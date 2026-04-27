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
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    const body = await res.text();
    const preview = body.trim().slice(0, 80).replace(/\s+/g, " ");
    throw new Error(
      `${init?.method || "GET"} ${path} expected JSON from ${currentApiBase}, `
      + `but received ${contentType || "unknown content type"}`
      + (preview ? ` (${preview})` : "")
    );
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

export function listLlmProfiles() {
  return request("/llm-profiles");
}

export function listProjects(query = "") {
  const qs = query ? `?q=${encodeURIComponent(query)}` : "";
  return request(`/projects${qs}`);
}

export function createProject(input) {
  return request("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {})
  });
}

export function listMemories(input = {}) {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.scope) params.set("scope", input.scope);
  if (input.projectId) params.set("projectId", input.projectId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return request(`/memories${qs}`);
}

export function createMemory(input) {
  return request("/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {})
  });
}

export function listDirectories(pathValue) {
  const qs = pathValue ? `?path=${encodeURIComponent(pathValue)}` : "";
  return request(`/filesystem/directories${qs}`);
}

export function getTask(id) {
  return request(`/tasks/${id}`);
}

export function getTaskCodeServer(id) {
  return request(`/tasks/${id}/code-server`);
}

export function launchTaskCodeServer(id) {
  return request(`/tasks/${id}/code-server`, { method: "POST" });
}

export function stopTaskCodeServer(id) {
  return request(`/tasks/${id}/code-server`, { method: "DELETE" });
}

export function startTask(goal, workspace, options = {}) {
  return request("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal,
      workspace,
      projectId: options.projectId || null,
      llmProfileId: options.llmProfileId || null,
      memoryMode: options.memoryMode || "auto"
    })
  });
}

export function continueTask(id, input) {
  const payload = typeof input === "string"
    ? { prompt: input }
    : {
      prompt: typeof input?.prompt === "string" ? input.prompt : "",
      ...(Array.isArray(input?.content) ? { content: input.content } : {}),
      ...(input?.llmProfileId ? { llmProfileId: input.llmProfileId } : {}),
      ...(input?.memoryMode ? { memoryMode: input.memoryMode } : {})
    };

  return request(`/tasks/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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

export function listTaskLedger() {
  return request("/task-ledger");
}

export function createTaskLedgerEntry(input) {
  return request("/task-ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {})
  });
}

export function updateTaskLedgerEntry(id, input) {
  return request(`/task-ledger/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {})
  });
}

export function runTaskLedgerEntryNow(id) {
  return request(`/task-ledger/${id}/run`, { method: "POST" });
}

export function deleteTaskLedgerEntry(id) {
  return request(`/task-ledger/${id}`, { method: "DELETE" });
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

export function createWorkflowSession(id, options = {}) {
  return request(`/workflows/${id}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options || {})
  });
}

export function getWorkflowSession(id) {
  return request(`/workflow-sessions/${id}`);
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

export function streamLogs(
  id,
  { onOpen, onLog, onStatus, onComplete, onApprovalRequired, onError, onClose }
) {
  const es = new EventSource(`${currentApiBase}/tasks/${id}/stream`);
  let completed = false;

  es.onopen = () => {
    onOpen?.();
  };

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
