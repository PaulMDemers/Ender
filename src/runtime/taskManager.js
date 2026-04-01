const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { sanitizeJsonValue, sanitizeString } = require("../utils/jsonSafe");

const THREAD_CONTEXT_LIMIT = 12;

class TaskManager {
  constructor(config) {
    this.config = config;
    this.scheduleManager = null;
    this.selfUpdateManager = null;
    this.tasks = new Map();
    this.maxLogs = 5000;
    this.threadsDir = path.resolve(this.config.threadsDir || path.resolve(process.cwd(), "threads"));
    this._persistQueue = Promise.resolve();
  }

  _isTerminalStatus(status) {
    return status === "done" || status === "error" || status === "canceled" || status === "terminated";
  }

  async init() {
    await fs.mkdir(this.threadsDir, { recursive: true });
    await this._loadPersistedTasks();
  }

  setScheduleManager(scheduleManager) {
    this.scheduleManager = scheduleManager || null;
  }

  setSelfUpdateManager(selfUpdateManager) {
    this.selfUpdateManager = selfUpdateManager || null;
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
      workspaceLabel: t.workspaceLabel,
      parentTaskId: t.parentTaskId || null,
      childTaskIds: Array.isArray(t.childTaskIds) ? [...t.childTaskIds] : []
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
      parentTaskId: t.parentTaskId || null,
      childTaskIds: Array.isArray(t.childTaskIds) ? [...t.childTaskIds] : [],
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

  getTaskSummary(id, options = {}) {
    const task = this.tasks.get(id);
    if (!task) return null;
    return this._taskSummary(task, options);
  }

  async waitForTask(id, options = {}) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, error: "not_found" };

    const hasTimeout = options.timeoutMs !== null && options.timeoutMs !== undefined;
    const timeoutMsRaw = Number(options.timeoutMs);
    const timeoutMs = hasTimeout && Number.isFinite(timeoutMsRaw) && timeoutMsRaw >= 0 ? Math.floor(timeoutMsRaw) : null;
    const includeLogs = Boolean(options.includeLogs);

    if (this._isTerminalStatus(task.status)) {
      return {
        ok: true,
        timedOut: false,
        task: this._taskSummary(task, { includeLogs })
      };
    }

    if (timeoutMs === 0) {
      return {
        ok: true,
        timedOut: true,
        task: this._taskSummary(task, { includeLogs })
      };
    }

    return new Promise((resolve) => {
      const waiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          task.waiters.delete(waiter);
          resolve({
            ok: true,
            timedOut: false,
            task: this._taskSummary(task, { includeLogs })
          });
        },
        timer: null
      };

