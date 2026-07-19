// @ts-check

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { sanitizeJsonValue, sanitizeString } = require("../utils/jsonSafe");
const { isAbortError } = require("../utils/abort");
const {
  TASK_STATUS,
  canTransitionTaskStatus,
  isActiveTaskStatus,
  isTerminalTaskStatus,
  outcomeStatusToTaskStatus
} = require("./taskLifecycle");
const { JsonTaskRepository } = require("./jsonTaskRepository");
const { TaskApprovalCoordinator } = require("./taskApprovalCoordinator");
const { TaskExecutionRunner } = require("./taskExecutionRunner");
const { TASK_RECORD_VERSION, migrateTaskRecord } = require("./taskRecord");
const {
  TASK_SSE_CONTRACT_EVENT,
  createTaskSseContractPayload,
  formatTaskSseEvent,
  setTaskSseContractHeaders,
  writeTaskSseEvent
} = require("../shared/apiContracts");

const THREAD_CONTEXT_LIMIT = 12;
const ALLOWED_IMAGE_DETAILS = new Set(["auto", "low", "high"]);

function sanitizeThreadContent(value) {
  if (Array.isArray(value)) {
    return sanitizeJsonValue(value);
  }
  return sanitizeString(value || "");
}

function hasThreadContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value || "").trim());
}

function normalizeUserContentBlocks(content) {
  if (!Array.isArray(content)) return [];

  const blocks = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;

    if (item.type === "text") {
      const text = sanitizeString(item.text || "").trim();
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    if (item.type === "image_url") {
      const rawImageUrl = typeof item.image_url === "string"
        ? { url: item.image_url, detail: item.detail }
        : item.image_url;
      const url = sanitizeString(rawImageUrl?.url || "").trim();
      if (!url) continue;

      const normalizedImageUrl = { url };
      const detail = sanitizeString(rawImageUrl?.detail || "").trim().toLowerCase();
      if (ALLOWED_IMAGE_DETAILS.has(detail)) {
        normalizedImageUrl.detail = detail;
      }

      blocks.push({ type: "image_url", image_url: normalizedImageUrl });
    }
  }

  return blocks;
}

function buildUserMessageContent(prompt, content) {
  const cleanPrompt = sanitizeString(prompt || "").trim();
  const blocks = normalizeUserContentBlocks(content);

  if (cleanPrompt && !blocks.length) {
    return cleanPrompt;
  }

  if (cleanPrompt) {
    blocks.unshift({ type: "text", text: cleanPrompt });
  }

  if (!blocks.length) {
    return "";
  }

  if (blocks.length === 1 && blocks[0].type === "text") {
    return blocks[0].text;
  }

  return blocks;
}

function summarizeUserMessageContent(content) {
  if (typeof content === "string") {
    return sanitizeString(content).trim();
  }

  if (!Array.isArray(content) || !content.length) {
    return "";
  }

  const firstText = content.find((item) => item?.type === "text" && typeof item.text === "string" && item.text.trim());
  if (firstText) {
    return sanitizeString(firstText.text).trim().split("\n")[0].slice(0, 240);
  }

  const imageCount = content.filter((item) => item?.type === "image_url").length;
  if (imageCount) {
    return `Sent ${imageCount} image attachment${imageCount === 1 ? "" : "s"}`;
  }

  return "Sent attachments";
}

function normalizeContinueTaskInput(input) {
  if (typeof input === "string") {
    return { prompt: input, content: null };
  }

  if (input && typeof input === "object") {
    return {
      prompt: typeof input.prompt === "string" ? input.prompt : "",
      content: Array.isArray(input.content) ? input.content : null,
      llmProfileId: input.llmProfileId ? String(input.llmProfileId).trim() : null,
      memoryMode: input.memoryMode ? String(input.memoryMode).trim() : null
    };
  }

  return { prompt: "", content: null };
}

