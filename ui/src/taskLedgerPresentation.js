export const FINISHED_LEDGER_STATUSES = new Set(["completed", "canceled"]);
export const ATTENTION_LEDGER_STATUSES = new Set(["failed", "blocked", "needs_input"]);
export const LEDGER_STAGES = [
  "queued",
  "intake",
  "feasibility_check",
  "workspace_scan",
  "plan",
  "implement",
  "verify",
  "finalize"
];

export function formatLedgerLabel(value, fallback = "pending") {
  return String(value || fallback).replaceAll("_", " ");
}

export function getLedgerStatusTone(status) {
  if (status === "running") return "running";
  if (status === "completed") return "success";
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "needs_input" || status === "canceled") return "warning";
  return "neutral";
}

export function linkedLedgerTaskId(entry) {
  return entry?.completedTaskId || entry?.startedTaskId || null;
}

export function ledgerSourceSummary(entry) {
  const parts = [entry?.source?.kind, entry?.source?.label, entry?.source?.referenceId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "manual";
}

export function ledgerOutcomeSummary(entry) {
  return entry?.lifecycle?.outcome?.summary
    || entry?.lastError
    || entry?.result
    || entry?.lifecycle?.stageSummary
    || "Awaiting lifecycle updates";
}

export function summarizeLedger(entries = []) {
  return entries.reduce((summary, entry) => {
    summary.total += 1;
    if (!FINISHED_LEDGER_STATUSES.has(entry.status)) summary.open += 1;
    if (entry.status === "running") summary.running += 1;
    if (entry.status === "pending") summary.pending += 1;
    if (ATTENTION_LEDGER_STATUSES.has(entry.status)) summary.attention += 1;
    if (entry.status === "completed") summary.completed += 1;
    if (FINISHED_LEDGER_STATUSES.has(entry.status)) summary.finished += 1;
    return summary;
  }, { total: 0, open: 0, pending: 0, running: 0, attention: 0, completed: 0, finished: 0 });
}

export function filterLedgerEntries(entries = [], { query = "", status = "open", type = "all" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  return entries.filter((entry) => {
    if (status === "open" && FINISHED_LEDGER_STATUSES.has(entry.status)) return false;
    if (status === "finished" && !FINISHED_LEDGER_STATUSES.has(entry.status)) return false;
    if (!['all', 'open', 'finished'].includes(status) && entry.status !== status) return false;
    if (type !== "all" && (entry.taskType || "generic") !== type) return false;
    if (!needle) return true;

    const searchable = [
      entry.id,
      entry.title,
      entry.prompt,
      entry.status,
      entry.taskType,
      entry.workspace,
      ledgerSourceSummary(entry),
      entry.lifecycle?.currentStage,
      entry.lifecycle?.stageSummary,
      entry.lifecycle?.outcome?.status,
      entry.lifecycle?.outcome?.summary,
      entry.lastError,
      entry.result
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(needle);
  });
}
