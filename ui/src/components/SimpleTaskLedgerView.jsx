import { useMemo, useState } from "react";
import {
  filterLedgerEntries,
  formatLedgerLabel,
  getLedgerStatusTone,
  ledgerOutcomeSummary,
  summarizeLedger
} from "../taskLedgerPresentation";
import StateNotice from "./ui/StateNotice";

export default function SimpleTaskLedgerView({
  entries,
  metadata,
  loading,
  busy,
  operation,
  error,
  result,
  serverName,
  serverUrl,
  onCreate,
  onOpenEntry,
  onOpenFullConsole,
  onReload,
  onClearFeedback
}) {
  const [prompt, setPrompt] = useState("");
  const [query, setQuery] = useState("");
  const [ledgerView, setLedgerView] = useState("active");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formError, setFormError] = useState("");
  const [lastPayload, setLastPayload] = useState(null);
  const summary = useMemo(() => summarizeLedger(entries || []), [entries]);
  const visibleEntries = useMemo(
    () => filterLedgerEntries(entries || [], {
      query,
      status: statusFilter === "all" ? (ledgerView === "active" ? "open" : "finished") : statusFilter
    }),
    [entries, ledgerView, query, statusFilter]
  );

  const create = async (payload) => {
    setLastPayload(payload);
    const response = await onCreate?.(payload);
    if (response) {
      setPrompt("");
      setFormError("");
    }
  };

  const submit = async (event) => {
    event?.preventDefault?.();
    const nextPrompt = String(prompt || "").trim();
    if (!nextPrompt) {
      setFormError("Describe the task before adding it to the queue.");
      return;
    }
    setFormError("");
    await create({ prompt: nextPrompt });
  };

  const retry = async () => {
    if (lastPayload) await create(lastPayload);
    else await onReload?.();
  };

  const filtersActive = Boolean(query || statusFilter !== "all");
  const capacityLabel = metadata?.maxAutoAgents
    ? `${metadata.maxAutoAgents} auto-agent slot${metadata.maxAutoAgents === 1 ? "" : "s"}`
    : "manual dispatch";

  return (
    <div className="simpleLedgerPage">
      <main className="simpleLedgerShell">
        <header className="simpleLedgerHeader">
          <div className="simpleLedgerHeaderCopy">
            <div className="workflowBadge">TASK LEDGER</div>
            <h1 className="simpleLedgerTitle">Shared work queue</h1>
            <div className="simpleLedgerMeta"><span>{serverName}</span><span className="mono">{serverUrl}</span><span className="mono">{capacityLabel}</span></div>
          </div>
          <div className="workflowActionBar">
            <button type="button" className="secondaryButton" onClick={() => onReload?.()} disabled={loading || busy}>Refresh</button>
            <button type="button" className="secondaryButton" onClick={onOpenFullConsole}>Open full console</button>
          </div>
        </header>

        <section className="automationSummaryGrid simpleLedgerSummary" aria-label="Queue summary">
          <div className="automationSummaryItem"><span>Waiting</span><strong>{summary.pending}</strong></div>
          <div className="automationSummaryItem"><span>Running</span><strong>{summary.running}</strong></div>
          <div className={`automationSummaryItem ${summary.attention ? "attention" : ""}`}><span>Needs attention</span><strong>{summary.attention}</strong></div>
          <div className="automationSummaryItem"><span>Completed</span><strong>{summary.completed}</strong></div>
        </section>

        {loading && !entries?.length ? <StateNotice title="Loading task ledger" detail="Reading the shared queue from the server." busy /> : null}
        {operation?.type === "create" ? <StateNotice title="Adding task" detail="The request will remain here until the server accepts it." busy compact /> : null}
        {error ? <StateNotice tone="danger" title="Queue update failed" detail={error} actionLabel={lastPayload ? "Retry add" : "Reload"} onAction={retry} busy={busy || loading} compact /> : null}
        {!error && result?.type === "create" ? <StateNotice tone="success" title="Task added" detail="The queue now includes the new request." actionLabel="Dismiss" onAction={onClearFeedback} compact /> : null}

        <form className="consolePanel simpleLedgerComposer" onSubmit={submit} noValidate>
          <div className="panelBody simpleLedgerComposerBody">
            <label className="workflowField">
              <span className="workflowFieldLabel">Add task</span>
              <textarea className="consoleTextarea compact" value={prompt} onChange={(event) => { setPrompt(event.target.value); setFormError(""); }} placeholder="Describe the next task to add to the ledger." rows={3} />
            </label>
            <div className="workflowActionBar"><button className="primaryButton" disabled={busy || !prompt.trim()}>{operation?.type === "create" ? "Adding..." : "Add task"}</button></div>
            {formError ? <StateNotice tone="warning" title="Task request required" detail={formError} compact /> : null}
          </div>
        </form>

        <section className="consolePanel">
          <div className="panelBody simpleLedgerListBody">
            <div className="simpleLedgerListHeader">
              <div>
                <div className="sectionLabel">Ledger</div>
                <div className="collectionPanelTitle">{ledgerView === "active" ? "Active work" : "History"}</div>
                <div className="stepProgress mono">{visibleEntries.length} shown · {summary.total} total</div>
              </div>
              <div className="taskLedgerViewControls" role="group" aria-label="Ledger view">
                <button type="button" className="threadToggleButton" aria-pressed={ledgerView === "active"} onClick={() => { setLedgerView("active"); setStatusFilter("all"); }}>Active <span className="mono">{summary.open}</span></button>
                <button type="button" className="threadToggleButton" aria-pressed={ledgerView === "history"} onClick={() => { setLedgerView("history"); setStatusFilter("all"); }}>History <span className="mono">{summary.finished}</span></button>
              </div>
              <div className="simpleLedgerFilters" role="search" aria-label="Filter task ledger">
                <label className="workflowField"><span className="workflowFieldLabel">Search</span><input className="consoleInput" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search queue" /></label>
                <label className="workflowField"><span className="workflowFieldLabel">State</span><select className="consoleInput" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">all {ledgerView}</option>{ledgerView === "active" ? <><option value="pending">pending</option><option value="running">running</option><option value="needs_input">needs input</option><option value="blocked">blocked</option><option value="failed">failed</option></> : <><option value="completed">completed</option><option value="canceled">canceled</option></>}</select></label>
              </div>
            </div>
            <div className="simpleLedgerList">
              {!visibleEntries.length && !loading ? <StateNotice title={filtersActive ? "No matching tasks" : ledgerView === "active" ? "No active work" : "No completed work yet"} detail={filtersActive ? "Reset the filters to see more work." : ledgerView === "active" && summary.finished ? `${summary.finished} finished ${summary.finished === 1 ? "entry is" : "entries are"} available in History.` : ledgerView === "active" ? "Add the first task above." : "Completed and canceled work will appear here."} actionLabel={filtersActive ? "Reset filters" : undefined} onAction={filtersActive ? () => { setQuery(""); setStatusFilter("all"); } : undefined} /> : null}
              {visibleEntries.map((entry) => {
                return (
                  <button key={entry.id} type="button" className="simpleLedgerRow" onClick={() => onOpenEntry?.(entry)}>
                    <div className="simpleLedgerRowTop">
                      <span className={`statusPill ${getLedgerStatusTone(entry.status)}`}>{formatLedgerLabel(entry.status)}</span>
                      <span className="scheduleMetaChip mono">stage {formatLedgerLabel(entry.lifecycle?.currentStage, "queued")}</span>
                    </div>
                    <div className="simpleLedgerRowTitle">{entry.title || "Untitled task"}</div>
                    <div className="simpleLedgerRowPrompt">{entry.prompt}</div>
                    <div className={`simpleLedgerOutcome ${getLedgerStatusTone(entry.status)}`}>{ledgerOutcomeSummary(entry)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
