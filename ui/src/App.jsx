import { useEffect, useMemo, useState } from "react";
import {
  advanceWorkflowSession,
  continueTask,
  createSchedule,
  createWorkflowSession,
  deleteSchedule,
  deleteTaskWithOptions,
  getApiBase,
  getHealth,
  getWorkflowSession,
  listSchedules,
  listTasks,
  listWorkflows,
  rerunTask,
  resolveApproval,
  retreatWorkflowSession,
  runScheduleNow,
  setApiBase,
  terminateTask,
  updateSchedule
} from "./agentClient";
import { useTaskLogs } from "./hooks/useTaskLogs";
import NewTaskForm from "./components/NewTaskForm";
import TaskList from "./components/TaskList";
import LogViewer from "./components/LogViewer";
import ThreadComposer from "./components/ThreadComposer";
import ApprovalPrompt from "./components/ApprovalPrompt";
import ServerModal from "./components/ServerModal";
import WorkflowPanel from "./components/WorkflowPanel";
import SchedulePanel from "./components/SchedulePanel";

const logoIcon = "/icons/icon-rounded-master.png";

const SAVED_SERVERS_KEY = "ender_saved_servers";
const TASK_UI_STATE_KEY = "ender_task_ui_state";
const RAIL_COLLAPSED_KEY = "ender_rail_collapsed";
const WORKFLOW_SESSION_KEY = "ender_workflow_sessions";
const TASK_PAGE_SIZE = 12;

function compareTasksByNewest(a, b) {
  const aTime = new Date(a.finishedAt || a.startedAt || 0).getTime();
  const bTime = new Date(b.finishedAt || b.startedAt || 0).getTime();
  return bTime - aTime;
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

function loadRailCollapsed() {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function loadWorkflowSessionIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKFLOW_SESSION_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function getSavedWorkflowSessionId(serverUrl) {
  return String(loadWorkflowSessionIds()[serverUrl] || "").trim();
}

function saveWorkflowSessionId(serverUrl, sessionId) {
  const next = loadWorkflowSessionIds();
  if (sessionId) next[serverUrl] = sessionId;
  else delete next[serverUrl];
  localStorage.setItem(WORKFLOW_SESSION_KEY, JSON.stringify(next));
}

function isThreadIdle(status) {
  return status === "done" || status === "error" || status === "canceled" || status === "terminated";
}

function getStatusTone(status) {
  const normalized = String(status || "idle");
  if (normalized === "running") return "running";
  if (normalized === "awaiting_approval") return "approval";
  if (normalized === "done") return "success";
  if (normalized === "error") return "danger";
  if (normalized === "terminated" || normalized === "canceled") return "warning";
  return "neutral";
}

function getStatusLabel(status) {
  if (!status) return "idle";
  if (status === "awaiting_approval") return "approval needed";
  if (status === "done") return "completed";
  return String(status).replaceAll("_", " ");
}

function formatTimestamp(value) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatRelative(value) {
  if (!value) return "No activity yet";
  const deltaMs = new Date(value).getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (Math.abs(deltaMs) < hour) {
    return formatter.format(Math.round(deltaMs / minute), "minute");
  }
  if (Math.abs(deltaMs) < day) {
    return formatter.format(Math.round(deltaMs / hour), "hour");
  }
  return formatter.format(Math.round(deltaMs / day), "day");
}

function formatPathTail(value, segmentCount = 4) {
  const path = String(value || "").trim();
  if (!path) return "none";

  const normalized = path.replaceAll("\\", "/");
  const isAbsolute = normalized.startsWith("/");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length <= segmentCount) return path;

  return `${isAbsolute ? "/" : ""}.../${segments.slice(-segmentCount).join("/")}`;
}

function normalizeFsPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalized = raw.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized) return "/";
  if (/^[A-Z]:$/i.test(normalized)) return `${normalized.toLowerCase()}/`;
  if (/^[A-Z]:\//i.test(normalized)) return `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}`;
  return normalized;
}

