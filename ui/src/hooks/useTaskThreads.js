import { useCallback, useEffect, useMemo, useState } from "react";
import { listTasks } from "../agentClient";
import { startVisibilityAwarePolling } from "./visiblePolling";

const TASK_UI_STATE_KEY = "ender_task_ui_state";
const TASK_PAGE_SIZE = 12;

function compareTasksByNewest(a, b) {
  const aTime = new Date(a.finishedAt || a.startedAt || 0).getTime();
  const bTime = new Date(b.finishedAt || b.startedAt || 0).getTime();
  return bTime - aTime;
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

export function useTaskThreads({
  serverUrl,
  connectionRequested,
  composeMode,
  onListSuccess,
  onListFailure,
  onListComplete
}) {
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [taskUiState, setTaskUiState] = useState(() => loadTaskUiState());
  const [taskVisibleCount, setTaskVisibleCount] = useState(TASK_PAGE_SIZE);
  const [showArchived, setShowArchived] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");

  const reset = useCallback(() => {
    setTasks([]);
    setSelectedId(null);
  }, []);

  useEffect(() => {
    if (!connectionRequested) {
      onListComplete();
      reset();
      return undefined;
    }

    let live = true;
    const load = async () => {
      try {
        const data = await listTasks();
        if (!live) return;
        const items = data.items || [];
        onListSuccess();
        setTasks(items);
        setSelectedId((current) => {
          if (!current && composeMode === "thread" && items.length) {
            return [...items].sort(compareTasksByNewest)[0].id;
          }
          return current;
        });
      } catch (error) {
        if (!live) return;
        onListFailure(error);
        reset();
      } finally {
        if (live) onListComplete();
      }
    };

    const stopPolling = startVisibilityAwarePolling(load, 3000);
    return () => {
      live = false;
      stopPolling();
    };
  }, [
    serverUrl,
    composeMode,
    connectionRequested,
    onListSuccess,
    onListFailure,
    onListComplete,
    reset
  ]);

  const refresh = useCallback(async () => {
    if (!connectionRequested) return [];
    try {
      const data = await listTasks();
      onListSuccess();
      const items = data.items || [];
      setTasks(items);
      setSelectedId((current) => {
        if (!items.length) return null;
        if (current && items.some((task) => task.id === current)) return current;
        if (composeMode === "new") return null;
        return [...items].sort(compareTasksByNewest)[0].id;
      });
      return items;
    } catch (error) {
      onListFailure(error);
      reset();
      return [];
    }
  }, [connectionRequested, composeMode, onListSuccess, onListFailure, reset]);

  const selectTask = useCallback((taskId) => {
    setSelectedId(taskId || null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
  }, []);

  const appendTask = useCallback((task) => {
    setTasks((current) => [...current, task]);
  }, []);

  const updateTask = useCallback((taskId, update) => {
    setTasks((current) => current.map((task) => {
      if (task.id !== taskId) return task;
      return typeof update === "function" ? update(task) : { ...task, ...update };
    }));
  }, []);

  const patchTaskUi = useCallback((taskId, patch) => {
    setTaskUiState((current) => {
      const serverState = { ...(current[serverUrl] || {}) };
      serverState[taskId] = { ...(serverState[taskId] || {}), ...patch };
      const next = { ...current, [serverUrl]: serverState };
      saveTaskUiState(next);
      return next;
    });
  }, [serverUrl]);

  const removeTaskState = useCallback((taskId) => {
    setTaskUiState((current) => {
      if (!current[serverUrl]?.[taskId]) return current;
      const next = { ...current, [serverUrl]: { ...current[serverUrl] } };
      delete next[serverUrl][taskId];
      saveTaskUiState(next);
      return next;
    });
    setSelectedId((current) => (current === taskId ? null : current));
  }, [serverUrl]);

  const taskStateForServer = taskUiState[serverUrl] || {};

  const togglePinned = useCallback((taskId) => {
    patchTaskUi(taskId, { pinned: !taskStateForServer[taskId]?.pinned });
  }, [patchTaskUi, taskStateForServer]);

  const toggleArchived = useCallback((taskId) => {
    const nextArchived = !taskStateForServer[taskId]?.archived;
    patchTaskUi(taskId, { archived: nextArchived });
    if (nextArchived) {
      setSelectedId((current) => (current === taskId ? null : current));
    }
    return nextArchived;
  }, [patchTaskUi, taskStateForServer]);

  const toggleArchiveScope = useCallback(() => {
    setShowArchived((current) => !current);
    setSelectedId(null);
  }, []);

  const loadMore = useCallback(() => {
    setTaskVisibleCount((current) => current + TASK_PAGE_SIZE);
  }, []);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedId) || null,
    [tasks, selectedId]
  );

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

  const filteredTasks = useMemo(() => {
    const source = showArchived ? archivedTasks : activeTasks;
    const query = taskQuery.trim().toLowerCase();
    if (!query) return source;
    return source.filter((task) => [
      task.goal,
      task.id,
      task.status,
      task.workspace,
      task.projectId,
      task.llmProfileId
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [showArchived, archivedTasks, activeTasks, taskQuery]);

  const visibleTasks = useMemo(
    () => filteredTasks.slice(0, taskVisibleCount),
    [filteredTasks, taskVisibleCount]
  );

  useEffect(() => {
    setTaskVisibleCount(TASK_PAGE_SIZE);
  }, [showArchived, serverUrl, tasks.length, taskQuery]);

  useEffect(() => {
    setTaskQuery("");
  }, [serverUrl]);

  return {
    tasks,
    selectedId,
    selectedTask,
    taskStateForServer,
    showArchived,
    activeTasks,
    archivedTasks,
    taskQuery,
    setTaskQuery,
    filteredTaskCount: filteredTasks.length,
    visibleTasks,
    hasMore: filteredTasks.length > visibleTasks.length,
    refresh,
    reset,
    selectTask,
    clearSelection,
    appendTask,
    updateTask,
    removeTaskState,
    togglePinned,
    toggleArchived,
    toggleArchiveScope,
    loadMore
  };
}
