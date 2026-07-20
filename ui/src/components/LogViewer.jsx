import { useLayoutEffect, useMemo, useRef, useState } from "react";
import StateNotice from "./ui/StateNotice";

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
  if (message.startsWith("tool result") || message.startsWith("tool error")) return "tool-result";
  if (message.startsWith("tool call status:")) return "tool-status";
  if (message.startsWith("agent:")) return "agent";
  if (message.startsWith("step ")) return "model";
  if (message.startsWith("final:")) return "assistant";
  if (message.startsWith("goal=") || message.startsWith("workspace=") || message.startsWith("backend=")) return "context";
  if (message.includes("approval")) return "approval";
  return "system";
}

function isConversationEntry(item) {
  if (item.kind === "chat") return true;
  if (item.kind === "progress" || item.kind === "plan") return true;
  if (item.kind === "tool-group") return true;
  if (item.source === "approval") return true;
  return item.tone === "danger" || item.tone === "warning";
}

function getChatEntry(entry) {
  if (!entry?.data || typeof entry.data !== "object") return null;
  if (entry.data.kind !== "chat") return null;
  const role = entry.data.role === "assistant" ? "assistant" : "user";
  return {
    role,
    content: Object.prototype.hasOwnProperty.call(entry.data, "content") ? entry.data.content : ""
  };
}

