const { randomUUID } = require("node:crypto");

const TOOL_TITLE_OVERRIDES = {
  add_todo: "Plan work",
  file_exists: "Check file",
  file_list: "List workspace files",
  file_read: "Read file",
  file_write: "Write file",
  finalize: "Finalize response"
};

function createActivityId(prefix = "activity") {
  return `${prefix}-${randomUUID()}`;
}

function summarizeActivityValue(value, maxLength = 4000) {
  if (value === undefined || value === null) return null;
  let text;
  try {
    text = typeof value === "string"
      ? value
      : JSON.stringify(value, (key, nestedValue) => (
        /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key)$/i.test(key)
          ? "[redacted]"
          : nestedValue
      ));
  } catch {
    text = String(value);
  }
  text = text
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[redacted]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))=([^\s]+)/g, "$1=[redacted]");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function humanizeToolName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) return "Tool activity";
  if (TOOL_TITLE_OVERRIDES[normalized]) return TOOL_TITLE_OVERRIDES[normalized];
  const words = normalized.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function inferToolKind(name) {
  const normalized = String(name || "").toLowerCase();
  if (/file_(?:write|append|patch)|(?:edit|apply_patch)/.test(normalized)) return "edit";
  if (/file_(?:read|list|exists|search)|(?:find|search|grep)/.test(normalized)) return "read";
  if (/(?:exec|shell|command|terminal|test|build)/.test(normalized)) return "execute";
  if (/(?:browser|http|web|fetch)/.test(normalized)) return "fetch";
  if (/finalize/.test(normalized)) return "finalize";
  if (/(?:todo|plan)/.test(normalized)) return "plan";
  if (/git/.test(normalized)) return "repository";
  return "other";
}

function createRunPhaseEvent({ turnId, provider, phase, status = "started", step = null, label = null }) {
  return {
    kind: "run_phase",
    turnId: turnId || null,
    provider: provider || null,
    phase,
    status,
    step,
    label: label || null
  };
}

function createAssistantProgressEvent({ turnId, provider, segmentId, sequence = 0, content }) {
  return {
    kind: "assistant_progress",
    turnId: turnId || null,
    provider: provider || null,
    segmentId: segmentId || createActivityId("assistant-progress"),
    sequence,
    content: String(content || "")
  };
}

function createToolCallEvent({
  turnId,
  provider,
  toolCallId,
  toolName = null,
  title = null,
  toolKind = null,
  status = null,
  input = null,
  output = null,
  content = null,
  locations = []
}) {
  const normalizedName = toolName ? String(toolName) : null;
  return {
    kind: "tool_call",
    turnId: turnId || null,
    provider: provider || null,
    toolCallId: String(toolCallId || createActivityId("tool")),
    toolName: normalizedName,
    title: title || humanizeToolName(normalizedName),
    toolKind: toolKind || inferToolKind(normalizedName),
    status,
    input: summarizeActivityValue(input),
    output: summarizeActivityValue(output),
    content: summarizeActivityValue(content),
    locations: Array.isArray(locations)
      ? locations.slice(0, 20).map((location) => ({ path: location?.path || null, line: location?.line ?? null }))
      : []
  };
}

module.exports = {
  createActivityId,
  createAssistantProgressEvent,
  createRunPhaseEvent,
  createToolCallEvent,
  humanizeToolName,
  inferToolKind,
  summarizeActivityValue
};
