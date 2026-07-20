import { useEffect, useMemo, useRef, useState } from "react";
import {
  continueTask,
  deleteTaskWithOptions,
  rerunTask,
  resolveApproval,
  terminateTask,
} from "./agentClient";
import { useTaskLogs } from "./hooks/useTaskLogs";
import { useServerConnection } from "./hooks/useServerConnection";
import { useTaskThreads } from "./hooks/useTaskThreads";
import { useAutomations } from "./hooks/useAutomations";
import { useTaskLedger } from "./hooks/useTaskLedger";
import { useThreadEditor } from "./hooks/useThreadEditor";
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
import ApplicationShell, { MAIN_CONTENT_ID, NAVIGATION_ID } from "./components/ApplicationShell";
import PrimaryNavigation from "./components/PrimaryNavigation";
import StateNotice from "./components/ui/StateNotice";
import {
  DockedThreadEditor,
  ModalThreadEditor,
  StackedThreadEditor
} from "./components/ThreadEditor";
import { resolveActiveMode } from "./navigation";
import { APP_VERSION } from "./version";
import { formatConnectionState } from "./serverPresentation";

const logoIcon = "/icons/icon-rounded-master.png";

const RAIL_COLLAPSED_KEY = "ender_rail_collapsed";
const THREAD_TRANSCRIPT_TAB_ID = "thread-transcript-tab";
const THREAD_EDITOR_TAB_ID = "thread-editor-tab";
const THREAD_TRANSCRIPT_PANEL_ID = "thread-transcript-panel";
const THREAD_EDITOR_PANEL_ID = "thread-editor-panel";

