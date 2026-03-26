import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

const TOOL_TEXT_KEYS = ["stdout", "stderr", "output", "content", "message", "diff", "text", "result"];

function getLevelTone(level) {
  const normalized = String(level || "info").toLowerCase();
  if (normalized === "error") return "danger";
  if (normalized === "warn" || normalized === "warning") return "warning";
  if (normalized === "success") return "success";
  if (normalized === "debug") return "neutral";
  return "running";
}

function inferSource(message = "") {
  if (message.startsWith("tool call:")) return "tool";
  if (message.startsWith("tool result")) return "tool-result";
  if (message.startsWith("step ")) return "agent";
  if (message.startsWith("final:")) return "assistant";
  if (message.startsWith("goal=") || message.startsWith("workspace=") || message.startsWith("backend=")) return "context";
  if (message.includes("approval")) return "approval";
  return "system";
}

function getChatEntry(entry) {
  if (!entry?.data || typeof entry.data !== "object") return null;
  if (entry.data.kind !== "chat") return null;
  const role = entry.data.role === "assistant" ? "assistant" : "user";
  return {
    role,
    content: typeof entry.data.content === "string" ? entry.data.content : String(entry.data.content || "")
  };
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value || Date.now()));
}

function formatTimeRange(start, end) {
  const startText = formatTime(start);
  const endText = formatTime(end);
  return startText === endText ? startText : `${startText} - ${endText}`;
}

function normalizeMessage(entry) {
  if (typeof entry?.data === "string") return entry.data;
  if (entry?.data && typeof entry.data === "object") return JSON.stringify(entry.data);
  return "";
}

function tryParseJson(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function formatStructuredValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function splitToolPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { primary: formatStructuredValue(value), meta: "" };
  }

  const primaryKey = TOOL_TEXT_KEYS.find((key) => typeof value[key] === "string" && value[key].trim());
  if (!primaryKey) {
    return { primary: formatStructuredValue(value), meta: "" };
  }

  const metaEntries = Object.entries(value).filter(([key]) => key !== primaryKey);
  return {
    primary: value[primaryKey],
    meta: metaEntries.length ? JSON.stringify(Object.fromEntries(metaEntries), null, 2) : ""
  };
}

function getToolDisplay(message, source) {
  if (source === "tool") {
    const name = message.replace(/^tool call:\s*/, "").trim();
    return {
      label: name || "tool call",
      body: message || "No tool payload",
      meta: ""
    };
  }

  const match = message.match(/^tool result \(([^)]+)\):\s*([\s\S]*)$/);
  const label = match?.[1]?.trim() || "tool result";
  const body = match?.[2] ?? message;
  const parsed = tryParseJson(body);

  if (!parsed) {
    return {
      label,
      body: body || "No tool payload",
      meta: ""
    };
  }

  const { primary, meta } = splitToolPayload(parsed);
  return {
    label,
    body: primary || "No tool payload",
    meta
  };
}

function classifyEntry(entry) {
  const chatEntry = getChatEntry(entry);
  if (chatEntry) {
    return {
      kind: "chat",
      role: chatEntry.role,
      message: chatEntry.content,
      tone: chatEntry.role === "assistant" ? "running" : "neutral",
      metaLabel: String(chatEntry.role || "message").toUpperCase(),
      timestamp: entry?.t,
      entry
    };
  }

  const rawMessage = normalizeMessage(entry);
  const source = inferSource(rawMessage);
  const message = rawMessage.replace(/^final:\s*/, "");
  const tone = getLevelTone(entry.level);
  const metaLabel = `${String(entry.level || "info").toUpperCase()} · ${source}`;

  if (source === "tool" || source === "tool-result") {
    return {
      kind: "tool",
      source,
      tone,
      metaLabel,
      toolDisplay: getToolDisplay(message, source),
      timestamp: entry?.t,
      entry
    };
  }

  return {
    kind: "log",
    source,
    tone,
    metaLabel,
    message,
    timestamp: entry?.t,
    entry
  };
}

