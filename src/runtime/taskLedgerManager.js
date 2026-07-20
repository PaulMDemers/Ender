const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { migratePersistedRecord, versionPersistedRecord } = require("../persistence/jsonRecord");

const TERMINAL_TASK_STATUSES = new Set(["done", "error", "canceled", "terminated", "blocked", "needs_input"]);
const EDITABLE_LEDGER_STATUSES = new Set(["pending", "completed", "failed", "canceled", "blocked", "needs_input"]);
const LEDGER_STAGE_VALUES = new Set([
  "queued",
  "intake",
  "feasibility_check",
  "workspace_scan",
  "plan",
  "implement",
  "verify",
  "finalize"
]);
const FEASIBILITY_VALUES = new Set(["unknown", "ready", "needs_input", "blocked", "rejected"]);
const VERIFICATION_VALUES = new Set(["pending", "running", "passed", "failed", "skipped"]);

function deriveTitle(prompt) {
  const raw = String(prompt || "").trim();
  if (!raw) return "";
  const firstLine = raw.split("\n").find((line) => String(line || "").trim()) || raw;
  return firstLine.trim().slice(0, 120);
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") return null;

  const kind = String(source.kind || "").trim();
  const label = String(source.label || "").trim();
  const referenceId = String(source.referenceId || "").trim();

  if (!kind && !label && !referenceId) return null;

  return {
    kind: kind || "external",
    label: label || null,
    referenceId: referenceId || null
  };
}

function normalizeTaskType(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw || "generic";
}

