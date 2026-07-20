import { useEffect, useMemo, useState } from "react";
import { advanceWorkflowSession, createWorkflowSession, retreatWorkflowSession } from "../agentClient";
import WorkflowStepRenderer from "./WorkflowStepRenderer";
import StateNotice from "./ui/StateNotice";
import CollectionHeader from "./ui/CollectionHeader";
import contractDefinitions from "../../../shared/contracts.json";

const [PROMPT_TARGET, THREAD_TARGET, WORKFLOW_TARGET] = contractDefinitions.scheduleTargetKinds;

function buildTargetFromForm(kind, form, workflowInputs) {
  if (kind === PROMPT_TARGET) {
    return {
      kind,
      prompt: String(form.prompt || "").trim(),
      workspace: String(form.workspace || "").trim() || null
    };
  }
  if (kind === THREAD_TARGET) {
    return {
      kind,
      threadId: String(form.threadId || "").trim(),
      prompt: String(form.prompt || "").trim()
    };
  }
  return {
    kind: WORKFLOW_TARGET,
    workflowId: String(form.workflowId || "").trim(),
    inputs: Array.isArray(workflowInputs) ? workflowInputs : []
  };
}

function targetSummary(schedule) {
  const target = schedule?.target || {};
  if (target.kind === PROMPT_TARGET) {
    return `Start prompt${target.workspace ? ` @ ${target.workspace}` : ""}`;
  }
  if (target.kind === THREAD_TARGET) {
    return `Continue thread ${String(target.threadId || "").slice(0, 8)}`;
  }
  if (target.kind === WORKFLOW_TARGET) {
    const inputCount = Array.isArray(target.inputs) ? target.inputs.length : 0;
    return `Run workflow ${target.workflowId}${inputCount ? ` · ${inputCount} inputs` : ""}`;
  }
  return "Unknown target";
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

function compactResultLabel(value) {
  if (!value) return "n/a";
  return String(value).replaceAll("_", " ");
}

function isWorkflowConfigured(session) {
  return session?.currentStep?.type === "complete";
}

function isCronShapeValid(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.length === 5 || parts.length === 6;
}

function isTimezoneValid(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    return true;
  } catch {
    return false;
  }
}

