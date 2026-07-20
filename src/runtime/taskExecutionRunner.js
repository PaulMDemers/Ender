// @ts-check

const { throwIfAborted } = require("../utils/abort");

class TaskExecutionRunner {
  constructor(options = {}) {
    this.runTaskImpl = options.runTaskImpl || null;
  }

  async run({
    task,
    thread,
    signal,
    onLog,
    requestApproval,
    onWorkspacePrepared,
    runtime
  }) {
    throwIfAborted(signal);
    let workspaceDir = task.workspace;
    if (task.projectId && runtime.projectManager?.ensureWorkspace) {
      const ensured = await runtime.projectManager.ensureWorkspace(task.projectId);
      throwIfAborted(signal);
      if (!ensured.ok) {
        throw new Error(ensured.message || ensured.error || "Unable to prepare project workspace");
      }
      if (ensured.workspacePath && ensured.workspacePath !== workspaceDir) {
        workspaceDir = ensured.workspacePath;
        await onWorkspacePrepared?.(workspaceDir);
      }
    }

    throwIfAborted(signal);
    const runConfig = runtime.llmProfileManager?.buildRunConfig
      ? runtime.llmProfileManager.buildRunConfig(task.llmProfileId)
      : runtime.config;
    const runTaskImpl = this.runTaskImpl || require("./runTask").runTask;

    throwIfAborted(signal);
    return runTaskImpl({
      goal: String(task.executionPrompt || task.goal || ""),
      thread,
      config: runConfig,
      onLog,
      requestApproval,
      workspaceDir,
      taskId: task.id,
      taskMeta: runtime.taskManager.getTaskForContext(task.id),
      scheduleManager: runtime.scheduleManager,
      taskManager: runtime.taskManager,
      selfUpdateManager: runtime.selfUpdateManager,
      taskLedgerManager: runtime.taskLedgerManager,
      projectManager: runtime.projectManager,
      memoryManager: runtime.memoryManager,
      signal
    });
  }
}

module.exports = { TaskExecutionRunner };