class TaskManager {
  constructor(config, options = {}) {
    this.config = config;
    this.scheduleManager = null;
    this.selfUpdateManager = null;
    this.taskLedgerManager = null;
    this.projectManager = null;
    this.memoryManager = null;
    this.llmProfileManager = null;
    this.notificationClient = null;
    this.logger = options.logger || console;
    this.tasks = new Map();
    this.shuttingDown = false;
    this.maxLogs = 5000;
    this.threadsDir = path.resolve(this.config.threadsDir || path.resolve(process.cwd(), "threads"));
    this.taskRepository = options.taskRepository || new JsonTaskRepository({ threadsDir: this.threadsDir });
    this.taskRunner = options.taskRunner || new TaskExecutionRunner();
    this.approvalCoordinator = options.approvalCoordinator || new TaskApprovalCoordinator();
  }

  _isTerminalStatus(status) {
    return isTerminalTaskStatus(status);
  }

  async init() {
    await this.taskRepository.init();
    await this._loadPersistedTasks();
  }

  setScheduleManager(scheduleManager) {
    this.scheduleManager = scheduleManager || null;
  }

  setSelfUpdateManager(selfUpdateManager) {
    this.selfUpdateManager = selfUpdateManager || null;
  }

  setTaskLedgerManager(taskLedgerManager) {
    this.taskLedgerManager = taskLedgerManager || null;
  }

  setProjectManager(projectManager) {
    this.projectManager = projectManager || null;
  }

  setMemoryManager(memoryManager) {
    this.memoryManager = memoryManager || null;
  }

  setLlmProfileManager(llmProfileManager) {
    this.llmProfileManager = llmProfileManager || null;
  }

  setNotificationClient(notificationClient) {
    this.notificationClient = notificationClient || null;
  }

  _transitionTask(task, nextStatus, options = {}) {
    const previousStatus = task.status;
    if (!canTransitionTaskStatus(previousStatus, nextStatus)) {
      throw new Error(`Invalid task status transition: ${previousStatus} -> ${nextStatus}`);
    }

    task.status = nextStatus;
    if (options.clearFinishedAt) task.finishedAt = null;
    if (Object.prototype.hasOwnProperty.call(options, "finishedAt")) {
      task.finishedAt = options.finishedAt;
    }
    if (Object.prototype.hasOwnProperty.call(options, "result")) {
      task.result = options.result;
    }

    if (options.publishStatus !== false) this._broadcastStatus(task);
    if (options.schedulePersist) this._schedulePersist(task);
    return { previousStatus, status: nextStatus };
  }

  _publishTerminalState(task, notification = null) {
    if (!isTerminalTaskStatus(task.status)) {
      throw new Error(`Cannot publish completion for non-terminal task status: ${task.status}`);
    }

    this._broadcastEvent(task, "complete", {
      status: task.status,
      result: task.result || null
    });
    this._resolveWaiters(task);
    if (notification) {
      this._notifyTaskEvent(task, notification.type, notification.input);
    }
    this._closeSubscribers(task);
  }

