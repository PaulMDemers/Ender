const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { runTask } = require("./runTask");

class TaskManager {
  constructor(config) {
    this.config = config;
    this.scheduleManager = null;
    this.tasks = new Map();
    this.maxLogs = 5000;
    this.threadsDir = path.resolve(this.config.threadsDir || path.resolve(process.cwd(), "threads"));
    this._persistQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.threadsDir, { recursive: true });
    await this._loadPersistedTasks();
  }

  setScheduleManager(scheduleManager) {
    this.scheduleManager = scheduleManager || null;
  }

  async listWorkspaces() {
    const base = path.resolve(this.config.workspaceBase);
    await fs.mkdir(base, { recursive: true });
    const entries = await fs.readdir(base, { withFileTypes: true });
    const dirs = entries
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));

    return {
      base,
      items: dirs.map((dir) => ({
        label: dir,
        value: dir,
        absolutePath: path.resolve(base, dir)
      }))
    };
  }

  async listDirectories(inputPath) {
    const raw = String(inputPath || "").trim();
    const target = raw ? path.resolve(raw) : path.parse(process.cwd()).root;
    const st = await fs.stat(target);
    if (!st.isDirectory()) {
      throw new Error("Path is not a directory");
    }
    const entries = await fs.readdir(target, { withFileTypes: true });
    const dirs = entries
      .filter((d) => d.isDirectory())
      .map((d) => ({
        name: d.name,
        path: path.join(target, d.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      current: target,
      parent: path.dirname(target) !== target ? path.dirname(target) : null,
      items: dirs
    };
  }

  list() {
    return [...this.tasks.values()].map((t) => ({
      id: t.id,
      goal: t.goal,
      status: t.status,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt || null,
      logCount: t.logs.length,
      runCount: t.runCount,
      pendingApprovalCount: t.pendingApprovals.size,
      workspace: t.workspace,
      workspaceLabel: t.workspaceLabel
    }));
  }

  get(id) {
    const t = this.tasks.get(id);
    if (!t) return null;
    return {
      id: t.id,
      goal: t.goal,
      status: t.status,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt || null,
      result: t.result || null,
      logCount: t.logs.length,
      runCount: t.runCount,
      workspace: t.workspace,
      workspaceLabel: t.workspaceLabel,
      pendingApprovals: [...t.pendingApprovals.values()].map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.description,
        details: a.details,
        requestedAt: a.requestedAt
      }))
    };
  }

  getLogs(id, from = 0) {
    const t = this.tasks.get(id);
    if (!t) return null;
    const start = Math.max(0, Number(from) || 0);
    const entries = t.logs.slice(start);
    return { from: start, to: start + entries.length, entries };
  }

  rerun(id) {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, error: "not_found" };
    const started = this.start(t.goal, t.workspaceLabel || t.workspace);
    if (!started.ok) return started;
    return { ok: true, id: started.id };
  }

  continueTask(id, prompt) {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, error: "not_found" };
    if (t.status === "running" || t.status === "awaiting_approval") {
      return { ok: false, error: "task_busy" };
    }

    const clean = String(prompt || "").trim();
    if (!clean) return { ok: false, error: "prompt_required" };

    t.goal = clean;
    t.thread.push({ role: "user", content: clean });
    this._schedulePersist(t);
    this._runThread(t);
    return { ok: true, id: t.id };
  }

  resolveApproval(taskId, approvalId, approved) {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, error: "not_found" };

    const approval = task.pendingApprovals.get(approvalId);
    if (!approval) return { ok: false, error: "approval_not_found" };

    task.pendingApprovals.delete(approvalId);
    approval.resolve(Boolean(approved));

    const msg = approved ? `approval granted (${approvalId})` : `approval denied (${approvalId})`;
    this._push(task, { level: approved ? "info" : "warn", data: msg });
    this._broadcastLog(task, this._normalizeLog({ level: approved ? "info" : "warn", data: msg }));

    if (task.pendingApprovals.size === 0 && task.status === "awaiting_approval") {
      task.status = "running";
      this._broadcastStatus(task);
    }

    this._schedulePersist(task);
    return { ok: true };
  }

  terminate(id) {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, error: "not_found" };

    if (t.status === "running" || t.status === "awaiting_approval") {
      t.status = "terminated";
      this._push(t, { level: "warn", data: "Task marked as terminated" });
      this._broadcastStatus(t);
      this._broadcastEvent(t, "complete", { status: t.status, result: t.result || null });
      this._closeSubscribers(t);

      for (const approval of t.pendingApprovals.values()) {
        approval.resolve(false);
      }
      t.pendingApprovals.clear();
      t.finishedAt = t.finishedAt || new Date().toISOString();
      this._schedulePersist(t);
    }

    return { ok: true };
  }

  cancel(id) {
    return this.terminate(id);
  }

  async delete(id, options = {}) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, error: "not_found" };
    const deleteWorkspace = Boolean(options && options.deleteWorkspace);
    const workspacePath = task.workspace ? path.resolve(task.workspace) : null;
    const workspaceDeletion = {
      attempted: deleteWorkspace && Boolean(workspacePath),
      deleted: false,
      reason: null,
      path: workspacePath
    };

    task.deleted = true;
    clearTimeout(task.persistTimer);

    if (task.status === "running" || task.status === "awaiting_approval") {
      task.status = "terminated";
      for (const approval of task.pendingApprovals.values()) {
        approval.resolve(false);
      }
      task.pendingApprovals.clear();
      this._closeSubscribers(task);
    }

    this.tasks.delete(id);
    if (deleteWorkspace && workspacePath) {
      if (!this._canDeleteWorkspace(workspacePath)) {
        workspaceDeletion.reason = "protected_workspace";
      } else if (this._isWorkspaceInUseByOtherTask(id, workspacePath)) {
        workspaceDeletion.reason = "still_in_use";
      } else {
        try {
          if (!fsSync.existsSync(workspacePath)) {
            workspaceDeletion.reason = "not_found";
          } else {
            await fs.rm(workspacePath, { recursive: true, force: true });
            workspaceDeletion.deleted = true;
          }
        } catch (err) {
          workspaceDeletion.reason = "delete_failed";
          workspaceDeletion.message = err.message || String(err);
        }
      }
    }

    try {
      await this._deleteTaskFile(id);
    } catch (err) {
      console.warn(`Failed to delete persisted thread ${id}: ${err.message || String(err)}`);
    }

    return { ok: true, workspaceDeletion };
  }

  start(goal, workspaceInput) {
    let workspace;
    let workspaceLabel;
    try {
      const resolved = this._resolveWorkspace(workspaceInput);
      workspace = resolved.workspace;
      workspaceLabel = resolved.workspaceLabel;
    } catch (err) {
      return { ok: false, error: "invalid_workspace", message: err.message || String(err) };
    }

    const id = this._createTaskId();
    const cleanGoal = String(goal || "").trim();
    const task = {
      id,
      goal: cleanGoal,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logs: [],
      subs: new Set(),
      result: null,
      runCount: 0,
      thread: [{ role: "user", content: cleanGoal }],
      pendingApprovals: new Map(),
      workspace,
      workspaceLabel
    };
    this.tasks.set(id, task);
    this._schedulePersist(task);
    this._runThread(task);
    return { ok: true, id };
  }

  sse(id, res) {
    const t = this.tasks.get(id);
    if (!t) return false;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(`event: status\ndata: ${JSON.stringify({ t: Date.now(), status: t.status })}\n\n`);
    for (const log of t.logs) {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    }

    for (const approval of t.pendingApprovals.values()) {
      const payload = {
        id: approval.id,
        type: approval.type,
        title: approval.title,
        description: approval.description,
        details: approval.details,
        requestedAt: approval.requestedAt
      };
      res.write(`event: approval_required\ndata: ${JSON.stringify(payload)}\n\n`);
    }

    if (t.status === "done" || t.status === "error" || t.status === "canceled" || t.status === "terminated") {
      res.write(`event: complete\ndata: ${JSON.stringify({ status: t.status, result: t.result || null })}\n\n`);
      res.end();
      return true;
    }

    const hb = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, 15000);

    t.subs.add(res);

    const cleanup = () => {
      clearInterval(hb);
      t.subs.delete(res);
      try {
        res.end();
      } catch {
        // no-op
      }
    };

    res.on("close", cleanup);
    res.on("finish", cleanup);
    return true;
  }

  _resolveWorkspace(workspaceInput) {
    if (!workspaceInput || !String(workspaceInput).trim()) {
      return {
        workspace: path.resolve(this.config.workdir),
        workspaceLabel: path.resolve(this.config.workdir)
      };
    }

    const requested = String(workspaceInput).trim();
    const candidate = path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(process.cwd(), requested);

    if (!fsSync.existsSync(candidate)) {
      throw new Error("Workspace does not exist");
    }
    const st = fsSync.statSync(candidate);
    if (!st.isDirectory()) {
      throw new Error("Workspace is not a directory");
    }

    return {
      workspace: candidate,
      workspaceLabel: requested
    };
  }

  _isWorkspaceInUseByOtherTask(taskId, workspacePath) {
    const target = path.resolve(workspacePath);
    for (const [id, task] of this.tasks.entries()) {
      if (id === taskId) continue;
      if (!task.workspace) continue;
      if (path.resolve(task.workspace) === target) {
        return true;
      }
    }
    return false;
  }

  _isWorkspaceChildOfRoot(workspacePath) {
    const root = path.resolve(this.config.workdir);
    const target = path.resolve(workspacePath);
    const relative = path.relative(root, target);

    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  _canDeleteWorkspace(workspacePath) {
    const target = path.resolve(workspacePath);
    const rootPath = path.parse(target).root;
    const workdir = path.resolve(this.config.workdir);
    const workspaceBase = this.config.workspaceBase ? path.resolve(this.config.workspaceBase) : null;
    if (target === rootPath) return false;
    if (target === workdir) return false;
    if (workspaceBase && target === workspaceBase) return false;
    return this._isWorkspaceChildOfRoot(target);
  }

  _renderPrompt(thread) {
    const recent = thread.slice(-12);
    const transcript = recent
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    return [
      "Continue this thread while preserving context.",
      "If earlier context conflicts with latest user request, prioritize the latest user request.",
      "",
      transcript
    ].join("\n");
  }

  _requestApproval(task, payload) {
    const id = randomUUID();
    return new Promise((resolve) => {
      const approval = {
        id,
        type: payload.type || "generic",
        title: payload.title || "Approval required",
        description: payload.description || "Please confirm this action",
        details: payload.details || {},
        requestedAt: new Date().toISOString(),
        resolve
      };

      task.pendingApprovals.set(id, approval);
      task.status = "awaiting_approval";
      this._broadcastStatus(task);
      this._schedulePersist(task);
      this._broadcastEvent(task, "approval_required", {
        id: approval.id,
        type: approval.type,
        title: approval.title,
        description: approval.description,
        details: approval.details,
        requestedAt: approval.requestedAt
      });
    });
  }

  _runThread(task) {
    task.status = "running";
    task.finishedAt = null;
    task.runCount += 1;
    this._broadcastStatus(task);
    this._schedulePersist(task);

    const onLog = (entry) => {
      this._push(task, entry);
      this._broadcastLog(task, this._normalizeLog(entry));
    };

    const requestApproval = (payload) => this._requestApproval(task, payload);
    const goal = this._renderPrompt(task.thread);

    (async () => {
      try {
        const { result } = await runTask({
          goal,
          config: this.config,
          onLog,
          requestApproval,
          workspaceDir: task.workspace,
          taskId: task.id,
          scheduleManager: this.scheduleManager
        });

        if (task.deleted || task.status === "canceled" || task.status === "terminated") return;

        task.status = "done";
        task.result = result;
        task.finishedAt = new Date().toISOString();
        task.thread.push({ role: "assistant", content: String(result) });
        const finalEntry = { level: "info", data: `final: ${String(result).slice(0, 2000)}` };
        this._push(task, finalEntry);
        this._broadcastLog(task, this._normalizeLog(finalEntry));
        this._broadcastStatus(task);
        await this._persistTask(task);
        this._broadcastEvent(task, "complete", { status: task.status, result: task.result });
        this._closeSubscribers(task);
      } catch (err) {
        task.status = "error";
        task.finishedAt = new Date().toISOString();
        task.result = null;
        const errorEntry = { level: "error", data: err && err.stack ? err.stack : String(err) };
        this._push(task, errorEntry);
        this._broadcastLog(task, this._normalizeLog(errorEntry));
        this._broadcastStatus(task);
        await this._persistTask(task);
        this._broadcastEvent(task, "complete", { status: task.status, result: null });
        this._closeSubscribers(task);
      }
    })();
  }

  _normalizeLog(entry) {
    return {
      t: Date.now(),
      level: entry.level || "info",
      data: String(entry.data || "")
    };
  }

  _push(task, entry) {
    const item = this._normalizeLog(entry);
    task.logs.push(item);
    if (task.logs.length > this.maxLogs) {
      task.logs.splice(0, task.logs.length - this.maxLogs);
    }
    this._schedulePersist(task);
  }

  _broadcastLog(task, item) {
    this._safeBroadcast(task, "log", item);
  }

  _broadcastStatus(task) {
    this._safeBroadcast(task, "status", { t: Date.now(), status: task.status });
  }

  _broadcastEvent(task, eventName, data) {
    this._safeBroadcast(task, eventName, data);
  }

  _safeBroadcast(task, eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    const dead = [];

    for (const res of task.subs) {
      try {
        res.write(payload);
      } catch {
        dead.push(res);
      }
    }

    for (const res of dead) {
      task.subs.delete(res);
      try {
        res.end();
      } catch {
        // no-op
      }
    }
  }

  _closeSubscribers(task) {
    for (const res of task.subs) {
      try {
        res.end();
      } catch {
        // no-op
      }
    }
    task.subs.clear();
  }

  _createTaskId() {
    let id = randomUUID();
    while (this.tasks.has(id)) {
      id = randomUUID();
    }
    return id;
  }

  _taskFile(taskId) {
    return path.join(this.threadsDir, `${taskId}.json`);
  }

  _serializeTask(task) {
    return {
      id: task.id,
      goal: task.goal,
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt || null,
      logs: Array.isArray(task.logs) ? task.logs : [],
      result: task.result ?? null,
      runCount: Number.isFinite(task.runCount) ? task.runCount : 0,
      thread: Array.isArray(task.thread) ? task.thread : [],
      workspace: task.workspace,
      workspaceLabel: task.workspaceLabel || task.workspace,
      pendingApprovals: [...task.pendingApprovals.values()].map((approval) => ({
        id: approval.id,
        type: approval.type,
        title: approval.title,
        description: approval.description,
        details: approval.details,
        requestedAt: approval.requestedAt
      }))
    };
  }

  _hydrateTask(data) {
    const task = {
      id: String(data.id),
      goal: String(data.goal || ""),
      status: String(data.status || "error"),
      startedAt: data.startedAt || new Date().toISOString(),
      finishedAt: data.finishedAt || null,
      logs: Array.isArray(data.logs) ? data.logs.slice(-this.maxLogs) : [],
      subs: new Set(),
      result: data.result ?? null,
      runCount: Number.isFinite(data.runCount) ? data.runCount : 0,
      thread: Array.isArray(data.thread) ? data.thread : [],
      pendingApprovals: new Map(),
      workspace: String(data.workspace || this.config.workdir),
      workspaceLabel: String(data.workspaceLabel || data.workspace || this.config.workdir)
    };

    const approvals = Array.isArray(data.pendingApprovals) ? data.pendingApprovals : [];
    for (const approval of approvals) {
      task.pendingApprovals.set(String(approval.id), {
        id: String(approval.id),
        type: approval.type || "generic",
        title: approval.title || "Approval required",
        description: approval.description || "Please confirm this action",
        details: approval.details || {},
        requestedAt: approval.requestedAt || new Date().toISOString(),
        resolve: () => {}
      });
    }

    if (task.status === "running" || task.status === "awaiting_approval") {
      task.status = "error";
      task.finishedAt = new Date().toISOString();
      task.pendingApprovals.clear();
      const restartEntry = this._normalizeLog({
        level: "warn",
        data: "Task interrupted by server restart before completion"
      });
      task.logs.push(restartEntry);
      if (task.logs.length > this.maxLogs) {
        task.logs.splice(0, task.logs.length - this.maxLogs);
      }
    }

    return task;
  }

  async _loadPersistedTasks() {
    const entries = await fs.readdir(this.threadsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const filePath = path.join(this.threadsDir, file);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const data = JSON.parse(raw);
        if (!data || !data.id || this.tasks.has(String(data.id))) continue;
        const task = this._hydrateTask(data);
        this.tasks.set(task.id, task);
        await this._persistTask(task);
      } catch (err) {
        console.warn(`Failed to load persisted thread ${filePath}: ${err.message || String(err)}`);
      }
    }
  }

  _schedulePersist(task) {
    clearTimeout(task.persistTimer);
    task.persistTimer = setTimeout(() => {
      this._persistTask(task).catch((err) => {
        console.warn(`Failed to persist thread ${task.id}: ${err.message || String(err)}`);
      });
    }, 25);
    task.persistTimer.unref?.();
  }

  async _persistTask(task) {
    if (task.deleted) return;
    clearTimeout(task.persistTimer);
    const snapshot = JSON.stringify(this._serializeTask(task), null, 2);
    const target = this._taskFile(task.id);
    const temp = `${target}.tmp`;

    const writeTask = async () => {
      await fs.mkdir(this.threadsDir, { recursive: true });
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, target);
    };

    this._persistQueue = this._persistQueue.catch(() => {}).then(writeTask);

    return this._persistQueue;
  }

  async _deleteTaskFile(taskId) {
    const target = this._taskFile(taskId);
    const temp = `${target}.tmp`;
    const removeTask = async () => {
      await fs.rm(temp, { force: true });
      await fs.rm(target, { force: true });
    };

    this._persistQueue = this._persistQueue.catch(() => {}).then(removeTask);
    return this._persistQueue;
  }
}

module.exports = { TaskManager };
