export function getTaskRevision(task = {}) {
  return JSON.stringify([
    task.updatedAt || task.finishedAt || task.startedAt || "",
    task.status || "",
    task.runCount || 0,
    task.logCount || 0,
    task.pendingApprovalCount || 0
  ]);
}

export function hasUnseenTaskUpdates(task, taskState) {
  return taskState?.seenRevision !== getTaskRevision(task);
}
