import { useEffect, useMemo, useState } from "react";
import { advanceWorkflowSession, createWorkflowSession, retreatWorkflowSession } from "../agentClient";
import WorkflowStepRenderer from "./WorkflowStepRenderer";
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

  const threadOptions = useMemo(
    () => (tasks || []).map((task) => ({ value: task.id, label: `${task.id.slice(0, 8)} · ${task.goal}` })),
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

  const beginCreate = () => {
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
    resetWorkflowConfigState();
  };

  useEffect(() => {
    beginCreate();
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

    if (targetKind === WORKFLOW_TARGET) {
      if (!workflowId) {
        setWorkflowConfigError("Choose a workflow to continue");
        return;
      }
      if (!workflowSession || !isWorkflowConfigured(workflowSession)) {
        setWorkflowConfigError("Complete the workflow configuration before saving this schedule");
        return;
      }
    }

    const target = buildTargetFromForm(targetKind, { prompt, workspace, threadId, workflowId }, workflowInputs);
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

  const workflowReady = isWorkflowConfigured(workflowSession);
  const cadencePresets = [
    { label: "Weekdays 9am", cron: "0 9 * * 1-5" },
    { label: "Daily 9am", cron: "0 9 * * *" },
    { label: "Hourly", cron: "0 * * * *" }
  ];

  return (
    <div className="scheduleWorkspace">
      <section className="consolePanel scheduleEditor">
        <div className="panelBody workflowPanelBody">
          <div className="workflowHero">
            <span className="workflowBadge">SCHEDULE</span>
            <div className="launchTitle">{editingId ? "Edit automation" : "Create a recurring run"}</div>
            <div className="launchDescription">
              Start prompts, resume threads, or trigger workflows on a recurring cadence.
            </div>
          </div>

          <form className="workflowStep" onSubmit={submit}>
            <div className="workflowGrid">
              <label className="workflowField">
                <span className="workflowFieldLabel">Name</span>
                <input className="consoleInput" value={name} onChange={(event) => setName(event.target.value)} required />
              </label>

              <label className="workflowField">
                <span className="workflowFieldLabel">Cadence</span>
                <input
                  className="consoleInput mono"
                  value={cronExpr}
                  onChange={(event) => setCronExpr(event.target.value)}
                  required
                  placeholder="0 9 * * 1-5"
                />
                <div className="schedulePresetRow">
                  {cadencePresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className={`miniButton ${cronExpr === preset.cron ? "schedulePresetActive" : ""}`.trim()}
                      onClick={() => setCronExpr(preset.cron)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </label>

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
              <button type="button" className="secondaryButton" onClick={() => setShowAdvanced((value) => !value)}>
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

                    {workflowConfigError ? <div className="errorBanner">{workflowConfigError}</div> : null}
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

            <div className="workflowActionBar">
              <button type="submit" className="primaryButton workflowAction" disabled={busy || workflowConfigBusy}>
                {busy ? "Saving..." : editingId ? "Save schedule" : "Create schedule"}
              </button>
              {editingId ? (
                <button type="button" className="secondaryButton" disabled={busy || workflowConfigBusy} onClick={beginCreate}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>

          {error ? <div className="errorBanner">{error}</div> : null}
        </div>
      </section>

      <section className="consolePanel scheduleLedger">
        <div className="panelBody workflowPanelBody">
          <div className="workflowHero compact">
            <span className="workflowBadge">ACTIVE JOBS</span>
            <div className="launchTitle">Current schedules</div>
          </div>

          <div className="scheduleList">
            {(schedules || []).map((schedule) => (
              <div key={schedule.id} className="scheduleRow">
                <div className="scheduleRowHeader">
                  <div>
                    <div className="workflowName">{schedule.name}</div>
                    <div className="workflowDesc">{targetSummary(schedule)}</div>
                  </div>
                  <div className={`scheduleStatus ${schedule.enabled ? "ready" : "notReady"}`}>
                    <span className="statusDot" />
                    {schedule.enabled ? "Enabled" : "Disabled"}
                  </div>
                </div>

                <div className="scheduleMetaInline">
                  <span className="scheduleMetaChip mono">cron {schedule.cron}</span>
                  <span className="scheduleMetaChip mono">{schedule.timezone || "server default"}</span>
                  <span className="scheduleMetaChip mono">last {formatTimestamp(schedule.lastRunAt)}</span>
                  <span className="scheduleMetaChip mono">result {compactResultLabel(schedule.lastRunStatus)}</span>
                </div>

                {schedule.lastRunMessage ? <div className="panelNote">{schedule.lastRunMessage}</div> : null}

                <div className="scheduleActions scheduleActionsCompact">
                  <button type="button" className="miniButton" disabled={busy} onClick={() => startEdit(schedule)}>
                    Edit
                  </button>
                  <button type="button" className="miniButton" disabled={busy} onClick={() => onRunNow?.(schedule.id)}>
                    Run now
                  </button>
                  <button type="button" className="miniButton miniButtonDanger" disabled={busy} onClick={() => onDelete?.(schedule.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {!schedules?.length ? <div className="emptyState">No schedules created yet</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
