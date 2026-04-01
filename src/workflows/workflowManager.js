const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { getWorkflowDefinitions } = require("./index");

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

class WorkflowManager {
  constructor({ config, taskManager, definitions } = {}) {
    this.config = config;
    this.taskManager = taskManager;
    const sourceDefinitions = Array.isArray(definitions) && definitions.length ? definitions : getWorkflowDefinitions();
    this.definitions = new Map(sourceDefinitions.map((workflow) => [workflow.id, workflow]));
    this.sessions = new Map();
    this.sessionsDir = path.resolve(
      this.config?.workflowSessionsDir || path.resolve(process.cwd(), "workflow-sessions")
    );
    this._persistQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await this._loadPersistedSessions();
  }

  list() {
    return [...this.definitions.values()].map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      supportsScheduling: workflow.supportsScheduling !== false
    }));
  }

  async createSession(workflowId, options = {}) {
    const workflow = this.definitions.get(workflowId);
    if (!workflow) return { ok: false, error: "not_found" };
    const allowedModes = new Set(["interactive", "schedule_config", "scheduled_run"]);
    const requestedMode = String(options?.mode || "interactive");
    const mode = allowedModes.has(requestedMode) ? requestedMode : "interactive";

    const session = {
      id: randomUUID(),
      workflowId,
      mode,
      status: "active",
      shouldPersist: mode !== "scheduled_run",
      resumedFromDisk: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
      state: await workflow.createInitialState({}, { config: this.config, taskManager: this.taskManager })
    };
    this.sessions.set(session.id, session);
    await this._persistSession(session);
    return { ok: true, session: this._serialize(session, workflow) };
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const workflow = this.definitions.get(session.workflowId);
    if (!workflow) return null;
    return this._serialize(session, workflow);
  }

  async advanceSession(sessionId, input) {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: "not_found" };
    const workflow = this.definitions.get(session.workflowId);
    if (!workflow) return { ok: false, error: "not_found" };
    const previousState = cloneState(session.state);

    const result = await workflow.advance(session, input || {}, {
      config: this.config,
      taskManager: this.taskManager
    });

    if (!result.ok) {
      return { ok: false, error: "advance_failed", message: result.error || "Workflow step failed" };
    }

    session.history.push(previousState);
    session.updatedAt = new Date().toISOString();
    await this._persistSession(session);
    return {
      ok: true,
      session: this._serialize(session, workflow),
      startedTaskId: result.startedTaskId || null
    };
  }

  async runScheduled(workflowId, inputs = []) {
    const created = await this.createSession(workflowId, { mode: "scheduled_run" });
    if (!created.ok) return created;
    const sessionId = created.session.id;
    const steps = Array.isArray(inputs) ? inputs : [];
    let startedTaskId = null;

    for (const input of steps) {
      const advanced = await this.advanceSession(sessionId, input || {});
      if (!advanced.ok) {
        return {
          ok: false,
          error: advanced.error || "advance_failed",
          message: advanced.message || "Workflow step failed during scheduled run"
        };
      }
      if (advanced.startedTaskId) {
        startedTaskId = advanced.startedTaskId;
        break;
      }
    }

    const session = this.getSession(sessionId);
    if (!startedTaskId && session?.currentStep?.type !== "complete") {
      return {
        ok: false,
        error: "workflow_requires_more_input",
        message: "Workflow still requires more step input",
        session
      };
    }

    return { ok: true, session, startedTaskId };
  }

  retreatSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: "not_found" };
    const workflow = this.definitions.get(session.workflowId);
    if (!workflow) return { ok: false, error: "not_found" };
    if (session.state.startedTaskId) {
      return { ok: false, error: "already_started", message: "Workflow has already started a task" };
    }
    if (!session.history.length) {
      return { ok: false, error: "at_start", message: "Already at the first workflow step" };
    }

    session.state = session.history.pop();
    session.updatedAt = new Date().toISOString();
    this._persistSession(session).catch(() => {});
    return { ok: true, session: this._serialize(session, workflow) };
  }

  _serialize(session, workflow) {
    return {
      id: session.id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      startedTaskId: session.state.startedTaskId || null,
      mode: session.mode || "interactive",
      resumedFromDisk: Boolean(session.resumedFromDisk),
      canGoBack: !session.state.startedTaskId && session.history.length > 0,
      bootstrapError: session.state.bootstrapError || null,
      debug: Array.isArray(session.state.debug) ? session.state.debug : [],
      currentStep: workflow.getCurrentStep(session)
    };
  }

  _sessionFile(sessionId) {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  _serializeForDisk(session) {
    return {
      id: session.id,
      workflowId: session.workflowId,
      mode: session.mode || "interactive",
      status: session.status || "active",
      shouldPersist: session.shouldPersist !== false,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      history: Array.isArray(session.history) ? session.history : [],
      state: session.state || {}
    };
  }

  _hydrateSession(data) {
    return {
      id: String(data.id),
      workflowId: String(data.workflowId),
      mode: String(data.mode || "interactive"),
      status: String(data.status || "active"),
      shouldPersist: data.shouldPersist !== false,
      resumedFromDisk: true,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      history: Array.isArray(data.history) ? data.history : [],
      state: data.state && typeof data.state === "object" ? data.state : {}
    };
  }

  async _loadPersistedSessions() {
    const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));

    for (const file of files) {
      const target = path.join(this.sessionsDir, file.name);
      try {
        const raw = await fs.readFile(target, "utf8");
        const data = JSON.parse(raw);
        if (!data?.id || !data?.workflowId) continue;
        if (!this.definitions.has(String(data.workflowId))) continue;
        const session = this._hydrateSession(data);
        this.sessions.set(session.id, session);
      } catch (err) {
        console.warn(`Failed to load workflow session ${target}: ${err.message || String(err)}`);
      }
    }
  }

  async _persistSession(session) {
    if (!session?.shouldPersist) return;

    const snapshot = JSON.stringify(this._serializeForDisk(session), null, 2);
    const target = this._sessionFile(session.id);
    const temp = `${target}.tmp`;

    const writeSession = async () => {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, target);
    };

    this._persistQueue = this._persistQueue.catch(() => {}).then(writeSession);
    return this._persistQueue;
  }
}

module.exports = { WorkflowManager };
