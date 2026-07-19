import { useCallback, useEffect, useState } from "react";
import {
  advanceWorkflowSession,
  createSchedule,
  createWorkflowSession,
  deleteSchedule,
  getWorkflowSession,
  listSchedules,
  listWorkflows,
  retreatWorkflowSession,
  runScheduleNow,
  updateSchedule
} from "../agentClient";

const WORKFLOW_SESSION_KEY = "ender_workflow_sessions";

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

export function useAutomations({ serverUrl, connectionRequested, composeMode }) {
  const [workflows, setWorkflows] = useState([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowSession, setWorkflowSession] = useState(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleOperation, setScheduleOperation] = useState(null);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleResult, setScheduleResult] = useState(null);

  const reset = useCallback(() => {
    setWorkflows([]);
    setWorkflowLoading(false);
    setWorkflowError("");
    setWorkflowSession(null);
    setWorkflowBusy(false);
    setSchedules([]);
    setScheduleLoading(false);
    setScheduleBusy(false);
    setScheduleOperation(null);
    setScheduleError("");
    setScheduleResult(null);
  }, []);

  const refreshWorkflows = useCallback(async () => {
    setWorkflowLoading(true);
    setWorkflowError("");
    try {
      const data = await listWorkflows();
      const items = data.items || [];
      setWorkflows(items);
      return items;
    } catch (error) {
      setWorkflowError(error.message || "Unable to load workflows");
      return null;
    } finally {
      setWorkflowLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    if (!connectionRequested) reset();
  }, [connectionRequested, reset]);

  useEffect(() => {
    if (!connectionRequested) {
      setWorkflows([]);
      setWorkflowLoading(false);
      return undefined;
    }
    if (composeMode !== "workflow" && composeMode !== "schedule") return undefined;
    let live = true;
    setWorkflowLoading(true);
    setWorkflowError("");
    listWorkflows()
      .then((data) => {
        if (live) setWorkflows(data.items || []);
      })
      .catch((error) => {
        if (live) setWorkflowError(error.message || "Unable to load workflows");
      })
      .finally(() => {
        if (live) setWorkflowLoading(false);
      });
    return () => {
      live = false;
    };
  }, [composeMode, serverUrl, connectionRequested]);

  useEffect(() => {
    if (!connectionRequested || composeMode !== "workflow" || workflowSession) return undefined;
    const savedSessionId = getSavedWorkflowSessionId(serverUrl);
    if (!savedSessionId) return undefined;
    let live = true;
    setWorkflowLoading(true);
    getWorkflowSession(savedSessionId)
      .then((session) => {
        if (!live) return;
        setWorkflowSession(session);
        setWorkflowError("");
      })
      .catch(() => {
        if (live) saveWorkflowSessionId(serverUrl, "");
      })
      .finally(() => {
        if (live) setWorkflowLoading(false);
      });
    return () => {
      live = false;
    };
  }, [composeMode, serverUrl, workflowSession, connectionRequested]);

  useEffect(() => {
    if (!workflowSession) return;
    if (workflowSession?.mode === "interactive" && !workflowSession.startedTaskId) {
      saveWorkflowSessionId(serverUrl, workflowSession.id);
      return;
    }
    saveWorkflowSessionId(serverUrl, "");
  }, [serverUrl, workflowSession]);

  useEffect(() => {
    if (!connectionRequested) {
      setSchedules([]);
      setScheduleLoading(false);
      return undefined;
    }
    if (composeMode !== "schedule") return undefined;
    let live = true;
    setScheduleLoading(true);
    listSchedules()
      .then((data) => {
        if (!live) return;
        setSchedules(data.items || []);
        setScheduleError("");
      })
      .catch((error) => {
        if (live) setScheduleError(error.message || "Unable to load schedules");
      })
      .finally(() => {
        if (live) setScheduleLoading(false);
      });
    return () => {
      live = false;
    };
  }, [composeMode, serverUrl, connectionRequested]);

  const discardWorkflowSession = useCallback(() => {
    setWorkflowSession(null);
    setWorkflowError("");
    saveWorkflowSessionId(serverUrl, "");
  }, [serverUrl]);

  const clearWorkflowError = useCallback(() => setWorkflowError(""), []);

  const startWorkflow = useCallback(async (workflowId) => {
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const session = await createWorkflowSession(workflowId);
      setWorkflowSession(session);
      return session;
    } catch (error) {
      setWorkflowError(error.message || "Unable to start workflow");
      return null;
    } finally {
      setWorkflowBusy(false);
    }
  }, []);

  const advanceWorkflow = useCallback(async (input) => {
    if (!workflowSession) return null;
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const result = await advanceWorkflowSession(workflowSession.id, input);
      setWorkflowSession(result.session);
      return result;
    } catch (error) {
      setWorkflowError(error.message || "Workflow step failed");
      return null;
    } finally {
      setWorkflowBusy(false);
    }
  }, [workflowSession]);

  const retreatWorkflow = useCallback(async () => {
    if (!workflowSession) return null;
    setWorkflowBusy(true);
    setWorkflowError("");
    try {
      const session = await retreatWorkflowSession(workflowSession.id);
      setWorkflowSession(session);
      return session;
    } catch (error) {
      setWorkflowError(error.message || "Unable to go back");
      return null;
    } finally {
      setWorkflowBusy(false);
    }
  }, [workflowSession]);

  const refreshSchedules = useCallback(async () => {
    const data = await listSchedules();
    const items = data.items || [];
    setSchedules(items);
    return items;
  }, [serverUrl]);

  const reloadSchedules = useCallback(async () => {
    setScheduleLoading(true);
    setScheduleError("");
    try {
      return await refreshSchedules();
    } catch (error) {
      setScheduleError(error.message || "Unable to load schedules");
      return null;
    } finally {
      setScheduleLoading(false);
    }
  }, [refreshSchedules]);

  const mutateSchedule = useCallback(async (type, id, operation, fallbackMessage) => {
    setScheduleBusy(true);
    setScheduleOperation({ type, id: id || null });
    setScheduleError("");
    setScheduleResult(null);
    try {
      const result = await operation();
      await refreshSchedules();
      setScheduleResult({ type, id: id || result?.id || null, result: result || null });
      return result;
    } catch (error) {
      setScheduleError(error.message || fallbackMessage);
      if (type === "run") {
        try {
          await refreshSchedules();
        } catch {
          // Preserve the mutation error; refresh recovery remains available separately.
        }
      }
      return null;
    } finally {
      setScheduleBusy(false);
      setScheduleOperation(null);
    }
  }, [refreshSchedules]);

  return {
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
    reset,
    refreshWorkflows,
    reloadSchedules,
    clearWorkflowError,
    discardWorkflowSession,
    startWorkflow,
    advanceWorkflow,
    retreatWorkflow,
    clearScheduleFeedback: () => {
      setScheduleError("");
      setScheduleResult(null);
    },
    createSchedule: (payload) => mutateSchedule(
      "create",
      null,
      () => createSchedule(payload),
      "Unable to create schedule"
    ),
    updateSchedule: (id, payload) => mutateSchedule(
      "update",
      id,
      () => updateSchedule(id, payload),
      "Unable to update schedule"
    ),
    deleteSchedule: (id) => mutateSchedule(
      "delete",
      id,
      () => deleteSchedule(id),
      "Unable to delete schedule"
    ),
    runScheduleNow: (id) => mutateSchedule(
      "run",
      id,
      () => runScheduleNow(id),
      "Unable to run schedule"
    )
  };
}
