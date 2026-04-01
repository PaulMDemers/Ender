import { useEffect, useRef, useState } from "react";
import { getLogs, getTask, streamLogs } from "../agentClient";

function isTerminal(status) {
  return status === "done" || status === "error" || status === "canceled" || status === "terminated";
}

function getEntryKey(entry) {
  return JSON.stringify([entry?.t || 0, entry?.level || "info", entry?.data ?? ""]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt) {
  const base = 500;
  const max = 8000;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt));
  const jitter = exp * (0.2 * Math.random());
  return Math.round(exp + jitter);
}

export function useTaskLogs(taskId, apiBase, runToken) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const seenKeysRef = useRef(new Set());
  const previousTaskIdRef = useRef(null);
  const previousApiBaseRef = useRef(null);

  useEffect(() => {
    let active = true;
    let es = null;
    let reconnectAttempt = 0;

    const taskChanged = previousTaskIdRef.current !== taskId || previousApiBaseRef.current !== apiBase;
    previousTaskIdRef.current = taskId;
    previousApiBaseRef.current = apiBase;

    const syncSnapshot = async () => {
      if (!active || !taskId) return;
      try {
        const [task, logs] = await Promise.all([getTask(taskId), getLogs(taskId, 0)]);
        if (!active) return;
        if (task?.status) {
          setStatus(task.status);
          if (isTerminal(task.status)) setCompleted(true);
        }
        if (Array.isArray(task?.pendingApprovals)) {
          setPendingApprovals(task.pendingApprovals);
        }
        if (logs?.entries) {
          seenKeysRef.current = new Set(logs.entries.map(getEntryKey));
          setEntries(logs.entries);
        }
      } catch {
        // best-effort sync only
      }
    };

    const attachStream = () => {
      if (!active || !taskId) return null;
      setStreamConnected(false);

      const nextEs = streamLogs(taskId, {
        onOpen: () => {
          reconnectAttempt = 0;
          setStreamConnected(true);
        },
        onLog: (entry) => {
          const key = getEntryKey(entry);
          if (seenKeysRef.current.has(key)) return;
          seenKeysRef.current.add(key);
          setEntries((prev) => [...prev, entry]);
        },
        onStatus: (s) => {
          setStatus(s.status);
          if (s.status === "running" || s.status === "awaiting_approval") {
            setCompleted(false);
          }
          if (isTerminal(s.status)) {
            setCompleted(true);
          }
        },
        onApprovalRequired: (approval) => {
          setPendingApprovals((prev) => {
            const exists = prev.some((p) => p.id === approval.id);
            return exists ? prev : [...prev, approval];
          });
        },
        onComplete: async (payload) => {
          setCompleted(true);
          if (payload?.status) {
            setStatus(payload.status);
          }
          await syncSnapshot();
        },
        onError: (e) => {
          const nextEntry = { t: Date.now(), level: "error", data: e?.data || "stream error" };
          const key = getEntryKey(nextEntry);
          if (seenKeysRef.current.has(key)) return;
          seenKeysRef.current.add(key);
          setEntries((prev) => [...prev, nextEntry]);
        },
        onClose: async () => {
          setStreamConnected(false);
          await syncSnapshot();

          if (!active) return;
          if (completed) return;

          const delay = getBackoffDelay(reconnectAttempt);
          reconnectAttempt += 1;
          await sleep(delay);
          if (!active) return;

          if (es) {
            try {
              es.close();
            } catch {
              // ignore
            }
          }
          es = attachStream();
        }
      });

      return nextEs;
    };

    if (taskChanged) {
      seenKeysRef.current = new Set();
      setEntries([]);
      setStatus(null);
      setCompleted(false);
      setPendingApprovals([]);
      setStreamConnected(false);
    }
    if (!taskId) {
      return () => {
        active = false;
      };
    }

    es = attachStream();

    return () => {
      active = false;
      setStreamConnected(false);
      if (es) es.close();
    };
  }, [taskId, apiBase, runToken, completed]);

  const removeApproval = (approvalId) => {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  };

  return { entries, status, completed, pendingApprovals, removeApproval, streamConnected };
}
