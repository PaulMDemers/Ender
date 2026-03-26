import { useEffect, useRef, useState } from "react";
import { getLogs, getTask, streamLogs } from "../agentClient";

function isTerminal(status) {
  return status === "done" || status === "error" || status === "canceled" || status === "terminated";
}

function getEntryKey(entry) {
  return JSON.stringify([entry?.t || 0, entry?.level || "info", entry?.data ?? ""]);
}

export function useTaskLogs(taskId, apiBase, runToken) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const seenKeysRef = useRef(new Set());
  const previousTaskIdRef = useRef(null);
  const previousApiBaseRef = useRef(null);

  useEffect(() => {
    let active = true;
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

    if (taskChanged) {
      seenKeysRef.current = new Set();
      setEntries([]);
      setStatus(null);
      setCompleted(false);
      setPendingApprovals([]);
    }
    if (!taskId) return () => { active = false; };

    const es = streamLogs(taskId, {
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
        await syncSnapshot();
      }
    });

    return () => {
      active = false;
      es.close();
    };
  }, [taskId, apiBase, runToken]);

  const removeApproval = (approvalId) => {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  };

  return { entries, status, completed, pendingApprovals, removeApproval };
}
