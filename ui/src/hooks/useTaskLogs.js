import { useEffect, useState } from "react";
import { getLogs, getTask, streamLogs } from "../agentClient";

function isTerminal(status) {
  return status === "done" || status === "error" || status === "canceled" || status === "terminated";
}

export function useTaskLogs(taskId, apiBase, runToken) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  useEffect(() => {
    let active = true;

    const syncSnapshot = async () => {
      if (!active || !taskId) return;
      try {
        const [task, logs] = await Promise.all([getTask(taskId), getLogs(taskId, 0)]);
        if (!active) return;
        if (task?.status) {
          setStatus(task.status);
          if (isTerminal(task.status)) setCompleted(true);
        }
        if (logs?.entries) {
          setEntries(logs.entries);
        }
      } catch {
        // best-effort sync only
      }
    };

    setEntries([]);
    setStatus(null);
    setCompleted(false);
    setPendingApprovals([]);
    if (!taskId) return () => { active = false; };

    const es = streamLogs(taskId, {
      onLog: (entry) => setEntries((prev) => [...prev, entry]),
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
        setEntries((prev) => [
          ...prev,
          { t: Date.now(), level: "error", data: e?.data || "stream error" }
        ]);
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