export default function SchedulePanel({
  schedules,
  workflows,
  tasks,
  loading,
  busy,
  operation,
  error,
  result,
  onCreate,
  onUpdate,
  onDelete,
  onRunNow,
  onReload,
  onClearFeedback
}) {
  const [editingId, setEditingId] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  const [enabled, setEnabled] = useState(true);
  const [targetKind, setTargetKind] = useState(PROMPT_TARGET);
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [threadId, setThreadId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [workflowSession, setWorkflowSession] = useState(null);
  const [workflowInputs, setWorkflowInputs] = useState([]);
  const [workflowConfigBusy, setWorkflowConfigBusy] = useState(false);
  const [workflowConfigError, setWorkflowConfigError] = useState("");
  const [workflowBootstrap, setWorkflowBootstrap] = useState({ nonce: 0, inputs: [] });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formError, setFormError] = useState("");
  const [lastRequest, setLastRequest] = useState(null);

  const threadOptions = useMemo(
    () => (tasks || []).map((task) => ({ value: task.id, label: `${task.id.slice(0, 8)} · ${task.title || task.goal}` })),
    [tasks]
  );

  const schedulableWorkflows = useMemo(
    () => (workflows || []).filter((item) => item.supportsScheduling !== false || item.id === workflowId),
    [workflows, workflowId]
  );

  const selectedWorkflow = useMemo(
    () => schedulableWorkflows.find((item) => item.id === workflowId) || null,
    [schedulableWorkflows, workflowId]
  );

  const queueWorkflowBootstrap = (inputs = []) => {
    setWorkflowBootstrap({
      nonce: Date.now() + Math.random(),
      inputs: Array.isArray(inputs) ? inputs : []
    });
  };

  const resetWorkflowConfigState = () => {
    setWorkflowSession(null);
    setWorkflowInputs([]);
    setWorkflowConfigError("");
    setWorkflowConfigBusy(false);
    setWorkflowBootstrap({ nonce: 0, inputs: [] });
  };

  const beginCreate = ({ open = true } = {}) => {
    setEditorOpen(open);
    setEditingId(null);
    setName("");
    setCronExpr("0 9 * * 1-5");
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    setEnabled(true);
    setTargetKind(PROMPT_TARGET);
    setPrompt("");
    setWorkspace("");
    setThreadId("");
    setWorkflowId("");
    setShowAdvanced(false);
    setFormError("");
    setLastRequest(null);
    resetWorkflowConfigState();
  };

  useEffect(() => {
    beginCreate({ open: false });
  }, []);

  useEffect(() => {
    let live = true;

    if (targetKind !== WORKFLOW_TARGET || !workflowId) {
      setWorkflowSession(null);
      setWorkflowInputs([]);
      setWorkflowConfigError("");
      setWorkflowConfigBusy(false);
      return () => {
        live = false;
      };
    }

    const bootstrapInputs = Array.isArray(workflowBootstrap.inputs) ? workflowBootstrap.inputs : [];

    setWorkflowConfigBusy(true);
    setWorkflowConfigError("");

    (async () => {
      let nextSession = await createWorkflowSession(workflowId, { mode: "schedule_config" });
      for (const input of bootstrapInputs) {
        const advanced = await advanceWorkflowSession(nextSession.id, input || {});
        nextSession = advanced.session;
      }

      if (!live) return;
      setWorkflowSession(nextSession);
      setWorkflowInputs(bootstrapInputs);
    })()
      .catch((err) => {
        if (!live) return;
        setWorkflowSession(null);
        setWorkflowInputs(bootstrapInputs);
        setWorkflowConfigError(err.message || "Unable to prepare workflow schedule configuration");
      })
      .finally(() => {
        if (live) setWorkflowConfigBusy(false);
      });

    return () => {
      live = false;
    };
  }, [targetKind, workflowId, workflowBootstrap.nonce]);

  const startEdit = (schedule) => {
    onClearFeedback?.();
    setEditorOpen(true);
    setEditingId(schedule.id);
    setName(schedule.name || "");
    setCronExpr(schedule.cron || "");
    setTimezone(schedule.timezone || "");
    setEnabled(schedule.enabled !== false);
    const target = schedule.target || {};
    setTargetKind(target.kind || PROMPT_TARGET);
    setPrompt(target.prompt || "");
    setWorkspace(target.workspace || "");
    setThreadId(target.threadId || "");
    setWorkflowId(target.workflowId || "");
    setShowAdvanced(Boolean(schedule.timezone || target.kind === WORKFLOW_TARGET || schedule.enabled === false));
    setFormError("");
    setLastRequest(null);
    setWorkflowConfigError("");
    if (target.kind === WORKFLOW_TARGET && target.workflowId) {
      queueWorkflowBootstrap(target.inputs || []);
    } else {
      resetWorkflowConfigState();
    }
  };

  const advanceWorkflowConfig = async (input) => {
    if (!workflowSession) return;
    setWorkflowConfigBusy(true);
    setWorkflowConfigError("");
    try {
      const result = await advanceWorkflowSession(workflowSession.id, input || {});
      setWorkflowSession(result.session);
      setWorkflowInputs((prev) => [...prev, input || {}]);
    } catch (err) {
      setWorkflowConfigError(err.message || "Unable to save workflow step");
    } finally {
      setWorkflowConfigBusy(false);
    }
  };

  const retreatWorkflowConfig = async () => {
    if (!workflowSession?.canGoBack) return;
    setWorkflowConfigBusy(true);
    setWorkflowConfigError("");
    try {
      const session = await retreatWorkflowSession(workflowSession.id);
      setWorkflowSession(session);
      setWorkflowInputs((prev) => prev.slice(0, -1));
    } catch (err) {
      setWorkflowConfigError(err.message || "Unable to go back");
    } finally {
      setWorkflowConfigBusy(false);
    }
  };

  const resetWorkflowConfiguration = () => {
    if (!workflowId) return;
    queueWorkflowBootstrap([]);
  };

  const submit = async (event) => {
    event?.preventDefault?.();

    const normalizedName = String(name || "").trim();
    const normalizedCron = String(cronExpr || "").trim();
    const normalizedTimezone = String(timezone || "").trim();
    const normalizedPrompt = String(prompt || "").trim();
    if (!normalizedName) {
      setFormError("Add a name so operators can identify this schedule.");
      return;
    }
    if (!isCronShapeValid(normalizedCron)) {
      setFormError("Enter a cron expression with five or six space-separated fields.");
      return;
    }
    if (!isTimezoneValid(normalizedTimezone)) {
      setFormError("Enter a valid IANA timezone such as America/New_York, or leave it blank for the server default.");
      return;
    }
    if (targetKind === PROMPT_TARGET && !normalizedPrompt) {
      setFormError("Add the prompt this schedule should start.");
      return;
    }
    if (targetKind === THREAD_TARGET && !threadId) {
      setFormError("Choose the thread this schedule should continue.");
      return;
    }
    if (targetKind === THREAD_TARGET && !normalizedPrompt) {
      setFormError("Add the follow-up prompt this schedule should send.");
      return;
    }

    if (targetKind === WORKFLOW_TARGET) {
      if (!workflowId) {
        setFormError("Choose a workflow to continue.");
        return;
      }
      if (!workflowSession || !isWorkflowConfigured(workflowSession)) {
        setFormError("Complete the workflow configuration before saving this schedule.");
        return;
      }
    }

    setFormError("");
    onClearFeedback?.();
    const target = buildTargetFromForm(targetKind, { prompt, workspace, threadId, workflowId }, workflowInputs);
    const payload = {
      name: normalizedName,
      cron: normalizedCron,
      timezone: normalizedTimezone || null,
      enabled,
      target
    };
    const request = { type: editingId ? "update" : "create", id: editingId, payload, resetForm: true };
    setLastRequest(request);
    const saved = editingId
      ? await onUpdate?.(editingId, payload)
      : await onCreate?.(payload);
    if (saved) beginCreate({ open: false });
  };

  const performRequest = async (request) => {
    if (!request) return null;
    setLastRequest(request);
    onClearFeedback?.();
    let response = null;
    if (request.type === "create") response = await onCreate?.(request.payload);
    if (request.type === "update") response = await onUpdate?.(request.id, request.payload);
    if (request.type === "run") response = await onRunNow?.(request.id);
    if (request.type === "delete") response = await onDelete?.(request.id);
    if (response?.cancelled) {
      setLastRequest(null);
      return response;
    }
    if (response && request.resetForm) beginCreate({ open: false });
    if (response) setLastRequest(null);
    return response;
  };

  const runNow = (schedule) => performRequest({ type: "run", id: schedule.id });

  const deleteEntry = (schedule) => performRequest({ type: "delete", id: schedule.id });

  const toggleEnabled = (schedule) => performRequest({
    type: "update",
    id: schedule.id,
    payload: { enabled: !schedule.enabled },
    resetForm: false
  });

  const retryLastRequest = () => {
    if (lastRequest) return performRequest(lastRequest);
    return onReload?.();
  };

  const retryLabel = lastRequest?.type === "run"
    ? "Retry run"
    : lastRequest?.type === "delete"
      ? "Retry delete"
      : lastRequest?.type === "update"
        ? "Retry update"
        : lastRequest?.type === "create"
          ? "Retry create"
          : "Reload schedules";

  const operationTitle = operation?.type === "run"
    ? "Running schedule"
    : operation?.type === "delete"
      ? "Deleting schedule"
      : operation?.type === "update"
        ? "Updating schedule"
        : operation?.type === "create"
          ? "Creating schedule"
          : "Updating schedules";

  const resultTitle = result?.type === "run"
    ? "Schedule run started"
    : result?.type === "delete"
      ? "Schedule deleted"
      : result?.type === "update"
        ? "Schedule updated"
        : "Schedule created";

  const resultDetail = result?.type === "run"
    ? result.result?.message || "The run request completed and its latest outcome is shown in the schedule list."
    : "The server schedule collection is up to date.";

  const workflowReady = isWorkflowConfigured(workflowSession);
  const cadencePresets = [
    { label: "Weekdays 9am", cron: "0 9 * * 1-5" },
    { label: "Daily 9am", cron: "0 9 * * *" },
    { label: "Hourly", cron: "0 * * * *" }
  ];
  const enabledCount = (schedules || []).filter((schedule) => schedule.enabled).length;
  const failedCount = (schedules || []).filter((schedule) => schedule.lastRunStatus === "error").length;
  const neverRunCount = (schedules || []).filter((schedule) => !schedule.lastRunAt).length;

  return (
    <div className="scheduleStack">
      <CollectionHeader
        label="Automation"
        title="Recurring operations"
        description="Inspect outcomes and run, pause, or edit server-managed schedules. Open the editor only when configuration changes."
        stats={[
          { label: "total", value: (schedules || []).length },
          { label: "enabled", value: enabledCount },
          { label: "review", value: failedCount, tone: failedCount ? "attention" : "" },
          { label: "never run", value: neverRunCount }
        ]}
        ariaLabel="Schedule overview"
      >
        {editorOpen ? (
          <button type="button" className="secondaryButton" onClick={() => beginCreate({ open: false })} disabled={busy || workflowConfigBusy}>Close editor</button>
        ) : (
          <button type="button" className="primaryButton" onClick={() => beginCreate()} disabled={busy}>New schedule</button>
        )}
      </CollectionHeader>

      {loading && !schedules?.length ? (
        <StateNotice title="Loading schedules" detail="Reading recurring jobs and their latest outcomes from the server." busy />
      ) : null}
      {operation ? (
        <StateNotice title={operationTitle} detail="The form and schedule collection will remain in place while the server responds." busy compact />
      ) : null}
      {error ? (
        <StateNotice
          tone="danger"
          title="Schedule operation failed"
          detail={error}
          actionLabel={retryLabel}
          onAction={retryLastRequest}
          busy={busy || loading}
          compact
        />
      ) : null}
      {!error && result ? (
        <StateNotice tone="success" title={resultTitle} detail={resultDetail} compact />
      ) : null}

      <div className={`scheduleWorkspace collectionWorkspace ${editorOpen ? "editorOpen" : "collectionOnly"}`}>
      {editorOpen ? <section className="consolePanel scheduleEditor">
        <div className="panelBody workflowPanelBody">
          <div className="workflowHero compact">
            <span className="workflowBadge">{editingId ? "Edit schedule" : "New schedule"}</span>
            <div className="launchTitle">{editingId ? "Edit automation" : "Create a recurring run"}</div>
          </div>

          <form className="workflowStep" onSubmit={submit} noValidate>
            <div className="scheduleTopGrid">
              <label className="workflowField scheduleNameField">
                <span className="workflowFieldLabel">Name</span>
                <span className="fieldHint">Use a recognizable operational label.</span>
                <input className="consoleInput" value={name} onChange={(event) => { setName(event.target.value); setFormError(""); }} />
              </label>

              <label className="workflowField">
                <span className="workflowFieldLabel">Cadence</span>
                <span className="fieldHint">Choose a preset or enter a five- or six-field cron expression.</span>
                <input
                  className="consoleInput mono"
                  value={cronExpr}
                  onChange={(event) => { setCronExpr(event.target.value); setFormError(""); }}
                  placeholder="0 9 * * 1-5"
                />
                <div className="schedulePresetRow">
                  {cadencePresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className={`miniButton ${cronExpr === preset.cron ? "schedulePresetActive" : ""}`.trim()}
                      aria-pressed={cronExpr === preset.cron}
                      onClick={() => setCronExpr(preset.cron)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </label>
            </div>

            <div className="workflowGrid">
              <label className="workflowField">
                <span className="workflowFieldLabel">Target type</span>
                <select
                  className="consoleInput"
                  value={targetKind}
                  onChange={(event) => {
                    const nextKind = event.target.value;
                    setTargetKind(nextKind);
                    if (nextKind !== WORKFLOW_TARGET) {
                      resetWorkflowConfigState();
                    }
                  }}
                >
                  <option value={PROMPT_TARGET}>Start new prompt</option>
                  <option value={THREAD_TARGET}>Continue existing thread</option>
                  <option value={WORKFLOW_TARGET}>Run workflow</option>
                </select>
              </label>
            </div>

            <div className="workflowActionBar scheduleAdvancedToggleRow">
              <button
                type="button"
                className="secondaryButton"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((value) => !value)}
              >
                {showAdvanced ? "Hide advanced options" : "Show advanced options"}
              </button>
            </div>

            {targetKind === PROMPT_TARGET ? (
              <>
                <label className="workflowField">
                  <span className="workflowFieldLabel">Prompt</span>
                  <textarea className="consoleTextarea compact" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} required />
                </label>
                <label className="workflowField">
                  <span className="workflowFieldLabel">Workspace</span>
                  <input className="consoleInput" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="Optional repo or folder" />
                </label>
              </>
            ) : null}

            {targetKind === THREAD_TARGET ? (
              <>
                <label className="workflowField">
                  <span className="workflowFieldLabel">Thread</span>
                  <select className="consoleInput" value={threadId} onChange={(event) => setThreadId(event.target.value)} required>
                    <option value="">Select thread...</option>
                    {threadOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="workflowField">
                  <span className="workflowFieldLabel">Resume prompt</span>
                  <textarea className="consoleTextarea compact" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} required />
                </label>
              </>
            ) : null}

            {targetKind === WORKFLOW_TARGET ? (
              <>
                <label className="workflowField">
                  <span className="workflowFieldLabel">Workflow</span>
                  <select
                    className="consoleInput"
                    value={workflowId}
                    onChange={(event) => {
                      const nextWorkflowId = event.target.value;
                      setWorkflowId(nextWorkflowId);
                      if (nextWorkflowId) queueWorkflowBootstrap([]);
                      else resetWorkflowConfigState();
                    }}
                    required
                  >
                    <option value="">Select workflow...</option>
                    {schedulableWorkflows.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>

                {workflowId ? (
                  <div className="scheduleWorkflowConfigurator pickerBox">
                    <div className="workflowToolbar">
                      <div className="stepProgress mono">
                        {workflowConfigBusy
                          ? "Preparing schedule workflow..."
                          : workflowReady
                            ? `Configured · ${workflowInputs.length} saved inputs`
                            : `Configure ${selectedWorkflow?.name || workflowId}`}
                      </div>
                      <div className="workflowActionBar">
                        <button type="button" className="secondaryButton" disabled={busy || workflowConfigBusy} onClick={resetWorkflowConfiguration}>
                          Reset config
                        </button>
                        {workflowSession?.canGoBack ? (
                          <button type="button" className="secondaryButton" disabled={busy || workflowConfigBusy} onClick={retreatWorkflowConfig}>
                            Back
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="panelNote">
                      {workflowReady
                        ? "This workflow is fully configured and ready for scheduled execution."
                        : "Complete these workflow steps now so the scheduled run can execute without interactive prompts."}
                    </div>

                    {workflowSession ? (
                      <WorkflowStepRenderer
                        step={workflowSession.currentStep}
                        onSubmit={advanceWorkflowConfig}
                        busy={busy || workflowConfigBusy}
                        submitLabel="Save step"
                      />
                    ) : workflowConfigBusy ? (
                      <div className="emptyState">Preparing workflow configuration…</div>
                    ) : null}

                    {workflowConfigError ? (
                      <StateNotice
                        tone="danger"
                        title="Workflow configuration failed"
                        detail={workflowConfigError}
                        actionLabel="Retry configuration"
                        onAction={() => queueWorkflowBootstrap(workflowInputs)}
                        busy={workflowConfigBusy}
                        compact
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="panelNote">Only workflows that support scheduled execution appear here.</div>
                )}
              </>
            ) : null}

            {showAdvanced ? (
              <div className="workflowGrid scheduleAdvancedGrid">
                <label className="workflowField">
                  <span className="workflowFieldLabel">Timezone</span>
                  <input
                    className="consoleInput"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    placeholder="America/New_York"
                  />
                </label>

                <label className="workflowField">
                  <span className="workflowFieldLabel">Automation state</span>
                  <label className="toggleField">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => setEnabled(event.target.checked)}
                    />
                    <span>{enabled ? "Enabled" : "Disabled"}</span>
                  </label>
                </label>
              </div>
            ) : null}

            {formError ? (
              <StateNotice tone="warning" title="Schedule needs attention" detail={formError} compact />
            ) : null}

            <div className="workflowActionBar">
              <button type="submit" className="primaryButton workflowAction" disabled={busy || workflowConfigBusy}>
                {busy ? "Saving..." : editingId ? "Save schedule" : "Create schedule"}
              </button>
              {editingId ? (
                <button type="button" className="secondaryButton" disabled={busy || workflowConfigBusy} onClick={() => beginCreate({ open: false })}>
                  Cancel edit
                </button>
              ) : (
                <button type="button" className="secondaryButton" disabled={busy || workflowConfigBusy} onClick={() => beginCreate({ open: false })}>
                  Close
                </button>
              )}
            </div>
          </form>

        </div>
      </section> : null}

      <section className="consolePanel scheduleLedger">
        <div className="panelBody workflowPanelBody">
          <div className="collectionPanelHeader">
            <div>
              <div className="sectionLabel">Schedule collection</div>
              <div className="collectionPanelTitle">Current schedules</div>
            </div>
            <div className="stepProgress mono">{(schedules || []).length} configured</div>
          </div>

          <div className="scheduleList">
            {(schedules || []).map((schedule) => (
              <div key={schedule.id} className="scheduleRow collectionRow">
                <div className="scheduleRowHeader">
                  <div>
                    <div className="workflowName">{schedule.name}</div>
                    <div className="workflowDesc">{targetSummary(schedule)}</div>
                  </div>
                  <div className="scheduleRowControls">
                    <div className={`scheduleStatus ${schedule.enabled ? "ready" : "notReady"}`}>
                      <span className="statusDot" />
                      {schedule.enabled ? "Enabled" : "Disabled"}
                    </div>
                    <div className="scheduleActions scheduleActionsCompact">
                      <button type="button" className="miniButton" disabled={busy} onClick={() => startEdit(schedule)}>Edit</button>
                      <button type="button" className="miniButton" disabled={busy} onClick={() => toggleEnabled(schedule)}>{schedule.enabled ? "Disable" : "Enable"}</button>
                      <button type="button" className="miniButton" disabled={busy} onClick={() => runNow(schedule)}>
                        {operation?.type === "run" && operation.id === schedule.id ? "Running…" : "Run now"}
                      </button>
                      <button type="button" className="miniButton miniButtonDanger" disabled={busy} onClick={() => deleteEntry(schedule)}>
                        {operation?.type === "delete" && operation.id === schedule.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="scheduleMetaInline">
                  <span className="scheduleMetaChip mono">cron {schedule.cron}</span>
                  <span className="scheduleMetaChip mono">{schedule.timezone || "server default"}</span>
                  <span className="scheduleMetaChip mono">last {formatTimestamp(schedule.lastRunAt)}</span>
                  <span className={`scheduleMetaChip mono ${schedule.lastRunStatus === "error" ? "danger" : schedule.lastRunStatus ? "success" : ""}`.trim()}>
                    result {compactResultLabel(schedule.lastRunStatus)}
                  </span>
                </div>

                {schedule.lastRunMessage ? (
                  <div className={`scheduleRunOutcome ${schedule.lastRunStatus === "error" ? "danger" : "success"}`}>
                    <strong>Latest outcome</strong>
                    <span>{schedule.lastRunMessage}</span>
                  </div>
                ) : null}

                <details className="scheduleDetails">
                  <summary>Target details</summary>
                  <div className="scheduleTargetDetails">
                    <span className="mono">{schedule.id}</span>
                    {schedule.target?.prompt ? <span>{schedule.target.prompt}</span> : null}
                    {schedule.target?.workspace ? <span className="mono">{schedule.target.workspace}</span> : null}
                    {schedule.target?.workflowId ? <span className="mono">workflow {schedule.target.workflowId}</span> : null}
                    {schedule.target?.threadId ? <span className="mono">thread {schedule.target.threadId}</span> : null}
                  </div>
                </details>

              </div>
            ))}

            {!schedules?.length && !loading ? (
              <StateNotice title="No schedules yet" detail="Create the first recurring run when this server needs automated work." actionLabel="Create first schedule" onAction={() => beginCreate()} />
            ) : null}
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
