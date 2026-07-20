import { useState } from "react";
import WorkflowStepRenderer from "./WorkflowStepRenderer";
import StateNotice from "./ui/StateNotice";
import CollectionHeader from "./ui/CollectionHeader";

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
            className={`workflowCard collectionRow ${state.ready ? "" : "workflowCardUnavailable"}`.trim()}
            onClick={() => onStart?.(workflow.id)}
            disabled={busy || !state.ready}
          >
            <div className="workflowCardHeader">
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
      <CollectionHeader
        label={session ? "Active workflow" : "Workflow catalog"}
        title={session ? step?.title || session.workflowName : "Guided launches"}
        description={session && step?.description
          ? step.description
          : "Choose a validated server-defined flow and hand the result into a supervised thread."}
        stats={session ? [] : [
          { label: "available", value: availableCount },
          { label: "setup", value: setupCount, tone: setupCount ? "attention" : "" },
          { label: "schedulable", value: schedulableCount }
        ]}
        ariaLabel="Workflow overview"
      >
        {session ? (
          <>
            {session.canGoBack ? <button type="button" className="secondaryButton" disabled={busy} onClick={goBack}>Back</button> : null}
            <button type="button" className="secondaryButton" disabled={busy} onClick={reset}>Change workflow</button>
          </>
        ) : (
          <button type="button" className="secondaryButton" disabled={busy || loading} onClick={() => onReload?.()}>Refresh</button>
        )}
      </CollectionHeader>

      {session ? (
        <div className="collectionContextBar mono">
          <span>{stepSummary}</span>
          <span>session {session.id.slice(0, 8)} · updated {new Date(session.updatedAt).toLocaleTimeString()}</span>
        </div>
      ) : null}

      {session?.resumedFromDisk ? (
        <StateNotice
          tone="success"
          title="Saved workflow restored"
          detail="Continue where this server session left off before the connection changed."
          compact
        />
      ) : null}

      <div className="workflowWorkspace collectionWorkspace">
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

            {historyCount ? (
              <details className="workflowDebug">
                <summary className="mono">Debug trace · {historyCount}</summary>
                <pre className="workflowDebugPre">{JSON.stringify(debugEntries, null, 2)}</pre>
              </details>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
