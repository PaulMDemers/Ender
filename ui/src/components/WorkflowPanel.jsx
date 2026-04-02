import WorkflowStepRenderer from "./WorkflowStepRenderer";

function WorkflowList({ workflows, onStart }) {
  return (
    <div className="workflowList">
      {workflows.map((workflow) => (
        <button key={workflow.id} type="button" className="workflowCard" onClick={() => onStart?.(workflow.id)}>
          <div className="workflowCardHeader">
            <span className="workflowBadge">WORKFLOW</span>
            <span className="mono">{workflow.id}</span>
          </div>
          <div className="workflowName">{workflow.name}</div>
          <div className="workflowDesc">{workflow.description}</div>
        </button>
      ))}
      {!workflows.length ? <div className="emptyState">No workflows available from this server</div> : null}
    </div>
  );
}

export default function WorkflowPanel({
  workflows,
  loading,
  error,
  session,
  busy,
  onStartWorkflow,
  onAdvance,
  onBack,
  onReset
}) {
  const step = session?.currentStep || null;
  const effectiveError = error || session?.bootstrapError || "";
  const debugEntries = Array.isArray(session?.debug) ? session.debug : [];
  const historyCount = Array.isArray(debugEntries) ? debugEntries.length : 0;
  const stepSummary = session
    ? `${session.canGoBack ? "Multi-step flow" : "Starting point"}${step?.type ? ` · ${step.type.replaceAll("_", " ")}` : ""}`
    : "Choose a server-defined flow";

  return (
    <div className="workflowStack">
      <section className="workflowIntro">
        <div className="workflowHero">
          <span className="workflowBadge">{session ? "STEP ACTIVE" : "WORKFLOW"}</span>
          <div className="launchTitle">{session ? step?.title || session.workflowName : "Guided task launch"}</div>
          <div className="launchDescription">
            {session && step?.description
              ? step.description
              : "Choose a server-defined flow to gather inputs, filter targets, and hand off into a live thread."}
          </div>
        </div>
        {session ? (
          <div className="workflowToolbar">
            <div className="stepProgress mono">
              {stepSummary} · session {session.id.slice(0, 8)} · updated {new Date(session.updatedAt).toLocaleTimeString()}
            </div>
            <div className="workflowActionBar">
              <button type="button" className="secondaryButton" disabled={busy} onClick={() => onReset?.()}>
                Change workflow
              </button>
              {session?.canGoBack ? (
                <button type="button" className="secondaryButton" disabled={busy} onClick={() => onBack?.()}>
                  Back
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {session?.resumedFromDisk ? (
          <div className="emptyState">Resumed a saved workflow session from disk after reconnecting to the server.</div>
        ) : null}
      </section>

      <section className="consolePanel workflowConsole">
        <div className="panelBody workflowPanelBody">
          {!session ? (
            loading ? <div className="emptyState">Loading workflows...</div> : <WorkflowList workflows={workflows} onStart={onStartWorkflow} />
          ) : (
            <>
              <WorkflowStepRenderer step={step} onSubmit={onAdvance} busy={busy} />
              {step?.type === "complete" ? <div className="emptyState">Workflow complete. Transitioning into the task view.</div> : null}
            </>
          )}

          {effectiveError ? <div className="errorBanner">{effectiveError}</div> : null}

          {historyCount ? (
            <details className="workflowDebug">
              <summary className="mono">Debug trace</summary>
              <pre className="workflowDebugPre">{JSON.stringify(debugEntries, null, 2)}</pre>
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}
