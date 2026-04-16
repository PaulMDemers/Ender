import { useEffect, useMemo, useRef, useState } from "react";

const FINISHED_STATUSES = new Set(["completed", "failed", "canceled"]);
const TASK_TYPE_OPTIONS = ["generic", "coding", "documentation", "research", "ops"];

function parseLines(value) {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
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

function getStatusTone(status) {
  if (status === "running") return "running";
  if (status === "completed") return "success";
  if (status === "needs_input") return "warning";
  if (status === "failed") return "danger";
  if (status === "blocked") return "danger";
  if (status === "canceled") return "warning";
  return "neutral";
}

function getStatusLabel(status) {
  if (!status) return "pending";
  return String(status).replaceAll("_", " ");
}

function sourceSummary(entry) {
  const kind = String(entry?.source?.kind || "").trim();
  const label = String(entry?.source?.label || "").trim();
  const referenceId = String(entry?.source?.referenceId || "").trim();
  const parts = [kind, label, referenceId].filter(Boolean);
  return parts.length ? parts.join(" · ") : "manual";
}

function linkedTaskId(entry) {
  return entry?.completedTaskId || entry?.startedTaskId || null;
}

export default function TaskLedgerPanel({
  entries,
  busy,
  error,
  serverWorkspacePath,
  onCreate,
  onDelete,
  onOpenIsolatedView,
  onRunNow,
  onOpenTask
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
  const [showFinished, setShowFinished] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const lastWorkspaceDefaultRef = useRef(String(serverWorkspacePath || "").trim());

  const openEntries = useMemo(
    () => (entries || []).filter((entry) => !FINISHED_STATUSES.has(entry.status)),
    [entries]
  );
  const finishedEntries = useMemo(
    () => (entries || []).filter((entry) => FINISHED_STATUSES.has(entry.status)),
    [entries]
  );
  const visibleEntries = showFinished ? (entries || []) : openEntries;

  useEffect(() => {
    const nextDefault = String(serverWorkspacePath || "").trim();
    if (!nextDefault) return;
    if (!workspace || workspace === lastWorkspaceDefaultRef.current) {
      setWorkspace(nextDefault);
    }
    lastWorkspaceDefaultRef.current = nextDefault;
  }, [serverWorkspacePath, workspace, lastWorkspaceDefaultRef]);

  const submit = async (event) => {
    event?.preventDefault?.();
    if (!prompt.trim() || submitting) return;

    setSubmitting(true);
    setLocalError("");
    try {
      await onCreate?.({
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
    } catch (err) {
      setLocalError(err.message || "Unable to add ledger item");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="workflowStack">
      <section className="workflowIntro">
        <div className="workflowHero">
          <span className="workflowBadge">TASK LEDGER</span>
          <div className="launchTitle">Queue generic work for available agents</div>
          <div className="launchDescription">
            Add tasks from any source, watch active work, and inspect finished items without leaving the main console.
          </div>
        </div>

        <div className="workflowToolbar workflowToolbarCompact">
          <div className="stepProgress mono">
            {openEntries.length} open · {finishedEntries.length} finished · {(entries || []).length} total
          </div>
          <div className="workflowActionBar">
            <button
              type="button"
              className="secondaryButton"
              onClick={() => onOpenIsolatedView?.()}
            >
              Open isolated view
            </button>
            <button
              type="button"
              className={`secondaryButton ${showFinished ? "schedulePresetActive" : ""}`.trim()}
              onClick={() => setShowFinished((value) => !value)}
            >
              {showFinished ? "Hide finished" : "Include finished"}
            </button>
          </div>
        </div>
      </section>

      <div className="scheduleWorkspace taskLedgerWorkspace">
        <section className="consolePanel scheduleEditor">
          <div className="panelBody workflowPanelBody">
            <div className="workflowHero compact">
              <span className="workflowBadge">NEW ENTRY</span>
              <div className="launchTitle">Add work to the ledger</div>
              <div className="launchDescription">
                Keep it lightweight by default. Task details, workspace, and source metadata are available when you need them.
              </div>
            </div>

            <form className="workflowStep" onSubmit={submit}>
              <label className="workflowField">
                <span className="workflowFieldLabel">Task Request</span>
                <textarea
                  className="consoleTextarea"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Describe the work the next available agent should complete."
                  required
                />
              </label>

              <div className="workflowActionBar scheduleAdvancedToggleRow">
                <button type="button" className="secondaryButton" onClick={() => setShowOptions((value) => !value)}>
                  {showOptions ? "Hide more options" : "Show more options"}
                </button>
              </div>

              {showOptions ? (
                <>
                  <div className="workflowGrid">
                    <label className="workflowField">
                      <span className="workflowFieldLabel">Title</span>
                      <input
                        className="consoleInput"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Optional short label"
                      />
                    </label>

                    <label className="workflowField">
                      <span className="workflowFieldLabel">Workspace</span>
                      <input
                        className="consoleInput mono"
                        value={workspace}
                        onChange={(event) => setWorkspace(event.target.value)}
                        placeholder="/path/to/repo or project"
                      />
                    </label>

                    <label className="workflowField">
                      <span className="workflowFieldLabel">Task Type</span>
                      <select className="consoleInput" value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                        {TASK_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>

                    <label className="workflowField toggleField">
                      <input
                        type="checkbox"
                        checked={autoRun}
                        onChange={(event) => setAutoRun(event.target.checked)}
                      />
                      <span>Auto-run when a worker slot is available</span>
                    </label>

                    <label className="workflowField">
                      <span className="workflowFieldLabel">Source Kind</span>
                      <input
                        className="consoleInput"
                        value={sourceKind}
                        onChange={(event) => setSourceKind(event.target.value)}
                        placeholder="manual, jira, github, api..."
                      />
                    </label>

                    <label className="workflowField">
                      <span className="workflowFieldLabel">Source Label / Ref</span>
                      <input
                        className="consoleInput"
                        value={sourceLabel}
                        onChange={(event) => setSourceLabel(event.target.value)}
                        placeholder="ABC-123 or inbound webhook"
                      />
                    </label>
                  </div>

                  <div className="workflowGrid">
                    <label className="workflowField">
                      <span className="workflowFieldLabel">Success Criteria</span>
                      <textarea
                        className="consoleTextarea compact"
                        value={successCriteriaText}
                        onChange={(event) => setSuccessCriteriaText(event.target.value)}
                        placeholder={"One item per line\nTests pass\nFeature behaves as requested"}
                      />
                    </label>

                    <label className="workflowField">
                      <span className="workflowFieldLabel">Constraints</span>
                      <textarea
                        className="consoleTextarea compact"
                        value={constraintsText}
                        onChange={(event) => setConstraintsText(event.target.value)}
                        placeholder={"One item per line\nDo not touch production config\nStay inside this workspace"}
                      />
                    </label>
                  </div>

                  <label className="workflowField">
                    <span className="workflowFieldLabel">Verification Plan</span>
                    <textarea
                      className="consoleTextarea compact"
                      value={verificationPlanText}
                      onChange={(event) => setVerificationPlanText(event.target.value)}
                      placeholder={"One item per line\nnpm test\nnpm run build\nmanual check of generated file"}
                    />
                  </label>

                  <label className="workflowField">
                    <span className="workflowFieldLabel">External Reference</span>
                    <input
                      className="consoleInput mono"
                      value={sourceReferenceId}
                      onChange={(event) => setSourceReferenceId(event.target.value)}
                      placeholder="Optional durable source id"
                    />
                  </label>
                </>
              ) : null}

              <div className="workflowActionBar">
                <button className="primaryButton workflowAction" disabled={submitting || !prompt.trim()}>
                  {submitting ? "Adding..." : "Add to ledger"}
                </button>
              </div>

              {localError ? <div className="errorBanner">{localError}</div> : null}
            </form>
          </div>
        </section>

        <aside className="sidePanel workflowSidePanel taskLedgerSidePanel">
          <div className="sectionLabel">Queue snapshot</div>
          <div className="launchSummaryValue">{showFinished ? "All entries" : "Open entries"}</div>
          <div className="panelNote">
            Running entries stay linked to the thread that picked them up. Finished entries keep the result and linked thread id.
          </div>

          <div className="launchContextBlock">
            <span className="launchSummaryLabel">Visibility</span>
            <div className="sidePanelValue mono">{showFinished ? "open + finished" : "open only"}</div>
          </div>

          <div className="launchContextBlock">
            <span className="launchSummaryLabel">Auto dispatch</span>
            <div className="sidePanelValue mono">Create with auto-run enabled or launch individual entries manually.</div>
          </div>
        </aside>
      </div>

      <section className="consolePanel scheduleLedger">
        <div className="panelBody workflowPanelBody">
          <div className="workflowHero compact">
            <span className="workflowBadge">{showFinished ? "LEDGER" : "OPEN WORK"}</span>
            <div className="launchTitle">{showFinished ? "All task ledger entries" : "Queued and active task ledger entries"}</div>
            <div className="launchDescription">
              Generic queue view across all sources. Use it to monitor dispatch and jump into the thread that did the work.
            </div>
          </div>

          <div className="scheduleList">
            {!visibleEntries.length && !busy ? (
              <div className="emptyState">
                {showFinished ? "No task ledger entries have been recorded yet" : "No open task ledger entries right now"}
              </div>
            ) : null}

            {visibleEntries.map((entry) => {
              const taskId = linkedTaskId(entry);
              const runnable = entry.status !== "running";
              const deletable = entry.status !== "running";
              const runLabel = entry.status === "completed" ? "Run again" : "Run now";

              return (
                <div key={entry.id} className="consolePanel scheduleRow taskLedgerRow">
                  <div className="taskLedgerRowHeader">
                    <div className="taskLedgerRowTitleBlock">
                      <div className="workflowCardHeader">
                        <span className={`statusPill ${getStatusTone(entry.status)}`}>{getStatusLabel(entry.status)}</span>
                        <span className="scheduleMetaChip mono">{entry.taskType || "generic"}</span>
                        <span className="scheduleMetaChip mono">{sourceSummary(entry)}</span>
                      </div>
                      <div className="workflowName">{entry.title || "Untitled ledger entry"}</div>
                      <div className="workflowDesc taskLedgerPromptPreview">{entry.prompt}</div>
                    </div>

                    <div className="scheduleActions scheduleActionsCompact">
                      {taskId ? (
                        <button type="button" className="miniButton" onClick={() => onOpenTask?.(taskId)}>
                          Open thread
                        </button>
                      ) : null}
                      {runnable ? (
                        <button type="button" className="miniButton" onClick={() => onRunNow?.(entry.id)}>
                          {runLabel}
                        </button>
                      ) : null}
                      {deletable ? (
                        <button type="button" className="miniButton" onClick={() => onDelete?.(entry.id)}>
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="scheduleMetaInline">
                    <span className="scheduleMetaChip mono">{`entry ${entry.id.slice(0, 8)}`}</span>
                    <span className="scheduleMetaChip mono">{entry.autoRun ? "auto-run enabled" : "manual dispatch"}</span>
                    <span className="scheduleMetaChip mono">{`attempts ${entry.attemptCount || 0}`}</span>
                    {entry.lifecycle?.currentStage ? (
                      <span className="scheduleMetaChip mono">{`stage ${entry.lifecycle.currentStage}`}</span>
                    ) : null}
                    {entry.workspace ? <span className="scheduleMetaChip mono" title={entry.workspace}>{entry.workspace}</span> : null}
                    {entry.startedTaskId ? (
                      <span className="scheduleMetaChip mono">{`thread ${entry.startedTaskId.slice(0, 8)}`}</span>
                    ) : null}
                  </div>

                  <div className="taskLedgerMetaGrid">
                    <div className="metaRow">
                      <span className="metaLabel">Created</span>
                      <span className="metaValue mono">{formatTimestamp(entry.createdAt)}</span>
                    </div>
                    <div className="metaRow">
                      <span className="metaLabel">Updated</span>
                      <span className="metaValue mono">{formatTimestamp(entry.updatedAt)}</span>
                    </div>
                    <div className="metaRow">
                      <span className="metaLabel">Feasibility</span>
                      <span className="metaValue mono">{entry.lifecycle?.feasibility?.outcome || "unknown"}</span>
                    </div>
                    <div className="metaRow">
                      <span className="metaLabel">Verification</span>
                      <span className="metaValue mono">{entry.lifecycle?.verification?.status || "pending"}</span>
                    </div>
                  </div>

                  {entry.successCriteria?.length ? (
                    <div className="taskLedgerDetailBlock">
                      <span className="metaLabel">Success Criteria</span>
                      <div className="taskLedgerTagList">
                        {entry.successCriteria.map((item) => (
                          <span key={item} className="scheduleMetaChip">{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {entry.constraints?.length ? (
                    <div className="taskLedgerDetailBlock">
                      <span className="metaLabel">Constraints</span>
                      <div className="taskLedgerTagList">
                        {entry.constraints.map((item) => (
                          <span key={item} className="scheduleMetaChip">{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {entry.lifecycle?.plan?.checklist?.length ? (
                    <div className="taskLedgerDetailBlock">
                      <span className="metaLabel">Checklist</span>
                      <div className="taskLedgerTagList">
                        {entry.lifecycle.plan.checklist.map((item) => (
                          <span key={item} className="scheduleMetaChip">{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {entry.verificationPlan?.length ? (
                    <div className="taskLedgerDetailBlock">
                      <span className="metaLabel">Verification Plan</span>
                      <div className="taskLedgerTagList">
                        {entry.verificationPlan.map((item) => (
                          <span key={item} className="scheduleMetaChip">{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {entry.lifecycle?.verification?.evidence?.length ? (
                    <div className="taskLedgerDetailBlock">
                      <span className="metaLabel">Verification Evidence</span>
                      <div className="taskLedgerTagList">
                        {entry.lifecycle.verification.evidence.map((item) => (
                          <span key={item} className="scheduleMetaChip">{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {entry.result || entry.lastError || entry.lifecycle?.stageSummary ? (
                    <div className="taskLedgerDetailBlock">
                      <span className="metaLabel">Summary</span>
                      <div className="panelNote">
                        {entry.lifecycle?.outcome?.summary || entry.lifecycle?.stageSummary || entry.lastError || entry.result}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {busy ? <div className="emptyState">Refreshing task ledger...</div> : null}
          {error ? <div className="errorBanner">{error}</div> : null}
        </div>
      </section>
    </div>
  );
}
