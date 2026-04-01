const { randomUUID } = require("node:crypto");
const { getWorkflowDefinitions } = require("./index");

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

class WorkflowManager {
  constructor({ config, taskManager }) {
    this.config = config;
    this.taskManager = taskManager;
    this.definitions = new Map(getWorkflowDefinitions().map((workflow) => [workflow.id, workflow]));
    this.sessions = new Map();
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
      state: await workflow.createInitialState({}, { config: this.config, taskManager: this.taskManager })
    };
    this.sessions.set(session.id, session);
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
      canGoBack: !session.state.startedTaskId && session.history.length > 0,
      bootstrapError: session.state.bootstrapError || null,
      debug: Array.isArray(session.state.debug) ? session.state.debug : [],
      currentStep: workflow.getCurrentStep(session)
    };
  }
}

module.exports = { WorkflowManager };
