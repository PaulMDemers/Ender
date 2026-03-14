import { useEffect, useMemo, useState } from "react";

function buildTargetFromForm(kind, form) {
  if (kind === "prompt") {
    return {
      kind,
      prompt: String(form.prompt || "").trim(),
      workspace: String(form.workspace || "").trim() || null
    };
  }
  if (kind === "thread") {
    return {
      kind,
      threadId: String(form.threadId || "").trim(),
      prompt: String(form.prompt || "").trim()
    };
  }
  return {
    kind: "workflow",
    workflowId: String(form.workflowId || "").trim(),
    inputs: []
  };
}

function targetSummary(schedule) {
  const target = schedule?.target || {};
  if (target.kind === "prompt") {
    return `Prompt${target.workspace ? ` @ ${target.workspace}` : ""}`;
  }
  if (target.kind === "thread") {
    return `Thread ${target.threadId}`;
  }
  if (target.kind === "workflow") {
    return `Workflow ${target.workflowId}`;
  }
  return "Unknown target";
}

export default function SchedulePanel({
  schedules,
  workflows,
  tasks,
  busy,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onRunNow
}) {
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  const [enabled, setEnabled] = useState(true);
  const [targetKind, setTargetKind] = useState("prompt");
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [threadId, setThreadId] = useState("");
  const [workflowId, setWorkflowId] = useState("");

  const threadOptions = useMemo(() => (
    (tasks || []).map((task) => ({ value: task.id, label: `${task.id.slice(0, 8)} - ${task.goal}` }))
  ), [tasks]);

  const beginCreate = () => {
    setEditingId(null);
    setName("");
    setCronExpr("0 9 * * 1-5");
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    setEnabled(true);
    setTargetKind("prompt");
    setPrompt("");
    setWorkspace("");
    setThreadId("");
    setWorkflowId("");
  };

  useEffect(() => {
    beginCreate();
  }, []);

  const startEdit = (schedule) => {
    setEditingId(schedule.id);
    setName(schedule.name || "");
    setCronExpr(schedule.cron || "");
    setTimezone(schedule.timezone || "");
    setEnabled(schedule.enabled !== false);
    const target = schedule.target || {};
    setTargetKind(target.kind || "prompt");
    setPrompt(target.prompt || "");
    setWorkspace(target.workspace || "");
    setThreadId(target.threadId || "");
    setWorkflowId(target.workflowId || "");
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    const target = buildTargetFromForm(targetKind, { prompt, workspace, threadId, workflowId });
    const payload = {
      name: String(name || "").trim(),
      cron: String(cronExpr || "").trim(),
      timezone: String(timezone || "").trim() || null,
      enabled,
      target
    };
    if (editingId) {
      await onUpdate?.(editingId, payload);
    } else {
      await onCreate?.(payload);
    }
    beginCreate();
  };

  return (
    <div className="workflowPanel">
      <div className="blankPanelTitle">{editingId ? "Edit schedule" : "Create schedule"}</div>
      <div className="blankPanelText">
        Use cron syntax to run prompts, continue threads, or trigger workflows automatically.
      </div>
      <form className="workflowStep" onSubmit={submit}>
        <label className="workflowField">
          <span className="workflowFieldLabel">Name</span>
          <input className="serverInput" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="workflowField">
          <span className="workflowFieldLabel">Cron</span>
          <input
            className="serverInput"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            required
            placeholder="0 9 * * 1-5"
          />
        </label>
        <label className="workflowField">
          <span className="workflowFieldLabel">Timezone</span>
          <input
            className="serverInput"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
          />
        </label>
        <label className="workflowField">
          <span className="workflowFieldLabel">Target</span>
          <select className="serverInput" value={targetKind} onChange={(e) => setTargetKind(e.target.value)}>
            <option value="prompt">Start new prompt task</option>
            <option value="thread">Continue existing thread</option>
            <option value="workflow">Run workflow</option>
          </select>
        </label>
        {targetKind === "prompt" ? (
          <>
            <label className="workflowField">
              <span className="workflowFieldLabel">Prompt</span>
              <textarea className="serverInput" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} required />
            </label>
            <label className="workflowField">
              <span className="workflowFieldLabel">Workspace (optional)</span>
              <input className="serverInput" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
            </label>
          </>
        ) : null}
        {targetKind === "thread" ? (
          <>
            <label className="workflowField">
              <span className="workflowFieldLabel">Thread</span>
              <select className="serverInput" value={threadId} onChange={(e) => setThreadId(e.target.value)} required>
                <option value="">Select thread...</option>
                {threadOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="workflowField">
              <span className="workflowFieldLabel">Prompt</span>
              <textarea className="serverInput" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} required />
            </label>
          </>
        ) : null}
        {targetKind === "workflow" ? (
          <label className="workflowField">
            <span className="workflowFieldLabel">Workflow</span>
            <select className="serverInput" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} required>
              <option value="">Select workflow...</option>
              {(workflows || []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="workflowField">
          <span className="workflowFieldLabel">Enabled</span>
          <select className="serverInput" value={enabled ? "yes" : "no"} onChange={(e) => setEnabled(e.target.value === "yes")}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <div className="workflowStepActions">
          <button type="submit" className="actionButton workflowAction" disabled={busy}>
            {busy ? "Saving..." : editingId ? "Save Changes" : "Create Schedule"}
          </button>
          {editingId ? (
            <button type="button" className="miniButton" disabled={busy} onClick={beginCreate}>
              Cancel Edit
            </button>
          ) : null}
        </div>
      </form>

      <div className="blankPanelTitle">Current schedules</div>
      <div className="workflowList">
        {(schedules || []).map((schedule) => (
          <div key={schedule.id} className="workflowCard">
            <div className="workflowName">{schedule.name}</div>
            <div className="workflowDesc">
              {schedule.cron} {schedule.timezone ? `(${schedule.timezone})` : ""}
            </div>
            <div className="workflowDesc">{targetSummary(schedule)}</div>
            {schedule.lastRunAt ? (
              <div className="workflowDesc">
                Last run: {new Date(schedule.lastRunAt).toLocaleString()} [{schedule.lastRunStatus || "unknown"}]
              </div>
            ) : null}
            {schedule.lastRunMessage ? <div className="workflowDesc">{schedule.lastRunMessage}</div> : null}
            <div className="taskActions">
              <button type="button" className="miniButton" disabled={busy} onClick={() => startEdit(schedule)}>
                Edit
              </button>
              <button type="button" className="miniButton" disabled={busy} onClick={() => onRunNow?.(schedule.id)}>
                Run Now
              </button>
              <button
                type="button"
                className="miniButton miniButtonDanger"
                disabled={busy}
                onClick={() => onDelete?.(schedule.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {!schedules?.length ? <div className="emptyState">No schedules yet</div> : null}
      </div>
      {error ? <div className="errorText">{error}</div> : null}
    </div>
  );
}