function loadRailCollapsed() {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
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

function getModeTitle(mode) {
  if (mode === "workflow") return "Workflows";
  if (mode === "schedule") return "Schedules";
  if (mode === "ledger") return "Task ledger";
  return "New task";
}

function getStandaloneViewFromHash() {
  const hash = String(window.location.hash || "").trim().toLowerCase();
  if (hash === "#task-ledger" || hash === "#/task-ledger") {
    return "ledger";
  }
  return null;
}

export default function App() {
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [composeMode, setComposeMode] = useState("new");
  const [standaloneView, setStandaloneView] = useState(() => getStandaloneViewFromHash());
  const [railCollapsed, setRailCollapsed] = useState(() => loadRailCollapsed());
  const [railOpen, setRailOpen] = useState(false);
  const [threadScrollToken, setThreadScrollToken] = useState(0);

  useEffect(() => {
    const onHashChange = () => {
      setStandaloneView(getStandaloneViewFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
  const [threadFocusRequested, setThreadFocusRequested] = useState(false);

  const threadRefreshRef = useRef(() => Promise.resolve([]));
  const dockRailRestoreRef = useRef(null);
  const {
    serverUrl,
    savedServers,
    connectionRequested,
    showConnectionShell,
    loading,
    loadError,
    health,
    lastHealth,
    healthChecking,
    healthError,
    healthCheckedAt,
    connectionState,
    contractStatus,
    llmProfiles,
    defaultLlmProfileId,
    projects,
    reconnectNotice,
    currentServer,
    connectServer,
    toggleFavoriteServer,
    removeServer,
    refreshHealth,
    refreshProjects,
    reportTaskListSuccess,
    reportTaskListFailure,
    completeTaskListLoad
  } = useServerConnection({ onReconnect: () => threadRefreshRef.current() });
  const {
    tasks,
    selectedId,
    selectedTask,
    taskStateForServer,
    showArchived,
    activeTasks,
    archivedTasks,
    taskQuery,
    setTaskQuery,
    filteredTaskCount,
    visibleTasks,
    hasMore: hasMoreTasks,
    refresh,
    reset: resetThreads,
    selectTask,
    clearSelection,
    appendTask,
    updateTask,
    removeTaskState,
    togglePinned,
    toggleArchived: toggleTaskArchived,
    toggleArchiveScope,
    loadMore: loadMoreTasks
  } = useTaskThreads({
    serverUrl,
    connectionRequested,
    composeMode,
    onListSuccess: reportTaskListSuccess,
    onListFailure: reportTaskListFailure,
    onListComplete: completeTaskListLoad
  });
  threadRefreshRef.current = refresh;
  const {
    workflows,
    workflowLoading,
    workflowError,
    workflowSession,
    workflowBusy,
    schedules,
    scheduleLoading,
    scheduleBusy,
    scheduleOperation,
    scheduleError,
    scheduleResult,
    reset: resetAutomations,
    refreshWorkflows,
    reloadSchedules,
    clearWorkflowError,
    clearScheduleFeedback,
    discardWorkflowSession,
    startWorkflow,
    advanceWorkflow: advanceWorkflowStep,
    retreatWorkflow,
    createSchedule: createScheduleRecord,
    updateSchedule: updateScheduleRecord,
    deleteSchedule: deleteScheduleRecord,
    runScheduleNow: runScheduleRecordNow
  } = useAutomations({ serverUrl, connectionRequested, composeMode });
  const {
    entries: ledgerEntries,
    metadata: ledgerMetadata,
    loading: ledgerLoading,
    busy: ledgerBusy,
    operation: ledgerOperation,
    error: ledgerError,
    result: ledgerResult,
    reset: resetLedger,
    refresh: reloadLedger,
    clearFeedback: clearLedgerFeedback,
    createEntry: createLedgerRecord,
    runEntryNow: runLedgerRecordNow,
    deleteEntry: deleteLedgerRecord
  } = useTaskLedger({ serverUrl, connectionRequested, composeMode, standaloneView });
  const editor = useThreadEditor({
    taskId: selectedTask?.id,
    active: Boolean(selectedTask && composeMode === "thread"),
    serverUrl
  });

  useEffect(() => {
    if (!selectedTask || composeMode !== "thread") {
      setThreadFocusRequested(false);
    }
  }, [selectedTask, composeMode]);

  useEffect(() => {
    localStorage.setItem(RAIL_COLLAPSED_KEY, String(railCollapsed));
  }, [railCollapsed]);

  const { entries, status, pendingApprovals, removeApproval } = useTaskLogs(
    selectedId,
    serverUrl,
    selectedTask?.runCount || 0
  );

  const effectiveStatus = selectedTask ? status || selectedTask.status : null;
  const primaryApproval = pendingApprovals[0] || null;
  const threadBlockedByApproval = effectiveStatus === "awaiting_approval";
  const activeMode = resolveActiveMode(composeMode, Boolean(selectedTask));
  const sendLocked = !selectedTask || !isThreadIdle(effectiveStatus);
  const readinessChecks = useMemo(
    () => summarizeHealth(health, Boolean(selectedTask)),
    [health, selectedTask]
  );
  const headerModeTitle = getModeTitle(activeMode);
  const serverWorkspacePath = String(health?.paths?.workspaceRoot || "").trim() || "";
  const codeServerReady = Boolean(health?.services?.codeServer?.ready);
  const connectionCopy = formatConnectionState(connectionState);
  const hasSplitEditor = editor.hasSplit;
  const hasStackedEditor = editor.hasStacked;
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

  const applyServer = (server) => {
    const normalized = connectServer(server);
    if (!normalized) return null;
    resetThreads();
    resetAutomations();
    resetLedger();
    setComposeMode("new");
    setServerModalOpen(false);
    return normalized;
  };

  const openMode = (nextMode) => {
    setComposeMode(nextMode);
    if (nextMode !== "thread") {
      clearSelection();
    }
    clearWorkflowError();
    setRailOpen(false);
  };

  const onStarted = ({ id, goal, workspace, projectId, llmProfileId, memoryMode }) => {
    appendTask({
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
    });
    selectTask(id);
    setComposeMode("thread");
    setRailOpen(false);
  };

  const advanceWorkflow = async (input) => {
    const result = await advanceWorkflowStep(input);
    if (result?.startedTaskId) {
      await refresh();
      selectTask(result.startedTaskId);
      setComposeMode("thread");
      discardWorkflowSession();
    }
    return result;
  };

  const createScheduleEntry = (payload) => createScheduleRecord(payload);

  const updateScheduleEntry = (id, payload) => updateScheduleRecord(id, payload);

  const deleteScheduleEntry = async (id) => {
    const confirmed = window.confirm("Delete this schedule?");
    if (!confirmed) return { cancelled: true };
    return deleteScheduleRecord(id);
  };

  const runScheduleEntryNow = async (id) => {
    const result = await runScheduleRecordNow(id);
    if (result) {
      await refresh();
    }
    return result;
  };

  const createLedgerEntry = async (payload) => {
    const result = await createLedgerRecord(payload);
    if (!result) return null;
    await refresh();
    return result;
  };

  const runLedgerEntryNow = async (id) => {
    const result = await runLedgerRecordNow(id);
    if (!result) return null;
    await refresh();
    if (result.startedTaskId) {
      selectTask(result.startedTaskId);
      setComposeMode("thread");
    }
    return result;
  };

  const deleteLedgerEntry = async (id) => {
    const confirmed = window.confirm("Delete this ledger entry?");
    if (!confirmed) return { cancelled: true };
    return deleteLedgerRecord(id);
  };

  const openTaskFromLedger = async (taskId) => {
    await refresh();
    selectTask(taskId);
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
    const wasSelected = selectedId === id;
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

    removeTaskState(id);
    if (wasSelected) setComposeMode("new");
    await refresh();
  };

  const toggleArchived = (taskId) => {
    const wasSelected = selectedId === taskId;
    const nextArchived = toggleTaskArchived(taskId);
    if (wasSelected && nextArchived) setComposeMode("new");
  };

  const onRerun = async (id) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const result = await rerunTask(id);
    onStarted({
      id: result.id,
      title: task.title || task.goal,
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
    updateTask(selectedTask.id, (task) => ({
      ...task,
      status: "running",
      runCount: (task.runCount || 0) + 1,
      llmProfileId: input?.llmProfileId || task.llmProfileId,
      memoryMode: input?.memoryMode || task.memoryMode || "auto"
    }));
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

  const showThreadTranscript = () => {
    editor.showTranscript();
    setRailOpen(false);
  };

  const showThreadEditor = editor.showEditor;

  const selectThreadMobilePanel = (panel, { moveFocus = false } = {}) => {
    if (panel === "editor") editor.selectEditorPanel();
    else showThreadTranscript();

    if (moveFocus) {
      const tabId = panel === "editor" ? THREAD_EDITOR_TAB_ID : THREAD_TRANSCRIPT_TAB_ID;
      window.requestAnimationFrame(() => document.getElementById(tabId)?.focus({ preventScroll: true }));
    }
  };

  const handleThreadMobileTabKeyDown = (event, currentPanel) => {
    let nextPanel = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home") nextPanel = "transcript";
    if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End") nextPanel = "editor";
    if (!nextPanel || nextPanel === currentPanel) return;
    event.preventDefault();
    selectThreadMobilePanel(nextPanel, { moveFocus: true });
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

  const renderThreadTranscript = () => (
    <div className="transcriptStack">
      {!codeServerReady ? (
        <StateNotice
          title="Workspace editor unavailable"
          detail={health?.setupHints?.codeServer || "This server has not configured the optional thread workspace editor."}
          compact
        />
      ) : editor.busyOperation === "launch" ? (
        <StateNotice
          title="Starting workspace editor"
          detail="Ender is preparing an editor session for this thread workspace."
          busy
          compact
        />
      ) : editor.actionError?.operation === "launch" ? (
        <StateNotice
          tone="danger"
          title="Workspace editor could not start"
          detail={editor.actionError.message}
          actionLabel="Retry editor"
          onAction={editor.retryAction}
          busy={editor.busy}
          compact
        />
      ) : null}
      {primaryApproval ? (
        <ApprovalPrompt
          approval={primaryApproval}
          onApprove={(approvalId) => decideApproval(approvalId, true)}
          onDeny={(approvalId) => decideApproval(approvalId, false)}
        />
      ) : null}
      <LogViewer
        entries={entries}
        status={effectiveStatus}
        entryCount={entries.length}
        scrollToBottomToken={threadScrollToken}
      />
    </div>
  );

  const renderMainContent = () => {
    if (activeMode === "workflow") {
      return (
        <WorkflowPanel
          workflows={workflows}
          readiness={health?.workflows || {}}
          loading={workflowLoading}
          error={workflowError}
          session={workflowSession}
          busy={workflowBusy}
          onStartWorkflow={startWorkflow}
          onReload={refreshWorkflows}
          onAdvance={advanceWorkflow}
          onBack={retreatWorkflow}
          onReset={discardWorkflowSession}
        />
      );
    }

    if (activeMode === "schedule") {
      return (
        <SchedulePanel
          schedules={schedules}
          workflows={workflows}
          tasks={tasks}
          loading={scheduleLoading}
          busy={scheduleBusy}
          operation={scheduleOperation}
          error={scheduleError}
          result={scheduleResult}
          onCreate={createScheduleEntry}
          onUpdate={updateScheduleEntry}
          onDelete={deleteScheduleEntry}
          onRunNow={runScheduleEntryNow}
          onReload={reloadSchedules}
          onClearFeedback={clearScheduleFeedback}
        />
      );
    }

    if (activeMode === "ledger") {
      return (
        <TaskLedgerPanel
          entries={ledgerEntries}
          metadata={ledgerMetadata}
          loading={ledgerLoading}
          busy={ledgerBusy}
          operation={ledgerOperation}
          error={ledgerError}
          result={ledgerResult}
          serverWorkspacePath={serverWorkspacePath}
          onCreate={createLedgerEntry}
          onDelete={deleteLedgerEntry}
          onOpenIsolatedView={openLedgerStandaloneView}
          onRunNow={runLedgerEntryNow}
          onOpenTask={openTaskFromLedger}
          onReload={reloadLedger}
          onClearFeedback={clearLedgerFeedback}
        />
      );
    }

    if (selectedTask && composeMode === "thread") {
      if (hasStackedEditor) {
        return (
          <div className="threadMobileWorkspace">
            <div className="threadMobileSwitcher" role="tablist" aria-label="Thread workspace view">
              <button
                id={THREAD_TRANSCRIPT_TAB_ID}
                type="button"
                role="tab"
                aria-selected={editor.mobilePanel === "transcript"}
                aria-controls={THREAD_TRANSCRIPT_PANEL_ID}
                tabIndex={editor.mobilePanel === "transcript" ? 0 : -1}
                className={`threadSurfaceButton ${editor.mobilePanel === "transcript" ? "active" : ""}`}
                onClick={() => selectThreadMobilePanel("transcript")}
                onKeyDown={(event) => handleThreadMobileTabKeyDown(event, "transcript")}
              >
                Transcript
              </button>
              <button
                id={THREAD_EDITOR_TAB_ID}
                type="button"
                role="tab"
                aria-selected={editor.mobilePanel === "editor"}
                aria-controls={THREAD_EDITOR_PANEL_ID}
                tabIndex={editor.mobilePanel === "editor" ? 0 : -1}
                className={`threadSurfaceButton ${editor.mobilePanel === "editor" ? "active" : ""}`}
                onClick={() => selectThreadMobilePanel("editor")}
                onKeyDown={(event) => handleThreadMobileTabKeyDown(event, "editor")}
              >
                Editor
              </button>
            </div>
            {editor.mobilePanel === "editor" ? (
              <div id={THREAD_EDITOR_PANEL_ID} role="tabpanel" aria-labelledby={THREAD_EDITOR_TAB_ID}>
                <StackedThreadEditor editor={editor} workspace={selectedTask.workspace} />
              </div>
            ) : (
              <div id={THREAD_TRANSCRIPT_PANEL_ID} role="tabpanel" aria-labelledby={THREAD_TRANSCRIPT_TAB_ID}>
                {renderThreadTranscript()}
              </div>
            )}
          </div>
        );
      }

      return renderThreadTranscript();
    }

    return (
      <NewTaskForm
        onStarted={onStarted}
        serverWorkspacePath={serverWorkspacePath}
        readinessChecks={readinessChecks}
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
        connectionState={connectionState}
        onConnect={applyServer}
        onRetry={() => applyServer(currentServer || { name: "Direct endpoint", endpoint: serverUrl })}
        onToggleFavorite={toggleFavoriteServer}
        onRemove={removeServer}
      />
    );
  }

  if (standaloneView === "ledger") {
    return (
      <SimpleTaskLedgerView
        entries={ledgerEntries}
        metadata={ledgerMetadata}
        loading={ledgerLoading}
        busy={ledgerBusy}
        operation={ledgerOperation}
        error={ledgerError}
        result={ledgerResult}
        serverName={currentServer?.name || "Direct endpoint"}
        serverUrl={serverUrl}
        onCreate={createLedgerEntry}
        onOpenEntry={openEntryFromStandaloneLedger}
        onOpenFullConsole={openFullConsole}
        onReload={reloadLedger}
        onClearFeedback={clearLedgerFeedback}
      />
    );
  }

  return (
    <>
      <ServerModal
        open={serverModalOpen}
        currentEndpoint={serverUrl}
        currentServerName={currentServer?.name || "Direct endpoint"}
        servers={savedServers}
        busy={connectionState === "checking"}
        error={loadError}
        connectionState={connectionState}
        health={health}
        lastHealth={lastHealth}
        healthChecking={healthChecking}
        healthError={healthError}
        healthCheckedAt={healthCheckedAt}
        contractStatus={contractStatus}
        uiVersion={APP_VERSION}
        onClose={() => setServerModalOpen(false)}
        onConnect={applyServer}
        onRefreshHealth={refreshHealth}
        onToggleFavorite={toggleFavoriteServer}
        onRemove={removeServer}
      />

      <ApplicationShell
        railOpen={railOpen}
        railCollapsed={railCollapsed}
        hasDock={hasSplitEditor}
        reviewMode={isThreadFocusMode}
        onDismissRail={() => setRailOpen(false)}
      >
        <aside id={NAVIGATION_ID} className={`leftRail ${railOpen ? "open" : ""}`} aria-label="Ender navigation">
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
                  <h1 className="title">Ender</h1>
                </div>
              </div>
            </div>

            <PrimaryNavigation activeId={activeMode} onNavigate={openMode} />

            <section className={`railSection threadCollection ${tasks.length > 4 ? "hasSearch" : ""}`}>
              <div className="railSectionHeader">
                <div className="sectionHeading">
                  <span>{showArchived ? "Archived threads" : "Thread ledger"}</span>
                  <span className="sectionCount mono">
                    {showArchived ? archivedTasks.length : activeTasks.length}
                  </span>
                </div>
                <button
                  type="button"
                  className={`threadScopeButton ${showArchived ? "active" : ""}`}
                  aria-label={showArchived ? `Show active threads (${activeTasks.length})` : `Show archived threads (${archivedTasks.length})`}
                  onClick={toggleArchiveScope}
                >
                  {showArchived ? "Active" : "Archived"}
                </button>
              </div>
              {tasks.length > 4 ? (
                <div className="threadSearchRow">
                  <input
                    className="threadSearchInput"
                    type="search"
                    aria-label="Search threads"
                    placeholder="Search goal, status, or workspace"
                    value={taskQuery}
                    onChange={(event) => setTaskQuery(event.target.value)}
                  />
                  {taskQuery ? (
                    <button type="button" className="threadSearchClear" onClick={() => setTaskQuery("")}>
                      Clear
                    </button>
                  ) : null}
                  {taskQuery ? <span className="threadSearchCount mono">{filteredTaskCount} found</span> : null}
                </div>
              ) : null}
              <TaskList
                items={visibleTasks}
                selectedId={selectedId}
                taskState={taskStateForServer}
                hasMore={hasMoreTasks}
                loadMoreLabel={`Load more ${showArchived ? "archived" : "threads"}`}
                emptyLabel={showArchived ? "No archived threads" : "No threads on this server yet"}
                onSelect={(id) => {
                  selectTask(id);
                  setComposeMode("thread");
                  setRailOpen(false);
                }}
                onTogglePinned={togglePinned}
                onToggleArchived={toggleArchived}
                onLoadMore={loadMoreTasks}
                onTerminate={onTerminate}
                onDelete={onDelete}
                onRerun={onRerun}
              />
            </section>
          </div>
        </aside>

        <main id={MAIN_CONTENT_ID} tabIndex="-1" className={`mainPane ${isThreadFocusMode ? "reviewMode" : ""}`}>
          <header className={`mainHeader ${selectedTask && composeMode === "thread" ? "threadMode" : ""} ${isThreadFocusMode ? "reviewMode" : ""}`}>
            <div className="headerTopRow">
              <div className="headerTitleGroup">
                <button
                  type="button"
                  className="mobileRailButton"
                  aria-label="Open navigation"
                  aria-expanded={railOpen}
                  aria-controls={NAVIGATION_ID}
                  onClick={() => setRailOpen((prev) => !prev)}
                >
                  Menu
                </button>
                <div className="headerTitleCopy">
                  <div className="headerTitleLine">
                    <h2
                    className={`headerGoal ${selectedTask && composeMode === "thread" ? "threadPrompt" : ""}`}
                    title={selectedTask && composeMode === "thread" ? (selectedTask.title || selectedTask.goal) : headerModeTitle}
                    >
                      {selectedTask && composeMode === "thread" ? (selectedTask.title || selectedTask.goal) : headerModeTitle}
                    </h2>
                    {selectedTask && composeMode === "thread" ? (
                      <div className="threadHeaderContext">
                        <span className={`statusPill headerStatusPill ${getStatusTone(effectiveStatus)}`}>
                          {getStatusLabel(effectiveStatus)}
                        </span>
                        <span className="headerMetaTag headerWorkspaceTag mono" title={selectedTask.workspace || "none"}>
                          {formatPathTail(selectedTask.workspace, 3)}
                        </span>
                        {primaryApproval ? <span className="headerMetaTag attention">Approval required</span> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="headerActionColumn">
                <div className="headerActions">
                  {selectedTask && composeMode === "thread" ? (
                    <button
                      type="button"
                      className="iconButton"
                      onClick={
                        hasStackedEditor && editor.mobilePanel === "editor"
                          ? showThreadTranscript
                          : showThreadEditor
                      }
                      disabled={editor.busy || (!editor.session && !codeServerReady)}
                      title={!editor.session && !codeServerReady ? "Workspace editor unavailable on this server" : undefined}
                    >
                      {editor.busyOperation === "launch"
                        ? "Starting…"
                        : hasStackedEditor && editor.mobilePanel === "editor"
                          ? "Transcript"
                          : editor.session
                            ? "Editor"
                            : "Launch Editor"}
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
                  <button
                    type="button"
                    className={`serverTargetButton ${connectionCopy.tone}`}
                    aria-label={`Manage server ${currentServer?.name || "Direct endpoint"}, ${connectionCopy.label}`}
                    title={serverUrl}
                    onClick={() => setServerModalOpen(true)}
                  >
                    <span className="statusDot" aria-hidden="true" />
                    <span className="serverTargetName">{currentServer?.name || "Direct endpoint"}</span>
                    <span className="serverTargetState">{connectionCopy.label}</span>
                  </button>
                </div>
              </div>
            </div>
            {loadError ? (
              <StateNotice
                tone="danger"
                title="Thread sync failed"
                detail={loadError}
                actionLabel="Retry thread sync"
                onAction={refresh}
                compact
              />
            ) : reconnectNotice ? (
              <StateNotice
                tone={reconnectNotice.startsWith("Reconnected") ? "success" : "warning"}
                title={reconnectNotice.startsWith("Reconnected") ? "Connection restored" : "Connection lost"}
                detail={reconnectNotice}
                compact
              />
            ) : null}
          </header>

          <section className={`mainBody ${isThreadFocusMode ? "reviewMode" : ""}`}>{renderMainContent()}</section>
          {selectedTask && composeMode === "thread" && !(hasStackedEditor && editor.mobilePanel === "editor") ? (
            threadBlockedByApproval ? (
              <section className="threadComposer composerBlockedState">
                <span className="composerBlockedLabel">Run paused</span>
                <span className="composerBlockedMessage">Resolve the pending approval above to continue this run.</span>
              </section>
            ) : (
              <ThreadComposer
                disabled={sendLocked}
                onSend={sendNextPrompt}
                llmProfiles={llmProfiles}
                currentLlmProfileId={selectedTask.llmProfileId || defaultLlmProfileId}
                currentMemoryMode={selectedTask.memoryMode || "auto"}
              />
            )
          ) : null}
        </main>
        <DockedThreadEditor editor={editor} workspace={selectedTask?.workspace} />
      </ApplicationShell>

      <ModalThreadEditor editor={editor} workspace={selectedTask?.workspace} />
    </>
  );
}
