import { useEffect, useMemo, useRef, useState } from "react";
import {
  advanceWorkflowSession,
  continueTask,
  createTaskLedgerEntry,
  listLlmProfiles,
  listProjects,
  createSchedule,
  deleteTaskLedgerEntry,
  getTaskCodeServer,
  createWorkflowSession,
  deleteSchedule,
  deleteTaskWithOptions,
  getApiBase,
  getHealth,
  launchTaskCodeServer,
  listTaskLedger,
  getWorkflowSession,
  listSchedules,
  listTasks,
  listWorkflows,
  rerunTask,
  resolveApproval,
  retreatWorkflowSession,
  runTaskLedgerEntryNow,
  runScheduleNow,
  setApiBase,
  stopTaskCodeServer,
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
import ServerPickerShell from "./components/ServerPickerShell";
import WorkflowPanel from "./components/WorkflowPanel";
import SchedulePanel from "./components/SchedulePanel";
import TaskLedgerPanel from "./components/TaskLedgerPanel";
import SimpleTaskLedgerView from "./components/SimpleTaskLedgerView";
import { APP_VERSION } from "./version";

const logoIcon = "/icons/icon-rounded-master.png";

const SAVED_SERVERS_KEY = "ender_saved_servers";
const TASK_UI_STATE_KEY = "ender_task_ui_state";
const RAIL_COLLAPSED_KEY = "ender_rail_collapsed";
const WORKFLOW_SESSION_KEY = "ender_workflow_sessions";
const TASK_PAGE_SIZE = 12;
const HAS_CONFIGURED_DEFAULT_API = Boolean(import.meta.env.VITE_ENDER_API);

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
  return status === "done"
    || status === "error"
    || status === "canceled"
    || status === "terminated"
    || status === "blocked"
    || status === "needs_input";
}

function getStatusTone(status) {
  const normalized = String(status || "idle");
  if (normalized === "running") return "running";
  if (normalized === "awaiting_approval") return "approval";
  if (normalized === "done") return "success";
  if (normalized === "needs_input") return "warning";
  if (normalized === "blocked") return "danger";
  if (normalized === "error") return "danger";
  if (normalized === "terminated" || normalized === "canceled") return "warning";
  return "neutral";
}

function getStatusLabel(status) {
  if (!status) return "idle";
  if (status === "awaiting_approval") return "approval needed";
  if (status === "done") return "completed";
  if (status === "needs_input") return "needs input";
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
      label: "Thread editor",
      ready: Boolean(health?.services?.codeServer?.ready),
      detail: health?.setupHints?.codeServer || ""
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
  if (mode === "ledger") {
    return {
      eyebrow: "Task Ledger",
      title: "Queue shared agent work",
      subtitle: "Track generic queued work, dispatch it to available threads, and review completed items across sources."
    };
  }
  return {
    eyebrow: "Launch",
    title: "Start a new task",
    subtitle: "Set the goal, scope the workspace if needed, and move straight into the live transcript once the run starts."
  };
}

