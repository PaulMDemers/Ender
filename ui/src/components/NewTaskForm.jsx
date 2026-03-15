import { useEffect, useRef, useState } from "react";
import { listDirectories, startTask } from "../agentClient";

export default function NewTaskForm({ onStarted, serverName, serverUrl, readinessChecks }) {
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
  }, [pickerOpen]);

  const submit = async (event) => {
    event?.preventDefault?.();
    const nextGoal = goal.trim();
    if (!nextGoal || busy) return;
    setBusy(true);
    setError("");
    try {
      const { id } = await startTask(nextGoal, workspace.trim() || undefined);
      onStarted?.({ id, goal: nextGoal, workspace: workspace.trim() || undefined });
      setGoal("");
      if (taRef.current) taRef.current.style.height = "";
    } catch (err) {
      setError(err.message || "Unable to start task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="consolePanel launchPanel">
      <div className="panelChrome">
        <div className="panelLabel mono">task.launch</div>
      </div>

      <div className="panelBody launchPanelBody">
        <div className="launchHero">
          <div className="workflowBadge">NEW THREAD</div>
          <h2 className="launchTitle">Launch a supervised agent run</h2>
          <p className="launchDescription">
            Give Ender a concrete objective, optionally scope it to a workspace, and move immediately into the
            live transcript once execution begins.
          </p>
        </div>

        <form className="launchForm" onSubmit={submit}>
          <label className="launchField">
            <span className="fieldLabel">Mission goal</span>
            <span className="fieldHint">Plain language is fine. Ender will preserve this thread and let you resume later.</span>
            <textarea
              ref={taRef}
              value={goal}
              rows={4}
              className="consoleTextarea"
              placeholder="Example: audit the API auth flow, identify weak points, and prepare a safe remediation plan."
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

          <div className="launchGrid">
            <label className="launchField">
              <span className="fieldLabel">Workspace</span>
              <span className="fieldHint">Optional absolute or relative path. Use a picker if you want to scope the run.</span>
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
            </label>

            <div className="launchField">
              <span className="fieldLabel">Connected target</span>
              <span className="launchSummaryLabel">Server</span>
              <div className="launchSummaryValue">{serverName}</div>
              <div className="launchSummaryMeta mono">{serverUrl}</div>
            </div>
          </div>

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

          <div className="launchFooter">
            <div className="launchReadiness">
              {(readinessChecks || []).slice(0, 3).map((item) => (
                <span key={item.label} className={`readinessChip ${item.ready ? "ready" : "notReady"}`}>
                  {item.label}
                </span>
              ))}
            </div>
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
