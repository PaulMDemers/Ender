export const PRIMARY_DESTINATIONS = Object.freeze([
  Object.freeze({
    id: "new",
    label: "New thread",
    description: "Start agent work",
    icon: "plus"
  }),
  Object.freeze({
    id: "workflow",
    label: "Workflows",
    description: "Guided launch",
    icon: "workflow"
  }),
  Object.freeze({
    id: "schedule",
    label: "Schedules",
    description: "Recurring runs",
    icon: "calendar"
  }),
  Object.freeze({
    id: "ledger",
    label: "Task ledger",
    description: "Shared queue",
    icon: "ledger"
  })
]);

export function resolveActiveMode(composeMode, hasSelectedThread) {
  return composeMode === "thread" && !hasSelectedThread ? "new" : composeMode;
}
