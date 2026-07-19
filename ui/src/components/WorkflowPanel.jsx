import { useState } from "react";
import WorkflowStepRenderer from "./WorkflowStepRenderer";
import StateNotice from "./ui/StateNotice";

function getWorkflowReadiness(workflow, readiness) {
  const state = readiness?.[workflow.id];
  const missing = Array.isArray(state?.missing) ? state.missing : [];
  if (state?.ready === false) {
    return {
      ready: false,
      label: "Needs setup",
      detail: missing.length ? `Missing ${missing.join(", ")}` : "Server prerequisites are incomplete."
    };
  }
  return {
    ready: true,
    label: state?.ready === true ? "Ready" : "Available",
    detail: workflow.supportsScheduling === false ? "Interactive only" : "Interactive and schedulable"
  };
}

function WorkflowList({ workflows, readiness, busy, onStart }) {
  if (!workflows.length) {
    return (
      <StateNotice
        title="No workflows available"
        detail="This server has not registered any guided launch workflows."
      />
    );
  }

  return (
    <div className="workflowList" aria-label="Available workflows">
      {workflows.map((workflow) => {
        const state = getWorkflowReadiness(workflow, readiness);
        return (
          <button
            key={workflow.id}
            type="button"
            className={`workflowCard ${state.ready ? "" : "workflowCardUnavailable"}`.trim()}
            onClick={() => onStart?.(workflow.id)}
            disabled={busy || !state.ready}
          >
            <div className="workflowCardHeader">
              <span className="workflowBadge">WORKFLOW</span>
              <span className={`statusPill ${state.ready ? "success" : "warning"}`}>{state.label}</span>
            </div>
            <div className="workflowName">{workflow.name}</div>
            <div className="workflowDesc">{workflow.description}</div>
            <div className="workflowCardFooter">
              <span className="mono">{workflow.id}</span>
              <span>{state.detail}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function WorkflowPanel({
  workflows,
  readiness,
  loading,
  error,
  session,
  busy,
  onStartWorkflow,
  onReload,
  onAdvance,
  onBack,
  onReset
}) {
  const [lastAction, setLastAction] = useState(null);
  const step = session?.currentStep || null;
  const effectiveError = error || session?.bootstrapError || "";
  const debugEntries = Array.isArray(session?.debug) ? session.debug : [];
  const historyCount = debugEntries.length;
  const availableCount = (workflows || []).filter((workflow) => getWorkflowReadiness(workflow, readiness).ready).length;
  const setupCount = Math.max(0, (workflows || []).length - availableCount);
  const schedulableCount = (workflows || []).filter((workflow) => workflow.supportsScheduling !== false).length;
  const stepSummary = session
    ? `${session.canGoBack ? "Multi-step flow" : "Starting point"}${step?.type ? ` · ${step.type.replaceAll("_", " ")}` : ""}`
    : "Choose a server-defined flow";

  const startWorkflow = async (workflowId) => {
    const action = { type: "start", workflowId };
    setLastAction(action);
    const result = await onStartWorkflow?.(workflowId);
    if (result) setLastAction(null);
    return result;
  };

  const advanceWorkflow = async (input) => {
    const action = { type: "advance", input };
    setLastAction(action);
    const result = await onAdvance?.(input);
    if (result) setLastAction(null);
    return result;
  };

  const goBack = async () => {
    const action = { type: "back" };
    setLastAction(action);
    const result = await onBack?.();
    if (result) setLastAction(null);
    return result;
  };

  const retry = () => {
    if (lastAction?.type === "start") return startWorkflow(lastAction.workflowId);
    if (lastAction?.type === "advance") return advanceWorkflow(lastAction.input);
    if (lastAction?.type === "back") return goBack();
    if (session?.bootstrapError) return reset();
    return onReload?.();
  };

  const reset = () => {
    setLastAction(null);
    onReset?.();
  };

  const retryLabel = session?.bootstrapError && !lastAction
    ? "Change workflow"
    : lastAction?.type === "advance"
    ? "Retry step"
    : lastAction?.type === "back"
      ? "Retry back"
      : lastAction?.type === "start"
        ? "Retry workflow"
        : "Reload workflows";

  return (
    <div className="workflowStack">
      <section className="automationOverview" aria-label="Workflow overview">
        <div className="workflowHero">
          <span className="workflowBadge">{session ? "ACTIVE SESSION" : "WORKFLOWS"}</span>
          <div className="launchTitle">{session ? step?.title || session.workflowName : "Guided task launch"}</div>
          <div className="launchDescription">
            {session && step?.description
              ? step.description
              : "Choose a server-defined flow to gather validated inputs and hand work into a supervised thread."}
          </div>
        </div>
        {!session ? (
          <div className="automationSummaryGrid">
            <div className="automationSummaryItem"><span>Available</span><strong>{availableCount}</strong></div>
            <div className="automationSummaryItem"><span>Needs setup</span><strong>{setupCount}</strong></div>
            <div className="automationSummaryItem"><span>Schedulable</span><strong>{schedulableCount}</strong></div>
          </div>
        ) : (
          <div className="workflowToolbar workflowToolbarCompact">
            <div className="stepProgress mono">
              {stepSummary} · session {session.id.slice(0, 8)} · updated {new Date(session.updatedAt).toLocaleTimeString()}
            </div>
            <div className="workflowActionBar">
              <button type="button" className="secondaryButton" disabled={busy} onClick={reset}>Change workflow</button>
              {session.canGoBack ? (
                <button type="button" className="secondaryButton" disabled={busy} onClick={goBack}>Back</button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {session?.resumedFromDisk ? (
        <StateNotice
          tone="success"
          title="Saved workflow restored"
          detail="Continue where this server session left off before the connection changed."
          compact
        />
      ) : null}

      <div className="workflowWorkspace">
        <section className="consolePanel workflowConsole">
          <div className="panelBody workflowPanelBody">
            {!session ? (
              loading && !workflows.length ? (
                <StateNotice title="Loading workflows" detail="Reading guided launch definitions and readiness from the server." busy />
              ) : (
                <WorkflowList workflows={workflows || []} readiness={readiness} busy={busy} onStart={startWorkflow} />
              )
            ) : (
              <>
                <div className="workflowStepHeader">
                  <span className="statusPill running">{busy ? "processing" : "awaiting input"}</span>
                  <span className="mono">{session.workflowName}</span>
                </div>
                <WorkflowStepRenderer step={step} onSubmit={advanceWorkflow} busy={busy} />
                {step?.type === "complete" ? (
                  <StateNotice tone="success" title="Workflow complete" detail="Ender is transitioning into the created task." />
                ) : null}
              </>
            )}

            {effectiveError ? (
              <StateNotice
                tone="danger"
                title={session ? "Workflow step failed" : "Workflows could not load"}
                detail={effectiveError}
                actionLabel={retryLabel}
                onAction={retry}
                busy={busy || loading}
              />
            ) : null}
          </div>
        </section>

        <aside className="sidePanel workflowSidePanel">
          <div className="sectionLabel">Session status</div>
          <div className="launchSummaryValue">{session ? (step?.title || session.workflowName) : "Ready to choose"}</div>
          <div className="panelNote">
            {session
              ? "Inputs stay attached to this recoverable server session until the workflow creates a thread or you change workflows."
              : "Readiness comes from the connected server. Workflows needing setup remain visible with their missing prerequisites."}
          </div>
          <div className="launchContextBlock">
            <span className="launchSummaryLabel">Mode</span>
            <div className="sidePanelValue mono">{session ? stepSummary : "interactive guided launch"}</div>
          </div>
          {session ? (
            <div className="launchContextBlock">
              <span className="launchSummaryLabel">Recovery</span>
              <div className="sidePanelValue">Saved automatically on this server</div>
            </div>
          ) : null}
          {historyCount ? (
            <details className="workflowDebug">
              <summary className="mono">Debug trace · {historyCount}</summary>
              <pre className="workflowDebugPre">{JSON.stringify(debugEntries, null, 2)}</pre>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
