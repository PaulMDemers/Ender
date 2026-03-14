import { useEffect, useMemo, useState } from "react";
import { advanceWorkflowSession, continueTask, createSchedule, createWorkflowSession, deleteSchedule, deleteTaskWithOptions, getApiBase, getHealth, listSchedules, listTasks, listWorkflows, rerunTask, resolveApproval, retreatWorkflowSession, runScheduleNow, setApiBase, terminateTask, updateSchedule } from "./agentClient";
import { useTaskLogs } from "./hooks/useTaskLogs";
import NewTaskForm from "./components/NewTaskForm";
import TaskList from "./components/TaskList";
import LogViewer from "./components/LogViewer";
import ThreadComposer from "./components/ThreadComposer";
import ApprovalPrompt from "./components/ApprovalPrompt";
import ServerModal from "./components/ServerModal";
import WorkflowPanel from "./components/WorkflowPanel";
import SchedulePanel from "./components/SchedulePanel";
import logoIcon from "./assets/ender-logo.png";

const SAVED_SERVERS_KEY = "ender_saved_servers";
const TASK_UI_STATE_KEY = "ender_task_ui_state";
const TASK_PAGE_SIZE = 12;

function compareTasksByNewest(a, b) {
  return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
}

function loadSavedServers() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_SERVERS_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => ({
        name: String(item?.name || item?.endpoint || ""),
        endpoint: String(item?.endpoint || "").trim(),
        favorite: Boolean(item?.favorite),
        lastUsedAt: Number(item?.lastUsedAt || 0)
      }))
      .filter((item) => item.endpoint);
  } catch {
    return [];
  }
}

function saveServers(items) {
  localStorage.setItem(SAVED_SERVERS_KEY, JSON.stringify(items));
}

