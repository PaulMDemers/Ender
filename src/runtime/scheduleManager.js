const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const cron = require("node-cron");
const { contractDefinitions, scheduleInputSchema } = require("../shared/contracts");

class ScheduleManager {
  constructor({ config, taskManager, workflowManager }) {
    this.config = config;
    this.taskManager = taskManager;
    this.workflowManager = workflowManager;
    this.schedulesDir = path.resolve(config.schedulesDir || path.resolve(process.cwd(), "schedules"));
    this.schedules = new Map();
    this.jobs = new Map();
    this._persistQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.schedulesDir, { recursive: true });
    await this._loadPersistedSchedules();
    this._activateAll();
  }

  list() {
    return [...this.schedules.values()].map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      cron: schedule.cron,
      timezone: schedule.timezone || null,
      enabled: schedule.enabled,
      target: schedule.target,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      lastRunAt: schedule.lastRunAt || null,
      lastRunStatus: schedule.lastRunStatus || null,
      lastRunMessage: schedule.lastRunMessage || null
    }));
  }

  get(id) {
    return this.schedules.get(String(id)) || null;
  }

  async create(input) {
    const validation = this._validateInput(input);
    if (!validation.ok) return validation;

    const id = this._createId();
    const now = new Date().toISOString();
    const schedule = {
      id,
      name: validation.value.name,
      cron: validation.value.cron,
      timezone: validation.value.timezone || null,
      enabled: validation.value.enabled,
      target: validation.value.target,
      createdAt: now,
      updatedAt: now,
      createdByTaskId: validation.value.createdByTaskId || null,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null
    };

    this.schedules.set(id, schedule);
    if (schedule.enabled) this._activate(schedule);
    await this._persistSchedule(schedule);
    return { ok: true, schedule: this._serialize(schedule) };
  }

  async update(id, input) {
    const current = this.schedules.get(String(id));
    if (!current) return { ok: false, error: "not_found" };

    const merged = {
      name: input?.name ?? current.name,
      cron: input?.cron ?? current.cron,
      timezone: input?.timezone ?? current.timezone,
      enabled: input?.enabled ?? current.enabled,
      createdByTaskId: current.createdByTaskId,
      target: input?.target ?? current.target
    };

    const validation = this._validateInput(merged);
    if (!validation.ok) return validation;
    const nextValue = validation.value;

    current.name = nextValue.name;
    current.cron = nextValue.cron;
    current.timezone = nextValue.timezone || null;
    current.enabled = nextValue.enabled;
    current.target = nextValue.target;
    current.updatedAt = new Date().toISOString();

    if (current.enabled) this._activate(current);
    else this._deactivate(current.id);

    await this._persistSchedule(current);
    return { ok: true, schedule: this._serialize(current) };
  }

  async delete(id) {
    const schedule = this.schedules.get(String(id));
    if (!schedule) return { ok: false, error: "not_found" };
    this._deactivate(schedule.id);
    this.schedules.delete(schedule.id);
    await this._deleteScheduleFile(schedule.id);
    return { ok: true };
  }

  async runNow(id) {
    const schedule = this.schedules.get(String(id));
    if (!schedule) return { ok: false, error: "not_found" };
    return this._execute(schedule);
  }

  async _execute(schedule) {
    schedule.lastRunAt = new Date().toISOString();
    schedule.updatedAt = schedule.lastRunAt;

    let result;
    try {
      if (schedule.target.kind === "prompt") {
        result = this.taskManager.start(schedule.target.prompt, schedule.target.workspace || undefined, {
          projectId: schedule.target.projectId || null,
          llmProfileId: schedule.target.llmProfileId || null,
          memoryMode: schedule.target.memoryMode || "auto"
        });
        if (!result.ok) {
          throw new Error(result.message || result.error || "prompt schedule failed");
        }
        schedule.lastRunStatus = "ok";
        schedule.lastRunMessage = `started task ${result.id}`;
      } else if (schedule.target.kind === "thread") {
        result = this.taskManager.continueTask(schedule.target.threadId, schedule.target.prompt);
        if (!result.ok) {
          throw new Error(result.message || result.error || "thread schedule failed");
        }
        schedule.lastRunStatus = "ok";
        schedule.lastRunMessage = `continued thread ${schedule.target.threadId}`;
      } else if (schedule.target.kind === "workflow") {
        result = await this.workflowManager.runScheduled(
          schedule.target.workflowId,
          schedule.target.inputs || []
        );
        if (!result.ok) {
          throw new Error(result.message || result.error || "workflow schedule failed");
        }
        schedule.lastRunStatus = "ok";
        schedule.lastRunMessage = result.startedTaskId
          ? `workflow started task ${result.startedTaskId}`
          : "workflow completed";
      } else {
        throw new Error(`Unsupported schedule target kind: ${schedule.target.kind}`);
      }
    } catch (err) {
      schedule.lastRunStatus = "error";
      schedule.lastRunMessage = err.message || String(err);
    }

    await this._persistSchedule(schedule);
    return {
      ok: schedule.lastRunStatus === "ok",
      status: schedule.lastRunStatus,
      message: schedule.lastRunMessage
    };
  }

  _activateAll() {
    for (const schedule of this.schedules.values()) {
      if (schedule.enabled) this._activate(schedule);
    }
  }

  _activate(schedule) {
    this._deactivate(schedule.id);
    const job = cron.schedule(schedule.cron, () => {
      this._execute(schedule).catch((err) => {
        schedule.lastRunStatus = "error";
        schedule.lastRunMessage = err.message || String(err);
        schedule.lastRunAt = new Date().toISOString();
        schedule.updatedAt = schedule.lastRunAt;
        this._persistSchedule(schedule).catch(() => {});
      });
    }, {
      timezone: schedule.timezone || undefined
    });
    this.jobs.set(schedule.id, job);
  }

  _deactivate(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.stop();
    this.jobs.delete(id);
  }

  _validateInput(input) {
    const name = String(input?.name || "").trim();
    const cronExpr = String(input?.cron || "").trim();
    const timezone = String(input?.timezone || "").trim();
    const enabled = input?.enabled !== false;
    const createdByTaskId = input?.createdByTaskId ? String(input.createdByTaskId).trim() : null;
    const target = input?.target && typeof input.target === "object" ? input.target : null;

    if (!name) return { ok: false, error: "name_required", message: "name is required" };
    if (!cronExpr) return { ok: false, error: "cron_required", message: "cron is required" };
    if (!cron.validate(cronExpr)) {
      return { ok: false, error: "invalid_cron", message: "cron expression is invalid" };
    }
    if (!target) {
      return { ok: false, error: "target_required", message: "target is required" };
    }

    const normalized = {
      name,
      cron: cronExpr,
      timezone: timezone || null,
      enabled,
      createdByTaskId,
      target: {
        kind: String(target.kind || "").trim(),
        prompt: target.prompt ? String(target.prompt).trim() : undefined,
        workspace: target.workspace ? String(target.workspace).trim() : null,
        projectId: target.projectId ? String(target.projectId).trim() : null,
        llmProfileId: target.llmProfileId ? String(target.llmProfileId).trim() : null,
        memoryMode: target.memoryMode ? String(target.memoryMode).trim() : undefined,
        threadId: target.threadId ? String(target.threadId).trim() : undefined,
        workflowId: target.workflowId ? String(target.workflowId).trim() : undefined,
        inputs: Array.isArray(target.inputs) ? target.inputs : []
      }
    };

    const parsed = scheduleInputSchema.safeParse(normalized);
    if (parsed.success) {
      return { ok: true, value: parsed.data };
    }

    const kind = normalized.target.kind;
    if (!contractDefinitions.scheduleTargetKinds.includes(kind)) {
      return {
        ok: false,
        error: "invalid_target_kind",
        message: `target.kind must be ${contractDefinitions.scheduleTargetKinds.join(", ")}`
      };
    }
    if (kind === "prompt") {
      return { ok: false, error: "prompt_required", message: "target.prompt is required" };
    }
    if (kind === "thread") {
      if (!normalized.target.threadId) {
        return { ok: false, error: "thread_id_required", message: "target.threadId is required" };
      }
      return { ok: false, error: "prompt_required", message: "target.prompt is required" };
    }
    if (kind === "workflow") {
      return { ok: false, error: "workflow_id_required", message: "target.workflowId is required" };
    }

    return { ok: false, error: "target_invalid", message: "target is invalid" };
  }

  _serialize(schedule) {
    return {
      id: schedule.id,
      name: schedule.name,
      cron: schedule.cron,
      timezone: schedule.timezone || null,
      enabled: schedule.enabled,
      target: schedule.target,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      createdByTaskId: schedule.createdByTaskId || null,
      lastRunAt: schedule.lastRunAt || null,
      lastRunStatus: schedule.lastRunStatus || null,
      lastRunMessage: schedule.lastRunMessage || null
    };
  }

  _hydrate(data) {
    const schedule = {
      id: String(data.id),
      name: String(data.name || "Untitled Schedule"),
      cron: String(data.cron || ""),
      timezone: data.timezone ? String(data.timezone) : null,
      enabled: data.enabled !== false,
      target: data.target || {},
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      createdByTaskId: data.createdByTaskId ? String(data.createdByTaskId) : null,
      lastRunAt: data.lastRunAt || null,
      lastRunStatus: data.lastRunStatus || null,
      lastRunMessage: data.lastRunMessage || null
    };
    return schedule;
  }

  _createId() {
    let id = randomUUID();
    while (this.schedules.has(id)) id = randomUUID();
    return id;
  }

  _scheduleFile(id) {
    return path.join(this.schedulesDir, `${id}.json`);
  }

  async _loadPersistedSchedules() {
    const entries = await fs.readdir(this.schedulesDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(this.schedulesDir, file.name);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed?.id) continue;
        const candidate = this._hydrate(parsed);
        const valid = this._validateInput({
          name: candidate.name,
          cron: candidate.cron,
          timezone: candidate.timezone,
          enabled: candidate.enabled,
          createdByTaskId: candidate.createdByTaskId,
          target: candidate.target
        });
        if (!valid.ok) continue;
        this.schedules.set(candidate.id, candidate);
      } catch (err) {
        console.warn(`Failed to load schedule ${filePath}: ${err.message || String(err)}`);
      }
    }
  }

  async _persistSchedule(schedule) {
    const snapshot = JSON.stringify(this._serialize(schedule), null, 2);
    const target = this._scheduleFile(schedule.id);
    const temp = `${target}.tmp`;
    const writeSchedule = async () => {
      await fs.mkdir(this.schedulesDir, { recursive: true });
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, target);
    };
    this._persistQueue = this._persistQueue.catch(() => {}).then(writeSchedule);
    return this._persistQueue;
  }

  async _deleteScheduleFile(id) {
    const target = this._scheduleFile(id);
    const temp = `${target}.tmp`;
    const removeSchedule = async () => {
      await fs.rm(temp, { force: true });
      await fs.rm(target, { force: true });
    };
    this._persistQueue = this._persistQueue.catch(() => {}).then(removeSchedule);
    return this._persistQueue;
  }
}

module.exports = { ScheduleManager };