function getStandaloneViewFromHash() {
  const hash = String(window.location.hash || "").trim().toLowerCase();
  if (hash === "#task-ledger" || hash === "#/task-ledger") {
    return "ledger";
  }
  return null;
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [savedServers, setSavedServers] = useState([]);
  const [connectionRequested, setConnectionRequested] = useState(HAS_CONFIGURED_DEFAULT_API);
  const [connectedOnce, setConnectedOnce] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [composeMode, setComposeMode] = useState("new");
  const [standaloneView, setStandaloneView] = useState(() => getStandaloneViewFromHash());
  const [workflows, setWorkflows] = useState([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowSession, setWorkflowSession] = useState(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [llmProfiles, setLlmProfiles] = useState([]);
  const [defaultLlmProfileId, setDefaultLlmProfileId] = useState("");
  const [projects, setProjects] = useState([]);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
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
  const [reconnectNotice, setReconnectNotice] = useState("");
  const [codeServerSession, setCodeServerSession] = useState(null);
  const [codeServerBusy, setCodeServerBusy] = useState(false);
  const [codeServerError, setCodeServerError] = useState("");
  const [editorSurface, setEditorSurface] = useState(null);
  const [editorFrameKey, setEditorFrameKey] = useState(0);
  const [editorFrameStatus, setEditorFrameStatus] = useState("idle");
  const [editorFrameReachable, setEditorFrameReachable] = useState(false);
  const [copiedEditorPassword, setCopiedEditorPassword] = useState(false);

  useEffect(() => {
    const onHashChange = () => {
      setStandaloneView(getStandaloneViewFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
  const [editorDockWidth, setEditorDockWidth] = useState(640);
  const [editorDetailsCollapsed, setEditorDetailsCollapsed] = useState(true);
  const [threadFocusRequested, setThreadFocusRequested] = useState(false);
  const [threadMobilePanel, setThreadMobilePanel] = useState("transcript");

  const wasOnlineRef = useRef(null);
  const copiedEditorPasswordTimerRef = useRef(null);
  const dockRailRestoreRef = useRef(null);
  const dockResizeRef = useRef({
    active: false,
    startX: 0,
    startWidth: 640
  });
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedId) || null, [tasks, selectedId]);
  const taskStateForServer = taskUiState[serverUrl] || {};
  const codeServerEditorUrl = codeServerSession?.proxyUrl || codeServerSession?.url || "";

  useEffect(() => {
    const saved = localStorage.getItem("ender_api_base");
    const nextSavedServers = loadSavedServers();
    setSavedServers(nextSavedServers);
    setTaskUiState(loadTaskUiState());
    if (saved) {
      const normalized = setApiBase(saved);
      setServerUrl(normalized);
      setConnectionRequested(true);
      setLoading(true);
      setServerModalOpen(false);
    } else {
      setServerUrl(getApiBase());
      setConnectionRequested(HAS_CONFIGURED_DEFAULT_API);
      setLoading(HAS_CONFIGURED_DEFAULT_API);
      setServerModalOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedTask || composeMode !== "thread") {
      setThreadFocusRequested(false);
      setThreadMobilePanel("transcript");
    }
  }, [selectedTask, composeMode]);

  useEffect(() => {
    localStorage.setItem(RAIL_COLLAPSED_KEY, String(railCollapsed));
  }, [railCollapsed]);

  useEffect(() => {
    if (!connectionRequested) {
      setWorkflows([]);
      setWorkflowLoading(false);
      return;
    }
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
  }, [composeMode, serverUrl, connectionRequested]);

  useEffect(() => {
    if (!connectionRequested) return;
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
  }, [composeMode, serverUrl, workflowSession, connectionRequested]);

  useEffect(() => {
    if (workflowSession && workflowSession.mode === "interactive" && !workflowSession.startedTaskId) {
      saveWorkflowSessionId(serverUrl, workflowSession.id);
      return;
    }
    saveWorkflowSessionId(serverUrl, "");
  }, [serverUrl, workflowSession]);

  useEffect(() => {
    if (!connectionRequested) {
      setSchedules([]);
      setScheduleBusy(false);
      return;
    }
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
  }, [composeMode, serverUrl, connectionRequested]);

  useEffect(() => {
    if (!connectionRequested) {
      setLedgerEntries([]);
      setLedgerBusy(false);
      return;
    }
    if (composeMode !== "ledger" && standaloneView !== "ledger") return;
    let live = true;

    const loadLedger = async () => {
      setLedgerBusy(true);
      try {
        const data = await listTaskLedger();
        if (!live) return;
        setLedgerEntries(data.items || []);
        setLedgerError("");
      } catch (err) {
        if (!live) return;
        setLedgerError(err.message || "Unable to load task ledger");
      } finally {
        if (live) setLedgerBusy(false);
      }
    };

    loadLedger();
    const id = setInterval(loadLedger, 3000);

    return () => {
      live = false;
      clearInterval(id);
    };
  }, [composeMode, serverUrl, standaloneView, connectionRequested]);

  useEffect(() => {
    if (!connectionRequested) {
      setHealth(null);
      return undefined;
    }
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
  }, [serverUrl, connectionRequested]);

  useEffect(() => {
    if (!connectionRequested) {
      setLlmProfiles([]);
      setDefaultLlmProfileId("");
      setProjects([]);
      return undefined;
    }
    let live = true;

    const loadRuntimeCatalogs = async () => {
      try {
        const [profilesData, projectsData] = await Promise.all([
          listLlmProfiles(),
          listProjects()
        ]);
        if (!live) return;
        setLlmProfiles(profilesData.items || []);
        setDefaultLlmProfileId(profilesData.defaultProfileId || profilesData.items?.[0]?.id || "");
        setProjects(projectsData.items || []);
      } catch {
        if (!live) return;
        setLlmProfiles([]);
        setDefaultLlmProfileId("");
        setProjects([]);
      }
    };

    loadRuntimeCatalogs();
    const intervalId = setInterval(loadRuntimeCatalogs, 15000);
    return () => {
      live = false;
      clearInterval(intervalId);
    };
  }, [serverUrl, connectionRequested]);

  useEffect(() => {
    const isOnline = Boolean(health?.ok);
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    if (wasOnline === null) return;

    if (wasOnline && !isOnline) {
      setReconnectNotice("Server disconnected. Waiting to reconnect...");
    }

    if (!wasOnline && isOnline) {
      setReconnectNotice("Reconnected. Refreshing...");
      refresh().finally(() => {
        setTimeout(() => setReconnectNotice(""), 1500);
      });
    }
  }, [health?.ok]);

  useEffect(() => {
    if (!selectedTask || composeMode !== "thread") {
      setCodeServerSession(null);
      setCodeServerError("");
      setEditorSurface(null);
      return undefined;
    }

    let live = true;

    const load = async () => {
      try {
        const result = await getTaskCodeServer(selectedTask.id);
        if (!live) return;
        setCodeServerSession(result.session || null);
        setCodeServerError("");
      } catch (err) {
        if (!live) return;
        setCodeServerSession(null);
        setCodeServerError(err.message || "Unable to load thread editor status");
      }
    };

    load();
    const intervalId = setInterval(load, 15000);

    return () => {
      live = false;
      clearInterval(intervalId);
    };
  }, [selectedTask?.id, serverUrl, composeMode]);

  useEffect(() => {
    if (codeServerSession) return;
    setEditorSurface(null);
    setEditorDetailsCollapsed(true);
    setThreadMobilePanel("transcript");
  }, [codeServerSession]);

  useEffect(() => {
    setCopiedEditorPassword(false);
  }, [codeServerSession?.password]);

  useEffect(() => {
    if (!codeServerEditorUrl || !editorSurface) {
      setEditorFrameStatus("idle");
      setEditorFrameReachable(false);
      return;
    }

    setEditorFrameStatus("connecting");
    setEditorFrameReachable(false);
  }, [codeServerEditorUrl, editorSurface]);

  useEffect(() => {
    if (!codeServerEditorUrl || !editorSurface) return;
    setEditorFrameStatus("connecting");
  }, [codeServerEditorUrl, editorSurface, editorFrameKey]);

  useEffect(() => {
    if (!codeServerEditorUrl || !editorSurface || editorFrameStatus === "loaded") {
      return undefined;
    }

    let live = true;

    const probeEditor = async () => {
      try {
        await fetch(codeServerEditorUrl, { mode: "no-cors", cache: "no-store" });
        if (!live) return;
        if (!editorFrameReachable) {
          setEditorFrameKey((value) => value + 1);
        }
        setEditorFrameReachable(true);
      } catch {
        if (live) setEditorFrameReachable(false);
      }
    };

    probeEditor();
    const intervalId = window.setInterval(probeEditor, 2000);

    return () => {
      live = false;
      window.clearInterval(intervalId);
    };
  }, [codeServerEditorUrl, editorSurface, editorFrameStatus, editorFrameReachable]);

  useEffect(() => {
    if (!codeServerEditorUrl || !editorSurface || editorFrameStatus !== "connecting") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setEditorFrameKey((value) => value + 1);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [codeServerEditorUrl, editorSurface, editorFrameStatus, editorFrameKey]);

  useEffect(() => () => {
    if (copiedEditorPasswordTimerRef.current) {
      window.clearTimeout(copiedEditorPasswordTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (editorSurface !== "modal") return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setEditorSurface(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editorSurface]);

  useEffect(() => {
    const onPointerMove = (event) => {
      const state = dockResizeRef.current;
      if (!state.active) return;

      const nextWidth = state.startWidth + (state.startX - event.clientX);
      const maxWidth = Math.max(520, Math.floor(window.innerWidth * 0.58));
      const clamped = Math.min(maxWidth, Math.max(420, nextWidth));
      setEditorDockWidth(clamped);
    };

    const onPointerUp = () => {
      if (!dockResizeRef.current.active) return;
      dockResizeRef.current.active = false;
      document.body.classList.remove("editorDockResizing");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("editorDockResizing");
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setEditorDockWidth((current) => {
        const maxWidth = Math.max(520, Math.floor(window.innerWidth * 0.58));
        return Math.min(current, maxWidth);
      });

      const nextSurface = getResponsiveEditorSurface(editorSurface, window.innerWidth);
      if (nextSurface && nextSurface !== editorSurface) {
        setEditorFrameKey((value) => value + 1);
        setEditorSurface(nextSurface);
        setThreadMobilePanel(nextSurface === "stacked" ? "editor" : "transcript");
      }
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [editorSurface]);

  useEffect(() => {
    if (!connectionRequested) {
      setLoading(false);
      setLoadError("");
      setTasks([]);
      setSelectedId(null);
      return undefined;
    }

    let live = true;
    const load = async () => {
      try {
        const data = await listTasks();
        if (!live) return;
        setLoadError("");
        setConnectedOnce(true);
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
  }, [selectedId, serverUrl, composeMode, connectionRequested]);

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
  const { entries, status, pendingApprovals, removeApproval } = useTaskLogs(
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
  const showConnectionShell = !connectedOnce;

  const discardWorkflowSession = () => {
    setWorkflowSession(null);
    saveWorkflowSessionId(serverUrl, "");
  };

  const effectiveStatus = selectedTask ? status || selectedTask.status : null;
  const primaryApproval = pendingApprovals[0] || null;
  const threadBlockedByApproval = effectiveStatus === "awaiting_approval";
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
  const serverWorkspacePath = String(health?.paths?.workspaceRoot || "").trim() || "";
  const selfUpdateReady = Boolean(health?.services?.selfUpdate?.ready);
  const selfUpdateHint = health?.setupHints?.selfUpdate || "";
  const codeServerReady = Boolean(health?.services?.codeServer?.ready);
  const serverAppVersion = String(health?.app?.version || "").trim();
  const hasSplitEditor = editorSurface === "split" && Boolean(codeServerSession?.url);
  const hasStackedEditor = editorSurface === "stacked" && Boolean(codeServerSession?.url);
  const isThreadFocusMode = Boolean(selectedTask && composeMode === "thread" && (threadFocusRequested || hasSplitEditor));

  useEffect(() => {
    if (!hasSplitEditor) {
      if (dockRailRestoreRef.current !== null && !threadFocusRequested) {
        setRailCollapsed(Boolean(dockRailRestoreRef.current));
      }
      dockRailRestoreRef.current = null;
      return;
    }

    if (dockRailRestoreRef.current === null) {
      dockRailRestoreRef.current = railCollapsed;
    }
    if (!railCollapsed) {
      setRailCollapsed(true);
    }
    setRailOpen(false);
  }, [hasSplitEditor, railCollapsed, threadFocusRequested]);

  function getPreferredEditorSurface(width = typeof window !== "undefined" ? window.innerWidth : 1440) {
    if (width < 980) return "stacked";
    if (width < 1180) return "modal";
    return "split";
  }

  function getResponsiveEditorSurface(currentSurface, width = typeof window !== "undefined" ? window.innerWidth : 1440) {
    if (!currentSurface) return null;
    if (currentSurface === "split") {
      return getPreferredEditorSurface(width);
    }
    if (currentSurface === "stacked") {
      return getPreferredEditorSurface(width);
    }
    if (currentSurface === "modal" && width < 980) {
      return "stacked";
    }
    return currentSurface;
  }

  function shouldUseStackedEditor() {
    return getPreferredEditorSurface() === "stacked";
  }

  function shouldUseModalEditor() {
    return getPreferredEditorSurface() === "modal";
  }

  const refresh = async () => {
    if (!connectionRequested) return [];
    try {
      const data = await listTasks();
      setLoadError("");
      setConnectedOnce(true);
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
      setConnectionRequested(true);
      setConnectedOnce(false);
      setLoading(true);
    setHealth(null);
    setLlmProfiles([]);
    setDefaultLlmProfileId("");
    setProjects([]);
      setLoadError("");
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
    if (endpoint === serverUrl) {
      localStorage.removeItem("ender_api_base");
      if (!connectedOnce) {
        setConnectionRequested(false);
        setLoadError("");
      }
    }
  };

  const openMode = (nextMode) => {
    setComposeMode(nextMode);
    if (nextMode !== "thread") {
      setSelectedId(null);
    }
    setWorkflowError("");
    setRailOpen(false);
  };

  const onStarted = ({ id, goal, workspace, projectId, llmProfileId, memoryMode }) => {
    setTasks((prev) => [...prev, {
      id,
      goal,
      workspace: workspace || null,
      projectId: projectId || null,
      llmProfileId: llmProfileId || defaultLlmProfileId || null,
      memoryMode: memoryMode || "auto",
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

  const refreshProjects = async () => {
    const data = await listProjects();
    setProjects(data.items || []);
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

  const refreshTaskLedger = async () => {
    const data = await listTaskLedger();
    setLedgerEntries(data.items || []);
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

  const createLedgerEntry = async (payload) => {
    setLedgerBusy(true);
    setLedgerError("");
    try {
      await createTaskLedgerEntry(payload);
      await Promise.all([refreshTaskLedger(), refresh()]);
    } catch (err) {
      setLedgerError(err.message || "Unable to create task ledger entry");
      throw err;
    } finally {
      setLedgerBusy(false);
    }
  };

  const runLedgerEntryNow = async (id) => {
    setLedgerBusy(true);
    setLedgerError("");
    try {
      const result = await runTaskLedgerEntryNow(id);
      await Promise.all([refreshTaskLedger(), refresh()]);
      if (result?.startedTaskId) {
        setSelectedId(result.startedTaskId);
        setComposeMode("thread");
      }
    } catch (err) {
      setLedgerError(err.message || "Unable to run task ledger entry");
    } finally {
      setLedgerBusy(false);
    }
  };

  const deleteLedgerEntry = async (id) => {
    const confirmed = window.confirm("Delete this ledger entry?");
    if (!confirmed) return;
    setLedgerBusy(true);
    setLedgerError("");
    try {
      await deleteTaskLedgerEntry(id);
      await refreshTaskLedger();
    } catch (err) {
      setLedgerError(err.message || "Unable to delete task ledger entry");
    } finally {
      setLedgerBusy(false);
    }
  };

  const openTaskFromLedger = async (taskId) => {
    await refresh();
    setSelectedId(taskId);
    setComposeMode("thread");
    setRailOpen(false);
  };

  const openLedgerStandaloneView = () => {
    window.location.hash = "/task-ledger";
  };

  const openFullConsole = () => {
    if (!window.location.hash) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setStandaloneView(null);
  };

  const openEntryFromStandaloneLedger = async (entry) => {
    const taskId = entry?.completedTaskId || entry?.startedTaskId || null;
    openFullConsole();
    if (taskId) {
      await openTaskFromLedger(taskId);
      return;
    }
    setComposeMode("ledger");
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
      } else if (workspaceDeletion.reason === "project_workspace") {
        window.alert(`Thread deleted. Workspace left on disk because it belongs to a saved project:\n${workspaceDeletion.path}`);
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
    onStarted({
      id: result.id,
      goal: task.goal,
      workspace: task.workspace,
      projectId: task.projectId || null,
      llmProfileId: task.llmProfileId || null,
      memoryMode: task.memoryMode || "auto"
    });
    setTimeout(() => {
      refresh();
    }, 250);
  };

  const sendNextPrompt = async (input) => {
    if (!selectedTask) return;
    setThreadScrollToken((value) => value + 1);
    await continueTask(selectedTask.id, input);
    setTasks((prev) =>
      prev.map((task) => (task.id === selectedTask.id
        ? {
            ...task,
            status: "running",
            runCount: (task.runCount || 0) + 1,
            llmProfileId: input?.llmProfileId || task.llmProfileId,
            memoryMode: input?.memoryMode || task.memoryMode || "auto"
          }
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

  const launchEditor = async () => {
    if (!selectedTask) return;
    setCodeServerBusy(true);
    setCodeServerError("");
    try {
      const result = await launchTaskCodeServer(selectedTask.id);
      setCodeServerSession(result.session || null);
      if (result.session?.url) {
        setEditorFrameKey((value) => value + 1);
        const nextSurface = getPreferredEditorSurface();
        setEditorSurface(nextSurface);
        setThreadMobilePanel(nextSurface === "stacked" ? "editor" : "transcript");
      }
    } catch (err) {
      setCodeServerError(err.message || "Unable to launch thread editor");
    } finally {
      setCodeServerBusy(false);
    }
  };

  const stopEditor = async () => {
    if (!selectedTask) return;
    setCodeServerBusy(true);
    setCodeServerError("");
    try {
      await stopTaskCodeServer(selectedTask.id);
      setCodeServerSession(null);
      setEditorSurface(null);
    } catch (err) {
      setCodeServerError(err.message || "Unable to stop thread editor");
    } finally {
      setCodeServerBusy(false);
    }
  };

  const openEditorTab = () => {
    if (!codeServerEditorUrl) return;
    const nextWindow = window.open(codeServerEditorUrl, "_blank", "noopener,noreferrer");
    if (nextWindow) {
      setEditorSurface(null);
      setEditorDetailsCollapsed(true);
      setThreadMobilePanel("transcript");
    }
  };

  const copyEditorPassword = async () => {
    const password = codeServerSession?.password;
    if (!password) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password);
      } else {
        const textarea = document.createElement("textarea");
        try {
          textarea.value = password;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
        } finally {
          textarea.remove();
        }
      }

      setCopiedEditorPassword(true);
      if (copiedEditorPasswordTimerRef.current) {
        window.clearTimeout(copiedEditorPasswordTimerRef.current);
      }
      copiedEditorPasswordTimerRef.current = window.setTimeout(() => {
        setCopiedEditorPassword(false);
      }, 1600);
    } catch {
      setCodeServerError("Unable to copy the editor password.");
    }
  };

  const openEditorModal = () => {
    if (!codeServerSession?.url) return;
    setEditorFrameKey((value) => value + 1);
    setEditorDetailsCollapsed(true);
    setEditorSurface("modal");
    setThreadMobilePanel("transcript");
  };

  const openEditorStacked = () => {
    if (!codeServerSession?.url) return;
    setEditorFrameKey((value) => value + 1);
    setEditorDetailsCollapsed(true);
    setEditorSurface("stacked");
    setThreadMobilePanel("editor");
  };

  const openEditorSplit = () => {
    if (!codeServerSession?.url) return;
    if (shouldUseStackedEditor()) {
      openEditorStacked();
      return;
    }
    if (shouldUseModalEditor()) {
      openEditorModal();
      return;
    }
    setEditorFrameKey((value) => value + 1);
    setEditorDetailsCollapsed(true);
    setEditorSurface("split");
    setThreadMobilePanel("transcript");
  };

  const showThreadTranscript = () => {
    setThreadMobilePanel("transcript");
    setRailOpen(false);
  };

  const showThreadEditor = () => {
    if (!codeServerSession?.url) {
      launchEditor();
      return;
    }
    if (shouldUseStackedEditor()) {
      openEditorStacked();
      return;
    }
    openEditorSplit();
  };

  const toggleThreadFocus = () => {
    setThreadFocusRequested((value) => !value);
    setRailOpen(false);
  };

  const leaveThreadFocus = () => {
    setThreadFocusRequested(false);
    setRailCollapsed(false);
    setRailOpen(false);
  };

  const beginDockResize = (event) => {
    dockResizeRef.current = {
      active: true,
      startX: event.clientX,
      startWidth: editorDockWidth
    };
    document.body.classList.add("editorDockResizing");
  };

  const renderThreadTranscript = () => (
    <div className="transcriptStack">
      {primaryApproval ? (
        <>
          <section className="approvalStickyBar">
            <div className="approvalStickyCopy">
              <div className="workflowBadge">APPROVAL REQUIRED</div>
              <div className="approvalStickyTitle">{primaryApproval.title || "Sensitive action requested"}</div>
              <div className="approvalStickyMeta">
                {primaryApproval.description || "Resolve the pending action before continuing this run."}
              </div>
            </div>
            <div className="approvalStickyActions">
              <button className="primaryButton" onClick={() => decideApproval(primaryApproval.id, true)}>
                Approve
              </button>
              <button className="dangerButton" onClick={() => decideApproval(primaryApproval.id, false)}>
                Deny
              </button>
            </div>
          </section>
          <ApprovalPrompt
            approval={primaryApproval}
            onApprove={(approvalId) => decideApproval(approvalId, true)}
            onDeny={(approvalId) => decideApproval(approvalId, false)}
          />
        </>
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

  const renderEditorPasswordButton = () => {
    if (!codeServerSession?.password) return null;

    return (
      <button
        type="button"
        className={`editorPasswordButton ${copiedEditorPassword ? "copied" : ""}`}
        onClick={copyEditorPassword}
        title="Copy editor password"
        aria-label="Copy editor password"
      >
        <span className="headerChipLabel">Password</span>
        <span className="editorPasswordValue mono">{codeServerSession.password}</span>
        <span className="editorPasswordState">{copiedEditorPassword ? "Copied" : "Copy"}</span>
      </button>
    );
  };

  const renderEditorPasswordCredential = () => {
    if (!codeServerSession?.password) return null;

    return (
      <button
        type="button"
        className={`editorCredential editorCredentialButton ${copiedEditorPassword ? "copied" : ""}`}
        onClick={copyEditorPassword}
      >
        <span className="headerChipLabel">Password</span>
        <span className="editorCredentialCopyRow">
          <span className="editorMetaValue mono">{codeServerSession.password}</span>
          <span className="editorPasswordState">{copiedEditorPassword ? "Copied" : "Copy"}</span>
        </span>
      </button>
    );
  };

  const renderEditorFrame = (surface, shellClassName = "") => {
    if (!codeServerEditorUrl) return null;
    const waiting = editorFrameStatus !== "loaded";

    return (
      <div className={`editorFrameShell ${shellClassName}`}>
        {waiting ? (
          <div className="editorFrameOverlay" role="status" aria-live="polite">
            <div className="editorFrameSpinner" aria-hidden="true" />
            <div className="editorFrameOverlayTitle">Waiting to connect</div>
            <div className="editorFrameOverlayText">The workspace editor will reload automatically when it is ready.</div>
          </div>
        ) : null}
        <iframe
          key={`${surface}-${editorFrameKey}-${codeServerEditorUrl}`}
          className="editorFrame"
          src={codeServerEditorUrl}
          title="Thread workspace editor"
          onLoad={() => setEditorFrameStatus(editorFrameReachable ? "loaded" : "connecting")}
        />
      </div>
    );
  };

  const renderStackedEditor = () => {
    if (!codeServerSession?.url) return null;

    return (
      <section className="threadEditorStack" aria-label="Thread workspace editor">
        <div className="threadEditorStackHeader">
          <div>
            <div className="panelLabel mono">thread.editor</div>
            <div className="editorDockTitle">Workspace editor</div>
          </div>
          <div className="editorDockActions threadEditorStackActions">
            <span className="statusPill success">running</span>
            {renderEditorPasswordButton()}
            <button type="button" className="miniButton" onClick={() => setEditorDetailsCollapsed((value) => !value)}>
              {editorDetailsCollapsed ? "Show Details" : "Hide Details"}
            </button>
            <button type="button" className="miniButton" onClick={openEditorTab}>
              New Tab
            </button>
            <button type="button" className="miniButton miniButtonDanger" onClick={() => setEditorSurface(null)}>
              Close
            </button>
          </div>
        </div>
        {!editorDetailsCollapsed ? (
          <div className="threadEditorStackMeta">
            <div className="panelNote">Switch back to the transcript any time to review logs, approvals, or continue the thread.</div>
            <div className="editorCredentials">
              <div className="editorCredential">
                <span className="headerChipLabel">URL</span>
                <a className="editorLink mono" href={codeServerEditorUrl} target="_blank" rel="noreferrer">
                  {codeServerEditorUrl}
                </a>
              </div>
              {renderEditorPasswordCredential()}
            </div>
          </div>
        ) : null}
        {renderEditorFrame("stacked", "threadEditorStackViewport")}
      </section>
    );
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

    if (activeMode === "ledger") {
      return (
        <TaskLedgerPanel
          entries={ledgerEntries}
          busy={ledgerBusy}
          error={ledgerError}
          serverWorkspacePath={serverWorkspacePath}
          onCreate={createLedgerEntry}
          onDelete={deleteLedgerEntry}
          onOpenIsolatedView={openLedgerStandaloneView}
          onRunNow={runLedgerEntryNow}
          onOpenTask={openTaskFromLedger}
        />
      );
    }

    if (selectedTask && composeMode === "thread") {
      if (hasStackedEditor) {
        return (
          <div className="threadMobileWorkspace">
            <div className="threadMobileSwitcher" role="tablist" aria-label="Thread workspace view">
              <button
                type="button"
                role="tab"
                aria-selected={threadMobilePanel === "transcript"}
                className={`threadSurfaceButton ${threadMobilePanel === "transcript" ? "active" : ""}`}
                onClick={showThreadTranscript}
              >
                Transcript
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={threadMobilePanel === "editor"}
                className={`threadSurfaceButton ${threadMobilePanel === "editor" ? "active" : ""}`}
                onClick={() => setThreadMobilePanel("editor")}
              >
                Editor
              </button>
            </div>
            {threadMobilePanel === "editor" ? renderStackedEditor() : renderThreadTranscript()}
          </div>
        );
      }

      return renderThreadTranscript();
    }

    return (
      <NewTaskForm
        onStarted={onStarted}
        serverName={currentServer?.name || "Direct connection"}
        serverUrl={serverUrl}
        serverWorkspacePath={serverWorkspacePath}
        readinessChecks={readinessChecks}
        selfWorkspacePath={selfWorkspacePath}
        selfUpdateReady={selfUpdateReady}
        selfUpdateHint={selfUpdateHint}
        llmProfiles={llmProfiles}
        projects={projects}
        defaultLlmProfileId={defaultLlmProfileId}
        onProjectCreated={refreshProjects}
      />
    );
  };

  if (showConnectionShell) {
    return (
      <ServerPickerShell
        currentEndpoint={serverUrl}
        currentServerName={currentServer?.name || ""}
        servers={savedServers}
        busy={connectionRequested && loading}
        error={loadError}
        onConnect={applyServer}
        onToggleFavorite={toggleFavoriteServer}
        onRemove={removeServer}
      />
    );
  }

  if (standaloneView === "ledger") {
    return (
      <SimpleTaskLedgerView
        entries={ledgerEntries}
        busy={ledgerBusy}
        error={ledgerError}
        serverName={currentServer?.name || "Direct endpoint"}
        serverUrl={serverUrl}
        onCreate={createLedgerEntry}
        onOpenEntry={openEntryFromStandaloneLedger}
        onOpenFullConsole={openFullConsole}
      />
    );
  }

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

      <div className={`layout ${railCollapsed ? "railCollapsed" : ""} ${hasSplitEditor ? "withDock" : ""} ${isThreadFocusMode ? "reviewMode" : ""}`}>
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
                  <div className="serverEndpointDisplay mono">{serverUrl}</div>
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
                    onClick={() => setServerSummaryCollapsed((value) => !value)}
                  >
                    <span className={`chevronIcon ${serverSummaryCollapsed ? "down" : "up"}`} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {reconnectNotice ? <div className="panelNote">{reconnectNotice}</div> : null}

              {!serverSummaryCollapsed ? (
                <>
                  <div className="serverSummaryMetaRow">
                    <span className="serverSummaryMetaChip mono">{tasks.length} threads</span>
                    <span className="serverSummaryMetaChip mono">ui v{APP_VERSION}</span>
                    <span className="serverSummaryMetaChip mono">server v{serverAppVersion || "unknown"}</span>
                    {selfWorkspacePath ? (
                      <span className="serverSummaryMetaChip mono">{selfUpdateReady ? "self-update ready" : "self-update unavailable"}</span>
                    ) : null}
                  </div>
                  {serverWorkspacePath ? (
                    <div className="readinessMeta">
                      Workspace root: {formatPathTail(serverWorkspacePath, 5)}
                    </div>
                  ) : null}
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
                  <button
                    type="button"
                    className={`modeButton ${activeMode === "ledger" ? "active" : ""}`}
                    onClick={() => openMode("ledger")}
                  >
                    <span className="modeButtonLabel">Task Ledger</span>
                    <span className="modeButtonMeta">Queued shared work</span>
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
                onLoadMore={() => setTaskVisibleCount((value) => value + TASK_PAGE_SIZE)}
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

        <main className={`mainPane ${isThreadFocusMode ? "reviewMode" : ""}`}>
          <header className={`mainHeader ${headerCollapsed ? "collapsed" : ""} ${isThreadFocusMode ? "reviewMode" : ""}`}>
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
                  {selectedTask && composeMode === "thread" ? (
                    <button
                      type="button"
                      className="iconButton"
                      onClick={
                        hasStackedEditor && threadMobilePanel === "editor"
                          ? showThreadTranscript
                          : codeServerSession
                            ? showThreadEditor
                            : launchEditor
                      }
                      disabled={codeServerBusy || (!codeServerSession && !codeServerReady)}
                    >
                      {codeServerBusy ? "Launching..." : hasStackedEditor && threadMobilePanel === "editor" ? "Transcript" : codeServerSession ? "Editor" : "Launch Editor"}
                    </button>
                  ) : null}
                  {selectedTask && composeMode === "thread" && !hasSplitEditor ? (
                    <button
                      type="button"
                      className="iconButton"
                      onClick={isThreadFocusMode ? leaveThreadFocus : toggleThreadFocus}
                    >
                      {isThreadFocusMode ? "Show Threads" : "Focus View"}
                    </button>
                  ) : null}
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
              </div>
            </div>

            {!headerCollapsed && selectedTask && composeMode === "thread" ? (
              <div className="threadHeaderMetaStrip">
                <span className={`statusPill headerStatusPill ${getStatusTone(effectiveStatus)}`}>
                  {getStatusLabel(effectiveStatus)}
                </span>
                <span className="headerMetaTag mono">{`thread ${String(selectedTask.id).slice(0, 8)}`}</span>
                <span className="headerMetaTag mono" title={selectedTask.workspace || "none"}>
                  {`workspace ${formatPathTail(selectedTask.workspace, 3)}`}
                </span>
                <span className="headerMetaTag mono">{`updated ${formatTimestamp(selectedTaskUpdatedAt)}`}</span>
                <span className="headerMetaTag mono">{formatRelative(selectedTaskUpdatedAt)}</span>
                {primaryApproval ? <span className="headerMetaTag attention mono">approval required</span> : null}
              </div>
            ) : null}

            {!headerCollapsed && (!selectedTask || composeMode !== "thread") ? (
              <div
                className={`headerChipRow ${
                  selectedTask && composeMode === "thread" ? "threadHeaderChipRow" : "overviewHeaderChipRow"
                }`}
              >
                <div className="headerChip">
                  <span className="headerChipLabel">Server</span>
                  <span className="headerChipValue mono">{currentServer?.name || serverUrl}</span>
                </div>
                <div className="headerChip">
                  <span className="headerChipLabel">Threads</span>
                  <span className="headerChipValue mono">{activeTasks.length}</span>
                </div>
                <div className="headerChip">
                  <span className="headerChipLabel">Timezone</span>
                  <span className="headerChipValue mono">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                </div>
                <div className="headerChip">
                  <span className="headerChipLabel">Archive</span>
                  <span className="headerChipValue mono">{archivedTasks.length} hidden</span>
                </div>
              </div>
            ) : null}
          </header>

          <section className={`mainBody ${isThreadFocusMode ? "reviewMode" : ""}`}>{renderMainContent()}</section>
          {selectedTask && composeMode === "thread" && !(hasStackedEditor && threadMobilePanel === "editor") ? (
            threadBlockedByApproval ? (
              <section className="threadComposer composerBlockedState">
                <div className="composerTop">
                  <div>
                    <div className="composerEyebrow">Run paused</div>
                    <div className="composerContext mono">
                      {selectedTask.id.slice(0, 8)} · approval needed
                    </div>
                  </div>
                  <div className="composerContext mono">{selectedTask.workspace || "No workspace scope"}</div>
                </div>
                <div className="composerBlockedMessage">
                  Resolve the pending approval above to continue this run. Follow-up prompts are disabled until the operator approves or denies the action.
                </div>
              </section>
            ) : (
              <ThreadComposer
                disabled={sendLocked}
                status={effectiveStatus}
                onSend={sendNextPrompt}
                workspace={selectedTask.workspace}
                taskId={selectedTask.id}
                llmProfiles={llmProfiles}
                currentLlmProfileId={selectedTask.llmProfileId || defaultLlmProfileId}
                currentMemoryMode={selectedTask.memoryMode || "auto"}
              />
            )
          ) : null}
        </main>
        {hasSplitEditor ? (
          <aside className="editorDock" role="dialog" aria-label="Docked workspace editor" style={{ width: `${editorDockWidth}px` }}>
            <button
              type="button"
              className="editorDockResizeHandle"
              aria-label="Resize docked editor"
              title="Drag to resize"
              onPointerDown={beginDockResize}
            />
            <div className="editorDockHeader">
              <div className="editorDockTopBar">
                <div className="editorDockHeading">
                  <div className="panelLabel mono">thread.editor</div>
                  <div className="editorDockTitle">Docked workspace editor</div>
                </div>
                <div className="editorDockActions">
                  <span className="statusPill success">running</span>
                  {renderEditorPasswordButton()}
                  <button type="button" className="miniButton" onClick={() => setEditorDetailsCollapsed((value) => !value)}>
                    {editorDetailsCollapsed ? "Show Details" : "Hide Details"}
                  </button>
                  <button type="button" className="miniButton" onClick={openEditorTab}>
                    New Tab
                  </button>
                  <button type="button" className="miniButton" onClick={openEditorModal}>
                    Modal
                  </button>
                  <button type="button" className="miniButton miniButtonDanger" onClick={() => setEditorSurface(null)}>
                    Close
                  </button>
                </div>
              </div>
              {!editorDetailsCollapsed ? (
                <div className="editorDockDetails">
                  <div className="panelNote">If the embed is blocked by the browser or editor headers, open it in a new tab instead.</div>
                  <div className="editorCredentials editorDockCredentials">
                    <div className="editorCredential">
                      <span className="headerChipLabel">URL</span>
                      <a className="editorLink mono" href={codeServerEditorUrl} target="_blank" rel="noreferrer">
                        {codeServerEditorUrl}
                      </a>
                    </div>
                    {renderEditorPasswordCredential()}
                  </div>
                </div>
              ) : null}
            </div>
            {renderEditorFrame("split")}
          </aside>
        ) : null}
      </div>

      {editorSurface === "modal" && codeServerSession?.url ? (
        <div className="modalBackdrop" onClick={() => setEditorSurface(null)}>
          <div
            className="modalCard editorModal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace editor"
          >
            <div className="panelChrome">
              <div className="panelLabel mono">thread.editor</div>
              <button type="button" className="iconButton" aria-label="Close workspace editor" onClick={() => setEditorSurface(null)}>
                Close
              </button>
            </div>

            <div className="editorModalBody">
              <div className="editorModalHeader">
                <div>
                  <div className="modalTitle">Workspace editor</div>
                  <div className="modalSubtitle">
                    This embed stays scoped to the active thread workspace. If the iframe is blocked, use a new tab instead.
                  </div>
                </div>
                {!editorDetailsCollapsed ? (
                  <>
                    <div className="editorMetaGrid">
                      <div className="editorMetaItem">
                        <span className="headerChipLabel">Workspace</span>
                        <span className="editorMetaValue mono" title={selectedTask?.workspace || "none"}>
                          {formatPathTail(selectedTask?.workspace, 4)}
                        </span>
                      </div>
                      <div className="editorMetaItem">
                        <span className="headerChipLabel">Status</span>
                        <span className="statusPill success">running</span>
                      </div>
                      <div className="editorMetaItem">
                        <span className="headerChipLabel">Mode</span>
                        <span className="editorMetaValue mono">{codeServerSession.mode || "local"}</span>
                      </div>
                      <div className="editorMetaItem">
                        <span className="headerChipLabel">Port</span>
                        <span className="editorMetaValue mono">{codeServerSession.port}</span>
                      </div>
                    </div>
                    <div className="editorCredentials">
                      <div className="editorCredential">
                        <span className="headerChipLabel">URL</span>
                        <a className="editorLink mono" href={codeServerEditorUrl} target="_blank" rel="noreferrer">
                          {codeServerEditorUrl}
                        </a>
                      </div>
                      {renderEditorPasswordCredential()}
                    </div>
                  </>
                ) : null}
                <div className="editorModalActions">
                  {renderEditorPasswordButton()}
                  <button type="button" className="miniButton" onClick={() => setEditorDetailsCollapsed((value) => !value)}>
                    {editorDetailsCollapsed ? "Show Details" : "Hide Details"}
                  </button>
                  {!shouldUseModalEditor() ? (
                    <button type="button" className="primaryButton" onClick={openEditorSplit}>
                      Dock Right
                    </button>
                  ) : null}
                  <button type="button" className="miniButton" onClick={openEditorTab}>
                    New Tab
                  </button>
                  <button type="button" className="miniButton miniButtonDanger" onClick={stopEditor} disabled={codeServerBusy}>
                    {codeServerBusy ? "Stopping..." : "Stop"}
                  </button>
                  <button type="button" className="miniButton miniButtonDanger" onClick={() => setEditorSurface(null)}>
                    Close
                  </button>
                </div>
                {codeServerError ? <div className="errorBanner editorErrorBanner">{codeServerError}</div> : null}
              </div>
              {renderEditorFrame("modal", "editorModalViewport")}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
