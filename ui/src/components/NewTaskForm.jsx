import { useEffect, useRef, useState } from "react";
import { createProject, getHealth, listDirectories, startTask } from "../agentClient";
import DisclosureButton from "./ui/DisclosureButton";
import StateNotice from "./ui/StateNotice";

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
  serverWorkspacePath,
  readinessChecks,
  selfWorkspacePath,
  selfUpdateReady,
  selfUpdateHint,
  llmProfiles,
  projects,
  defaultLlmProfileId,
  onProjectCreated
}) {
  const [goal, setGoal] = useState("");
  const [workspace, setWorkspace] = useState(String(serverWorkspacePath || "").trim());
  const [projectId, setProjectId] = useState("");
  const [llmProfileId, setLlmProfileId] = useState(defaultLlmProfileId || "");
  const [memoryMode, setMemoryMode] = useState("auto");
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectRepoUrl, setProjectRepoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState("");
  const [pickerParent, setPickerParent] = useState(null);
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [runSettingsOpen, setRunSettingsOpen] = useState(false);
  const taRef = useRef(null);
  const lastWorkspaceDefaultRef = useRef(String(serverWorkspacePath || "").trim());
  const selectedProfile = (llmProfiles || []).find((profile) => profile.id === llmProfileId);
  const runSettingsSummary = [
    selectedProfile?.label || selectedProfile?.backend || "Server default",
    memoryMode === "auto" ? "Automatic memory" : memoryMode === "manual" ? "Manual memory" : "Memory off"
  ].join(" · ");

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

  useEffect(() => {
    const nextDefault = String(serverWorkspacePath || "").trim();
    if (!nextDefault) return;
    if (!workspace || workspace === lastWorkspaceDefaultRef.current) {
      setWorkspace(nextDefault);
    }
    lastWorkspaceDefaultRef.current = nextDefault;
  }, [serverWorkspacePath, workspace]);

  useEffect(() => {
    if (!llmProfileId && defaultLlmProfileId) setLlmProfileId(defaultLlmProfileId);
  }, [defaultLlmProfileId, llmProfileId]);

  const saveProject = async () => {
    const name = projectName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await createProject({
        name,
        repoUrl: projectRepoUrl.trim() || null
      });
      setProjectId(created.id);
      setProjectFormOpen(false);
      setProjectName("");
      setProjectRepoUrl("");
      onProjectCreated?.(created);
    } catch (err) {
      setError(err.message || "Unable to create project");
    } finally {
      setBusy(false);
    }
  };

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

        const { id } = await startTask(nextGoal, workspace.trim() || undefined, {
          projectId: projectId || undefined,
          llmProfileId: llmProfileId || undefined,
          memoryMode
        });
        onStarted?.({
          id,
          goal: nextGoal,
          workspace: workspace.trim() || undefined,
          projectId: projectId || null,
          llmProfileId: llmProfileId || null,
          memoryMode
        });
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

              <div className="launchField">
                <span className="fieldLabel">Project</span>
                <span className="fieldHint">Attach reusable repo and resource context. If the workspace is missing, Ender will prepare it from the project repo.</span>
                <div className="workspacePickerRow">
                  <select
                    className="consoleInput"
                    aria-label="Project"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    <option value="">No project</option>
                    {(projects || []).map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                  <button type="button" className="secondaryButton pickerToggle" onClick={() => setProjectFormOpen((value) => !value)}>
                    {projectFormOpen ? "Close" : "Add"}
                  </button>
                </div>
              </div>

              {projectFormOpen ? (
                <div className="pickerBox">
                  <label className="workflowField">
                    <span className="workflowFieldLabel">Project name</span>
                    <input
                      className="consoleInput"
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                      placeholder="Ender"
                    />
                  </label>
                  <label className="workflowField">
                    <span className="workflowFieldLabel">Repo URL</span>
                    <input
                      className="consoleInput mono"
                      value={projectRepoUrl}
                      onChange={(event) => setProjectRepoUrl(event.target.value)}
                      placeholder="https://github.com/org/repo.git"
                    />
                  </label>
                  <button type="button" className="miniButton" disabled={!projectName.trim() || busy} onClick={saveProject}>
                    Save project
                  </button>
                </div>
              ) : null}

              <label className="launchField">
                <span className="fieldLabel">Workspace</span>
                <span className="fieldHint">Defaults to the server workspace directory. Change it if this run should stay inside a narrower repo or folder.</span>
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

              <div className="launchSettingsDisclosure">
                <div className="launchSettingsCopy">
                  <span className="fieldLabel">Run settings</span>
                  <span className="fieldHint">{runSettingsSummary}</span>
                </div>
                <DisclosureButton
                  className="secondaryButton launchSettingsButton"
                  expanded={runSettingsOpen}
                  controls="new-task-run-settings"
                  label={runSettingsOpen ? "Hide run settings" : "Review run settings"}
                  onClick={() => setRunSettingsOpen((value) => !value)}
                >
                  {runSettingsOpen ? "Hide settings" : "Review settings"}
                </DisclosureButton>
              </div>

              {runSettingsOpen ? (
                <div id="new-task-run-settings" className="launchSettingsGrid">
                  <label className="launchField">
                    <span className="fieldLabel">Backend profile</span>
                    <select
                      className="consoleInput"
                      value={llmProfileId}
                      onChange={(event) => setLlmProfileId(event.target.value)}
                    >
                      {(llmProfiles || []).map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.label} · {profile.backend}{profile.model ? ` · ${profile.model}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="launchField">
                    <span className="fieldLabel">Memory loading</span>
                    <select
                      className="consoleInput"
                      value={memoryMode}
                      onChange={(event) => setMemoryMode(event.target.value)}
                    >
                      <option value="auto">Auto</option>
                      <option value="manual">Manual tools only</option>
                      <option value="off">Off</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>

            <aside className="sidePanel launchSidePanel">
              <div className="sectionLabel">Connected target</div>
              <div className="launchSummaryValue">{serverName}</div>
              <div className="launchSummaryMeta mono">{serverUrl}</div>

              {serverWorkspacePath ? (
                <div className="launchContextBlock">
                  <span className="launchSummaryLabel">Server workspace</span>
                  <div className="sidePanelValue mono" title={serverWorkspacePath}>{serverWorkspacePath}</div>
                  <div className="panelNote">
                    {selfWorkspacePath && selfUpdateReady
                      ? "Supervised self-update is available for the Ender repo workspace."
                      : selfUpdateHint || "This is the default workspace root for new supervised runs."}
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

          {error ? (
            <StateNotice
              tone="danger"
              title="Task could not start"
              detail={error}
              actionLabel="Try again"
              onAction={() => submit()}
              busy={busy}
            />
          ) : null}
        </form>
      </div>
    </section>
  );
}