  _publishApprovalRequired(task, approval) {
    this._broadcastEvent(task, "approval_required", {
      id: approval.id,
      type: approval.type,
      title: approval.title,
      description: approval.description,
      details: approval.details,
      requestedAt: approval.requestedAt
    });
    this._notifyTaskEvent(task, "approval_required", {
      title: approval.title || "Ender approval required",
      body: approval.description || task.goal,
      approvalId: approval.id,
      approvalType: approval.type
    });
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
      pendingApprovalCount: this.approvalCoordinator.count(t),
      workspace: t.workspace,
      workspaceLabel: t.workspaceLabel,
      projectId: t.projectId || null,
      llmProfileId: t.llmProfileId || null,
      memoryMode: t.memoryMode || "auto",
      ledgerEntryId: t.ledgerEntryId || null,
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
      projectId: t.projectId || null,
      llmProfileId: t.llmProfileId || null,
      memoryMode: t.memoryMode || "auto",
      ledgerEntryId: t.ledgerEntryId || null,
      parentTaskId: t.parentTaskId || null,
      childTaskIds: Array.isArray(t.childTaskIds) ? [...t.childTaskIds] : [],
      pendingApprovals: this.approvalCoordinator.list(t)
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

  getTaskForContext(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    return {
      ...this._taskSummary(task, { includeLogs: false }),
      thread: Array.isArray(task.thread) ? sanitizeJsonValue(task.thread) : [],
      latestPrompt: task.latestPrompt || task.goal,
      initialGoal: task.initialGoal || task.goal
    };
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
    if (this.shuttingDown) return { ok: false, error: "shutting_down", message: "Ender is shutting down" };
    const t = this.tasks.get(id);
    if (!t) return { ok: false, error: "not_found" };
    const rerunGoal = String(t.initialGoal || t.goal || "").trim();
    const started = this.start(rerunGoal, t.workspaceLabel || t.workspace, {
      projectId: t.projectId || null,
      llmProfileId: t.llmProfileId || null,
      memoryMode: t.memoryMode || "auto"
    });
    if (!started.ok) return started;
    return { ok: true, id: started.id };
  }

  continueTask(id, input) {
    if (this.shuttingDown) return { ok: false, error: "shutting_down", message: "Ender is shutting down" };
    const t = this.tasks.get(id);
    if (!t) return { ok: false, error: "not_found" };
    if (isActiveTaskStatus(t.status)) {
      return { ok: false, error: "task_busy" };
    }

    const { prompt, content, llmProfileId, memoryMode } = normalizeContinueTaskInput(input);
    const messageContent = buildUserMessageContent(prompt, content);
    if (!hasThreadContent(messageContent)) return { ok: false, error: "prompt_required" };

    if (llmProfileId) t.llmProfileId = llmProfileId;
    if (["auto", "off", "manual"].includes(memoryMode)) t.memoryMode = memoryMode;
    t.latestPrompt = summarizeUserMessageContent(messageContent) || t.latestPrompt || t.goal;
    t.thread.push({ role: "user", content: messageContent });
    this._push(t, { level: "info", data: { kind: "chat", role: "user", content: messageContent } });
    this._schedulePersist(t);
    this._runThread(t);
    return { ok: true, id: t.id };
  }

  resolveApproval(taskId, approvalId, approved) {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, error: "not_found" };

    const resolution = this.approvalCoordinator.resolve(task, approvalId, approved);
    if (!resolution.ok) return resolution;

    const msg = approved ? `approval granted (${approvalId})` : `approval denied (${approvalId})`;
    this._push(task, { level: approved ? "info" : "warn", data: msg });
    this._broadcastLog(task, this._normalizeLog({ level: approved ? "info" : "warn", data: msg }));

    if (resolution.remaining === 0 && task.status === TASK_STATUS.AWAITING_APPROVAL) {
      this._transitionTask(task, TASK_STATUS.RUNNING);
    }

    this._schedulePersist(task);
    return { ok: true };
  }

  terminate(id) {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, error: "not_found" };