      if (timeoutMs !== null && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          task.waiters.delete(waiter);
          resolve({
            ok: true,
            timedOut: true,
            task: this._taskSummary(task, { includeLogs })
          });
        }, timeoutMs);
        waiter.timer.unref?.();
      }

      task.waiters.add(waiter);
    });
  }

  rerun(id) {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, error: "not_found" };
    const rerunGoal = String(t.initialGoal || t.goal || "").trim();
    const started = this.start(rerunGoal, t.workspaceLabel || t.workspace);
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

    t.latestPrompt = clean;
    t.thread.push({ role: "user", content: clean });
    this._push(t, { level: "info", data: { kind: "chat", role: "user", content: clean } });
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
      this._resolveWaiters(t);
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

    if (task.parentTaskId) {
      const parent = this.tasks.get(task.parentTaskId);
      if (parent && Array.isArray(parent.childTaskIds)) {
        parent.childTaskIds = parent.childTaskIds.filter((childId) => childId !== task.id);
        this._schedulePersist(parent);
      }
    }

    if (task.status === "running" || task.status === "awaiting_approval") {
      task.status = "terminated";
      for (const approval of task.pendingApprovals.values()) {
        approval.resolve(false);
      }
      task.pendingApprovals.clear();
      this._closeSubscribers(task);
      this._resolveWaiters(task);
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

  start(goal, workspaceInput, options = {}) {
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
      initialGoal: cleanGoal,
      latestPrompt: cleanGoal,
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
      workspaceLabel,
      parentTaskId: options.parentTaskId ? String(options.parentTaskId) : null,
      childTaskIds: [],
      waiters: new Set(),
      autoRestartOnInterruption: this._shouldAutoRestartWorkspace(workspace)
    };
    this.tasks.set(id, task);
    this._push(task, { level: "info", data: { kind: "chat", role: "user", content: cleanGoal } });
    if (task.parentTaskId) {
      const parent = this.tasks.get(task.parentTaskId);
      if (parent) {
        if (!Array.isArray(parent.childTaskIds)) parent.childTaskIds = [];
        if (!parent.childTaskIds.includes(id)) {
          parent.childTaskIds.push(id);
          this._schedulePersist(parent);
        }
      }
    }
    this._schedulePersist(task);
    this._runThread(task);
    return { ok: true, id };
  }

  startChildTask(parentTaskId, goal, workspaceInput) {
    const parent = this.tasks.get(parentTaskId);
    if (!parent) return { ok: false, error: "parent_not_found" };

    const started = this.start(goal, workspaceInput || parent.workspace, { parentTaskId });
    if (!started.ok) return started;

    const child = this.tasks.get(started.id);
    if (!child) return { ok: false, error: "child_start_failed" };

    return {
      ok: true,
      id: child.id,
      task: this._taskSummary(child)
    };
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

    if (this._isTerminalStatus(t.status)) {
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

  _shouldAutoRestartWorkspace(workspacePath) {
    const target = path.resolve(workspacePath || this.config.workdir);
    const selfRoot = path.resolve(this.config.selfRoot || process.cwd());
    if (target === selfRoot) return true;
    return Boolean(this.config.autoRestartInterruptedThreads);
  }

  _getRunThread(thread) {
    if (!Array.isArray(thread)) return [];
    return thread
      .slice(-THREAD_CONTEXT_LIMIT)
      .map((entry) => ({
        role: String(entry?.role || ""),
        content: sanitizeString(entry?.content || "")
      }))
      .filter((entry) => (entry.role === "user" || entry.role === "assistant") && entry.content);
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
    const goal = String(task.goal || "");
    const thread = this._getRunThread(task.thread);

    (async () => {
      try {
        const { runTask } = require("./runTask");
        const { result } = await runTask({
          goal,
          thread,
          config: this.config,
          onLog,
          requestApproval,
          workspaceDir: task.workspace,
          taskId: task.id,
          scheduleManager: this.scheduleManager,
          taskManager: this,
          selfUpdateManager: this.selfUpdateManager
        });

        if (task.deleted || task.status === "canceled" || task.status === "terminated") return;

        task.status = "done";
        task.result = result;
        task.finishedAt = new Date().toISOString();
        const assistantContent = String(result);
        task.thread.push({ role: "assistant", content: assistantContent });
        const assistantEntry = { level: "info", data: { kind: "chat", role: "assistant", content: assistantContent } };
        this._push(task, assistantEntry);
        this._broadcastLog(task, this._normalizeLog(assistantEntry));
        this._broadcastStatus(task);
        await this._persistTask(task);
        this._resolveWaiters(task);
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
        this._resolveWaiters(task);
        this._broadcastEvent(task, "complete", { status: task.status, result: null });
        this._closeSubscribers(task);
      }
    })();
  }

  _normalizeLog(entry) {
    const data = Object.prototype.hasOwnProperty.call(entry || {}, "data") ? entry.data : "";
    return {
      t: Date.now(),
      level: entry.level || "info",
      data: typeof data === "string" ? sanitizeString(data) : sanitizeJsonValue(data)
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

  _taskSummary(task, options = {}) {
    const includeLogs = Boolean(options.includeLogs);
    return {
      id: task.id,
      goal: task.goal,
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt || null,
      result: task.result ?? null,
      runCount: Number.isFinite(task.runCount) ? task.runCount : 0,
      workspace: task.workspace,
      workspaceLabel: task.workspaceLabel || task.workspace,
      parentTaskId: task.parentTaskId || null,
      childTaskIds: Array.isArray(task.childTaskIds) ? [...task.childTaskIds] : [],
      pendingApprovalCount: task.pendingApprovals instanceof Map ? task.pendingApprovals.size : 0,
      logCount: Array.isArray(task.logs) ? task.logs.length : 0,
      logs: includeLogs ? (Array.isArray(task.logs) ? task.logs : []) : undefined
    };
  }

  _resolveWaiters(task) {
    if (!task.waiters || !task.waiters.size) return;
    for (const waiter of task.waiters) {
      try {
        waiter.resolve();
      } catch {
        // no-op
      }
    }
    task.waiters.clear();
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
      initialGoal: task.initialGoal || task.goal,
      latestPrompt: task.latestPrompt || task.goal,
      runCount: Number.isFinite(task.runCount) ? task.runCount : 0,
      thread: Array.isArray(task.thread) ? task.thread : [],
      workspace: task.workspace,
      workspaceLabel: task.workspaceLabel || task.workspace,
      parentTaskId: task.parentTaskId || null,
      childTaskIds: Array.isArray(task.childTaskIds) ? task.childTaskIds : [],
      autoRestartOnInterruption: Boolean(task.autoRestartOnInterruption),
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
      initialGoal: String(data.initialGoal || data.goal || ""),
      latestPrompt: String(data.latestPrompt || data.goal || ""),
      runCount: Number.isFinite(data.runCount) ? data.runCount : 0,
      thread: Array.isArray(data.thread) ? data.thread : [],
      pendingApprovals: new Map(),
      workspace: String(data.workspace || this.config.workdir),
      workspaceLabel: String(data.workspaceLabel || data.workspace || this.config.workdir),
      parentTaskId: data.parentTaskId ? String(data.parentTaskId) : null,
      childTaskIds: Array.isArray(data.childTaskIds) ? data.childTaskIds.map((id) => String(id)) : [],
      waiters: new Set(),
      autoRestartOnInterruption: typeof data.autoRestartOnInterruption === "boolean"
        ? data.autoRestartOnInterruption
        : this._shouldAutoRestartWorkspace(data.workspace || this.config.workdir)
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
      const shouldRestart = Boolean(task.autoRestartOnInterruption);
      task.pendingApprovals.clear();
      task.finishedAt = shouldRestart ? null : new Date().toISOString();
      const restartEntry = this._normalizeLog({
        level: "warn",
        data: shouldRestart
          ? "Task interrupted by server restart; auto-restarting thread"
          : "Task interrupted by server restart before completion"
      });
      task.logs.push(restartEntry);
      if (task.logs.length > this.maxLogs) {
        task.logs.splice(0, task.logs.length - this.maxLogs);
      }
      task.status = shouldRestart ? "running" : "error";
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
        if (task.status === "running") {
          this._runThread(task);
        }
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
