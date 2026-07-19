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

const TASK_TYPE_OPTIONS = ["generic", "coding", "documentation", "research", "ops"];
const STATUS_OPTIONS = ["open", "all", "pending", "running", "needs_input", "blocked", "failed", "completed", "canceled", "finished"];

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

export default function TaskLedgerPanel({
  entries,
  metadata,
  loading,
  refreshing,
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [formError, setFormError] = useState("");
  const [lastRequest, setLastRequest] = useState(null);
  const lastWorkspaceDefaultRef = useRef(String(serverWorkspacePath || "").trim());

  const summary = useMemo(() => summarizeLedger(entries || []), [entries]);
  const taskTypes = useMemo(
    () => [...new Set(["generic", ...(entries || []).map((entry) => entry.taskType || "generic")])],
    [entries]
  );
  const visibleEntries = useMemo(
    () => filterLedgerEntries(entries || [], { query, status: statusFilter, type: typeFilter }),
    [entries, query, statusFilter, typeFilter]
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
    if (response) resetComposer();
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
      if (response) resetComposer();
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
  const filtersActive = Boolean(query || statusFilter !== "open" || typeFilter !== "all");
  const manualOnly = (metadata?.maxAutoAgents || 0) === 0;

  return (
    <div className="workflowStack taskLedgerStack">
      <section className="automationOverview" aria-label="Task ledger overview">
        <div className="workflowHero">
          <span className="workflowBadge">TASK LEDGER</span>
          <div className="launchTitle">Agent work queue</div>
          <div className="launchDescription">Prioritize incoming work, follow its execution lifecycle, and hand off directly to the working thread.</div>
          <div className="stepProgress mono">
            {summary.open} open · {summary.finished} finished · {summary.total} total
            {refreshing ? " · syncing" : ""}
          </div>
        </div>
        <div className="automationSummaryGrid taskLedgerSummaryGrid">
          <div className="automationSummaryItem"><span>Waiting</span><strong>{summary.pending}</strong></div>
          <div className="automationSummaryItem"><span>Running</span><strong>{summary.running}</strong></div>
          <div className={`automationSummaryItem ${summary.attention ? "attention" : ""}`}><span>Needs attention</span><strong>{summary.attention}</strong></div>
          <div className="automationSummaryItem"><span>Completed</span><strong>{summary.completed}</strong></div>
        </div>
        <div className="workflowActionBar taskLedgerOverviewActions">
          <span className="scheduleMetaChip mono">
            {manualOnly ? "manual dispatch" : `${metadata.maxAutoAgents} auto-agent slot${metadata.maxAutoAgents === 1 ? "" : "s"}`}
          </span>
          <button type="button" className="secondaryButton" onClick={() => onReload?.()} disabled={loading || busy}>Refresh</button>
          <button type="button" className="secondaryButton" onClick={() => onOpenIsolatedView?.()}>Open isolated view</button>
        </div>
      </section>

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

      <div className="scheduleWorkspace taskLedgerWorkspace">
        <section className="consolePanel scheduleEditor">
          <div className="panelBody workflowPanelBody">
            <div className="workflowHero compact">
              <span className="workflowBadge">NEW ENTRY</span>
              <div className="launchTitle">Add work</div>
              <div className="launchDescription">Start with the request. Add operational context only when the work needs it.</div>
            </div>
            <form className="workflowStep" onSubmit={submit} noValidate>
              <label className="workflowField">
                <span className="workflowFieldLabel">Task Request</span>
                <textarea className="consoleTextarea" value={prompt} onChange={(event) => { setPrompt(event.target.value); setFormError(""); }} placeholder="Describe the work the next available agent should complete." />
              </label>
              <div className="workflowActionBar scheduleAdvancedToggleRow">
                <button type="button" className="secondaryButton" aria-expanded={showOptions} onClick={() => setShowOptions((value) => !value)}>
                  {showOptions ? "Hide more options" : "Show more options"}
                </button>
              </div>
              {showOptions ? (
                <div className="taskLedgerAdvancedFields">
                  <div className="workflowGrid">
                    <label className="workflowField"><span className="workflowFieldLabel">Title</span><input className="consoleInput" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional short label" /></label>
                    <label className="workflowField"><span className="workflowFieldLabel">Workspace</span><input className="consoleInput mono" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="/path/to/repo or project" /></label>
                    <label className="workflowField"><span className="workflowFieldLabel">Task Type</span><select className="consoleInput" value={taskType} onChange={(event) => setTaskType(event.target.value)}>{TASK_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className="workflowField toggleField"><input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} /><span>Auto-run when a worker slot is available</span></label>
                    <label className="workflowField"><span className="workflowFieldLabel">Source Kind</span><input className="consoleInput" value={sourceKind} onChange={(event) => setSourceKind(event.target.value)} placeholder="manual, jira, github, api..." /></label>
                    <label className="workflowField"><span className="workflowFieldLabel">Source Label / Ref</span><input className="consoleInput" value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="ABC-123 or inbound webhook" /></label>
                  </div>
                  <div className="workflowGrid">
                    <label className="workflowField"><span className="workflowFieldLabel">Success Criteria</span><textarea className="consoleTextarea compact" value={successCriteriaText} onChange={(event) => setSuccessCriteriaText(event.target.value)} placeholder={"One item per line\nTests pass\nFeature behaves as requested"} /></label>
                    <label className="workflowField"><span className="workflowFieldLabel">Constraints</span><textarea className="consoleTextarea compact" value={constraintsText} onChange={(event) => setConstraintsText(event.target.value)} placeholder={"One item per line\nDo not touch production config"} /></label>
                  </div>
                  <label className="workflowField"><span className="workflowFieldLabel">Verification Plan</span><textarea className="consoleTextarea compact" value={verificationPlanText} onChange={(event) => setVerificationPlanText(event.target.value)} placeholder={"One item per line\nnpm test\nnpm run build"} /></label>
                  <label className="workflowField"><span className="workflowFieldLabel">External Reference</span><input className="consoleInput mono" value={sourceReferenceId} onChange={(event) => setSourceReferenceId(event.target.value)} placeholder="Optional durable source id" /></label>
                </div>
              ) : null}
              <div className="workflowActionBar"><button className="primaryButton workflowAction" disabled={busy || !prompt.trim()}>{operation?.type === "create" ? "Adding..." : "Add to ledger"}</button></div>
              {formError ? <StateNotice tone="warning" title="Task request required" detail={formError} compact /> : null}
            </form>
          </div>
        </section>

        <aside className="sidePanel workflowSidePanel taskLedgerSidePanel">
          <div className="sectionLabel">Dispatch policy</div>
          <div className="launchSummaryValue">{manualOnly ? "Manual control" : `${metadata.maxAutoAgents} concurrent auto-agent${metadata.maxAutoAgents === 1 ? "" : "s"}`}</div>
          <div className="panelNote">Auto-run entries wait for server capacity. Manual “Run now” dispatches a specific item immediately.</div>
          <div className="launchContextBlock"><span className="launchSummaryLabel">Poll cadence</span><div className="sidePanelValue mono">{metadata?.pollIntervalMs ? `${Math.round(metadata.pollIntervalMs / 1000)}s server dispatch cycle` : "manual server dispatch"}</div></div>
          <div className="launchContextBlock"><span className="launchSummaryLabel">Thread handoff</span><div className="sidePanelValue">Once dispatched, open the linked thread to supervise or continue the work.</div></div>
        </aside>
      </div>

      <section className="consolePanel scheduleLedger">
        <div className="panelBody workflowPanelBody">
          <div className="taskLedgerCollectionHeader">
            <div className="workflowHero compact">
              <span className="workflowBadge">QUEUE</span>
              <div className="launchTitle">Work and outcomes</div>
              <div className="launchDescription">Filter before opening details; lifecycle and result context stay attached to each request.</div>
            </div>
            <div className="stepProgress mono">{visibleEntries.length} shown</div>
          </div>
          <div className="taskLedgerFilters" role="search" aria-label="Filter task ledger">
            <label className="workflowField taskLedgerSearchField"><span className="workflowFieldLabel">Search</span><input className="consoleInput" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, request, source, workspace, outcome..." /></label>
            <label className="workflowField"><span className="workflowFieldLabel">Status</span><select className="consoleInput" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{formatLedgerLabel(status)}</option>)}</select></label>
            <label className="workflowField"><span className="workflowFieldLabel">Type</span><select className="consoleInput" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">all types</option>{taskTypes.map((type) => <option key={type} value={type}>{formatLedgerLabel(type)}</option>)}</select></label>
            {filtersActive ? <button type="button" className="secondaryButton taskLedgerClearFilters" onClick={() => { setQuery(""); setStatusFilter("open"); setTypeFilter("all"); }}>Reset filters</button> : null}
          </div>

          <div className="scheduleList taskLedgerList">
            {!visibleEntries.length && !loading ? (
              <StateNotice title={filtersActive ? "No matching entries" : "Queue is clear"} detail={filtersActive ? "Adjust or reset the filters to broaden the result set." : "Add a request when there is new work to dispatch."} actionLabel={filtersActive ? "Reset filters" : undefined} onAction={filtersActive ? () => { setQuery(""); setStatusFilter("open"); setTypeFilter("all"); } : undefined} />
            ) : null}
            {visibleEntries.map((entry) => {
              const taskId = linkedLedgerTaskId(entry);
              const running = entry.status === "running";
              const entryBusy = operation?.id === entry.id;
              return (
                <article key={entry.id} className="consolePanel scheduleRow taskLedgerRow">
                  <div className="taskLedgerRowHeader">
                    <div className="taskLedgerRowTitleBlock">
                      <div className="workflowCardHeader">
                        <span className={`statusPill ${getLedgerStatusTone(entry.status)}`}>{formatLedgerLabel(entry.status)}</span>
                        <span className="scheduleMetaChip mono">{entry.taskType || "generic"}</span>
                        <span className="scheduleMetaChip mono">{ledgerSourceSummary(entry)}</span>
                      </div>
                      <div className="workflowName">{entry.title || "Untitled ledger entry"}</div>
                      <div className="workflowDesc taskLedgerPromptPreview">{entry.prompt}</div>
                    </div>
                    <div className="scheduleActions scheduleActionsCompact">
                      {taskId ? <button type="button" className="miniButton" onClick={() => onOpenTask?.(taskId)}>Open thread</button> : null}
                      {!running ? <button type="button" className="miniButton" disabled={busy} onClick={() => runEntry(entry.id)}>{entryBusy && operation?.type === "run" ? "Dispatching..." : entry.status === "completed" ? "Run again" : "Run now"}</button> : null}
                      {!running ? <button type="button" className="miniButton" disabled={busy} onClick={() => deleteEntry(entry.id)}>{entryBusy && operation?.type === "delete" ? "Deleting..." : "Delete"}</button> : null}
                    </div>
                  </div>
                  <LifecycleRail entry={entry} />
                  <div className={`taskLedgerOutcome ${getLedgerStatusTone(entry.status)}`}>
                    <span className="metaLabel">Latest outcome</span>
                    <span>{ledgerOutcomeSummary(entry)}</span>
                  </div>
                  <div className="scheduleMetaInline">
                    <span className="scheduleMetaChip mono">entry {entry.id.slice(0, 8)}</span>
                    <span className="scheduleMetaChip mono">{entry.autoRun ? "auto-run" : "manual"}</span>
                    <span className="scheduleMetaChip mono">attempts {entry.attemptCount || 0}</span>
                    <span className="scheduleMetaChip mono">stage {formatLedgerLabel(entry.lifecycle?.currentStage, "queued")}</span>
                    {entry.workspace ? <span className="scheduleMetaChip mono" title={entry.workspace}>{entry.workspace}</span> : null}
                  </div>
                  <details className="taskLedgerDetails">
                    <summary>Execution details</summary>
                    <div className="taskLedgerDetailsBody">
                      <div className="taskLedgerMetaGrid">
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
