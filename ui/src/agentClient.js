const DEFAULT_API_BASE = import.meta.env.VITE_ENDER_API || "http://localhost:3000";
let currentApiBase = DEFAULT_API_BASE;

function normalizeApiBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_API_BASE;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const u = new URL(withProto);
  return `${u.protocol}//${u.host}`;
}

export function setApiBase(nextBase) {
  currentApiBase = normalizeApiBase(nextBase);
  return currentApiBase;
}

export function getApiBase() {
  return currentApiBase;
}

async function request(path, init) {
  const res = await fetch(`${currentApiBase}${path}`, init);
  if (!res.ok) {
    throw new Error(`${init?.method || "GET"} ${path} failed (${res.status})`);
  }
  return res.json();
}

export function listTasks() {
  return request("/tasks");
}

export function getHealth() {
  return request("/health");
}

export function listWorkspaces() {
  return request("/workspaces");
}

export function listDirectories(pathValue) {
  const qs = pathValue ? `?path=${encodeURIComponent(pathValue)}` : "";
  return request(`/filesystem/directories${qs}`);
}

export function getTask(id) {
  return request(`/tasks/${id}`);
}

export function startTask(goal, workspace) {
  return request("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, workspace })
  });
}

export function continueTask(id, prompt) {
  return request(`/tasks/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
}

export function resolveApproval(id, approvalId, approved) {
  return request(`/tasks/${id}/approvals/${approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved })
  });
}

export function terminateTask(id) {
  return request(`/tasks/${id}/terminate`, { method: "POST" });
}

export function deleteTask(id) {
  return request(`/tasks/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deleteWorkspace: false })
  });
}

export function deleteTaskWithOptions(id, options = {}) {
  return request(`/tasks/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deleteWorkspace: Boolean(options.deleteWorkspace)
    })
  });
}

export function rerunTask(id) {
  return request(`/tasks/${id}/rerun`, { method: "POST" });
}

export function listWorkflows() {
  return request("/workflows");
}

export function listSchedules() {
  return request("/schedules");
}

export function createSchedule(input) {
  return request("/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {})
  });
}

export function updateSchedule(id, input) {
  return request(`/schedules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {})
  });
}

export function runScheduleNow(id) {
  return request(`/schedules/${id}/run`, { method: "POST" });
}

export function deleteSchedule(id) {
  return request(`/schedules/${id}`, { method: "DELETE" });
}

export function createWorkflowSession(id) {
  return request(`/workflows/${id}/sessions`, { method: "POST" });
}

export function advanceWorkflowSession(id, input) {
  return request(`/workflow-sessions/${id}/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {})
  });
}

export function retreatWorkflowSession(id) {
  return request(`/workflow-sessions/${id}/back`, { method: "POST" });
}

export function getLogs(id, from = 0) {
  return request(`/tasks/${id}/logs?from=${from}`);
}

export function streamLogs(id, { onLog, onStatus, onComplete, onApprovalRequired, onError, onClose }) {
  const es = new EventSource(`${currentApiBase}/tasks/${id}/stream`);
  let completed = false;

  es.addEventListener("log", (ev) => {
    try {
      onLog?.(JSON.parse(ev.data));
    } catch {
      // no-op
    }
  });

  es.addEventListener("status", (ev) => {
    try {
      onStatus?.(JSON.parse(ev.data));
    } catch {
      // no-op
    }
  });

  es.addEventListener("approval_required", (ev) => {
    try {
      onApprovalRequired?.(JSON.parse(ev.data));
    } catch {
      // no-op
    }
  });

  es.addEventListener("complete", (ev) => {
    completed = true;
    try {
      onComplete?.(JSON.parse(ev.data));
    } catch {
      onComplete?.({ status: "done", result: null });
    }
    es.close();
    onClose?.();
  });

  es.addEventListener("error", (ev) => {
    try {
      onError?.(JSON.parse(ev.data));
    } catch {
      if (!completed) {
        onError?.({ t: Date.now(), level: "error", data: "stream error" });
      }
    }
  });

  es.onerror = (err) => {
    if (!completed) {
      onClose?.(err);
    }
    es.close();
  };

  return es;
}