function isWorkspaceDeletionCandidate(workspacePath, workspaceRoot) {
  const target = normalizeFsPath(workspacePath);
  const root = normalizeFsPath(workspaceRoot);
  if (!target || !root || target === root) return false;
  return target.startsWith(`${root}/`);
}

function summarizeHealth(health, hasSelectedThread) {
  return [
    {
      label: "API healthy",
      ready: Boolean(health?.ok)
    },
    {
      label: "LLM ready",
      ready: Boolean(health?.services?.llm?.ready),
      detail: health?.services?.llm?.missing?.length
        ? `Add ${health.services.llm.missing.join(", ")} to .env and restart the Ender server.`
        : ""
    },
    {
      label: "Workflow ready",
      ready: Boolean(health?.workflows?.jira_to_repo_task?.ready),
      detail: health?.workflows?.jira_to_repo_task?.missing?.length
        ? `Configure ${health.workflows.jira_to_repo_task.missing.join(", ")} to enable the Jira workflow.`
        : ""
    },
    {
      label: "Browser capture",
      ready: Boolean(health?.services?.browserCapture?.ready),
      detail: !health?.services?.browserCapture?.ready
        ? `${health?.services?.browserCapture?.detail || "Install Playwright with Chromium to enable browser capture."}`
        : ""
    },
    {
      label: "GitHub token",
      ready: Boolean(health?.services?.github?.ready),
      detail: health?.services?.github?.missing?.length
        ? `Set ${health.services.github.missing.join(", ")} for private GitHub access and PR workflows.`
        : ""
    },
    {
      label: "Self-update",
      ready: Boolean(health?.services?.selfUpdate?.ready),
      detail: health?.setupHints?.selfUpdate || ""
    },
    {
      label: "Stream attached",
      ready: hasSelectedThread,
      detail: hasSelectedThread ? "Transcript stream active" : "Select a live thread to attach"
    }
  ];
}

