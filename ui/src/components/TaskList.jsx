import { useState } from "react";

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

  const toggleExpanded = (taskId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  return (
    <div className="taskList">
      {items.map((task) => {
        const expanded = expandedIds.has(task.id);
        const pinned = Boolean(taskState?.[task.id]?.pinned);
        const archived = Boolean(taskState?.[task.id]?.archived);
        const selected = selectedId === task.id;

        return (
          <article key={task.id} className={`threadCard ${selected ? "selected" : ""}`}>
            <button
              type="button"
              className="threadCardMain"
              onClick={() => {
                onSelect?.(task.id);
              }}
            >
              <div className="threadCardTop">
                <div className="threadStatusRow">
                  <span className={`statusPill ${getStatusTone(task.status)}`}>{getStatusLabel(task.status)}</span>
                  {pinned ? <span className="threadTag">Pinned</span> : null}
                </div>
                <span className="threadTimestamp mono">{formatTimestamp(task.finishedAt || task.startedAt)}</span>
              </div>

              <div className={`threadTitle ${expanded ? "expanded" : "clamped"}`} title={task.goal}>
                {task.goal}
              </div>

              {!expanded ? (
                <div className="threadCardSummary mono">
                  <span>{String(task.id).slice(0, 8)}</span>
                  <span>runs {task.runCount || 1}</span>
                  <span>logs {task.logCount || 0}</span>
                </div>
              ) : null}
            </button>
            <div className="threadCardFooter">
              <button
                type="button"
                className="summaryToggle threadEntryToggle"
                aria-label={expanded ? "Collapse thread entry" : "Expand thread entry"}
                title={expanded ? "Collapse thread entry" : "Expand thread entry"}
                onClick={() => toggleExpanded(task.id)}
              >
                <span className={`summaryToggleIcon ${expanded ? "expanded" : "collapsed"}`} aria-hidden="true" />
              </button>
            </div>
            {expanded ? (
              <>
                <div className="threadCardDetails">
                  <div className="threadCardMeta">
                    <span className="mono">{task.id}</span>
                    <span className="mono">runs {task.runCount || 1}</span>
                    <span className="mono">logs {task.logCount || 0}</span>
                  </div>

                  {task.workspace ? <div className="threadCardWorkspace mono">{task.workspace}</div> : null}
                </div>

                <div className="threadActions">
                  {isActive(task.status) ? (
                    <button type="button" className="miniButton" onClick={() => onTerminate?.(task.id)}>
                      Terminate
                    </button>
                  ) : null}
                  <button type="button" className="miniButton" onClick={() => onRerun?.(task.id)}>
                    Re-run
                  </button>
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