    if (isActiveTaskStatus(t.status)) {
      t.runController?.abort(new Error("Task terminated by user"));
      this._transitionTask(t, TASK_STATUS.TERMINATED, {
        finishedAt: t.finishedAt || new Date().toISOString(),
        schedulePersist: true
      });
      this._push(t, { level: "warn", data: "Task marked as terminated" });

      this.approvalCoordinator.rejectAll(t);
      this._publishTerminalState(t);
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

    if (isActiveTaskStatus(task.status)) {
      task.runController?.abort(new Error("Task deleted by user"));
      this._transitionTask(task, TASK_STATUS.TERMINATED, { publishStatus: false });
      this.approvalCoordinator.rejectAll(task);
      this._closeSubscribers(task);
      this._resolveWaiters(task);
    }

    this.tasks.delete(id);
    if (deleteWorkspace && workspacePath) {
      if (!this._canDeleteWorkspace(workspacePath)) {
        workspaceDeletion.reason = "protected_workspace";
      } else if (this.projectManager?.ownsWorkspace?.(workspacePath)) {
        workspaceDeletion.reason = "project_workspace";
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
      this.logger.warn(`Failed to delete persisted thread ${id}: ${err.message || String(err)}`);
    }

    return { ok: true, workspaceDeletion };
  }

  start(goal, workspaceInput, options = {}) {
    if (this.shuttingDown) return { ok: false, error: "shutting_down", message: "Ender is shutting down" };
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
      status: TASK_STATUS.RUNNING,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logs: [],
      subs: new Set(),
      result: null,
      runCount: 0,
      thread: [{ role: "user", content: cleanGoal }],
      pendingApprovals: this.approvalCoordinator.createStore(),
      workspace,
      workspaceLabel,
      projectId: options.projectId ? String(options.projectId) : null,
      llmProfileId: options.llmProfileId
        ? String(options.llmProfileId)
        : this.llmProfileManager?.defaultProfileId || this.config.defaultLlmProfileId || this.config.backend || null,
      memoryMode: ["auto", "manual", "off"].includes(String(options.memoryMode || ""))
        ? String(options.memoryMode)
        : "auto",
      ledgerEntryId: options.ledgerEntryId ? String(options.ledgerEntryId) : null,
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

    const started = this.start(goal, workspaceInput || parent.workspace, {
      parentTaskId,
      projectId: parent.projectId || null,
      llmProfileId: parent.llmProfileId || null,
      memoryMode: parent.memoryMode || "auto"
    });
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

    setTaskSseContractHeaders(res);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    writeTaskSseEvent(res, TASK_SSE_CONTRACT_EVENT, createTaskSseContractPayload());
    writeTaskSseEvent(res, "status", { t: Date.now(), status: t.status });
    for (const log of t.logs) {
      writeTaskSseEvent(res, "log", log);
    }

    for (const approval of this.approvalCoordinator.list(t)) {
      const payload = {
        id: approval.id,
        type: approval.type,
        title: approval.title,
        description: approval.description,
        details: approval.details,
        requestedAt: approval.requestedAt
      };
      writeTaskSseEvent(res, "approval_required", payload);
    }

    if (this._isTerminalStatus(t.status)) {
      writeTaskSseEvent(res, "complete", { status: t.status, result: t.result || null });
      res.end();
      return true;
    }

    const hb = setInterval(() => {
      writeTaskSseEvent(res, "ping", Date.now());
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
        content: sanitizeThreadContent(entry?.content)
      }))
      .filter((entry) => (entry.role === "user" || entry.role === "assistant") && hasThreadContent(entry.content));
  }

  _requestApproval(task, payload) {
    const { approval, decision } = this.approvalCoordinator.request(task, payload);
    this._transitionTask(task, TASK_STATUS.AWAITING_APPROVAL, {
      schedulePersist: true
    });
    this._publishApprovalRequired(task, approval);
    return decision;
  }