function formatTime(value, { includeSeconds = true } = {}) {
  const options = {
    hour: "2-digit",
    minute: "2-digit"
  };
  if (includeSeconds) options.second = "2-digit";
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value || Date.now()));
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

  const match = message.match(/^tool (?:result|error) \(([^)]+)\):\s*([\s\S]*)$/);
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

  if (entry?.data?.kind === "assistant_progress") {
    return {
      kind: "progress",
      source: "agent",
      tone: "running",
      message: String(entry.data.content || ""),
      segmentId: entry.data.segmentId || null,
      turnId: entry.data.turnId || null,
      provider: entry.data.provider || null,
      sequence: Number(entry.data.sequence || 0),
      timestamp: entry?.t,
      entry
    };
  }

  if (entry?.data?.kind === "run_phase") {
    const step = Number(entry.data.step || 0);
    const phase = String(entry.data.phase || "working");
    const provider = String(entry.data.provider || "model");
    return {
      kind: "log",
      source: "model",
      tone: "neutral",
      metaLabel: step ? `MODEL · request ${step}` : "MODEL",
      message: entry.data.label || (phase === "thinking" ? `Requesting the next action from ${provider}` : `${phase.replaceAll("_", " ")} · ${entry.data.status || "updated"}`),
      turnId: entry.data.turnId || null,
      timestamp: entry?.t,
      entry
    };
  }

  if (entry?.data?.kind === "approval") {
    const action = entry.data.action === "denied" ? "denied" : "granted";
    return {
      kind: "log",
      source: "approval",
      tone: action === "denied" ? "warning" : "success",
      metaLabel: `PERMISSION · ${action}`,
      message: `${action === "denied" ? "Permission denied" : "Permission granted"}: ${entry.data.title || entry.data.type || "requested action"}`,
      timestamp: entry?.t,
      entry
    };
  }

  if (entry?.data?.kind === "plan") {
    return {
      kind: "plan",
      source: "agent",
      tone: "running",
      entries: Array.isArray(entry.data.entries) ? entry.data.entries : [],
      turnId: entry.data.turnId || null,
      timestamp: entry?.t,
      entry
    };
  }

  if (entry?.data?.kind === "tool_call") {
    const status = entry.data.status || null;
    const details = {
      status,
      kind: entry.data.toolKind || null,
      input: entry.data.input || null,
      output: entry.data.output || entry.data.content || null,
      locations: entry.data.locations || []
    };
    return {
      kind: "tool",
      source: status === "completed" || status === "failed" ? "tool-result" : "tool",
      tone: status === "failed" ? "warning" : status === "completed" ? "success" : "running",
      metaLabel: `TOOL · ${status ? status.replaceAll("_", " ") : "updated"}`,
      structured: true,
      toolCallId: entry.data.toolCallId,
      toolName: entry.data.toolName || null,
      toolKind: entry.data.toolKind || null,
      toolStatus: status,
      turnId: entry.data.turnId || null,
      provider: entry.data.provider || null,
      toolDisplay: {
        label: entry.data.title || entry.data.toolKind || "Tool activity",
        body: details.output || details.input || "No additional details",
        meta: JSON.stringify(details, null, 2)
      },
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
    const failed = /^tool error/i.test(message) || tone === "danger";
    return {
      kind: "tool",
      source,
      tone: failed ? "warning" : tone,
      metaLabel: failed ? "TOOL · failed" : metaLabel,
      toolStatus: failed ? "failed" : source === "tool-result" ? "completed" : "in_progress",
      legacy: true,
      toolDisplay: getToolDisplay(message, source),
      timestamp: entry?.t,
      entry
    };
  }

  if (source === "agent") {
    return {
      kind: "progress",
      source,
      tone: "running",
      message: rawMessage.replace(/^agent:\s?/, ""),
      segmentId: null,
      sequence: 0,
      legacy: true,
      timestamp: entry?.t,
      entry
    };
  }

  if (source === "model") {
    const stepMatch = rawMessage.match(/^step\s+(\d+):\s*invoking model$/i);
    return {
      kind: "log",
      source,
      tone: "neutral",
      metaLabel: stepMatch ? `MODEL · request ${stepMatch[1]}` : "MODEL",
      message: "Requesting the next action from the model",
      timestamp: entry?.t,
      entry
    };
  }

  if (source === "approval") {
    const legacyResolution = rawMessage.match(/^approval\s+(granted|denied)(?:\s+\([^)]+\))?/i);
    if (legacyResolution) {
      const action = legacyResolution[1].toLowerCase();
      return {
        kind: "log",
        source,
        tone: action === "denied" ? "warning" : "success",
        metaLabel: `PERMISSION · ${action}`,
        message: action === "denied" ? "Permission denied" : "Permission granted",
        timestamp: entry?.t,
        entry
      };
    }
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
  let progressItem = null;
  let legacyToolSequence = 0;
  const pendingLegacyTools = new Map();

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

  const flushProgress = () => {
    if (!progressItem) return;
    grouped.push(progressItem);
    progressItem = null;
  };

  for (const entry of entries) {
    let item = classifyEntry(entry);
    const isHiddenContext = item.kind === "log" && item.source === "context" && /^(backend|workspace)=/i.test(item.message);
    const isHiddenStopReason = item.kind === "log" && /^loop stop reason=/i.test(item.message);
    const isHiddenToolArgs = item.kind === "log" && /^tool args \(/i.test(item.message);
    const isUndefinedLegacyToolStatus = item.kind === "log" && item.source === "tool-status" && /:\s*undefined\s*$/i.test(item.message);
    if (isHiddenContext || isHiddenStopReason || isHiddenToolArgs || isUndefinedLegacyToolStatus) {
      continue;
    }
    if (item.kind === "progress") {
      flushTools();
      const sameStructuredSegment = progressItem?.segmentId && item.segmentId === progressItem.segmentId;
      const adjacentLegacySegment = progressItem?.legacy && item.legacy
        && Number(item.timestamp || 0) - Number(progressItem.finishedAt || progressItem.timestamp || 0) < 2000;
      if (progressItem && (sameStructuredSegment || adjacentLegacySegment)) {
        progressItem.message += item.message;
        progressItem.finishedAt = item.timestamp;
      } else {
        flushProgress();
        progressItem = { ...item, finishedAt: item.timestamp };
      }
      continue;
    }
    if (item.kind === "tool") {
      flushProgress();
      if (item.legacy) {
        const label = item.toolDisplay?.label || "tool";
        if (item.source === "tool") {
          const toolCallId = `legacy-tool-${legacyToolSequence++}`;
          const queue = pendingLegacyTools.get(label) || [];
          queue.push(toolCallId);
          pendingLegacyTools.set(label, queue);
          item = { ...item, toolCallId };
        } else {
          const queue = pendingLegacyTools.get(label) || [];
          const toolCallId = queue.shift() || `legacy-tool-${legacyToolSequence++}`;
          pendingLegacyTools.set(label, queue);
          item = { ...item, toolCallId };
        }
      }
      toolItems.push(item);
      continue;
    }
    flushProgress();
    flushTools();
    grouped.push(item);
  }

  flushProgress();
  flushTools();
  return grouped;
}

function latestToolStates(items) {
  const states = new Map();
  for (const item of items) {
    const key = item.toolCallId || `${item.toolDisplay?.label}-${item.timestamp}`;
    states.set(key, item);
  }
  return [...states.values()];
}

function cleanTurnFinal(activityItems, finalItem) {
  const progressItems = activityItems.filter((item) => item.kind === "progress");
  const combinedProgress = progressItems.map((item) => String(item.message || "")).join("");
  const finalText = String(finalItem.message || "");
  if (combinedProgress && finalText.startsWith(combinedProgress)) {
    const remainder = finalText.slice(combinedProgress.length).trim();
    if (remainder) {
      return { activityItems, finalItem: { ...finalItem, message: remainder } };
    }
    const lastProgressIndex = activityItems.findLastIndex((item) => item.kind === "progress");
    if (lastProgressIndex >= 0) {
      return {
        activityItems: activityItems.filter((_, index) => index !== lastProgressIndex),
        finalItem: { ...finalItem, message: activityItems[lastProgressIndex].message }
      };
    }
  }

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const matchingProgressIndex = activityItems.findLastIndex((item) => (
    item.kind === "progress" && normalize(item.message) === normalize(finalText)
  ));
  return {
    activityItems: matchingProgressIndex >= 0
      ? activityItems.filter((_, index) => index !== matchingProgressIndex)
      : activityItems,
    finalItem
  };
}

function getItemStart(item) {
  return item.startedAt || item.timestamp || item.finishedAt || null;
}

function getItemEnd(item) {
  return item.finishedAt || item.timestamp || item.startedAt || null;
}

function buildConversationEntries(groupedEntries) {
  const conversation = [];
  let activityItems = [];

  const flushActivity = (completed = false) => {
    const meaningfulItems = activityItems.filter(isConversationEntry);
    activityItems = [];
    if (!meaningfulItems.length) return;
    conversation.push({
      kind: "work-summary",
      items: meaningfulItems,
      completed,
      startedAt: getItemStart(meaningfulItems[0]),
      finishedAt: getItemEnd(meaningfulItems[meaningfulItems.length - 1]),
      turnId: meaningfulItems.find((item) => item.turnId)?.turnId || null
    });
  };

  for (const item of groupedEntries) {
    if (item.kind === "chat" && item.role === "user") {
      flushActivity(false);
      conversation.push(item);
      continue;
    }

    if (item.kind === "chat" && item.role === "assistant") {
      const cleaned = cleanTurnFinal(activityItems.filter(isConversationEntry), item);
      activityItems = cleaned.activityItems;
      flushActivity(true);
      conversation.push(cleaned.finalItem);
      continue;
    }

    activityItems.push(item);
  }

  flushActivity(false);
  return conversation;
}

function summarizeToolGroup(items) {
  const labels = [...new Set(items.map((item) => item.toolDisplay?.label).filter(Boolean))];
  if (!labels.length) return "Tool activity";
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`;
}

function summarizeToolStates(items) {
  const latest = latestToolStates(items);
  const counts = latest.reduce((summary, item) => {
    const status = item.toolStatus || "updated";
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
  const parts = [
    counts.in_progress ? `${counts.in_progress} running` : null,
    counts.pending ? `${counts.pending} pending` : null,
    counts.completed ? `${counts.completed} completed` : null,
    counts.failed ? `${counts.failed} failed` : null
  ].filter(Boolean);
  return { latest, text: parts.join(" · ") || "Activity updated" };
}

function getWorkToolItems(workItem) {
  return workItem.items
    .filter((item) => item.kind === "tool-group")
    .flatMap((item) => item.items);
}

function getToolCategory(toolItem) {
  const identity = `${toolItem.toolName || ""} ${toolItem.toolKind || ""} ${toolItem.toolDisplay?.label || ""}`.toLowerCase();
  if (/(?:file_write|write file|apply.?patch|\bedit\b)/.test(identity)) return "write";
  if (/(?:file_read|file_list|file_exists|read file|list workspace|check file|search|find|grep)/.test(identity)) return "inspect";
  if (/(?:add_todo|\bplan\b)/.test(identity)) return "plan";
  if (/(?:finalize|final response)/.test(identity)) return "finalize";
  if (/(?:browser|http|fetch|snapshot|web)/.test(identity)) return "verify";
  if (/(?:exec|shell|command|terminal|\btest\b|\bbuild\b)/.test(identity)) return "execute";
  if (/git/.test(identity)) return "repository";
  return `other:${toolItem.toolDisplay?.label || "Tool activity"}`;
}

function getToolActionLabel(toolItem, { completed = false } = {}) {
  const category = getToolCategory(toolItem);
  if (category === "write") return completed ? "Wrote project files" : "Writing project files";
  if (category === "inspect") return completed ? "Inspected the workspace" : "Inspecting the workspace";
  if (category === "plan") return completed ? "Planned the work" : "Planning the work";
  if (category === "finalize") return completed ? "Finalized the response" : "Finalizing the response";
  if (category === "verify") return completed ? "Checked the results" : "Checking the results";
  if (category === "execute") return completed ? "Ran commands" : "Running commands";
  if (category === "repository") return completed ? "Reviewed the repository" : "Reviewing the repository";
  return toolItem.toolDisplay?.label || "Working";
}

function summarizeWorkMilestones(workItem) {
  const latestTools = latestToolStates(getWorkToolItems(workItem));
  const categories = new Map();
  for (const toolItem of latestTools) {
    const category = getToolCategory(toolItem);
    const current = categories.get(category) || { category, count: 0, failed: 0, sample: toolItem };
    current.count += 1;
    if (toolItem.toolStatus === "failed") current.failed += 1;
    current.sample = toolItem;
    categories.set(category, current);
  }

  const priority = { write: 0, verify: 1, execute: 2, repository: 3, inspect: 4, plan: 5, finalize: 6 };
  return [...categories.values()].map((entry) => {
    let label = getToolActionLabel(entry.sample, { completed: true });
    if (entry.category === "write" && entry.count > 1) label = `Wrote ${entry.count} files`;
    if (entry.category === "execute" && entry.count > 1) label = `Ran ${entry.count} commands`;
    if (entry.category.startsWith("other:") && entry.count > 1) label = `${entry.sample.toolDisplay?.label || "Tool activity"} · ${entry.count}`;
    return {
      ...entry,
      label,
      status: entry.failed ? "warning" : "completed"
    };
  }).sort((left, right) => (priority[left.category] ?? 7) - (priority[right.category] ?? 7));
}

function formatWorkDuration(start, end) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "";
  const seconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function summarizeWork(workItem, status, isLatest) {
  const milestones = summarizeWorkMilestones(workItem);
  const latestTools = latestToolStates(getWorkToolItems(workItem));
  const actionCount = latestTools.length;
  const failedCount = latestTools.filter((item) => item.toolStatus === "failed").length;
  const latestToolEvent = getWorkToolItems(workItem).at(-1) || null;
  const lastItem = workItem.items[workItem.items.length - 1] || null;
  const isActive = !workItem.completed && isLatest && (status === "running" || status === "awaiting_approval");

  let label = workItem.completed ? "Work complete" : "Work update";
  let headline = milestones.length
    ? `${milestones.slice(0, 2).map((entry) => entry.label).join(" · ")}${milestones.length > 2 ? ` · +${milestones.length - 2}` : ""}`
    : "Completed requested work";

  if (isActive) {
    label = status === "awaiting_approval" ? "Waiting" : latestToolEvent?.toolStatus === "failed" ? "Needs attention" : "Working";
    if (status === "awaiting_approval") {
      headline = "Waiting for approval";
    } else if (lastItem?.kind === "tool-group") {
      const activeTool = [...latestToolStates(lastItem.items)].reverse().find((item) => item.toolStatus === "in_progress" || item.toolStatus === "pending");
      const latestTool = activeTool || latestToolStates(lastItem.items).at(-1);
      headline = latestTool ? getToolActionLabel(latestTool) : "Checking the results";
    } else if (lastItem?.kind === "progress") {
      headline = lastItem.message || "Working";
    } else if (lastItem?.kind === "plan") {
      headline = lastItem.entries?.find((entry) => entry.status === "in_progress")?.content || "Planning the work";
    } else if (lastItem?.source === "approval") {
      headline = lastItem.message;
    }
  } else if (!workItem.completed && failedCount) {
    label = "Needs attention";
  }

  const meta = [
    actionCount ? `${actionCount} ${actionCount === 1 ? "action" : "actions"}` : null,
    formatWorkDuration(workItem.startedAt, workItem.finishedAt)
  ].filter(Boolean).join(" · ");

  return { actionCount, failedCount, headline, isActive, label, meta, milestones, latestTools };
}

function getProgressLabel(status, items) {
  if (status === "awaiting_approval") return "Waiting for approval";
  if (status !== "running") return null;
  const lastItem = items[items.length - 1] || null;
  if (!lastItem) return "Waiting for assistant";
  if (lastItem.kind === "tool-group") {
    const latest = latestToolStates(lastItem.items);
    const active = [...latest].reverse().find((item) => item.toolStatus === "in_progress" || item.toolStatus === "pending");
    const failed = [...latest].reverse().find((item) => item.toolStatus === "failed");
    if (active) return active.toolDisplay?.label || "Running tools";
    if (failed) return `Recovering after ${failed.toolDisplay?.label || "a failed tool"}`;
    return "Checking the results";
  }
  if (lastItem.kind === "plan") {
    const activePlanItem = lastItem.entries?.find((entry) => entry.status === "in_progress");
    return activePlanItem?.content || "Planning work";
  }
  if (lastItem.kind === "progress") return "Working";
  if (lastItem.source === "model") return "Thinking";
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

function isLikelyJsonBlock(value) {
  const parsed = tryParseJson(value);
  return parsed !== null;
}

function renderInline(text) {
  const value = String(text || "");
  if (!value) return null;

  const parts = [];
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    parts.push(<code key={`inline-${key++}`} className="threadInlineCode mono">{match[1]}</code>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return parts.map((part, index) => (typeof part === "string" ? <span key={`text-${index}`}>{part}</span> : part));
}

function renderMarkdownBlocks(content) {
  const source = String(content || "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^```([^`]*)$/);
    if (fenceMatch) {
      const language = fenceMatch[1].trim();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /^```\s*$/.test(lines[i])) {
        i += 1;
      }
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const level = Math.min(6, line.match(/^#+/)[0].length);
      blocks.push({ type: "heading", level, content: line.replace(/^#{1,6}\s+/, "") });
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```([^`]*)$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", content: paragraphLines.join("\n") });
  }

  if (!blocks.length && source.trim()) {
    return [{ type: "paragraph", content: source.trim() }];
  }

  return blocks;
}

function renderStringMessage(content, compact) {
  const blocks = renderMarkdownBlocks(content);
  const onlyJson = isLikelyJsonBlock(content);

  if (onlyJson) {
    const parsed = tryParseJson(content);
    return (
      <pre className={`threadCodeBlock mono ${compact ? "compact" : ""}`.trim()}>
        <code>{JSON.stringify(parsed, null, 2)}</code>
      </pre>
    );
  }

  return blocks.map((block, index) => {
    if (block.type === "heading") {
      const Tag = `h${block.level}`;
      return <Tag key={`heading-${index}`} className={`threadHeading threadHeading${block.level}`}>{renderInline(block.content)}</Tag>;
    }
    if (block.type === "list") {
      return (
        <ul key={`list-${index}`} className="threadList">
          {block.items.map((item, itemIndex) => (
            <li key={`list-item-${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }
    if (block.type === "code") {
      return (
        <div key={`code-${index}`} className="threadCodeWrap">
          {block.language ? <div className="threadCodeLabel mono">{block.language}</div> : null}
          <pre className={`threadCodeBlock mono ${compact ? "compact" : ""}`.trim()}>
            <code>{block.content}</code>
          </pre>
        </div>
      );
    }
    return <p key={`paragraph-${index}`} className="threadParagraph">{renderInline(block.content)}</p>;
  });
}

function renderStructuredPart(part, index, compact) {
  if (!part || typeof part !== "object") {
    return (
      <pre key={`part-${index}`} className={`threadCodeBlock mono ${compact ? "compact" : ""}`.trim()}>
        <code>{formatStructuredValue(part)}</code>
      </pre>
    );
  }

  if (part.type === "text") {
    return (
      <div key={`part-${index}`} className="threadAttachmentText">
        {renderStringMessage(part.text || "", compact)}
      </div>
    );
  }

  if (part.type === "image_url") {
    const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    if (!imageUrl) return null;

    return (
      <figure key={`part-${index}`} className="threadAttachmentFigure">
        <img className="threadAttachmentImage" src={imageUrl} alt={`Attached image ${index + 1}`} loading="lazy" />
      </figure>
    );
  }

  return (
    <pre key={`part-${index}`} className={`threadCodeBlock mono ${compact ? "compact" : ""}`.trim()}>
      <code>{formatStructuredValue(part)}</code>
    </pre>
  );
}

function RichMessage({ content, className = "", compact = false, showRaw = false }) {
  const isStructured = Array.isArray(content);
  const rawValue = useMemo(() => {
    if (Array.isArray(content)) {
      return JSON.stringify(content, null, 2);
    }
    return String(content || "");
  }, [content]);

  return (
    <div className={`threadRichMessage ${className}`.trim()}>
      {showRaw ? (
        <pre className={`threadCodeBlock mono ${compact ? "compact" : ""}`.trim()}>
          <code>{rawValue}</code>
        </pre>
      ) : isStructured ? (
        content.map((part, index) => renderStructuredPart(part, index, compact))
      ) : (
        renderStringMessage(rawValue, compact)
      )}
    </div>
  );
}

function ChatRow({ item, messageClassName, isUserChat, showAllEvents }) {
  const [showRaw, setShowRaw] = useState(false);
  const actionsRef = useRef(null);
  const rawToggleLabel = Array.isArray(item.message) ? "raw payload" : "raw markdown";
  const roleLabel = isUserChat ? "You" : "Assistant";

  const toggleRaw = () => {
    setShowRaw((value) => !value);
    actionsRef.current?.removeAttribute("open");
  };

  return (
    <>
      <div className="chatMessageHeader">
        <div className="chatIdentity">
          <span className={`chatRole ${item.tone}`}>{roleLabel}</span>
          <span className="chatTimestamp mono">
            {formatTime(item.timestamp, { includeSeconds: showAllEvents })}
          </span>
        </div>
        <details
          ref={actionsRef}
          className="messageActions"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              event.currentTarget.removeAttribute("open");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.removeAttribute("open");
              actionsRef.current?.querySelector("summary")?.focus();
            }
          }}
        >
          <summary
            className="messageActionsToggle"
            aria-label={`${roleLabel} message actions`}
            title={`${roleLabel} message actions`}
          >
            <span aria-hidden="true">•••</span>
          </summary>
          <div className="messageActionsMenu">
          <button
            type="button"
            className="messageActionsItem"
            onClick={toggleRaw}
            aria-pressed={showRaw}
          >
            {showRaw ? "Show rendered" : `View ${rawToggleLabel}`}
          </button>
          </div>
        </details>
      </div>
      <div className={messageClassName}>
        <RichMessage content={item.message || ""} compact={isUserChat} showRaw={showRaw} />
      </div>
    </>
  );
}

function ToolEventCard({ toolItem }) {
  return (
    <div className={`logToolEvent ${toolItem.source === "tool-result" ? "result" : "call"}`}>
      <div className="logMetaBar">
        <span className={`logMetaChip ${toolItem.tone} mono`}>{toolItem.metaLabel}</span>
        <span className="logToolLabel">{toolItem.toolDisplay.label}</span>
      </div>
      <pre className="logCodeBlock mono"><code>{toolItem.toolDisplay.body}</code></pre>
      {toolItem.toolDisplay.meta ? (
        <pre className="logCodeBlock logCodeMeta mono"><code>{toolItem.toolDisplay.meta}</code></pre>
      ) : null}
    </div>
  );
}

function WorkSummaryRow({ item, status, isLatest }) {
  const summary = summarizeWork(item, status, isLatest);
  const progressItems = item.items.filter((entry) => entry.kind === "progress");
  const latestPlan = item.items.findLast((entry) => entry.kind === "plan");
  const approvalItems = item.items.filter((entry) => entry.source === "approval");
  const statusTone = summary.failedCount ? "warning" : item.completed ? "success" : "running";

  return (
    <div className="logRow logRowWorkSummary">
      <div className="logRowAccent" />
      <div className="logContent">
        {summary.isActive ? <span className="visuallyHidden" role="status" aria-live="polite">{summary.headline}</span> : null}
        <details className="logWorkSummary">
          <summary className="logWorkSummaryHeader">
            <span className={`logMetaChip ${statusTone} mono`}>{summary.label}</span>
            <span className="logWorkSummaryHeadline">{summary.headline}</span>
            {summary.meta ? <span className="logWorkSummaryMeta mono">{summary.meta}</span> : null}
            <span className="logToolChevron" aria-hidden="true" />
          </summary>
          <div className="logWorkSummaryBody">
            {progressItems.length ? (
              <div className="logWorkNarrativeList" aria-label="Assistant progress">
                {progressItems.map((progressItem, index) => (
                  <div key={`work-progress-${progressItem.segmentId || progressItem.timestamp || index}`} className="logWorkNarrative">
                    <span className="logWorkMilestoneMarker" aria-hidden="true" />
                    <RichMessage content={progressItem.message || ""} compact />
                  </div>
                ))}
              </div>
            ) : null}

            {latestPlan?.entries?.length ? (
              <div className="logWorkPlan">
                <span className="logWorkBodyLabel mono">Plan</span>
                <ol className="logPlanList">
                  {latestPlan.entries.map((entry, index) => (
                    <li key={`${entry.content}-${index}`} className={entry.status}>{entry.content}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {summary.milestones.length ? (
              <div className="logWorkMilestones" aria-label="Work milestones">
                {summary.milestones.map((milestone) => (
                  <div key={milestone.category} className={`logWorkMilestone ${milestone.status}`}>
                    <span className="logWorkMilestoneMarker" aria-hidden="true" />
                    <span>{milestone.label}</span>
                    {milestone.failed ? <span className="logWorkMilestoneState mono">{milestone.failed} failed</span> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {approvalItems.map((approvalItem, index) => (
              <div key={`work-approval-${approvalItem.timestamp || index}`} className={`logWorkApproval ${approvalItem.tone}`}>
                <span className="logWorkBodyLabel mono">Permission</span>
                <span>{approvalItem.message}</span>
              </div>
            ))}

            {summary.latestTools.length ? (
              <details className="logWorkToolsDisclosure">
                <summary>Inspect {summary.actionCount} tool {summary.actionCount === 1 ? "action" : "actions"}</summary>
                <div className="logWorkToolDetails">
                  {summary.latestTools.map((toolItem, index) => (
                    <ToolEventCard key={`work-tool-${toolItem.toolCallId || toolItem.timestamp || index}`} toolItem={toolItem} />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

export default function LogViewer({ entries, status, entryCount, scrollToBottomToken = 0 }) {
  const panelRef = useRef(null);
  const endRef = useRef(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showRunDetails, setShowRunDetails] = useState(false);
  const groupedEntries = useMemo(() => groupEntries(entries), [entries]);
  const conversationEntries = useMemo(() => buildConversationEntries(groupedEntries), [groupedEntries]);
  const visibleEntries = showAllEvents ? groupedEntries : conversationEntries;
  const hiddenEntryCount = groupedEntries.length - conversationEntries.length;
  const conversationMessageCount = conversationEntries.filter((item) => item.kind === "chat").length;
  const conversationUpdateCount = conversationEntries.filter((item) => item.kind !== "chat").length;
  const progressLabel = useMemo(() => getProgressLabel(status, groupedEntries), [status, groupedEntries]);
  const hasActiveWorkSummary = conversationEntries.some((item) => item.kind === "work-summary" && !item.completed);
  const runDetails = useMemo(() => extractRunDetails(entries), [entries]);
  const hasRunDetails = Boolean(runDetails.backend || runDetails.workspace || runDetails.stopReason);
  const autoScrollKey = useMemo(() => {
    const lastItem = visibleEntries[visibleEntries.length - 1] || null;
    return JSON.stringify({
      entryCount,
      status,
      progressLabel,
      hasRunDetails,
      backend: runDetails.backend,
      workspace: runDetails.workspace,
      stopReason: runDetails.stopReason,
      showAllEvents,
      lastKind: lastItem?.kind || null,
      lastTimestamp: lastItem?.timestamp || lastItem?.finishedAt || null
    });
  }, [entryCount, hasRunDetails, progressLabel, runDetails.backend, runDetails.workspace, runDetails.stopReason, showAllEvents, status, visibleEntries]);

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
    <section className={`logConsole ${showAllEvents ? "activityMode" : "conversationMode"}`} aria-label="Thread transcript">
      <div className="logConsoleHeader">
        <div className="logConsoleMetaRow">
          <div className="logConsoleMetaGroup">
            <span className="logPanelMeta">
              {showAllEvents
                ? `${groupedEntries.length} activity ${groupedEntries.length === 1 ? "item" : "items"}`
                : `${conversationMessageCount} ${conversationMessageCount === 1 ? "message" : "messages"}${conversationUpdateCount ? ` · ${conversationUpdateCount} ${conversationUpdateCount === 1 ? "update" : "updates"}` : ""}`}
            </span>
            {!showAllEvents && hiddenEntryCount > 0 ? (
              <button type="button" className="logFilterButton" onClick={() => setShowAllEvents(true)}>
                Show {hiddenEntryCount} activity {hiddenEntryCount === 1 ? "item" : "items"}
              </button>
            ) : null}
          </div>
          <div className="logHeaderActions">
            {progressLabel && (showAllEvents || !hasActiveWorkSummary) ? (
              <div className="logProgressIndicator" role="status" aria-live="polite">
                <span className="logProgressDots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="logProgressLabel">{progressLabel}</span>
              </div>
            ) : null}
            <div className="logViewControls" role="group" aria-label="Transcript detail">
              <button
                type="button"
                className="threadToggleButton"
                aria-pressed={!showAllEvents}
                onClick={() => setShowAllEvents(false)}
              >
                Conversation
              </button>
              <button
                type="button"
                className="threadToggleButton"
                aria-pressed={showAllEvents}
                onClick={() => setShowAllEvents(true)}
              >
                All activity
              </button>
            </div>
            {hasRunDetails ? (
              <button
                type="button"
                className="threadToggleButton logRunDetailsToggle"
                aria-expanded={showRunDetails}
                aria-controls="thread-run-details"
                onClick={() => setShowRunDetails((value) => !value)}
              >
                <span>Run details</span>
                <span className={`summaryToggleIcon ${showRunDetails ? "expanded" : "collapsed"}`} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        {hasRunDetails && showRunDetails ? (
          <div id="thread-run-details" className="logRunDetailsBody">
              {runDetails.backend ? (
                <div className="logRunDetailsRow">
                  <span className="logRunDetailsKey">Backend</span>
                  <span className="logRunDetailsValue mono">{runDetails.backend}</span>
                </div>
              ) : null}
              {runDetails.workspace ? (
                <div className="logRunDetailsRow">
                  <span className="logRunDetailsKey">Workspace</span>
                  <span className="logRunDetailsValue mono">{runDetails.workspace}</span>
                </div>
              ) : null}
              {runDetails.stopReason ? (
                <div className="logRunDetailsRow">
                  <span className="logRunDetailsKey">Stop reason</span>
                  <span className="logRunDetailsValue mono">{runDetails.stopReason}</span>
                </div>
              ) : null}
          </div>
        ) : null}
      </div>

      <div
        ref={panelRef}
        className="logPanel"
      >
        {!visibleEntries.length ? (
          <div className="logEmpty" role="status">
            <StateNotice
              title={entries.length ? "No conversation events yet" : "Waiting for transcript activity"}
              detail={entries.length
                ? "Routine runtime activity is available in All activity. Conversation and important state changes will appear here."
                : "Messages, tool calls, and important state changes will appear as soon as the run produces them."}
            />
          </div>
        ) : (
          <div className="logStream">
            {visibleEntries.map((item, index) => {
              if (item.kind === "work-summary") {
                const isLatest = index === visibleEntries.findLastIndex((entry) => entry.kind === "work-summary");
                return <WorkSummaryRow key={`work-summary-${item.turnId || item.startedAt || index}`} item={item} status={status} isLatest={isLatest} />;
              }

              if (item.kind === "tool-group") {
                const summary = summarizeToolGroup(item.items);
                const toolStates = summarizeToolStates(item.items);
                const displayItems = showAllEvents ? item.items : toolStates.latest;
                const toolCount = toolStates.latest.length;
                return (
                  <div key={`tool-group-${item.startedAt || index}-${index}`} className={`logRow logRowGroupedTools ${showAllEvents ? "" : "conversationWorkRow"}`.trim()}>
                    <div className="logRowAccent" />
                    <div className="logContent">
                      <details className="logToolGroup">
                        <summary className="logToolGroupSummary">
                          <div className="logMetaBar">
                            <span className="logMetaChip neutral mono">{showAllEvents ? "TOOLS" : "WORK"} · {toolCount}</span>
                            <span className="logToolGroupLabel">{summary}</span>
                            {!showAllEvents ? <span className={`logWorkState mono ${toolStates.latest.some((toolItem) => toolItem.toolStatus === "failed") ? "warning" : ""}`.trim()}>{toolStates.text}</span> : null}
                          </div>
                          <span className="logToolChevron" aria-hidden="true" />
                        </summary>
                        <div className="logToolGroupBody">
                          {displayItems.map((toolItem, toolIndex) => (
                            <ToolEventCard key={`tool-item-${toolItem.timestamp || toolIndex}-${toolIndex}`} toolItem={toolItem} />
                          ))}
                        </div>
                      </details>
                      <div className="logTimestamp mono">{formatTimeRange(item.startedAt, item.finishedAt)}</div>
                    </div>
                  </div>
                );
              }

              if (item.kind === "progress") {
                return (
                  <div key={`progress-${item.segmentId || item.timestamp || index}-${index}`} className="logRow logRowProgress">
                    <div className="logRowAccent" />
                    <div className="logContent">
                      <div className="chatMessageHeader">
                        <div className="chatIdentity">
                          <span className="chatRole running">Assistant update</span>
                          <span className="chatTimestamp mono">{formatTime(item.timestamp, { includeSeconds: showAllEvents })}</span>
                        </div>
                      </div>
                      <div className="logMessage logProgressMessage"><RichMessage content={item.message || ""} /></div>
                    </div>
                  </div>
                );
              }

              if (item.kind === "plan") {
                const completedCount = item.entries.filter((entry) => entry.status === "completed").length;
                const activeEntry = item.entries.find((entry) => entry.status === "in_progress");
                return (
                  <div key={`plan-${item.timestamp || index}-${index}`} className="logRow logRowPlan">
                    <div className="logRowAccent" />
                    <div className="logContent">
                      <details className="logPlanDisclosure">
                        <summary>
                          <span className="logMetaChip running mono">PLAN · {completedCount}/{item.entries.length}</span>
                          <span>{activeEntry?.content || (completedCount === item.entries.length ? "Plan completed" : "Plan updated")}</span>
                        </summary>
                        <ol className="logPlanList">
                          {item.entries.map((entry, planIndex) => <li key={`${entry.content}-${planIndex}`} className={entry.status}>{entry.content}</li>)}
                        </ol>
                      </details>
                      <div className="logTimestamp mono">{formatTime(item.timestamp)}</div>
                    </div>
                  </div>
                );
              }

              const isUserChat = item.kind === "chat" && item.role === "user";
              const messageClassName = isUserChat ? "logMessage logChatMessage user" : "logMessage";

              return (
                <div
                  key={`${item.timestamp || index}-${index}`}
                  className={`logRow ${item.kind === "chat" ? `logRowChat ${item.role}` : ""}`.trim()}
                >
                  <div className="logRowAccent" />
                  <div className="logContent">
                    {item.kind === "chat" ? (
                      <ChatRow
                        item={item}
                        messageClassName={messageClassName}
                        isUserChat={isUserChat}
                        showAllEvents={showAllEvents}
                      />
                    ) : (
                      <>
                        <div className="logMetaBar">
                          <span className={`logMetaChip ${item.tone} mono`}>{item.metaLabel}</span>
                        </div>
                        <div className={messageClassName}>{item.message || "No message payload"}</div>
                      </>
                    )}
                    {item.kind === "chat" ? null : <div className="logTimestamp mono">{formatTime(item.timestamp)}</div>}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} className="logStreamEnd" aria-hidden="true" />
          </div>
        )}
      </div>
    </section>
  );
}
