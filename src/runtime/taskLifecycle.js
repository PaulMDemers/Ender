// @ts-check

const TASK_STATUS = Object.freeze({
  RUNNING: "running",
  AWAITING_APPROVAL: "awaiting_approval",
  DONE: "done",
  ERROR: "error",
  CANCELED: "canceled",
  TERMINATED: "terminated",
  BLOCKED: "blocked",
  NEEDS_INPUT: "needs_input"
});

const ACTIVE_TASK_STATUSES = new Set([
  TASK_STATUS.RUNNING,
  TASK_STATUS.AWAITING_APPROVAL
]);

const TERMINAL_TASK_STATUSES = new Set([
  TASK_STATUS.DONE,
  TASK_STATUS.ERROR,
  TASK_STATUS.CANCELED,
  TASK_STATUS.TERMINATED,
  TASK_STATUS.BLOCKED,
  TASK_STATUS.NEEDS_INPUT
]);

const KNOWN_TASK_STATUSES = new Set([
  ...ACTIVE_TASK_STATUSES,
  ...TERMINAL_TASK_STATUSES
]);

const ALLOWED_TRANSITIONS = new Map([
  [TASK_STATUS.RUNNING, new Set([
    TASK_STATUS.RUNNING,
    TASK_STATUS.AWAITING_APPROVAL,
    TASK_STATUS.DONE,
    TASK_STATUS.ERROR,
    TASK_STATUS.CANCELED,
    TASK_STATUS.TERMINATED,
    TASK_STATUS.BLOCKED,
    TASK_STATUS.NEEDS_INPUT
  ])],
  [TASK_STATUS.AWAITING_APPROVAL, new Set([
    TASK_STATUS.AWAITING_APPROVAL,
    TASK_STATUS.RUNNING,
    TASK_STATUS.ERROR,
    TASK_STATUS.CANCELED,
    TASK_STATUS.TERMINATED
  ])],
  [TASK_STATUS.DONE, new Set([TASK_STATUS.RUNNING])],
  [TASK_STATUS.ERROR, new Set([TASK_STATUS.RUNNING])],
  [TASK_STATUS.CANCELED, new Set([TASK_STATUS.RUNNING])],
  [TASK_STATUS.TERMINATED, new Set([TASK_STATUS.RUNNING])],
  [TASK_STATUS.BLOCKED, new Set([TASK_STATUS.RUNNING])],
  [TASK_STATUS.NEEDS_INPUT, new Set([TASK_STATUS.RUNNING])]
]);

function isActiveTaskStatus(status) {
  return ACTIVE_TASK_STATUSES.has(status);
}

function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.has(status);
}

function canTransitionTaskStatus(fromStatus, toStatus) {
  if (!KNOWN_TASK_STATUSES.has(toStatus)) return false;
  if (!KNOWN_TASK_STATUSES.has(fromStatus)) return true;
  return Boolean(ALLOWED_TRANSITIONS.get(fromStatus)?.has(toStatus));
}

function outcomeStatusToTaskStatus(outcomeStatus) {
  if (outcomeStatus === "blocked") return TASK_STATUS.BLOCKED;
  if (outcomeStatus === "needs_input") return TASK_STATUS.NEEDS_INPUT;
  return TASK_STATUS.DONE;
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  TASK_STATUS,
  TERMINAL_TASK_STATUSES,
  canTransitionTaskStatus,
  isActiveTaskStatus,
  isTerminalTaskStatus,
  outcomeStatusToTaskStatus
};