function normalizeStringArray(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split("\n")
      : [];

  const seen = new Set();
  const items = [];
  for (const item of source) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function createLifecycle(now, historySummary = "Entry created") {
  return {
    currentStage: "queued",
    stageSummary: historySummary,
    stageUpdatedAt: now,
    history: [{
      stage: "queued",
      summary: historySummary,
      at: now
    }],
    feasibility: {
      outcome: "unknown",
      summary: null,
      updatedAt: null
    },
    plan: {
      summary: null,
      checklist: [],
      verificationSteps: [],
      updatedAt: null
    },
    verification: {
      status: "pending",
      summary: null,
      evidence: [],
      updatedAt: null
    },
    outcome: {
      status: null,
      summary: null,
      updatedAt: null
    }
  };
}

function ensureLifecycle(lifecycle, fallbackNow) {
  const base = lifecycle && typeof lifecycle === "object" ? lifecycle : {};
  const history = Array.isArray(base.history) ? base.history : [];

  return {
    currentStage: LEDGER_STAGE_VALUES.has(base.currentStage) ? base.currentStage : "queued",
    stageSummary: base.stageSummary ? String(base.stageSummary) : "Entry created",
    stageUpdatedAt: base.stageUpdatedAt || fallbackNow,
    history: history.map((item) => ({
      stage: LEDGER_STAGE_VALUES.has(item?.stage) ? item.stage : "queued",
      summary: item?.summary ? String(item.summary) : "",
      at: item?.at || fallbackNow
    })),
    feasibility: {
      outcome: FEASIBILITY_VALUES.has(base.feasibility?.outcome) ? base.feasibility.outcome : "unknown",
      summary: base.feasibility?.summary ? String(base.feasibility.summary) : null,
      updatedAt: base.feasibility?.updatedAt || null
    },
    plan: {
      summary: base.plan?.summary ? String(base.plan.summary) : null,
      checklist: normalizeStringArray(base.plan?.checklist),
      verificationSteps: normalizeStringArray(base.plan?.verificationSteps),
      updatedAt: base.plan?.updatedAt || null
    },
    verification: {
      status: VERIFICATION_VALUES.has(base.verification?.status) ? base.verification.status : "pending",
      summary: base.verification?.summary ? String(base.verification.summary) : null,
      evidence: normalizeStringArray(base.verification?.evidence),
      updatedAt: base.verification?.updatedAt || null
    },
    outcome: {
      status: base.outcome?.status ? String(base.outcome.status) : null,
      summary: base.outcome?.summary ? String(base.outcome.summary) : null,
      updatedAt: base.outcome?.updatedAt || null
    }
  };
}

function appendStageHistory(lifecycle, stage, summary, at) {
  lifecycle.currentStage = stage;
  lifecycle.stageSummary = summary || null;
  lifecycle.stageUpdatedAt = at;
  lifecycle.history.push({
    stage,
    summary: summary || "",
    at
  });
}

function buildTaskLedgerTaskPrompt(entry) {
  const workspace = String(entry.workspace || "").trim();
  const title = String(entry.title || deriveTitle(entry.prompt) || "Ledger task").trim();
  const sourceKind = String(entry.source?.kind || "").trim();
  const sourceLabel = String(entry.source?.label || "").trim();
  const sourceReferenceId = String(entry.source?.referenceId || "").trim();
  const envelope = {
    ledgerEntryId: entry.id,
    taskType: entry.taskType || "generic",
    title,
    goal: String(entry.prompt || "").trim(),
    workspace: workspace || null,
    source: entry.source || { kind: "manual" },
    successCriteria: Array.isArray(entry.successCriteria) ? entry.successCriteria : [],
    constraints: Array.isArray(entry.constraints) ? entry.constraints : [],
    verificationPlan: Array.isArray(entry.verificationPlan) ? entry.verificationPlan : []
  };

  return [
    "Ender execution context: this request originated in the global task ledger.",
    "",
    `Task: ${title}`,
    sourceKind || sourceLabel || sourceReferenceId
      ? `Source: ${[sourceKind, sourceLabel, sourceReferenceId].filter(Boolean).join(" · ")}`
      : "Source: manual",
    workspace ? `Assigned workspace: ${workspace}` : "Assigned workspace: use the task workspace provided by Ender.",
    "",
    "Task envelope:",
    JSON.stringify(envelope, null, 2),
    "",
    "Execution policy:",
    "- Complete the original request autonomously when it is safe and feasible.",
    "- Inspect the workspace before changing files. For coding work, form a concrete plan and run useful verification.",
    "- Ender owns the ledger lifecycle. If ledger tools are available, use them for richer progress reporting; their absence is not a blocker and should not be mentioned in the final response.",
    "- Return the requested result directly. Do not narrate this envelope, the ledger procedure, or internal tool availability unless an actual blocker prevents completion.",
    "- Only report success when the request and its success criteria are satisfied. Otherwise state the missing input or blocker clearly.",
    "",
    "Original task request:",
    String(entry.prompt || "").trim()
  ].join("\n");
}

class TaskLedgerManager {
  constructor({ config, taskManager }) {
    this.config = config || {};
    this.taskManager = taskManager;
    this.ledgerDir = path.resolve(
      this.config.taskLedgerDir || path.resolve(process.cwd(), "task-ledger")
    );
    this.pollIntervalMs = Number.isFinite(this.config.taskLedgerPollIntervalMs)
      ? Math.max(0, Math.floor(this.config.taskLedgerPollIntervalMs))
      : 15_000;
    this.maxAutoAgents = Number.isFinite(this.config.taskLedgerMaxAutoAgents)
      ? Math.max(0, Math.floor(this.config.taskLedgerMaxAutoAgents))
      : 0;
    this.entries = new Map();
    this._persistQueue = Promise.resolve();
    this._reconcilePromise = null;
    this._pollTimer = null;
  }

  async init() {
    await fs.mkdir(this.ledgerDir, { recursive: true });
    await this._loadPersistedEntries();
    this._startPolling();
    await this.reconcile({ dispatch: true });
  }

  stop() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  list() {
    return [...this.entries.values()]
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .map((entry) => this._serialize(entry));
  }

  get(id) {
    const entry = this.entries.get(String(id));
    return entry ? this._serialize(entry) : null;
  }

  async recordStage(id, input) {
    const entry = this.entries.get(String(id));
    if (!entry) return { ok: false, error: "not_found" };

    const stage = String(input?.stage || "").trim();
    if (!LEDGER_STAGE_VALUES.has(stage)) {
      return { ok: false, error: "invalid_stage", message: "stage is invalid" };
    }

    const summary = String(input?.summary || "").trim() || null;
    const now = new Date().toISOString();
    appendStageHistory(entry.lifecycle, stage, summary, now);
    entry.updatedAt = now;
    await this._persistEntry(entry);
    return { ok: true, entry: this._serialize(entry) };
  }

  async reportFeasibility(id, input) {
    const entry = this.entries.get(String(id));
    if (!entry) return { ok: false, error: "not_found" };

    const outcome = String(input?.outcome || "").trim().toLowerCase();
    if (!FEASIBILITY_VALUES.has(outcome)) {
      return { ok: false, error: "invalid_feasibility", message: "feasibility outcome is invalid" };
    }

    const summary = String(input?.summary || "").trim() || null;
    const now = new Date().toISOString();
    entry.lifecycle.feasibility = {
      outcome,
      summary,
      updatedAt: now
    };
    appendStageHistory(entry.lifecycle, "feasibility_check", summary, now);
    entry.updatedAt = now;
    await this._persistEntry(entry);
    return { ok: true, entry: this._serialize(entry) };
  }

  async savePlan(id, input) {
    const entry = this.entries.get(String(id));
    if (!entry) return { ok: false, error: "not_found" };

    const now = new Date().toISOString();
    entry.lifecycle.plan = {
      summary: String(input?.summary || "").trim() || null,
      checklist: normalizeStringArray(input?.checklist),
      verificationSteps: normalizeStringArray(input?.verificationSteps),
      updatedAt: now
    };
    appendStageHistory(entry.lifecycle, "plan", entry.lifecycle.plan.summary, now);
    entry.updatedAt = now;
    await this._persistEntry(entry);
    return { ok: true, entry: this._serialize(entry) };
  }

  async reportVerification(id, input) {
    const entry = this.entries.get(String(id));
    if (!entry) return { ok: false, error: "not_found" };

    const status = String(input?.status || "").trim().toLowerCase();
    if (!VERIFICATION_VALUES.has(status)) {
      return { ok: false, error: "invalid_verification_status", message: "verification status is invalid" };
    }

    const now = new Date().toISOString();
    entry.lifecycle.verification = {
      status,
      summary: String(input?.summary || "").trim() || null,
      evidence: normalizeStringArray(input?.evidence),
      updatedAt: now
    };
    appendStageHistory(entry.lifecycle, "verify", entry.lifecycle.verification.summary, now);
    entry.updatedAt = now;
    await this._persistEntry(entry);
    return { ok: true, entry: this._serialize(entry) };
  }

  async create(input) {
    const validation = this._validateCreate(input);
    if (!validation.ok) return validation;

    const now = new Date().toISOString();
    const entry = {
      id: this._createEntryId(),
      title: validation.value.title,
      prompt: validation.value.prompt,
      taskType: validation.value.taskType,
      workspace: validation.value.workspace,
      autoRun: validation.value.autoRun,
      source: validation.value.source,
      successCriteria: validation.value.successCriteria,
      constraints: validation.value.constraints,
      verificationPlan: validation.value.verificationPlan,
      createdByTaskId: validation.value.createdByTaskId,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      startedTaskId: null,
      startedAt: null,
      completedTaskId: null,
      completedAt: null,
      attemptCount: 0,
      lastTaskStatus: null,
      lastError: null,
      result: null,
      lifecycle: createLifecycle(now)
    };

    this.entries.set(entry.id, entry);
    await this._persistEntry(entry);
    await this.reconcile({ dispatch: true });
    return { ok: true, entry: this._serialize(this.entries.get(entry.id) || entry) };
  }

  async update(id, input) {
    const entry = this.entries.get(String(id));
    if (!entry) return { ok: false, error: "not_found" };

    const validation = this._validateUpdate(input);
    if (!validation.ok) return validation;

    if (entry.status === "running" && validation.value.status && validation.value.status !== "running") {
      return {
        ok: false,
        error: "entry_running",
        message: "Running ledger entries cannot be edited until their linked task finishes."
      };
    }

    if (validation.value.title !== undefined) entry.title = validation.value.title;
    if (validation.value.prompt !== undefined) entry.prompt = validation.value.prompt;
    if (validation.value.taskType !== undefined) entry.taskType = validation.value.taskType;
    if (validation.value.workspace !== undefined) entry.workspace = validation.value.workspace;
    if (validation.value.autoRun !== undefined) entry.autoRun = validation.value.autoRun;
    if (validation.value.source !== undefined) entry.source = validation.value.source;
    if (validation.value.successCriteria !== undefined) entry.successCriteria = validation.value.successCriteria;
    if (validation.value.constraints !== undefined) entry.constraints = validation.value.constraints;
    if (validation.value.verificationPlan !== undefined) entry.verificationPlan = validation.value.verificationPlan;

    if (validation.value.status && validation.value.status !== entry.status) {
      if (entry.status === "running") {
        return {
          ok: false,
          error: "entry_running",
          message: "Running ledger entries cannot be reset or canceled through update."
        };
      }

      entry.status = validation.value.status;
      if (validation.value.status === "pending") {
        entry.startedTaskId = null;
        entry.startedAt = null;
        entry.completedTaskId = null;
        entry.completedAt = null;
        entry.lastTaskStatus = null;
        entry.lastError = null;
        entry.result = null;
        entry.lifecycle.outcome = {
          status: null,
          summary: null,
          updatedAt: null
        };
        appendStageHistory(entry.lifecycle, "queued", "Ledger entry reset to pending", new Date().toISOString());
      }

      if (validation.value.status === "canceled") {
        entry.completedAt = entry.completedAt || new Date().toISOString();
      }
    }

    entry.updatedAt = new Date().toISOString();
    await this._persistEntry(entry);

    if (entry.status === "pending" && entry.autoRun) {
      await this.reconcile({ dispatch: true });
    }

    return { ok: true, entry: this._serialize(this.entries.get(entry.id) || entry) };
  }

  async delete(id) {
    const entryId = String(id);
    const entry = this.entries.get(entryId);
    if (!entry) return { ok: false, error: "not_found" };

    if (entry.status === "running") {
      return {
        ok: false,
        error: "entry_running",
        message: "Running ledger entries cannot be deleted until their linked task finishes."
      };
    }

    this.entries.delete(entryId);
    const target = this._entryFile(entryId);
    const removeEntry = async () => {
      await fs.rm(target, { force: true });
    };

    this._persistQueue = this._persistQueue.catch(() => {}).then(removeEntry);
    await this._persistQueue;
    return { ok: true, id: entryId };
  }

  async runNow(id) {
    const entry = this.entries.get(String(id));
    if (!entry) return { ok: false, error: "not_found" };
    if (entry.status === "running") {
      return {
        ok: false,
        error: "entry_running",
        message: "Ledger entry is already running."
      };
    }

    const result = await this._dispatchEntry(entry, { ignoreCapacity: true });
    if (!result.ok) return result;
    return {
      ok: true,
      entry: this._serialize(result.entry),
      startedTaskId: result.startedTaskId
    };
  }

  async reconcile({ dispatch = true } = {}) {
    if (this._reconcilePromise) {
      return this._reconcilePromise;
    }

    this._reconcilePromise = (async () => {
      await this._syncRunningEntries();
      if (dispatch) {
        await this._dispatchPendingEntries();
      }
      return { ok: true };
    })().finally(() => {
      this._reconcilePromise = null;
    });

    return this._reconcilePromise;
  }

  _startPolling() {
    if (this.pollIntervalMs <= 0) return;
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      this.reconcile({ dispatch: true }).catch(() => {});
    }, this.pollIntervalMs);
    this._pollTimer.unref?.();
  }

  async _syncRunningEntries() {
    for (const entry of this.entries.values()) {
      if (entry.status !== "running") continue;

      const taskId = String(entry.startedTaskId || "").trim();
      if (!taskId) {
        entry.status = "failed";
        entry.completedAt = new Date().toISOString();
        entry.updatedAt = entry.completedAt;
        entry.lastTaskStatus = "missing_task_id";
        entry.lastError = "Running ledger entry is missing its linked task id.";
        await this._persistEntry(entry);
        continue;
      }

      const task = this.taskManager?.getTaskSummary?.(taskId);
      if (!task) {
        entry.status = "failed";
        entry.completedAt = new Date().toISOString();
        entry.updatedAt = entry.completedAt;
        entry.lastTaskStatus = "task_not_found";
        entry.lastError = "Linked task could not be found.";
        await this._persistEntry(entry);
        continue;
      }

      entry.lastTaskStatus = task.status || entry.lastTaskStatus;

      if (!TERMINAL_TASK_STATUSES.has(task.status)) {
        continue;
      }

      entry.completedTaskId = task.id;
      entry.completedAt = task.finishedAt || new Date().toISOString();
      entry.updatedAt = entry.completedAt;
      entry.result = task.result ?? null;

      if (entry.lifecycle.feasibility.outcome === "unknown") {
        entry.lifecycle.feasibility = {
          outcome: task.status === "done" ? "ready" : "blocked",
          summary: task.status === "done"
            ? "The linked worker completed the request without structured feasibility reporting."
            : "The linked worker ended before structured feasibility reporting completed.",
          updatedAt: entry.updatedAt
        };
      }

      if (entry.lifecycle.verification.status === "pending") {
        entry.lifecycle.verification = {
          status: task.status === "done" ? "skipped" : "failed",
          summary: task.status === "done"
            ? "The worker backend completed without structured verification evidence."
            : "Verification did not complete before the worker stopped.",
          evidence: [],
          updatedAt: entry.updatedAt
        };
        appendStageHistory(
          entry.lifecycle,
          "verify",
          entry.lifecycle.verification.summary,
          entry.updatedAt
        );
      }

      if (task.status === "done") {
        entry.status = "completed";
        entry.lastError = null;
      } else if (task.status === "needs_input") {
        entry.status = "needs_input";
        entry.lastError = "Linked task needs additional information before it can continue.";
      } else if (task.status === "blocked") {
        entry.status = "blocked";
        entry.lastError = "Linked task hit a blocker and could not complete autonomously.";
      } else if (task.status === "canceled" || task.status === "terminated") {
        entry.status = "canceled";
        entry.lastError = task.status === "terminated"
          ? "Linked task was terminated before completion."
          : "Linked task was canceled before completion.";
      } else {
        entry.status = "failed";
        entry.lastError = task.status === "error"
          ? "Linked task ended with error status."
          : `Linked task ended with status ${task.status}.`;
      }

      entry.lifecycle.outcome = {
        status: entry.status,
        summary: typeof entry.result === "string" && entry.result.trim()
          ? entry.result.trim()
          : entry.lastError || null,
        updatedAt: entry.updatedAt
      };
      appendStageHistory(entry.lifecycle, "finalize", entry.lifecycle.outcome.summary, entry.updatedAt);

      await this._persistEntry(entry);
    }
  }

  async _dispatchPendingEntries() {
    if (this.maxAutoAgents <= 0) return;

    const pending = [...this.entries.values()]
      .filter((entry) => entry.status === "pending" && entry.autoRun)
      .sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return aTime - bTime;
      });

    let remainingSlots = this.maxAutoAgents - this._countRunningEntries();
    if (remainingSlots <= 0) return;

    for (const entry of pending) {
      if (remainingSlots <= 0) break;
      const started = await this._dispatchEntry(entry, { ignoreCapacity: false });
      if (started.ok) {
        remainingSlots -= 1;
      }
    }
  }

  _countRunningEntries() {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "running") count += 1;
    }
    return count;
  }

  async _dispatchEntry(entry, { ignoreCapacity = false } = {}) {
    if (!entry) return { ok: false, error: "not_found" };
    if (entry.status === "running") {
      return { ok: false, error: "entry_running", message: "Ledger entry is already running." };
    }

    if (!ignoreCapacity && this.maxAutoAgents > 0 && this._countRunningEntries() >= this.maxAutoAgents) {
      return {
        ok: false,
        error: "no_capacity",
        message: "All automatic worker slots are currently in use."
      };
    }

    const started = this.taskManager?.start?.(
      entry.prompt,
      entry.workspace || undefined,
      {
        ledgerEntryId: entry.id,
        title: entry.title,
        executionPrompt: buildTaskLedgerTaskPrompt(entry)
      }
    );

    if (!started || !started.ok) {
      entry.status = "failed";
      entry.completedAt = new Date().toISOString();
      entry.updatedAt = entry.completedAt;
      entry.lastTaskStatus = "start_failed";
      entry.lastError = started?.message || started?.error || "Failed to start linked task.";
      await this._persistEntry(entry);
      return {
        ok: false,
        error: "task_start_failed",
        message: entry.lastError
      };
    }

    entry.status = "running";
    entry.updatedAt = new Date().toISOString();
    entry.startedTaskId = started.id;
    entry.startedAt = entry.updatedAt;
    entry.completedTaskId = null;
    entry.completedAt = null;
    entry.lastTaskStatus = "running";
    entry.lastError = null;
    entry.result = null;
    entry.attemptCount = Number.isFinite(entry.attemptCount) ? entry.attemptCount + 1 : 1;
    entry.lifecycle.outcome = {
      status: null,
      summary: null,
      updatedAt: null
    };
    appendStageHistory(entry.lifecycle, "intake", `Dispatched to thread ${started.id}`, entry.updatedAt);
    await this._persistEntry(entry);

    return { ok: true, entry, startedTaskId: started.id };
  }

  _validateCreate(input) {
    const prompt = String(input?.prompt || "").trim();
    const title = String(input?.title || deriveTitle(prompt)).trim();
    const taskType = normalizeTaskType(input?.taskType);
    const workspaceRaw = input?.workspace;
    const workspace = workspaceRaw == null ? null : String(workspaceRaw).trim() || null;
    const autoRun = input?.autoRun !== false;
    const source = normalizeSource(input?.source);
    const successCriteria = normalizeStringArray(input?.successCriteria);
    const constraints = normalizeStringArray(input?.constraints);
    const verificationPlan = normalizeStringArray(input?.verificationPlan);
    const createdByTaskId = input?.createdByTaskId ? String(input.createdByTaskId).trim() : null;

    if (!prompt) {
      return { ok: false, error: "prompt_required", message: "prompt is required" };
    }
    if (!title) {
      return { ok: false, error: "title_required", message: "title is required" };
    }

    return {
      ok: true,
      value: {
        title,
        prompt,
        taskType,
        workspace,
        autoRun,
        source,
        successCriteria,
        constraints,
        verificationPlan,
        createdByTaskId
      }
    };
  }

  _validateUpdate(input) {
    const next = {};

    if (Object.prototype.hasOwnProperty.call(input || {}, "title")) {
      const title = String(input?.title || "").trim();
      if (!title) return { ok: false, error: "title_required", message: "title cannot be empty" };
      next.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "prompt")) {
      const prompt = String(input?.prompt || "").trim();
      if (!prompt) return { ok: false, error: "prompt_required", message: "prompt cannot be empty" };
      next.prompt = prompt;
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "taskType")) {
      next.taskType = normalizeTaskType(input?.taskType);
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "workspace")) {
      next.workspace = input?.workspace == null ? null : String(input.workspace).trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "autoRun")) {
      next.autoRun = Boolean(input.autoRun);
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "source")) {
      next.source = normalizeSource(input?.source);
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "successCriteria")) {
      next.successCriteria = normalizeStringArray(input?.successCriteria);
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "constraints")) {
      next.constraints = normalizeStringArray(input?.constraints);
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "verificationPlan")) {
      next.verificationPlan = normalizeStringArray(input?.verificationPlan);
    }

    if (Object.prototype.hasOwnProperty.call(input || {}, "status")) {
      const status = String(input?.status || "").trim().toLowerCase();
      if (!EDITABLE_LEDGER_STATUSES.has(status)) {
        return {
          ok: false,
          error: "invalid_status",
          message: "status must be one of pending, completed, failed, canceled, blocked, or needs_input"
        };
      }
      next.status = status;
    }

    return { ok: true, value: next };
  }

  _createEntryId() {
    let id = randomUUID();
    while (this.entries.has(id)) {
      id = randomUUID();
    }
    return id;
  }

  _entryFile(entryId) {
    return path.join(this.ledgerDir, `${entryId}.json`);
  }

  _serialize(entry) {
    return {
      id: entry.id,
      title: entry.title,
      prompt: entry.prompt,
      taskType: entry.taskType || "generic",
      workspace: entry.workspace || null,
      autoRun: Boolean(entry.autoRun),
      source: entry.source || null,
      successCriteria: Array.isArray(entry.successCriteria) ? entry.successCriteria : [],
      constraints: Array.isArray(entry.constraints) ? entry.constraints : [],
      verificationPlan: Array.isArray(entry.verificationPlan) ? entry.verificationPlan : [],
      createdByTaskId: entry.createdByTaskId || null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      status: entry.status,
      startedTaskId: entry.startedTaskId || null,
      startedAt: entry.startedAt || null,
      completedTaskId: entry.completedTaskId || null,
      completedAt: entry.completedAt || null,
      attemptCount: Number.isFinite(entry.attemptCount) ? entry.attemptCount : 0,
      lastTaskStatus: entry.lastTaskStatus || null,
      lastError: entry.lastError || null,
      result: entry.result ?? null,
      lifecycle: ensureLifecycle(entry.lifecycle, entry.updatedAt || entry.createdAt || new Date().toISOString())
    };
  }

  async _loadPersistedEntries() {
    const entries = await fs.readdir(this.ledgerDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const filePath = path.join(this.ledgerDir, file);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const migrated = migratePersistedRecord(JSON.parse(raw), "taskLedgerEntry");
        const data = migrated.record;
        if (!data?.id || this.entries.has(String(data.id))) continue;
        const hydrated = {
          id: String(data.id),
          title: String(data.title || deriveTitle(data.prompt || "")),
          prompt: String(data.prompt || ""),
          taskType: normalizeTaskType(data.taskType),
          workspace: data.workspace ? String(data.workspace) : null,
          autoRun: data.autoRun !== false,
          source: normalizeSource(data.source),
          successCriteria: normalizeStringArray(data.successCriteria),
          constraints: normalizeStringArray(data.constraints),
          verificationPlan: normalizeStringArray(data.verificationPlan),
          createdByTaskId: data.createdByTaskId ? String(data.createdByTaskId) : null,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || data.createdAt || new Date().toISOString(),
          status: String(data.status || "pending"),
          startedTaskId: data.startedTaskId ? String(data.startedTaskId) : null,
          startedAt: data.startedAt || null,
          completedTaskId: data.completedTaskId ? String(data.completedTaskId) : null,
          completedAt: data.completedAt || null,
          attemptCount: Number.isFinite(data.attemptCount) ? data.attemptCount : 0,
          lastTaskStatus: data.lastTaskStatus ? String(data.lastTaskStatus) : null,
          lastError: data.lastError ? String(data.lastError) : null,
          result: data.result ?? null,
          lifecycle: ensureLifecycle(data.lifecycle, data.updatedAt || data.createdAt || new Date().toISOString())
        };
        this.entries.set(hydrated.id, hydrated);
        if (migrated.migrated) await this._persistEntry(hydrated);
      } catch (err) {
        console.warn(`Failed to load task ledger entry ${filePath}: ${err.message || String(err)}`);
      }
    }
  }

  async _persistEntry(entry) {
    const snapshot = JSON.stringify(
      versionPersistedRecord("taskLedgerEntry", this._serialize(entry)),
      null,
      2
    );
    const target = this._entryFile(entry.id);
    const temp = `${target}.tmp`;

    const writeEntry = async () => {
      await fs.mkdir(this.ledgerDir, { recursive: true });
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, target);
    };

    this._persistQueue = this._persistQueue.catch(() => {}).then(writeEntry);
    return this._persistQueue;
  }
}

module.exports = {
  TaskLedgerManager,
  buildTaskLedgerTaskPrompt
};