  _runThread(task) {
    task.runController?.abort(new Error("Task execution superseded"));
    this.approvalCoordinator.rejectAll(task);
    const runController = new AbortController();
    task.runController = runController;
    this._transitionTask(task, TASK_STATUS.RUNNING, {
      clearFinishedAt: true,
      schedulePersist: true
    });
    task.runCount += 1;

    const isCurrentRun = () => (
      task.runController === runController
      && !runController.signal.aborted
      && !task.deleted
    );
    const onLog = (entry) => {
      if (!isCurrentRun()) return;
      this._push(task, entry);
      this._broadcastLog(task, this._normalizeLog(entry));
    };

    const requestApproval = (payload) => (
      isCurrentRun() ? this._requestApproval(task, payload) : Promise.resolve(false)
    );
    const thread = this._getRunThread(task.thread);

    const runPromise = (async () => {
      try {
        const { result, outcomeStatus } = await this.taskRunner.run({
          task,
          thread,
          signal: runController.signal,
          onLog,
          requestApproval,
          onWorkspacePrepared: (workspacePath) => {
            if (!isCurrentRun()) return;
            task.workspace = workspacePath;
            task.workspaceLabel = workspacePath;
            this._schedulePersist(task);
          },
          runtime: {
            config: this.config,
            scheduleManager: this.scheduleManager,
            taskManager: this,
            selfUpdateManager: this.selfUpdateManager,
            taskLedgerManager: this.taskLedgerManager,
            projectManager: this.projectManager,
            memoryManager: this.memoryManager,
            llmProfileManager: this.llmProfileManager
          }
        });

        if (
          !isCurrentRun()
          || task.status === TASK_STATUS.CANCELED
          || task.status === TASK_STATUS.TERMINATED
        ) return;

        const terminalStatus = outcomeStatusToTaskStatus(outcomeStatus);
        const assistantContent = String(result);
        task.thread.push({ role: "assistant", content: assistantContent });
        const assistantEntry = { level: "info", data: { kind: "chat", role: "assistant", content: assistantContent } };
        this._push(task, assistantEntry);
        this._broadcastLog(task, this._normalizeLog(assistantEntry));
        this._transitionTask(task, terminalStatus, {
          finishedAt: new Date().toISOString(),
          result
        });
        await this._persistTask(task);
        this._publishTerminalState(task, {
          type: "task_completed",
          input: {
            title: task.status === TASK_STATUS.DONE ? "Ender task completed" : "Ender task needs attention",
            body: task.result || task.goal
          }
        });
      } catch (err) {
        if (task.runController !== runController) return;
        if (
          runController.signal.aborted
          || isAbortError(err)
          || task.deleted
          || task.status === TASK_STATUS.CANCELED
          || task.status === TASK_STATUS.TERMINATED
        ) {
          await this._persistTask(task);
          return;
        }
        const errorEntry = { level: "error", data: err && err.stack ? err.stack : String(err) };
        this._push(task, errorEntry);
        this._broadcastLog(task, this._normalizeLog(errorEntry));
        this._transitionTask(task, TASK_STATUS.ERROR, {
          finishedAt: new Date().toISOString(),
          result: null
        });
        await this._persistTask(task);
        this._publishTerminalState(task, {
          type: "task_failed",
          input: {
            title: "Ender task failed",
            body: err && err.message ? err.message : String(err)
          }
        });
      } finally {
        if (task.runController === runController) task.runController = null;
        if (task.runPromise === runPromise) task.runPromise = null;
      }
    })();
    task.runPromise = runPromise;
  }

  async shutdown() {
    if (this.shuttingDown) {
      const active = [...this.tasks.values()].map((task) => task.runPromise).filter(Boolean);
      await Promise.allSettled(active);
      await this.taskRepository.flush().catch(() => {});
      return;
    }

    this.shuttingDown = true;
    const active = [];
    for (const task of this.tasks.values()) {
      if (task.runPromise) active.push(task.runPromise);
      task.runController?.abort(new Error("Ender server is shutting down"));
      this.approvalCoordinator.rejectAll(task);
      this._closeSubscribers(task);
      await this._persistTask(task);
    }

    await Promise.allSettled(active);
    await this.taskRepository.flush().catch(() => {});
  }