function getModeCopy(mode) {
  if (mode === "workflow") {
    return {
      eyebrow: "Workflow",
      title: "Run a guided launch",
      subtitle: "Server-defined setup flows prepare parameters, validation, and task handoff before execution begins."
    };
  }
  if (mode === "schedule") {
    return {
      eyebrow: "Schedules",
      title: "Supervise recurring automations",
      subtitle: "Create cron-driven prompts, thread continuations, and workflow launches without leaving the main console."
    };
  }
  return {
    eyebrow: "Launch",
    title: "Start a new task",
    subtitle: "Set the goal, scope the workspace if needed, and move straight into the live transcript once the run starts."
  };
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [savedServers, setSavedServers] = useState([]);
  const [serverModalOpen, setServerModalOpen] = useState(false);
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
  const [serverSummaryCollapsed, setServerSummaryCollapsed] = useState(true);
  const [modeSectionCollapsed, setModeSectionCollapsed] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(() => loadRailCollapsed());
  const [railOpen, setRailOpen] = useState(false);
  const [threadScrollToken, setThreadScrollToken] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("ender_api_base");
    const nextSavedServers = loadSavedServers();
    setSavedServers(nextSavedServers);
    setTaskUiState(loadTaskUiState());
    if (saved) {
      const normalized = setApiBase(saved);
      setServerUrl(normalized);
      setServerModalOpen(false);
    } else {
      setServerUrl(getApiBase());
      setServerModalOpen(nextSavedServers.length === 0);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(RAIL_COLLAPSED_KEY, String(railCollapsed));
  }, [railCollapsed]);

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
    if (composeMode !== "workflow" || workflowSession) return;
    const savedSessionId = getSavedWorkflowSessionId(serverUrl);
    if (!savedSessionId) return;

    let live = true;
    setWorkflowLoading(true);
    getWorkflowSession(savedSessionId)
      .then((session) => {
        if (!live) return;
        setWorkflowSession(session);
        setWorkflowError("");
      })
      .catch(() => {
        if (!live) return;
        saveWorkflowSessionId(serverUrl, "");
      })
      .finally(() => {
        if (live) setWorkflowLoading(false);
      });

    return () => {
      live = false;
    };
  }, [composeMode, serverUrl, workflowSession]);

  useEffect(() => {
    if (workflowSession && workflowSession.mode === "interactive" && !workflowSession.startedTaskId) {
      saveWorkflowSessionId(serverUrl, workflowSession.id);
      return;
    }
    saveWorkflowSessionId(serverUrl, "");
  }, [serverUrl, workflowSession]);

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

    const loadHealth = async () => {
      try {
        const data = await getHealth();
        if (!live) return;
        setHealth(data);
      } catch {
        if (!live) return;
        setHealth(null);
      }
    };

    loadHealth();
    const intervalId = setInterval(loadHealth, 15000);

    return () => {
      live = false;
      clearInterval(intervalId);
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

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedId) || null, [tasks, selectedId]);
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

  const currentServer = useMemo(
    () => savedServers.find((server) => server.endpoint === serverUrl) || null,
    [savedServers, serverUrl]
  );

  const discardWorkflowSession = () => {
    setWorkflowSession(null);
    saveWorkflowSessionId(serverUrl, "");
  };

  const effectiveStatus = selectedTask ? status || selectedTask.status : null;
  const activeMode = composeMode === "thread" && !selectedTask ? "new" : composeMode;
  const sendLocked = !selectedTask || !isThreadIdle(effectiveStatus);
  const latestEntry = entries.length ? entries[entries.length - 1] : null;
  const selectedTaskUpdatedAt = latestEntry?.t
    ? new Date(latestEntry.t).toISOString()
    : selectedTask?.finishedAt || selectedTask?.startedAt || null;
  const readinessChecks = useMemo(
    () => summarizeHealth(health, Boolean(selectedTask)),
    [health, selectedTask]
  );
  const headerModeCopy = getModeCopy(activeMode);
  const selfWorkspacePath = String(health?.services?.selfUpdate?.rootDir || "").trim() || "";
  const selfUpdateReady = Boolean(health?.services?.selfUpdate?.ready);
  const selfUpdateHint = health?.setupHints?.selfUpdate || "";

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

  const openMode = (nextMode) => {
    setComposeMode(nextMode);
    if (nextMode !== "thread") {
      setSelectedId(null);
    }
    setWorkflowError("");
    setRailOpen(false);
  };

  const onStarted = ({ id, goal, workspace }) => {
    setTasks((prev) => [...prev, {
      id,
      goal,
      workspace: workspace || null,
      status: "running",
      startedAt: new Date().toISOString(),
      logCount: 0,
      runCount: 1,
      pendingApprovalCount: 0
    }]);
    setSelectedId(id);
    setComposeMode("thread");
    setRailOpen(false);
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
        discardWorkflowSession();
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
    const workspaceRoot = health?.paths?.workspaceRoot;

    const confirmed = window.confirm("Delete this thread? This cannot be undone.");
    if (!confirmed) return;

    let deleteWorkspace = false;
    if (isWorkspaceDeletionCandidate(task.workspace, workspaceRoot)) {
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
        window.alert(`Thread deleted. Workspace was not deleted because it is not an eligible workspace subdirectory:\n${workspaceDeletion.path}`);
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
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const result = await rerunTask(id);
    onStarted({ id: result.id, goal: task.goal, workspace: task.workspace });
    setTimeout(() => {
      refresh();
    }, 250);
  };

  const sendNextPrompt = async (prompt) => {
    if (!selectedTask) return;
    setThreadScrollToken((value) => value + 1);
    await continueTask(selectedTask.id, prompt);
    setTasks((prev) =>
      prev.map((task) => (task.id === selectedTask.id
        ? { ...task, status: "running", runCount: (task.runCount || 0) + 1 }
        : task))
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

  const renderMainContent = () => {
    if (activeMode === "workflow") {
      return (
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
            discardWorkflowSession();
            setWorkflowError("");
          }}
        />
      );
    }

    if (activeMode === "schedule") {
      return (
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
      );
    }

    if (selectedTask && composeMode === "thread") {
      return (
        <div className="transcriptStack">
          {pendingApprovals.length ? (
            <ApprovalPrompt
              approval={pendingApprovals[0]}
              onApprove={(approvalId) => decideApproval(approvalId, true)}
              onDeny={(approvalId) => decideApproval(approvalId, false)}
            />
          ) : null}
          <LogViewer
            entries={entries}
            status={effectiveStatus}
            entryCount={entries.length}
            taskId={selectedTask.id}
            scrollToBottomToken={threadScrollToken}
          />
        </div>
      );
    }

    return (
          <NewTaskForm
            onStarted={onStarted}
            serverName={currentServer?.name || "Direct connection"}
            serverUrl={serverUrl}
            readinessChecks={readinessChecks}
            selfWorkspacePath={selfWorkspacePath}
            selfUpdateReady={selfUpdateReady}
            selfUpdateHint={selfUpdateHint}
          />
        );
  };

  return (
    <>
      <ServerModal
        open={serverModalOpen}
        currentEndpoint={serverUrl}
        servers={savedServers}
        onClose={() => setServerModalOpen(false)}
        onConnect={applyServer}
        onToggleFavorite={toggleFavoriteServer}
        onRemove={removeServer}
      />

      <div className={`railScrim ${railOpen ? "visible" : ""}`} onClick={() => setRailOpen(false)} />

      <div className={`layout ${railCollapsed ? "railCollapsed" : ""}`}>
        <aside className={`leftRail ${railOpen ? "open" : ""}`}>
          <button
            type="button"
            className="railCollapseToggle"
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setRailCollapsed((prev) => !prev)}
          >
            <span className={`chevronIcon ${railCollapsed ? "right" : "left"}`} aria-hidden="true" />
          </button>

          <div className="leftRailContent">
            <div className="railHeader">
              <div className="brand">
                <div className="brandMarkWrap">
                  <img className="brandMark" src={logoIcon} alt="Ender logo" />
                </div>
                <div className="brandCopy">
                  <div className="brandEyebrow">Agent operations console</div>
                  <h1 className="title">Ender</h1>
                  <p className="subtitle">Live supervision for long-running agent work.</p>
                </div>
              </div>
            </div>

            <section className="serverSummary">
              <div className="connectionRow">
                <div>
                  <div className="sectionLabel">Current server</div>
                  <div className="serverNameDisplay">{currentServer?.name || "Direct endpoint"}</div>
                </div>
                <div className="serverSummaryActions">
                  <div className={`connectionStatus ${health?.ok ? "ready" : "notReady"}`}>
                    <span className="statusDot" />
                    {health?.ok ? "Connected" : "Offline"}
                  </div>
                  <button
                    type="button"
                    className="summaryToggle"
                    aria-label={serverSummaryCollapsed ? "Expand server details" : "Collapse server details"}
                    title={serverSummaryCollapsed ? "Expand server details" : "Collapse server details"}
                    onClick={() => setServerSummaryCollapsed((prev) => !prev)}
                  >
                    <span
                      className={`summaryToggleIcon ${serverSummaryCollapsed ? "collapsed" : "expanded"}`}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
              {!serverSummaryCollapsed ? (
                <>
                  <div className="serverEndpointDisplay mono">{serverUrl}</div>
                  {selfWorkspacePath ? (
                    <div className="readinessMeta">
                      Self workspace: {formatPathTail(selfWorkspacePath, 5)} {selfUpdateReady ? "· supervisor ready" : "· supervisor unavailable"}
                    </div>
                  ) : null}
                  <div className="readinessGrid">
                    {readinessChecks.map((item) => (
                      <div key={item.label} className={`readinessChip ${item.ready ? "ready" : "notReady"}`}>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  {readinessChecks.some((item) => item.detail) ? (
                    <div className="readinessMeta">
                      {readinessChecks
                        .filter((item) => item.detail)
                        .map((item) => `${item.label}: ${item.detail}`)
                        .join(" ")}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>

            {loadError ? <div className="errorBanner">{loadError}</div> : null}

            <section className="railSection">
              <div className="railSectionHeader">
                <div className="sectionHeading">
                  <span>Launch modes</span>
                </div>
                <button
                  type="button"
                  className="summaryToggle"
                  aria-label={modeSectionCollapsed ? "Expand launch modes" : "Collapse launch modes"}
                  title={modeSectionCollapsed ? "Expand launch modes" : "Collapse launch modes"}
                  onClick={() => setModeSectionCollapsed((prev) => !prev)}
                >
                  <span className={`summaryToggleIcon ${modeSectionCollapsed ? "collapsed" : "expanded"}`} aria-hidden="true" />
                </button>
              </div>
              {!modeSectionCollapsed ? (
                <div className="railPrimaryActions">
                  <button
                    type="button"
                    className={`modeButton ${activeMode === "new" ? "active" : ""}`}
                    onClick={() => openMode("new")}
                  >
                    <span className="modeButtonLabel">New Thread</span>
                    <span className="modeButtonMeta">Launch task</span>
                  </button>
                  <button
                    type="button"
                    className={`modeButton ${activeMode === "workflow" ? "active" : ""}`}
                    onClick={() => openMode("workflow")}
                  >
                    <span className="modeButtonLabel">Workflows</span>
                    <span className="modeButtonMeta">Guided setup</span>
                  </button>
                  <button
                    type="button"
                    className={`modeButton ${activeMode === "schedule" ? "active" : ""}`}
                    onClick={() => openMode("schedule")}
                  >
                    <span className="modeButtonLabel">Schedules</span>
                    <span className="modeButtonMeta">Recurring runs</span>
                  </button>
                </div>
              ) : null}
            </section>

            <section className="railSection threadCollection">
              <div className="railSectionHeader">
                <div className="sectionHeading">
                  <span>{showArchived ? "Archived threads" : "Thread ledger"}</span>
                  <span className="sectionCount mono">
                    {showArchived ? archivedTasks.length : activeTasks.length}
                  </span>
                </div>
              </div>
              <TaskList
                items={visibleTasks}
                selectedId={selectedId}
                taskState={taskStateForServer}
                hasMore={(showArchived ? archivedTasks : activeTasks).length > visibleTasks.length}
                loadMoreLabel={`Load more ${showArchived ? "archived" : "threads"}`}
                emptyLabel={showArchived ? "No archived threads" : "No threads on this server yet"}
                onSelect={(id) => {
                  setSelectedId(id);
                  setComposeMode("thread");
                  setRailOpen(false);
                }}
                onTogglePinned={togglePinned}
                onToggleArchived={toggleArchived}
                onLoadMore={() => setTaskVisibleCount((count) => count + TASK_PAGE_SIZE)}
                onTerminate={onTerminate}
                onDelete={onDelete}
                onRerun={onRerun}
              />
            </section>

            <div className="railFooter">
              <button
                type="button"
                className={`modeButton modeButtonSecondary ${showArchived ? "active" : ""}`}
                onClick={() => {
                  setShowArchived((prev) => !prev);
                  setSelectedId(null);
                }}
              >
                <span className="modeButtonLabel">
                  {showArchived ? `Show Active (${activeTasks.length})` : `Show Archived (${archivedTasks.length})`}
                </span>
                <span className="modeButtonMeta">Toggle archive scope</span>
              </button>
              <div className="railFootnote mono">
                v0.1.0 · {loading ? "syncing" : "ready"} · {tasks.length} total threads
              </div>
            </div>
          </div>
        </aside>

        <main className="mainPane">
          <header className={`mainHeader ${headerCollapsed ? "collapsed" : ""}`}>
            <div className="headerTopRow">
              <div className="headerTitleGroup">
                <button
                  type="button"
                  className="mobileRailButton"
                  onClick={() => setRailOpen((prev) => !prev)}
                >
                  Menu
                </button>
                <div className="headerTitleCopy">
                  <div className="headerEyebrow">
                    {selectedTask && composeMode === "thread" ? "Live transcript" : headerModeCopy.eyebrow}
                  </div>
                  <div
                    className={`headerGoal ${selectedTask && composeMode === "thread" ? "threadPrompt" : ""}`}
                    title={selectedTask && composeMode === "thread" ? selectedTask.goal : headerModeCopy.title}
                  >
                    {selectedTask && composeMode === "thread" ? selectedTask.goal : headerModeCopy.title}
                  </div>
                  {!selectedTask || composeMode !== "thread" ? <div className="headerMeta">{headerModeCopy.subtitle}</div> : null}
                </div>
              </div>
              <div className="headerActionColumn">
                <div className="headerActions">
                  <div className={`connectionStatus ${health?.ok ? "ready" : "notReady"}`}>
                    <span className="statusDot" />
                    {health?.ok ? "Server ready" : "Connection issue"}
                  </div>
                  <button type="button" className="iconButton" onClick={() => setServerModalOpen(true)}>
                    Switch Server
                  </button>
                  <button
                    type="button"
                    className="summaryToggle headerToggleButton"
                    aria-label={headerCollapsed ? "Expand header" : "Collapse header"}
                    title={headerCollapsed ? "Expand header" : "Collapse header"}
                    onClick={() => setHeaderCollapsed((prev) => !prev)}
                  >
                    <span
                      className={`summaryToggleIcon ${headerCollapsed ? "collapsed" : "expanded"}`}
                      aria-hidden="true"
                    />
                  </button>
                </div>
                {selectedTask && composeMode === "thread" ? (
                  <div className="headerThreadMeta mono">
                    {`Thread ${String(selectedTask.id).slice(0, 8)} · ${formatRelative(selectedTaskUpdatedAt)}`}
                  </div>
                ) : null}
              </div>
            </div>

            {!headerCollapsed ? (
              <div
                className={`headerChipRow ${
                  selectedTask && composeMode === "thread" ? "threadHeaderChipRow" : "overviewHeaderChipRow"
                }`}
              >
                <div className="headerChip">
                  <span className="headerChipLabel">Server</span>
                  <span className="headerChipValue mono">{currentServer?.name || serverUrl}</span>
                </div>
                {selectedTask && composeMode === "thread" ? (
                  <>
                    <div className="headerChip">
                      <span className="headerChipLabel">Status</span>
                      <span className={`statusPill headerStatusPill ${getStatusTone(effectiveStatus)}`}>
                        {getStatusLabel(effectiveStatus)}
                      </span>
                    </div>
                    <div className="headerChip">
                      <span className="headerChipLabel">Workspace</span>
                      <span className="headerChipValue headerPathValue mono" title={selectedTask.workspace || "none"}>
                        {formatPathTail(selectedTask.workspace, 3)}
                      </span>
                    </div>
                    <div className="headerChip">
                      <span className="headerChipLabel">Updated</span>
                      <span className="headerChipValue mono">{formatTimestamp(selectedTaskUpdatedAt)}</span>
                    </div>
                    <div className="headerChip">
                      <span className="headerChipLabel">Approvals</span>
                      <span className="headerChipValue mono">{pendingApprovals.length}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="headerChip">
                      <span className="headerChipLabel">Threads</span>
                      <span className="headerChipValue mono">{activeTasks.length}</span>
                    </div>
                    <div className="headerChip">
                      <span className="headerChipLabel">Archived</span>
                      <span className="headerChipValue mono">{archivedTasks.length}</span>
                    </div>
                    <div className="headerChip">
                      <span className="headerChipLabel">Timezone</span>
                      <span className="headerChipValue mono">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </header>

          <section className="mainBody">{renderMainContent()}</section>

          {selectedTask && composeMode === "thread" ? (
            <ThreadComposer
              disabled={sendLocked}
              onSend={sendNextPrompt}
              workspace={selectedTask.workspace}
              taskId={selectedTask.id}
              status={effectiveStatus}
            />
          ) : null}
        </main>
      </div>
    </>
  );
}
