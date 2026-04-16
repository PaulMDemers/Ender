import { useState } from "react";

function getStatusTone(status) {
  if (status === "running") return "running";
  if (status === "completed") return "success";
  if (status === "needs_input") return "warning";
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "canceled") return "warning";
  return "neutral";
}

function getStatusLabel(status) {
  if (!status) return "pending";
  return String(status).replaceAll("_", " ");
}

function linkedTaskId(entry) {
  return entry?.completedTaskId || entry?.startedTaskId || null;
}

export default function SimpleTaskLedgerView({
  entries,
  busy,
  error,
  serverName,
  serverUrl,
  onCreate,
  onOpenEntry,
  onOpenFullConsole
}) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const submit = async (event) => {
    event?.preventDefault?.();
    const nextPrompt = String(prompt || "").trim();
    if (!nextPrompt || submitting) return;

    setSubmitting(true);
    setLocalError("");
    try {
      await onCreate?.({ prompt: nextPrompt });
      setPrompt("");
    } catch (err) {
      setLocalError(err.message || "Unable to add task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="simpleLedgerPage">
      <div className="simpleLedgerShell">
        <div className="simpleLedgerHeader">
          <div className="simpleLedgerHeaderCopy">
            <div className="workflowBadge">TASK LEDGER</div>
            <h1 className="simpleLedgerTitle">Shared task queue</h1>
            <div className="simpleLedgerMeta">
              <span>{serverName}</span>
              <span className="mono">{serverUrl}</span>
            </div>
          </div>
          <button type="button" className="secondaryButton" onClick={onOpenFullConsole}>
            Open full console
          </button>
        </div>

        <form className="consolePanel simpleLedgerComposer" onSubmit={submit}>
          <div className="panelBody simpleLedgerComposerBody">
            <label className="workflowField">
              <span className="workflowFieldLabel">Add task</span>
              <textarea
                className="consoleTextarea compact"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the next task to add to the ledger."
                rows={3}
                required
              />
            </label>
            <div className="workflowActionBar">
              <button className="primaryButton" disabled={submitting || !prompt.trim()}>
                {submitting ? "Adding..." : "Add task"}
              </button>
            </div>
            {localError ? <div className="errorBanner">{localError}</div> : null}
          </div>
        </form>

        <section className="consolePanel">
          <div className="panelBody simpleLedgerListBody">
            <div className="simpleLedgerListHeader">
              <div className="sectionLabel">Tasks</div>
              <div className="stepProgress mono">{(entries || []).length} total</div>
            </div>

            <div className="simpleLedgerList">
              {!busy && !(entries || []).length ? <div className="emptyState">No tasks in the ledger yet</div> : null}
              {(entries || []).map((entry) => {
                const taskId = linkedTaskId(entry);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="simpleLedgerRow"
                    onClick={() => onOpenEntry?.(entry)}
                  >
                    <div className="simpleLedgerRowTop">
                      <span className={`statusPill ${getStatusTone(entry.status)}`}>{getStatusLabel(entry.status)}</span>
                      {taskId ? <span className="scheduleMetaChip mono">{`thread ${String(taskId).slice(0, 8)}`}</span> : null}
                    </div>
                    <div className="simpleLedgerRowTitle">{entry.title || "Untitled task"}</div>
                    <div className="simpleLedgerRowPrompt">{entry.prompt}</div>
                  </button>
                );
              })}
            </div>

            {busy ? <div className="emptyState">Refreshing task ledger...</div> : null}
            {error ? <div className="errorBanner">{error}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
