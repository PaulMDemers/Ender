import { useEffect, useMemo, useRef, useState } from "react";
import {
  LEDGER_STAGES,
  filterLedgerEntries,
  formatLedgerLabel,
  getLedgerStatusTone,
  ledgerOutcomeSummary,
  ledgerSourceSummary,
  linkedLedgerTaskId,
  summarizeLedger
} from "../taskLedgerPresentation";
import StateNotice from "./ui/StateNotice";
import CollectionHeader from "./ui/CollectionHeader";

const TASK_TYPE_OPTIONS = ["generic", "coding", "documentation", "research", "ops"];
const STATUS_OPTIONS = {
  active: ["all", "pending", "running", "needs_input", "blocked", "failed"],
  history: ["all", "completed", "canceled"]
};

function parseLines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function formatTimestamp(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function DetailList({ label, items }) {
  if (!items?.length) return null;
  return (
    <div className="taskLedgerDetailBlock">
      <span className="metaLabel">{label}</span>
      <div className="taskLedgerTagList">
        {items.map((item, index) => <span key={`${item}-${index}`} className="scheduleMetaChip">{item}</span>)}
      </div>
    </div>
  );
}

function LifecycleRail({ entry }) {
  const currentStage = entry.lifecycle?.currentStage || "queued";
  const currentIndex = Math.max(0, LEDGER_STAGES.indexOf(currentStage));
  return (
    <ol className="taskLedgerLifecycle" aria-label={`Lifecycle: ${formatLedgerLabel(currentStage)}`}>
      {LEDGER_STAGES.map((stage, index) => (
        <li
          key={stage}
          className={`${index < currentIndex ? "complete" : ""} ${stage === currentStage ? "current" : ""}`.trim()}
          aria-current={stage === currentStage ? "step" : undefined}
          title={formatLedgerLabel(stage)}
        >
          <span className="taskLedgerLifecycleDot" />
          <span>{formatLedgerLabel(stage)}</span>
        </li>
      ))}
    </ol>
  );
}

function ledgerProgress(entry) {
  const stage = entry.lifecycle?.currentStage || "queued";
  const index = Math.max(0, LEDGER_STAGES.indexOf(stage));
  return {
    stage,
    percent: `${Math.round((index / Math.max(1, LEDGER_STAGES.length - 1)) * 100)}%`
  };
}

function ledgerRowSummary(entry) {
  if (entry.status === "pending") {
    return entry.autoRun ? "Waiting for an available worker slot" : "Ready for manual dispatch";
  }
  if (entry.status === "running") {
    return `Worker active · ${formatLedgerLabel(entry.lifecycle?.currentStage, "intake")}`;
  }
  return ledgerOutcomeSummary(entry).replace(/^Dispatched to thread\s+\S+$/i, "Worker thread started");
}

export default function TaskLedgerPanel({
  entries,
  metadata,
  loading,
  busy,
  operation,
  error,
  result,
  serverWorkspacePath,
  onCreate,
  onDelete,
  onOpenIsolatedView,
  onRunNow,
  onOpenTask,
  onReload,
  onClearFeedback
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [taskType, setTaskType] = useState("generic");
  const [workspace, setWorkspace] = useState(String(serverWorkspacePath || "").trim());
  const [autoRun, setAutoRun] = useState(true);
  const [sourceKind, setSourceKind] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceReferenceId, setSourceReferenceId] = useState("");
  const [successCriteriaText, setSuccessCriteriaText] = useState("");
  const [constraintsText, setConstraintsText] = useState("");
  const [verificationPlanText, setVerificationPlanText] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [ledgerView, setLedgerView] = useState("active");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [formError, setFormError] = useState("");
  const [lastRequest, setLastRequest] = useState(null);
  const lastWorkspaceDefaultRef = useRef(String(serverWorkspacePath || "").trim());
  const newEntryButtonRef = useRef(null);
  const requestInputRef = useRef(null);

  const summary = useMemo(() => summarizeLedger(entries || []), [entries]);
  const taskTypes = useMemo(
    () => [...new Set(["generic", ...(entries || []).map((entry) => entry.taskType || "generic")])],
    [entries]
  );
  const visibleEntries = useMemo(
    () => filterLedgerEntries(entries || [], {
      query,
      status: statusFilter === "all" ? (ledgerView === "active" ? "open" : "finished") : statusFilter,
      type: typeFilter
    }),
    [entries, ledgerView, query, statusFilter, typeFilter]
  );

  useEffect(() => {
    const nextDefault = String(serverWorkspacePath || "").trim();
    if (!nextDefault) return;
    if (!workspace || workspace === lastWorkspaceDefaultRef.current) setWorkspace(nextDefault);
    lastWorkspaceDefaultRef.current = nextDefault;
  }, [serverWorkspacePath, workspace]);

  const resetComposer = () => {
    setTitle("");
    setPrompt("");
    setTaskType("generic");
    setWorkspace(String(serverWorkspacePath || "").trim());
    setAutoRun(true);
    setSourceKind("");
    setSourceLabel("");
    setSourceReferenceId("");
    setSuccessCriteriaText("");
    setConstraintsText("");
    setVerificationPlanText("");
    setShowOptions(false);
    setFormError("");
  };

  const openComposer = () => {
    onClearFeedback?.();
    resetComposer();
    setComposerOpen(true);
    requestAnimationFrame(() => requestInputRef.current?.focus());
  };

  const closeComposer = ({ restoreFocus = true } = {}) => {
    resetComposer();
    setComposerOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => newEntryButtonRef.current?.focus());
    }
  };

  const createPayload = () => ({
    title: title.trim() || undefined,
    prompt: prompt.trim(),
    taskType,
    workspace: workspace.trim() || null,
    autoRun,
    source: {
      kind: sourceKind.trim() || null,
      label: sourceLabel.trim() || null,
      referenceId: sourceReferenceId.trim() || null
    },
    successCriteria: parseLines(successCriteriaText),
    constraints: parseLines(constraintsText),
    verificationPlan: parseLines(verificationPlanText)
  });

  const submit = async (event) => {
    event?.preventDefault?.();
    if (!prompt.trim()) {
      setFormError("Describe the work before adding it to the ledger.");
      return;
    }
    const request = { type: "create", payload: createPayload() };
    setLastRequest(request);
    setFormError("");
    const response = await onCreate?.(request.payload);
    if (response) closeComposer({ restoreFocus: false });
  };

  const runEntry = async (id) => {
    setLastRequest({ type: "run", id });
    await onRunNow?.(id);
  };

  const deleteEntry = async (id) => {
    setLastRequest({ type: "delete", id });
    await onDelete?.(id);
  };

  const retryLastRequest = async () => {
    if (!lastRequest) {
      await onReload?.();
      return;
    }
    if (lastRequest.type === "create") {
      const response = await onCreate?.(lastRequest.payload);
      if (response) closeComposer();
    } else if (lastRequest.type === "run") {
      await onRunNow?.(lastRequest.id);
    } else if (lastRequest.type === "delete") {
      await onDelete?.(lastRequest.id);
    }
  };

  const operationLabel = operation?.type === "create"
    ? "Adding ledger entry"
    : operation?.type === "run"
      ? "Dispatching ledger entry"
      : operation?.type === "delete"
        ? "Deleting ledger entry"
        : "Updating task ledger";
  const successLabel = result?.type === "create"
    ? "Entry added"
    : result?.type === "run"
      ? "Entry dispatched"
      : "Entry deleted";
  const retryLabel = lastRequest ? `Retry ${lastRequest.type}` : "Reload ledger";
  const filtersActive = Boolean(query || statusFilter !== "all" || typeFilter !== "all");
  const manualOnly = (metadata?.maxAutoAgents || 0) === 0;
  const autoAgentSlots = metadata?.maxAutoAgents || 0;

  return (
    <div className="workflowStack taskLedgerStack">
      <CollectionHeader
        label="Task ledger"
        title="Agent work queue"
        description="Filter and dispatch shared work; open lifecycle and verification evidence only when an item needs investigation."
        stats={[
          { label: "waiting", value: summary.pending },
          { label: "running", value: summary.running },
          { label: "attention", value: summary.attention, tone: summary.attention ? "attention" : "" },
          { label: "completed", value: summary.completed }
        ]}
        ariaLabel="Task ledger overview"
      >
        <span className="collectionPolicy mono">{manualOnly ? "manual dispatch" : `${autoAgentSlots} agent slot${autoAgentSlots === 1 ? "" : "s"}`}</span>
        <button type="button" className="secondaryButton" onClick={() => onReload?.()} disabled={loading || busy}>Refresh</button>
        <button type="button" className="secondaryButton" onClick={() => onOpenIsolatedView?.()}>Focus queue</button>
        {!composerOpen ? (
          <button ref={newEntryButtonRef} type="button" className="primaryButton" onClick={openComposer} disabled={busy}>New entry</button>
        ) : null}
      </CollectionHeader>

      {loading && !entries?.length ? <StateNotice title="Loading task ledger" detail="Reading queue state and lifecycle outcomes from the server." busy /> : null}
      {operation ? <StateNotice title={operationLabel} detail="The queue remains visible while the server responds." busy compact /> : null}
      {error ? (
        <StateNotice
          tone="danger"
          title="Ledger operation failed"
          detail={error}
          actionLabel={retryLabel}
          onAction={retryLastRequest}
          busy={busy || loading}
          compact
        />
      ) : null}
      {!error && result ? (
        <StateNotice tone="success" title={successLabel} detail="The queue has been refreshed with the latest server state." actionLabel="Dismiss" onAction={onClearFeedback} compact />
      ) : null}

      {composerOpen ? (
        <section className="taskLedgerComposer" aria-labelledby="task-ledger-composer-title">
          <div className="taskLedgerComposerHeader">
            <div>
              <span className="sectionLabel">New entry</span>
              <h3 id="task-ledger-composer-title">Add work</h3>
              <p>Describe the outcome. Add operational context only when this request needs it.</p>
            </div>
            <button type="button" className="secondaryButton" disabled={busy} onClick={closeComposer}>Cancel</button>
          </div>
          <form className="taskLedgerComposerForm" onSubmit={submit} noValidate>
            <label className="workflowField">
              <span className="workflowFieldLabel">Task request</span>
              <textarea
                ref={requestInputRef}
                className="consoleTextarea taskLedgerRequestInput"
                rows={3}
                value={prompt}
                onChange={(event) => { setPrompt(event.target.value); setFormError(""); }}
                placeholder="Describe the work the next available agent should complete."
              />
            </label>
            <div className="taskLedgerComposerControls">
              <button type="button" className="threadToggleButton" aria-expanded={showOptions} aria-controls="task-ledger-options" onClick={() => setShowOptions((value) => !value)}>
                {showOptions ? "Hide context" : "Add context"}
              </button>
              <button className="primaryButton" disabled={busy || !prompt.trim()}>{operation?.type === "create" ? "Adding…" : "Add to ledger"}</button>
            </div>
            {showOptions ? (
              <div id="task-ledger-options" className="taskLedgerAdvancedFields">
                <div className="workflowGrid">
                  <label className="workflowField"><span className="workflowFieldLabel">Title</span><input className="consoleInput" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional short label" /></label>
                  <label className="workflowField"><span className="workflowFieldLabel">Workspace</span><input className="consoleInput mono" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="/path/to/repo or project" /></label>
                  <label className="workflowField"><span className="workflowFieldLabel">Task type</span><select className="consoleInput" value={taskType} onChange={(event) => setTaskType(event.target.value)}>{TASK_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label className="workflowField toggleField"><input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} /><span>Auto-run when a worker slot is available</span></label>
                  <label className="workflowField"><span className="workflowFieldLabel">Source kind</span><input className="consoleInput" value={sourceKind} onChange={(event) => setSourceKind(event.target.value)} placeholder="manual, jira, github, api…" /></label>
                  <label className="workflowField"><span className="workflowFieldLabel">Source label or reference</span><input className="consoleInput" value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="ABC-123 or inbound webhook" /></label>
                </div>
                <div className="workflowGrid">
                  <label className="workflowField"><span className="workflowFieldLabel">Success criteria</span><textarea className="consoleTextarea compact" value={successCriteriaText} onChange={(event) => setSuccessCriteriaText(event.target.value)} placeholder={"One item per line\nTests pass\nFeature behaves as requested"} /></label>
                  <label className="workflowField"><span className="workflowFieldLabel">Constraints</span><textarea className="consoleTextarea compact" value={constraintsText} onChange={(event) => setConstraintsText(event.target.value)} placeholder={"One item per line\nDo not touch production config"} /></label>
                </div>
                <label className="workflowField"><span className="workflowFieldLabel">Verification plan</span><textarea className="consoleTextarea compact" value={verificationPlanText} onChange={(event) => setVerificationPlanText(event.target.value)} placeholder={"One item per line\nnpm test\nnpm run build"} /></label>
                <label className="workflowField"><span className="workflowFieldLabel">External reference</span><input className="consoleInput mono" value={sourceReferenceId} onChange={(event) => setSourceReferenceId(event.target.value)} placeholder="Optional durable source id" /></label>
              </div>
            ) : null}
            {formError ? <StateNotice tone="warning" title="Task request required" detail={formError} compact /> : null}
          </form>
        </section>
      ) : null}

      <section className="consolePanel scheduleLedger">
        <div className="panelBody workflowPanelBody">
          <div className="collectionPanelHeader taskLedgerCollectionHeader">
            <div>
              <div className="sectionLabel">Ledger</div>
              <div className="collectionPanelTitle">{ledgerView === "active" ? "Active work" : "History"}</div>
            </div>
            <div className="taskLedgerViewControls" role="group" aria-label="Ledger view">
              <button
                type="button"
                className="threadToggleButton"
                aria-pressed={ledgerView === "active"}
                onClick={() => { setLedgerView("active"); setStatusFilter("all"); }}
              >
                Active <span className="mono">{summary.open}</span>
              </button>
              <button
                type="button"
                className="threadToggleButton"
                aria-pressed={ledgerView === "history"}
                onClick={() => { setLedgerView("history"); setStatusFilter("all"); }}
              >
                History <span className="mono">{summary.finished}</span>
              </button>
            </div>
          </div>
          <div className="taskLedgerFilters" role="search" aria-label="Filter task ledger">
            <label className="workflowField taskLedgerSearchField"><span className="workflowFieldLabel">Search</span><input className="consoleInput" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, request, source, workspace, outcome..." /></label>
            <label className="workflowField"><span className="workflowFieldLabel">State</span><select className="consoleInput" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{STATUS_OPTIONS[ledgerView].map((status) => <option key={status} value={status}>{status === "all" ? `all ${ledgerView}` : formatLedgerLabel(status)}</option>)}</select></label>
            <label className="workflowField"><span className="workflowFieldLabel">Type</span><select className="consoleInput" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">all types</option>{taskTypes.map((type) => <option key={type} value={type}>{formatLedgerLabel(type)}</option>)}</select></label>
            {filtersActive ? <button type="button" className="secondaryButton taskLedgerClearFilters" onClick={() => { setQuery(""); setStatusFilter("all"); setTypeFilter("all"); }}>Reset filters</button> : null}
          </div>

          <div className="scheduleList taskLedgerList">
            {!visibleEntries.length && !loading ? (
              <StateNotice
                title={filtersActive ? "No matching entries" : ledgerView === "active" ? "No active work" : "No completed work yet"}
                detail={filtersActive
                  ? "Adjust or reset the filters to broaden the result set."
                  : ledgerView === "active" && summary.finished
                    ? `${summary.finished} finished ${summary.finished === 1 ? "entry is" : "entries are"} available in History.`
                    : ledgerView === "active"
                      ? "Add a request when there is new work to dispatch."
                      : "Completed and canceled work will appear here."}
                actionLabel={filtersActive ? "Reset filters" : ledgerView === "active" && !composerOpen ? "Add first entry" : null}
                onAction={filtersActive ? () => { setQuery(""); setStatusFilter("all"); setTypeFilter("all"); } : openComposer}
              />
            ) : null}
            {visibleEntries.map((entry) => {
              const taskId = linkedLedgerTaskId(entry);
              const running = entry.status === "running";
              const entryBusy = operation?.id === entry.id;
              const entryTitle = entry.title || "Untitled ledger entry";
              const promptRepeatsTitle = Boolean(entry.title && String(entry.prompt || "").trim() === String(entry.title).trim());
              const progress = ledgerProgress(entry);
              return (
                <article key={entry.id} className="scheduleRow taskLedgerRow collectionRow">
                  <div className="taskLedgerRowHeader">
                    <div className="taskLedgerRowTitleBlock">
                      <div className="taskLedgerRowIdentity">
                        <span className={`statusPill ${getLedgerStatusTone(entry.status)}`}>{formatLedgerLabel(entry.status)}</span>
                        <div className="workflowName">{entryTitle}</div>
                      </div>
                      {!promptRepeatsTitle ? <div className="workflowDesc taskLedgerPromptPreview">{entry.prompt}</div> : null}
                      <div className="taskLedgerRowMeta">
                        <span>{entry.taskType || "generic"}</span>
                        <span>{ledgerSourceSummary(entry)}</span>
                        <span>{entry.autoRun ? "auto-run" : "manual dispatch"}</span>
                        {entry.attemptCount > 1 ? <span>{entry.attemptCount} attempts</span> : null}
                      </div>
                    </div>
                    <div className="scheduleActions scheduleActionsCompact">
                      {taskId ? <button type="button" className="miniButton taskLedgerPrimaryRowAction" onClick={() => onOpenTask?.(taskId)}>Open thread</button> : null}
                      {!taskId && !running ? <button type="button" className="miniButton taskLedgerPrimaryRowAction" disabled={busy} onClick={() => runEntry(entry.id)}>{entryBusy && operation?.type === "run" ? "Dispatching…" : "Run now"}</button> : null}
                    </div>
                  </div>
                  <div className="taskLedgerStageLine" aria-label={`Lifecycle stage: ${formatLedgerLabel(progress.stage)}`}>
                    <span className="taskLedgerStageLabel">{formatLedgerLabel(progress.stage)}</span>
                    <span className="taskLedgerStageTrack" aria-hidden="true"><span style={{ width: progress.percent }} /></span>
                    <time>{formatTimestamp(entry.updatedAt)}</time>
                  </div>
                  <div className={`taskLedgerRowSummary ${getLedgerStatusTone(entry.status)}`}>{ledgerRowSummary(entry)}</div>
                  <details className="taskLedgerDetails">
                    <summary>Details</summary>
                    <div className="taskLedgerDetailsBody">
                      {!running ? (
                        <div className="taskLedgerDetailActions">
                          {taskId ? <button type="button" className="miniButton" disabled={busy} onClick={() => runEntry(entry.id)}>{entryBusy && operation?.type === "run" ? "Dispatching…" : "Run again"}</button> : null}
                          <button type="button" className="miniButton miniButtonDanger" disabled={busy} onClick={() => deleteEntry(entry.id)}>{entryBusy && operation?.type === "delete" ? "Deleting…" : "Delete entry"}</button>
                        </div>
                      ) : null}
                      <LifecycleRail entry={entry} />
                      <div className="taskLedgerMetaGrid">
                        <div className="metaRow"><span className="metaLabel">Entry</span><span className="metaValue mono">{entry.id.slice(0, 8)}</span></div>
                        <div className="metaRow"><span className="metaLabel">Workspace</span><span className="metaValue mono">{entry.workspace || "Server default"}</span></div>
                        <div className="metaRow"><span className="metaLabel">Created</span><span className="metaValue mono">{formatTimestamp(entry.createdAt)}</span></div>
                        <div className="metaRow"><span className="metaLabel">Updated</span><span className="metaValue mono">{formatTimestamp(entry.updatedAt)}</span></div>
                        <div className="metaRow"><span className="metaLabel">Feasibility</span><span className="metaValue mono">{formatLedgerLabel(entry.lifecycle?.feasibility?.outcome, "unknown")}</span></div>
                        <div className="metaRow"><span className="metaLabel">Verification</span><span className="metaValue mono">{formatLedgerLabel(entry.lifecycle?.verification?.status)}</span></div>
                      </div>
                      {entry.lifecycle?.plan?.summary ? <div className="taskLedgerDetailBlock"><span className="metaLabel">Plan</span><div className="panelNote">{entry.lifecycle.plan.summary}</div></div> : null}
                      <DetailList label="Success criteria" items={entry.successCriteria} />
                      <DetailList label="Constraints" items={entry.constraints} />
                      <DetailList label="Checklist" items={entry.lifecycle?.plan?.checklist} />
                      <DetailList label="Verification plan" items={entry.verificationPlan?.length ? entry.verificationPlan : entry.lifecycle?.plan?.verificationSteps} />
                      <DetailList label="Verification evidence" items={entry.lifecycle?.verification?.evidence} />
                      {entry.lifecycle?.history?.length ? <div className="taskLedgerDetailBlock"><span className="metaLabel">Lifecycle history</span><div className="taskLedgerHistory">{entry.lifecycle.history.map((item, index) => <div key={`${item.stage}-${item.at}-${index}`}><span className="mono">{formatLedgerLabel(item.stage)}</span><span>{item.summary || "Stage updated"}</span><time>{formatTimestamp(item.at)}</time></div>)}</div></div> : null}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
