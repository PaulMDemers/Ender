import { useState } from "react";
import { hasUnseenTaskUpdates } from "../utils/taskRevision";
import DisclosureButton from "./ui/DisclosureButton";

function getStatusTone(status) {
  const normalized = String(status || "idle");
  if (normalized === "running") return "running";
  if (normalized === "awaiting_approval") return "approval";
  if (normalized === "done") return "success";
  if (normalized === "needs_input") return "warning";
  if (normalized === "blocked") return "danger";
  if (normalized === "error") return "danger";
  if (normalized === "terminated" || normalized === "canceled") return "warning";
  return "neutral";
}

function getStatusLabel(status) {
  if (!status) return "idle";
  if (status === "awaiting_approval") return "approval needed";
  if (status === "done") return "completed";
  if (status === "needs_input") return "needs input";
  return String(status).replaceAll("_", " ");
}

function isActive(status) {
  return !["done", "error", "canceled", "terminated", "blocked", "needs_input"].includes(status);
}

function formatTimestamp(value) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getTaskTitle(task) {
  const title = String(task?.title || "").trim();
  if (title) return title;

  const goal = String(task?.goal || "").trim();
  if (goal) return goal;

  const shortId = String(task?.id || "").trim().slice(0, 8);
  return shortId ? `Untitled thread ${shortId}` : "Untitled thread";
}

export default function TaskList({
  items,
  selectedId,
  taskState,
  hasMore,
  loadMoreLabel,
  emptyLabel,
  onSelect,
  onTogglePinned,
  onToggleArchived,
  onLoadMore,
  onTerminate,
  onDelete,
  onRerun
}) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [moreIds, setMoreIds] = useState(() => new Set());
  const [copiedId, setCopiedId] = useState(null);

  const toggleExpanded = (taskId) => {
    setMoreIds((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleMore = (taskId) => {
    setMoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const copyThreadId = async (taskId) => {
    try {
      await navigator.clipboard.writeText(String(taskId));
      setCopiedId(taskId);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="taskList">
      {items.map((task) => {
        const taskTitle = getTaskTitle(task);
        const expanded = expandedIds.has(task.id);
        const moreExpanded = moreIds.has(task.id);
        const pinned = Boolean(taskState?.[task.id]?.pinned);
        const archived = Boolean(taskState?.[task.id]?.archived);
        const selected = selectedId === task.id;
        const unseen = hasUnseenTaskUpdates(task, taskState?.[task.id]);
        const statusLabel = getStatusLabel(task.status);
        const statusTone = getStatusTone(task.status);

        return (
          <article key={task.id} className={`threadCard ${selected ? "selected" : ""} ${unseen ? "unread" : ""}`}>
            <button
              type="button"
              className="threadCardMain"
              aria-current={selected ? "true" : undefined}
              onClick={() => {
                onSelect?.(task.id);
              }}
            >
              <span
                className={`threadUnreadSlot ${unseen ? "unread" : ""}`}
                role={unseen ? "img" : undefined}
                aria-label={unseen ? "Unread thread updates" : undefined}
                title={unseen ? "Unread thread updates" : undefined}
              />
              <span className={`threadTitle ${expanded ? "expanded" : ""}`} title={taskTitle}>
                {taskTitle}
              </span>
              {pinned ? <span className="threadRowFlag">Pinned</span> : null}
              {task.pendingApprovalCount ? <span className="threadRowFlag attention">Approval</span> : null}
            </button>
            <div className="threadCardFooter">
              <DisclosureButton
                className="summaryToggle threadEntryToggle"
                expanded={expanded}
                controls={`thread-details-${task.id}`}
                label={`${expanded ? "Collapse" : "Expand"} thread details for ${taskTitle}`}
                onClick={() => toggleExpanded(task.id)}
              >
                <span className={`summaryToggleIcon ${expanded ? "expanded" : "collapsed"}`} aria-hidden="true" />
              </DisclosureButton>
            </div>
            {expanded ? (
              <>
                <div id={`thread-details-${task.id}`} className="threadCardDetails">
                  <div className="threadMetaSummary mono" aria-label="Thread summary">
                    <span className={`threadMetaStatus ${statusTone}`}>{statusLabel}</span>
                    <span>{formatTimestamp(task.finishedAt || task.startedAt)}</span>
                    {task.llmProfileId ? <span>{task.llmProfileId}</span> : null}
                    {task.memoryMode ? <span>{task.memoryMode} memory</span> : null}
                    <span>{task.runCount || 1} {(task.runCount || 1) === 1 ? "run" : "runs"}</span>
                    <span>{task.logCount || 0} {(task.logCount || 0) === 1 ? "log" : "logs"}</span>
                  </div>

                  {task.workspace ? (
                    <div className="threadCardWorkspace mono" title={task.workspace}>
                      {task.workspace}
                    </div>
                  ) : null}
                </div>

                <div className="threadActions">
                  <button type="button" className="miniButton threadPrimaryAction" onClick={() => onRerun?.(task.id)}>
                    Re-run
                  </button>
                  <DisclosureButton
                    className="miniButton threadMoreToggle"
                    expanded={moreExpanded}
                    controls={`thread-actions-${task.id}`}
                    label={`${moreExpanded ? "Collapse" : "Expand"} actions for ${taskTitle}`}
                    onClick={() => toggleMore(task.id)}
                  >
                    <span>More</span>
                    <span className={`summaryToggleIcon ${moreExpanded ? "expanded" : "collapsed"}`} aria-hidden="true" />
                  </DisclosureButton>
                </div>

                {moreExpanded ? (
                  <div id={`thread-actions-${task.id}`} className="threadMorePanel">
                    <div className="threadTechnicalBar">
                      <span className="mono" title={task.id}>Thread {String(task.id).slice(0, 8)}</span>
                      <button type="button" className="threadCopyButton" onClick={() => copyThreadId(task.id)}>
                        {copiedId === task.id ? "Copied" : "Copy ID"}
                      </button>
                    </div>
                    <div className="threadSecondaryActions">
                      {isActive(task.status) ? (
                        <button type="button" className="miniButton" onClick={() => onTerminate?.(task.id)}>
                          Terminate
                        </button>
                      ) : null}
                      <button type="button" className="miniButton" onClick={() => onTogglePinned?.(task.id)}>
                        {pinned ? "Unpin" : "Pin"}
                      </button>
                      <button type="button" className="miniButton" onClick={() => onToggleArchived?.(task.id)}>
                        {archived ? "Restore" : "Archive"}
                      </button>
                      <button type="button" className="miniButton miniButtonDanger" onClick={() => onDelete?.(task.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </article>
        );
      })}

      {hasMore ? (
        <button type="button" className="loadMoreButton" onClick={() => onLoadMore?.()}>
          {loadMoreLabel || "Load more"}
        </button>
      ) : null}

      {!items.length ? <div className="emptyState">{emptyLabel || "No threads yet"}</div> : null}
    </div>
  );
}