function groupEntries(entries) {
  const grouped = [];
  let toolItems = [];

  const flushTools = () => {
    if (!toolItems.length) return;
    grouped.push({
      kind: "tool-group",
      items: toolItems,
      startedAt: toolItems[0].timestamp,
      finishedAt: toolItems[toolItems.length - 1].timestamp
    });
    toolItems = [];
  };

  for (const entry of entries) {
    const item = classifyEntry(entry);
    const isHiddenAgentStep = item.kind === "log" && item.source === "agent" && /^step \d+: invoking model$/i.test(item.message);
    const isHiddenContext = item.kind === "log" && item.source === "context" && /^(backend|workspace)=/i.test(item.message);
    const isHiddenStopReason = item.kind === "log" && /^loop stop reason=/i.test(item.message);
    if (isHiddenAgentStep || isHiddenContext || isHiddenStopReason) {
      continue;
    }
    if (item.kind === "tool") {
      toolItems.push(item);
      continue;
    }
    flushTools();
    grouped.push(item);
  }

  flushTools();
  return grouped;
}

function summarizeToolGroup(items) {
  const labels = [...new Set(items.map((item) => item.toolDisplay?.label).filter(Boolean))];
  if (!labels.length) return "Tool activity";
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`;
}

function getProgressLabel(status, items) {
  if (status !== "running") return null;
  const lastItem = items[items.length - 1] || null;
  if (!lastItem) return "Waiting for assistant";
  if (lastItem.kind === "tool-group") return "Running tools";
  if (lastItem.kind === "log" && lastItem.source === "agent") return "Waiting for assistant";
  if (lastItem.kind === "chat" && lastItem.role === "user") return "Waiting for assistant";
  return "Working";
}

function extractRunDetails(entries) {
  const details = {
    backend: "",
    workspace: "",
    stopReason: ""
  };

  for (const entry of entries) {
    const message = normalizeMessage(entry);
    if (message.startsWith("backend=")) {
      details.backend = message.slice("backend=".length).trim();
      continue;
    }
    if (message.startsWith("workspace=")) {
      details.workspace = message.slice("workspace=".length).trim();
      continue;
    }
    if (message.startsWith("loop stop reason=")) {
      details.stopReason = message.slice("loop stop reason=".length).trim();
    }
  }

  return details;
}

export default function LogViewer({ entries, status, entryCount, taskId, scrollToBottomToken = 0 }) {
  const panelRef = useRef(null);
  const endRef = useRef(null);
  const groupedEntries = useMemo(() => groupEntries(entries), [entries]);
  const progressLabel = useMemo(() => getProgressLabel(status, groupedEntries), [status, groupedEntries]);
  const runDetails = useMemo(() => extractRunDetails(entries), [entries]);
  const hasRunDetails = Boolean(runDetails.backend || runDetails.workspace || runDetails.stopReason);
  const autoScrollKey = useMemo(() => {
    const lastItem = groupedEntries[groupedEntries.length - 1] || null;
    return JSON.stringify({
      entryCount,
      status,
      progressLabel,
      hasRunDetails,
      backend: runDetails.backend,
      workspace: runDetails.workspace,
      stopReason: runDetails.stopReason,
      lastKind: lastItem?.kind || null,
      lastTimestamp: lastItem?.timestamp || lastItem?.finishedAt || null
    });
  }, [entryCount, groupedEntries, hasRunDetails, progressLabel, runDetails.backend, runDetails.workspace, runDetails.stopReason, status]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const endMarker = endRef.current;
    if (!panel && !endMarker) return;

    panel?.scrollTo({ top: panel.scrollHeight, behavior: "auto" });
    endMarker?.scrollIntoView({ block: "end", inline: "nearest" });
  }, [autoScrollKey]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const endMarker = endRef.current;
    if ((!panel && !endMarker) || !scrollToBottomToken) return;

    panel?.scrollTo({ top: panel.scrollHeight, behavior: "auto" });
    endMarker?.scrollIntoView({ block: "end", inline: "nearest" });
  }, [scrollToBottomToken]);

  return (
    <section className="consolePanel logConsole">
      <div className="logConsoleHeader">
        <div className="panelChrome">
          <div className="panelLabel mono">live_transcript.panel</div>
          <div className="logPanelMeta mono">
            {taskId ? `${taskId.slice(0, 8)} · ${entryCount} lines · ${status || "idle"}` : "no thread selected"}
          </div>
        </div>
        {hasRunDetails ? (
          <details className="logRunDetails">
            <summary className="logRunDetailsSummary">
              <span className="logRunDetailsLabel mono">run_details</span>
              <span className="logToolChevron" aria-hidden="true" />
            </summary>
            <div className="logRunDetailsBody">
              {runDetails.backend ? (
                <div className="logRunDetailsRow">
                  <span className="logRunDetailsKey mono">backend</span>
                  <span className="logRunDetailsValue mono">{runDetails.backend}</span>
                </div>
              ) : null}
              {runDetails.workspace ? (
                <div className="logRunDetailsRow">
                  <span className="logRunDetailsKey mono">workspace</span>
                  <span className="logRunDetailsValue mono">{runDetails.workspace}</span>
                </div>
              ) : null}
              {runDetails.stopReason ? (
                <div className="logRunDetailsRow">
                  <span className="logRunDetailsKey mono">stop_reason</span>
                  <span className="logRunDetailsValue mono">{runDetails.stopReason}</span>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      <div
        ref={panelRef}
        className="logPanel"
      >
        {!entries.length ? (
          <div className="logEmpty">
            <div className="emptyState">No transcript events yet</div>
            <div className="panelNote">When the agent starts acting, logs, tool calls, and state transitions will stream here.</div>
          </div>
        ) : (
          <div className="logStream">
            {groupedEntries.map((item, index) => {
              if (item.kind === "tool-group") {
                const summary = summarizeToolGroup(item.items);
                const toolCount = item.items.length;
                return (
                  <div key={`tool-group-${item.startedAt || index}-${index}`} className="logRow logRowGroupedTools">
                    <div className="logRowAccent" />
                    <div className="logContent">
                      <details className="logToolGroup">
                        <summary className="logToolGroupSummary">
                          <div className="logMetaBar">
                            <span className="logMetaChip neutral mono">TOOLS · {toolCount}</span>
                            <span className="logToolGroupLabel">{summary}</span>
                          </div>
                          <span className="logToolChevron" aria-hidden="true" />
                        </summary>
                        <div className="logToolGroupBody">
                          {item.items.map((toolItem, toolIndex) => (
                            <div
                              key={`tool-item-${toolItem.timestamp || toolIndex}-${toolIndex}`}
                              className={`logToolEvent ${toolItem.source === "tool-result" ? "result" : "call"}`}
                            >
                              <div className="logMetaBar">
                                <span className={`logMetaChip ${toolItem.tone} mono`}>{toolItem.metaLabel}</span>
                                <span className="logToolLabel">{toolItem.toolDisplay.label}</span>
                              </div>
                              <pre className="logCodeBlock mono"><code>{toolItem.toolDisplay.body}</code></pre>
                              {toolItem.toolDisplay.meta ? (
                                <pre className="logCodeBlock logCodeMeta mono"><code>{toolItem.toolDisplay.meta}</code></pre>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </details>
                      <div className="logTimestamp mono">{formatTimeRange(item.startedAt, item.finishedAt)}</div>
                    </div>
                  </div>
                );
              }

              const isUserChat = item.kind === "chat" && item.role === "user";
              const messageClassName = isUserChat ? "logMessage logChatMessage user" : "logMessage";

              return (
                <div key={`${item.timestamp || index}-${index}`} className="logRow">
                  <div className="logRowAccent" />
                  <div className="logContent">
                    <div className="logMetaBar">
                      <span className={`logMetaChip ${item.tone} mono`}>{item.metaLabel}</span>
                    </div>
                    <div className={messageClassName}>{item.message || "No message payload"}</div>
                    <div className="logTimestamp mono">{formatTime(item.timestamp)}</div>
                  </div>
                </div>
              );
            })}
            {progressLabel ? (
              <div className="logRow logProgressRow">
                <div className="logRowAccent" />
                <div className="logContent">
                  <div className="logProgressIndicator">
                    <span className="logProgressDots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="logProgressLabel">{progressLabel}</span>
                  </div>
                </div>
              </div>
            ) : null}
            <div ref={endRef} className="logStreamEnd" aria-hidden="true" />
          </div>
        )}
      </div>
    </section>
  );
}
