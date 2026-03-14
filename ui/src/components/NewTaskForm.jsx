import { useEffect, useRef, useState } from "react";
import { listDirectories, startTask } from "../agentClient";

export default function NewTaskForm({ onStarted }) {
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
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.35)}px`;
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

  const submit = async (e) => {
    e?.preventDefault?.();
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
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={taRef}
        value={goal}
        rows={1}
        className="composerInput"
        placeholder="Ask Ender to solve something"
        onChange={(e) => {
          setGoal(e.target.value);
          autosize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />

      <button className="actionButton" disabled={busy || !goal.trim()}>
        {busy ? "Running..." : "Run"}
      </button>

      <div className="workspaceRow">
        <input
          className="workspaceInput"
          placeholder="Workspace folder (absolute or relative)"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        />
        <button type="button" className="miniButton" onClick={() => setPickerOpen((v) => !v)}>
          {pickerOpen ? "Close" : "Pick"}
        </button>
      </div>

      {pickerOpen ? (
        <div className="pickerBox">
          <div className="pickerHeader">
            <span>{pickerPath || "/"}</span>
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
                Select Current
              </button>
            </div>
          </div>
          <div className="pickerList">
            {pickerLoading ? <div className="taskMeta">Loading...</div> : null}
            {!pickerLoading && !pickerItems.length ? <div className="taskMeta">No subfolders</div> : null}
            {!pickerLoading
              ? pickerItems.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className="pickerItem"
                    onClick={() => loadDirs(item.path)}
                  >
                    {item.name}
                  </button>
                ))
              : null}
          </div>
        </div>
      ) : null}

      {error ? <div className="errorText">{error}</div> : null}
    </form>
  );
}