  _notifyTaskEvent(task, type, input = {}) {
    if (!this.notificationClient?.notifyTaskEvent) return;
    this.notificationClient.notifyTaskEvent(task, type, input).catch?.(() => {
      // Notification delivery is best-effort and must not block task execution.
    });
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
    const payload = formatTaskSseEvent(eventName, data);
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
      projectId: task.projectId || null,
      llmProfileId: task.llmProfileId || null,
      memoryMode: task.memoryMode || "auto",
      ledgerEntryId: task.ledgerEntryId || null,
      parentTaskId: task.parentTaskId || null,
      childTaskIds: Array.isArray(task.childTaskIds) ? [...task.childTaskIds] : [],
      pendingApprovalCount: this.approvalCoordinator.count(task),
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

  _serializeTask(task) {
    return {
      recordVersion: TASK_RECORD_VERSION,
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
      projectId: task.projectId || null,
      llmProfileId: task.llmProfileId || null,
      memoryMode: task.memoryMode || "auto",
      ledgerEntryId: task.ledgerEntryId || null,
      parentTaskId: task.parentTaskId || null,
      childTaskIds: Array.isArray(task.childTaskIds) ? task.childTaskIds : [],
      autoRestartOnInterruption: Boolean(task.autoRestartOnInterruption),
      pendingApprovals: this.approvalCoordinator.list(task)
    };
  }

  _hydrateTask(data) {
    const task = {
      id: String(data.id),
      goal: String(data.goal || ""),
      status: String(data.status || TASK_STATUS.ERROR),
      startedAt: data.startedAt || new Date().toISOString(),
      finishedAt: data.finishedAt || null,
      logs: Array.isArray(data.logs) ? data.logs.slice(-this.maxLogs) : [],
      subs: new Set(),
      result: data.result ?? null,
      initialGoal: String(data.initialGoal || data.goal || ""),
      latestPrompt: String(data.latestPrompt || data.goal || ""),
      runCount: Number.isFinite(data.runCount) ? data.runCount : 0,
      thread: Array.isArray(data.thread) ? data.thread : [],
      pendingApprovals: this.approvalCoordinator.createStore(data.pendingApprovals),
      workspace: String(data.workspace || this.config.workdir),
      workspaceLabel: String(data.workspaceLabel || data.workspace || this.config.workdir),
      projectId: data.projectId ? String(data.projectId) : null,
      llmProfileId: data.llmProfileId ? String(data.llmProfileId) : this.llmProfileManager?.defaultProfileId || null,
      memoryMode: ["auto", "manual", "off"].includes(String(data.memoryMode || ""))
        ? String(data.memoryMode)
        : "auto",
      ledgerEntryId: data.ledgerEntryId ? String(data.ledgerEntryId) : null,
      parentTaskId: data.parentTaskId ? String(data.parentTaskId) : null,
      childTaskIds: Array.isArray(data.childTaskIds) ? data.childTaskIds.map((id) => String(id)) : [],
      waiters: new Set(),
      autoRestartOnInterruption: typeof data.autoRestartOnInterruption === "boolean"
        ? data.autoRestartOnInterruption
        : this._shouldAutoRestartWorkspace(data.workspace || this.config.workdir)
    };

    if (isActiveTaskStatus(task.status)) {
      const shouldRestart = Boolean(task.autoRestartOnInterruption);
      this.approvalCoordinator.rejectAll(task);
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
      this._transitionTask(
        task,
        shouldRestart ? TASK_STATUS.RUNNING : TASK_STATUS.ERROR,
        {
          publishStatus: false,
          finishedAt: shouldRestart ? null : new Date().toISOString()
        }
      );
    }

    return task;
  }

  async _loadPersistedTasks() {
    const entries = await this.taskRepository.loadAll();
    for (const entry of entries) {
      try {
        if (entry.error) throw entry.error;
        const { record: data } = migrateTaskRecord(entry.record);
        if (!data || !data.id || this.tasks.has(String(data.id))) continue;
        if (String(data.id) !== entry.taskId) {
          throw new Error(`Task record id ${data.id} does not match filename ${entry.taskId}.json`);
        }
        const task = this._hydrateTask(data);
        this.tasks.set(task.id, task);
        await this._persistTask(task);
        if (task.status === TASK_STATUS.RUNNING) {
          this._runThread(task);
        }
      } catch (err) {
        this.logger.warn(`Failed to load persisted thread ${entry.filePath}: ${err.message || String(err)}`);
      }
    }
  }

  _schedulePersist(task) {
    clearTimeout(task.persistTimer);
    task.persistTimer = setTimeout(() => {
      this._persistTask(task).catch((err) => {
        this.logger.warn(`Failed to persist thread ${task.id}: ${err.message || String(err)}`);
      });
    }, 25);
    task.persistTimer.unref?.();
  }

  async _persistTask(task) {
    if (task.deleted) return;
    clearTimeout(task.persistTimer);
    return this.taskRepository.save(task.id, this._serializeTask(task));
  }

  async _deleteTaskFile(taskId) {
    return this.taskRepository.delete(taskId);
  }
}

module.exports = { TaskManager };
