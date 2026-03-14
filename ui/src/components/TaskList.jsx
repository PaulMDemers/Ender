import { useState } from "react";

function StatusPill({ status }) {
  const normalized = status || "running";
  let cls = "statusPill";
  if (normalized.startsWith("done")) cls += " done";
  else if (normalized.startsWith("error")) cls += " error";
  else if (normalized.startsWith("canceled") || normalized.startsWith("terminated")) cls += " canceled";
  else if (normalized.startsWith("awaiting_approval")) cls += " awaiting";
  return <span className={cls}>{normalized}</span>;
}

function isActive(status) {
  return !status.startsWith("done") && !status.startsWith("error") && !status.startsWith("canceled") && !status.startsWith("terminated");
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
        const needsClamp = String(task.goal || "").length > 140;
        const pinned = Boolean(taskState?.[task.id]?.pinned);
        const archived = Boolean(taskState?.[task.id]?.archived);

        return (
          <button
            key={task.id}
            className={`taskCard ${selectedId === task.id ? "active" : ""}`}
            onClick={() => onSelect?.(task.id)}
          >
            <div className="taskCardTop">
              <div className="taskCardTopLeft">
                <StatusPill status={task.status} />
                {pinned ? <span className="taskBadge">Pinned</span> : null}
                {archived ? <span className="taskBadge muted">Archived</span> : null}
              </div>
              <span className="taskStamp">{new Date(task.startedAt).toLocaleTimeString()}</span>
            </div>
            <div className={`taskGoal ${expanded ? "expanded" : "clamped"}`}>{task.goal}</div>
            {needsClamp ? (
              <span
                className="taskExpand"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(task.id);
                }}
              >
                {expanded ? "Show less" : "Show more"}
              </span>
            ) : null}
            <div className="taskMeta">{task.id}</div>
            {task.workspace ? <div className="taskWorkspace">workspace: {task.workspace}</div> : null}
            <div className="taskActions">
              {isActive(task.status) ? (
                <span
                  className="miniButton"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTerminate?.(task.id);
                  }}
                >
                  Terminate
                </span>
              ) : null}
              <span
                className="miniButton"
                onClick={(e) => {
                  e.stopPropagation();
                  onRerun?.(task.id);
                }}
              >
                Re-run
              </span>
              <span
                className="miniButton"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePinned?.(task.id);
                }}
              >
                {pinned ? "Unpin" : "Pin"}
              </span>
              <span
                className="miniButton"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleArchived?.(task.id);
                }}
              >
                {archived ? "Restore" : "Archive"}
              </span>
              <span
                className="miniButton miniButtonDanger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(task.id);
                }}
              >
                Delete
              </span>
            </div>
          </button>
        );
      })}
      {hasMore ? (
        <button type="button" className="loadMoreButton" onClick={() => onLoadMore?.()}>
          {loadMoreLabel || "Load more"}
        </button>
      ) : null}
      {!items.length ? <div className="emptyState">{emptyLabel || "No tasks yet"}</div> : null}
    </div>
  );
}