function loadTaskUiState() {
  try {
    const raw = JSON.parse(localStorage.getItem(TASK_UI_STATE_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveTaskUiState(value) {
  localStorage.setItem(TASK_UI_STATE_KEY, JSON.stringify(value));
}

function isThreadIdle(status) {
  return status === "done" || status === "error" || status === "canceled" || status === "terminated";
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [savedServers, setSavedServers] = useState([]);
  const [serverModalOpen, setServerModalOpen] = useState(true);
  const [composeMode, setComposeMode] = useState("new");
  const [workflows, setWorkflows] = useState([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowSession, setWorkflowSession] = useState(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [health, setHealth] = useState(null);
  const [taskUiState, setTaskUiState] = useState({});
  const [taskVisibleCount, setTaskVisibleCount] = useState(TASK_PAGE_SIZE);
  const [showArchived, setShowArchived] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("ender_api_base");
    setSavedServers(loadSavedServers());
    setTaskUiState(loadTaskUiState());
    if (saved) {
      const normalized = setApiBase(saved);
      setServerUrl(normalized);
    } else {
      setServerUrl(getApiBase());
    }
  }, []);

  useEffect(() => {
    if (composeMode !== "workflow" && composeMode !== "schedule") return;
    let live = true;
    setWorkflowLoading(true);
    listWorkflows()
      .then((data) => {
        if (!live) return;
        setWorkflows(data.items || []);
        setWorkflowError("");
      })
      .catch((err) => {
        if (!live) return;
        setWorkflowError(err.message || "Unable to load workflows");
      })
      .finally(() => {
        if (live) setWorkflowLoading(false);
      });

    return () => {
      live = false;
    };
  }, [composeMode, serverUrl]);

  useEffect(() => {
    if (composeMode !== "schedule") return;
    let live = true;
    setScheduleBusy(true);
    listSchedules()
      .then((data) => {
        if (!live) return;
        setSchedules(data.items || []);
        setScheduleError("");
      })
      .catch((err) => {
        if (!live) return;
        setScheduleError(err.message || "Unable to load schedules");
      })
      .finally(() => {
        if (live) setScheduleBusy(false);
      });

    return () => {
      live = false;
    };
  }, [composeMode, serverUrl]);

  useEffect(() => {
    let live = true;
    getHealth()
      .then((data) => {
        if (!live) return;
        setHealth(data);
      })
      .catch(() => {
        if (!live) return;
        setHealth(null);
      });

    return () => {
      live = false;
    };
  }, [serverUrl]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const data = await listTasks();
        if (!live) return;
        setLoadError("");
        setTasks(data.items || []);
        if (!selectedId && composeMode === "thread" && data.items?.length) {
          setSelectedId([...data.items].sort(compareTasksByNewest)[0].id);
        }
      } catch (err) {
        if (!live) return;
        setLoadError(err.message || "Unable to reach server");
        setTasks([]);
        setSelectedId(null);
      } finally {
        if (live) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [selectedId, serverUrl, composeMode]);

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedId) || null, [tasks, selectedId]);
  const taskStateForServer = taskUiState[serverUrl] || {};
  const activeTasks = useMemo(() => {
    const pinned = [];
    const rest = [];
    const items = tasks.filter((task) => !taskStateForServer[task.id]?.archived);
    const sorted = [...items].sort(compareTasksByNewest);
    for (const task of sorted) {
      if (taskStateForServer[task.id]?.pinned) pinned.push(task);
      else rest.push(task);
    }
    return [...pinned, ...rest];
  }, [tasks, taskStateForServer]);
  const archivedTasks = useMemo(() => {
    const items = tasks.filter((task) => taskStateForServer[task.id]?.archived);
    return [...items].sort(compareTasksByNewest);
  }, [tasks, taskStateForServer]);
  const visibleTasks = useMemo(
    () => (showArchived ? archivedTasks : activeTasks).slice(0, taskVisibleCount),
    [showArchived, archivedTasks, activeTasks, taskVisibleCount]
  );
  const { entries, status, completed, pendingApprovals, removeApproval } = useTaskLogs(
    selectedId,
    serverUrl,
    selectedTask?.runCount || 0
  );

  useEffect(() => {
    setTaskVisibleCount(TASK_PAGE_SIZE);
  }, [showArchived, serverUrl, tasks.length]);

  const refresh = async () => {
    try {
      const data = await listTasks();
      setLoadError("");
      const items = data.items || [];
      setTasks(items);
      setSelectedId((current) => {
        if (!items.length) return null;
        if (current && items.some((task) => task.id === current)) return current;
        if (composeMode === "new") return null;
        return [...items].sort(compareTasksByNewest)[0].id;
      });
      return items;
    } catch (err) {
      setLoadError(err.message || "Unable to reach server");
      setTasks([]);
      setSelectedId(null);
      return [];
    }
  };

  const applyServer = (server) => {
    try {
      const normalized = setApiBase(server.endpoint);
      const existing = savedServers.find((item) => item.endpoint === normalized);
      const nextServer = {
        name: server.name?.trim() || existing?.name || normalized,
        endpoint: normalized,
        favorite: existing?.favorite || false,
        lastUsedAt: Date.now()
      };
      const nextSavedServers = [nextServer, ...savedServers.filter((item) => item.endpoint !== normalized)];
      saveServers(nextSavedServers);
      setSavedServers(nextSavedServers);
      localStorage.setItem("ender_api_base", normalized);
      setServerUrl(normalized);
      setLoading(true);
      setTasks([]);
      setSelectedId(null);
      setComposeMode("new");
      setWorkflowSession(null);
      setServerModalOpen(false);
    } catch (err) {
      setLoadError(err.message || "Invalid server URL");
    }
  };

  const toggleFavoriteServer = (endpoint) => {
    setSavedServers((prev) => {
      const next = prev.map((server) => (
        server.endpoint === endpoint ? { ...server, favorite: !server.favorite } : server
      ));
      saveServers(next);
      return next;
    });
  };

  const removeServer = (endpoint) => {
    setSavedServers((prev) => {
      const next = prev.filter((server) => server.endpoint !== endpoint);
      saveServers(next);
      return next;
    });
  };

  const onStarted = ({ id, goal, workspace }) => {
    setTasks((prev) => [...prev, {
      id,
      goal,
      workspace: workspace || null,
      status: "running",
      startedAt: new Date().toISOString(),
      logCount: 0,
      runCount: 1
    }]);
    setSelectedId(id);
    setComposeMode("thread");
    setWorkflowSession(null);
  };

  const startWorkflow = async (workflowId) => {
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const session = await createWorkflowSession(workflowId);
      setWorkflowSession(session);
    } catch (err) {
      setWorkflowError(err.message || "Unable to start workflow");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const advanceWorkflow = async (input) => {
    if (!workflowSession) return;
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const result = await advanceWorkflowSession(workflowSession.id, input);
      setWorkflowSession(result.session);
      if (result.startedTaskId) {
        await refresh();
        setSelectedId(result.startedTaskId);
        setComposeMode("thread");
        setWorkflowSession(null);
      }
    } catch (err) {
      setWorkflowError(err.message || "Workflow step failed");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const retreatWorkflow = async () => {
    if (!workflowSession) return;
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const session = await retreatWorkflowSession(workflowSession.id);
      setWorkflowSession(session);
    } catch (err) {
      setWorkflowError(err.message || "Unable to go back");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const refreshSchedules = async () => {
    const data = await listSchedules();
    setSchedules(data.items || []);
  };

  const createScheduleEntry = async (payload) => {
    setScheduleBusy(true);
    setScheduleError("");
    try {
      await createSchedule(payload);
      await refreshSchedules();
    } catch (err) {
      setScheduleError(err.message || "Unable to create schedule");
    } finally {
      setScheduleBusy(false);
    }
  };

  const updateScheduleEntry = async (id, payload) => {
    setScheduleBusy(true);
    setScheduleError("");
    try {
      await updateSchedule(id, payload);
      await refreshSchedules();
    } catch (err) {
      setScheduleError(err.message || "Unable to update schedule");
    } finally {
      setScheduleBusy(false);
    }
  };

  const deleteScheduleEntry = async (id) => {
    const confirmed = window.confirm("Delete this schedule?");
    if (!confirmed) return;
    setScheduleBusy(true);
    setScheduleError("");
    try {
      await deleteSchedule(id);
      await refreshSchedules();
    } catch (err) {
      setScheduleError(err.message || "Unable to delete schedule");
    } finally {
      setScheduleBusy(false);
    }
  };

  const runScheduleEntryNow = async (id) => {
    setScheduleBusy(true);
    setScheduleError("");
    try {
      await runScheduleNow(id);
      await refreshSchedules();
      await refresh();
    } catch (err) {
      setScheduleError(err.message || "Unable to run schedule");
    } finally {
      setScheduleBusy(false);
    }
  };

  const onTerminate = async (id) => {
    await terminateTask(id);
    await refresh();
  };

  const onDelete = async (id) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;

    const confirmed = window.confirm("Delete this thread? This cannot be undone.");
    if (!confirmed) return;

    let deleteWorkspace = false;
    if (task.workspace) {
      deleteWorkspace = window.confirm(
        `Also delete this workspace folder?\n\n${task.workspace}\n\nChoose Cancel to leave it on disk.`
      );
    }

    const result = await deleteTaskWithOptions(id, { deleteWorkspace });
    const workspaceDeletion = result?.workspaceDeletion || null;

    if (deleteWorkspace && workspaceDeletion) {
      if (workspaceDeletion.deleted) {
        window.alert(`Workspace deleted: ${workspaceDeletion.path}`);
      } else if (workspaceDeletion.reason === "still_in_use") {
        window.alert(`Thread deleted. Workspace left on disk because it is still in use by another thread:\n${workspaceDeletion.path}`);
      } else if (workspaceDeletion.reason === "protected_workspace") {
        window.alert(`Thread deleted. Workspace was not deleted because it is a protected base directory:\n${workspaceDeletion.path}`);
      }
    }

    setTaskUiState((prev) => {
      const next = { ...prev };
      if (next[serverUrl]) {
        next[serverUrl] = { ...next[serverUrl] };
        delete next[serverUrl][id];
      }
      saveTaskUiState(next);
      return next;
    });
    setSelectedId((current) => {
      if (current === id) {
        setComposeMode("new");
        return null;
      }
      return current;
    });
    await refresh();
  };

  const patchTaskUi = (taskId, patch) => {
    setTaskUiState((prev) => {
      const currentServer = { ...(prev[serverUrl] || {}) };
      currentServer[taskId] = { ...(currentServer[taskId] || {}), ...patch };
      const next = { ...prev, [serverUrl]: currentServer };
      saveTaskUiState(next);
      return next;
    });
  };

  const togglePinned = (taskId) => {
    patchTaskUi(taskId, { pinned: !taskStateForServer[taskId]?.pinned });
  };

  const toggleArchived = (taskId) => {
    const nextArchived = !taskStateForServer[taskId]?.archived;
    patchTaskUi(taskId, { archived: nextArchived });
    if (selectedId === taskId && nextArchived) {
      setSelectedId(null);
      setComposeMode("new");
    }
  };

  const onRerun = async (id) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const result = await rerunTask(id);
    onStarted({ id: result.id, goal: task.goal, workspace: task.workspace });
    setTimeout(() => {
      refresh();
    }, 250);
  };

  const sendNextPrompt = async (prompt) => {
    if (!selectedTask) return;
    await continueTask(selectedTask.id, prompt);
    setTasks((prev) =>
      prev.map((t) => (t.id === selectedTask.id
        ? { ...t, status: "running", goal: prompt, runCount: (t.runCount || 0) + 1 }
        : t))
    );
    setTimeout(() => {
      refresh();
    }, 250);
  };

  const decideApproval = async (approvalId, approved) => {
    if (!selectedTask) return;
    await resolveApproval(selectedTask.id, approvalId, approved);
    removeApproval(approvalId);
    await refresh();
  };

  const effectiveStatus = selectedTask ? status || selectedTask.status : null;
  const sendLocked = !selectedTask || !isThreadIdle(effectiveStatus);
  const showNewThreadComposer = composeMode === "new";

  return (
    <div className="layout">
      <ServerModal
        open={serverModalOpen}
        currentEndpoint={serverUrl}
        servers={savedServers}
        onClose={() => setServerModalOpen(false)}
        onConnect={applyServer}
        onToggleFavorite={toggleFavoriteServer}
        onRemove={removeServer}
      />
      <aside className="leftRail">
        <div className="railHeader">
          <div className="brand">
            <img className="brandMark" src={logoIcon} alt="Ender logo" />
            <div>
              <div className="brandEyebrow">Ops Console</div>
              <h1 className="title">Ender</h1>
              <p className="subtitle">Agent task console</p>
            </div>
          </div>
          <div className="railActions">
            <button type="button" className="miniButton" onClick={() => setServerModalOpen(true)}>
              Servers
            </button>
          </div>
        </div>
        <div className="serverSummary">
          <div className="sectionLabel">Connected</div>
          <div className="taskMeta">{serverUrl}</div>
          <div className={`healthPill ${health?.workflows?.jira_to_repo_task?.ready ? "ready" : "notReady"}`}>
            {health?.workflows?.jira_to_repo_task?.ready ? "Workflow Ready" : "Workflow Needs Config"}
          </div>
          {!health?.workflows?.jira_to_repo_task?.ready && health?.workflows?.jira_to_repo_task?.missing?.length ? (
            <div className="healthMeta">
              Missing: {health.workflows.jira_to_repo_task.missing.join(", ")}
            </div>
          ) : null}
          <div className={`healthPill ${health?.services?.browserCapture?.ready ? "ready" : "notReady"}`}>
            {health?.services?.browserCapture?.ready ? "Browser Capture Ready" : "Browser Capture Needs Setup"}
          </div>
          {!health?.services?.browserCapture?.ready ? (
            <div className="healthMeta">
              {health?.services?.browserCapture?.detail || "Install Playwright + Chromium to enable browser snapshots."}
            </div>
          ) : null}
        </div>
        {loadError ? <div className="errorText">{loadError}</div> : null}
        <div className="railPrimaryActions">
          <button
            type="button"
            className="newThreadButton"
            onClick={() => {
              setSelectedId(null);
              setComposeMode("new");
              setWorkflowSession(null);
              setWorkflowError("");
            }}
          >
            New Thread
          </button>
          <button
            type="button"
            className="newThreadButton"
            onClick={() => {
              setSelectedId(null);
              setComposeMode("workflow");
              setWorkflowSession(null);
              setWorkflowError("");
            }}
          >
            Workflows
          </button>
          <button
            type="button"
            className="newThreadButton"
            onClick={() => {
              setSelectedId(null);
              setComposeMode("schedule");
              setWorkflowSession(null);
              setWorkflowError("");
            }}
          >
            Schedules
          </button>
        </div>
        <TaskList
          items={visibleTasks}
          selectedId={selectedId}
          taskState={taskStateForServer}
          hasMore={(showArchived ? archivedTasks : activeTasks).length > visibleTasks.length}
          loadMoreLabel={`Load more ${showArchived ? "archived" : "threads"}`}
          emptyLabel={showArchived ? "No archived threads" : "No tasks yet"}
          onSelect={(id) => {
            setSelectedId(id);
            setComposeMode("thread");
          }}
          onTogglePinned={togglePinned}
          onToggleArchived={toggleArchived}
          onLoadMore={() => setTaskVisibleCount((count) => count + TASK_PAGE_SIZE)}
          onTerminate={onTerminate}
          onDelete={onDelete}
          onRerun={onRerun}
        />
        <button
          type="button"
          className={`newThreadButton railArchiveButton ${showArchived ? "active" : ""}`}
          onClick={() => {
            setShowArchived((prev) => !prev);
            setSelectedId(null);
          }}
        >
          {showArchived ? `Show Active (${activeTasks.length})` : `Show Archived (${archivedTasks.length})`}
        </button>
      </aside>
      <main className="mainPane">
        <div className={`mainHeader ${headerCollapsed ? "collapsed" : ""}`}>
          <div>
            <div className="headerGoal">{selectedTask ? selectedTask.goal : "Start a new thread"}</div>
            <div className="headerMeta">
              {selectedTask
                ? `${selectedTask.id} | ${effectiveStatus}${completed ? " | complete" : ""}`
                : loading
                  ? "Loading tasks..."
                  : "Choose a server and start a fresh run"}
            </div>
          </div>
          <button
            type="button"
            className="miniButton headerToggle"
            onClick={() => setHeaderCollapsed((prev) => !prev)}
          >
            {headerCollapsed ? "Expand" : "Collapse"}
          </button>
        </div>
        <div className="mainBody">
          {pendingApprovals.length ? (
            <ApprovalPrompt
              approval={pendingApprovals[0]}
              onApprove={(approvalId) => decideApproval(approvalId, true)}
              onDeny={(approvalId) => decideApproval(approvalId, false)}
            />
          ) : null}

          {composeMode === "workflow" ? (
            <WorkflowPanel
              workflows={workflows}
              loading={workflowLoading}
              error={workflowError}
              session={workflowSession}
              busy={workflowBusy}
              onStartWorkflow={startWorkflow}
              onAdvance={advanceWorkflow}
              onBack={retreatWorkflow}
              onReset={() => {
                setWorkflowSession(null);
                setWorkflowError("");
              }}
            />
          ) : composeMode === "schedule" ? (
            <SchedulePanel
              schedules={schedules}
              workflows={workflows}
              tasks={tasks}
              busy={scheduleBusy}
              error={scheduleError}
              onCreate={createScheduleEntry}
              onUpdate={updateScheduleEntry}
              onDelete={deleteScheduleEntry}
              onRunNow={runScheduleEntryNow}
            />
          ) : selectedTask ? (
            <LogViewer entries={entries} />
          ) : (
            <div className="blankPanel">
              <img className="blankPanelLogo" src={logoIcon} alt="" aria-hidden="true" />
              <div className="blankPanelTitle">Ready for a new thread</div>
              <div className="blankPanelText">
                Pick a workspace if you need one, then ask Ender what to work on. Once a thread starts, this pane becomes the live transcript.
              </div>
            </div>
          )}
        </div>
        {composeMode === "workflow" || composeMode === "schedule" ? null : showNewThreadComposer ? (
          <NewTaskForm onStarted={onStarted} />
        ) : (
          <ThreadComposer disabled={sendLocked} onSend={sendNextPrompt} />
        )}
      </main>
    </div>
  );
}
