import { useEffect, useRef, useState } from "react";
import { getHealth, listDirectories, startTask } from "../agentClient";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt) {
  const base = 600;
  const max = 6000;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt));
  const jitter = exp * (0.2 * Math.random());
  return Math.round(exp + jitter);
}

function getStartErrorHint(health) {
  const missing = health?.services?.llm?.missing;
  if (Array.isArray(missing) && missing.length) {
    return `LLM is not configured on the server. Add ${missing.join(", ")} to .env and restart the Ender server.`;
  }
  return "";
}

export default function NewTaskForm({
  onStarted,
  serverName,
  serverUrl,
  readinessChecks,
  selfWorkspacePath,
  selfUpdateReady,
  selfUpdateHint
}) {
  const [goal, setGoal] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState("");
  const [pickerParent, setPickerParent] = useState(null);
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const taRef = useRef(null);

  const autosize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.32)}px`;
  };

  const loadDirs = async (pathValue) => {
    setPickerLoading(true);
    setError("");
    try {
      const data = await listDirectories(pathValue);
      setPickerPath(data.current);
      setPickerParent(data.parent);
      setPickerItems(data.items || []);
    } catch (err) {
      setError(err.message || "Unable to browse directories");
    } finally {
      setPickerLoading(false);
    }
  };

  useEffect(() => {
    if (!pickerOpen) return;
    loadDirs(workspace || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  const submit = async (event) => {
    event?.preventDefault?.();
    const nextGoal = goal.trim();
    if (!nextGoal || busy) return;

    setBusy(true);
    setError("");

    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        if (attempt > 0) {
          setError(`Start failed. Retrying (${attempt + 1}/${maxAttempts})...`);
          await sleep(getBackoffDelay(attempt - 1));
        }

        const { id } = await startTask(nextGoal, workspace.trim() || undefined);
        onStarted?.({ id, goal: nextGoal, workspace: workspace.trim() || undefined });
        setGoal("");
        if (taRef.current) taRef.current.style.height = "";
        setError("");
        setBusy(false);
        return;
      } catch (err) {
        // If the server is reachable but not ready (common: missing env), surface a helpful hint and stop retrying.
        try {
          const health = await getHealth();
          const hint = getStartErrorHint(health);
          if (hint) {
            setError(hint);
            break;
          }
        } catch {
          // ignore health fetch failures; we'll retry below
        }

        if (attempt === maxAttempts - 1) {
          setError(err.message || "Unable to start task");
        }
      }
    }

    setBusy(false);
  };

  return (
    <section className="consolePanel launchPanel">
      <div className="panelBody launchPanelBody">
        <div className="launchHero">
          <div className="workflowBadge">NEW THREAD</div>
          <h2 className="launchTitle">Launch a supervised agent run</h2>
          <p className="launchDescription">
            Give Ender a concrete objective and move straight into the live transcript.
          </p>
        </div>

        <form className="launchForm" onSubmit={submit}>
          <div className="launchWorkspace">
            <div className="launchPrimaryColumn">
              <label className="launchField">
                <span className="fieldLabel">Mission goal</span>
                <span className="fieldHint">Plain language is fine. Ender preserves the thread so you can resume later.</span>
                <textarea
                  ref={taRef}
                  value={goal}
                  rows={4}
                  className="consoleTextarea"
                  placeholder="Example: audit the auth flow and prepare a safe remediation plan."
                  onChange={(event) => {
                    setGoal(event.target.value);
                    autosize();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
              </label>

              <label className="launchField">
                <span className="fieldLabel">Workspace</span>
                <span className="fieldHint">Optional path if this run should stay inside a repo or folder.</span>
                <div className="workspacePickerRow">
                  <input
                    className="consoleInput"
                    placeholder="/path/to/repo or project"
                    value={workspace}
                    onChange={(event) => setWorkspace(event.target.value)}
                  />
                  <button type="button" className="secondaryButton pickerToggle" onClick={() => setPickerOpen((value) => !value)}>
                    {pickerOpen ? "Close picker" : "Browse"}
                  </button>
                </div>
                {selfWorkspacePath ? (
                  <div className="workflowActionBar">
                    <button
                      type="button"
                      className="secondaryButton"
                      onClick={() => setWorkspace(selfWorkspacePath)}
                    >
                      Use Ender repo
                    </button>
                  </div>
                ) : null}
              </label>

              {pickerOpen ? (
                <div className="pickerBox">
                  <div className="pickerHeader">
                    <div>
                      <div className="fieldLabel">Directory browser</div>
                      <div className="pickerPath mono">{pickerPath || "/"}</div>
                    </div>
                    <div className="pickerActions">
                      <button
                        type="button"
                        className="miniButton"
                        disabled={!pickerParent || pickerLoading}
                        onClick={() => pickerParent && loadDirs(pickerParent)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="miniButton"
                        disabled={pickerLoading}
                        onClick={() => {
                          setWorkspace(pickerPath);
                          setPickerOpen(false);
                        }}
                      >
                        Use current
                      </button>
                    </div>
                  </div>
                  <div className="pickerList">
                    {pickerLoading ? <div className="emptyState">Loading directories...</div> : null}
                    {!pickerLoading && !pickerItems.length ? <div className="emptyState">No child directories</div> : null}
                    {!pickerLoading
                      ? pickerItems.map((item) => (
                          <button
                            key={item.path}
                            type="button"
                            className="pickerItem"
                            onClick={() => loadDirs(item.path)}
                          >
                            <span>{item.name}</span>
                            <span className="mono">{item.path}</span>
                          </button>
                        ))
                      : null}
                  </div>
                </div>
              ) : null}
            </div>

            <aside className="sidePanel launchSidePanel">
              <div className="sectionLabel">Connected target</div>
              <div className="launchSummaryValue">{serverName}</div>
              <div className="launchSummaryMeta mono">{serverUrl}</div>

              {selfWorkspacePath ? (
                <div className="launchContextBlock">
                  <span className="launchSummaryLabel">Self workspace</span>
                  <div className="sidePanelValue mono" title={selfWorkspacePath}>{selfWorkspacePath}</div>
                  <div className="panelNote">
                    {selfUpdateReady
                      ? "Supervised self-update is available for the Ender repo workspace."
                      : selfUpdateHint || "The Ender repo workspace is available, but supervised self-update is not ready."}
                  </div>
                </div>
              ) : null}

              <div className="launchContextBlock">
                <span className="launchSummaryLabel">Readiness</span>
                <div className="launchReadiness">
                  {(readinessChecks || []).slice(0, 4).map((item) => (
                    <span key={item.label} className={`readinessChip ${item.ready ? "ready" : "notReady"}`}>
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            </aside>
          </div>

          <div className="launchFooter">
            <div className="panelNote">Press Enter to start quickly. Use Shift+Enter for a multiline objective.</div>
            <button className="primaryButton launchAction" disabled={busy || !goal.trim()}>
              {busy ? "Starting run..." : "Start task"}
            </button>
          </div>

          {error ? <div className="errorBanner">{error}</div> : null}
        </form>
      </div>
    </section>
  );
}
