import { useEffect, useRef, useState } from "react";

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
  if (message.startsWith("goal=") || message.startsWith("workspace=") || message.startsWith("backend=")) return "context";
  if (message.includes("approval")) return "approval";
  return "system";
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value || Date.now()));
}

function normalizeMessage(entry) {
  if (typeof entry?.data === "string") return entry.data;
  if (entry?.data && typeof entry.data === "object") return JSON.stringify(entry.data);
  return "";
}

export default function LogViewer({ entries, status, entryCount, taskId }) {
  const ref = useRef(null);
  const [stickBottom, setStickBottom] = useState(true);

  useEffect(() => {
    if (ref.current && stickBottom) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [entries, stickBottom]);

  return (
    <section className="consolePanel logConsole">
      <div className="panelChrome">
        <div className="panelLabel mono">live_transcript.panel</div>
        <div className="logPanelMeta mono">
          {taskId ? `${taskId.slice(0, 8)} · ${entryCount} lines · ${status || "idle"}` : "no thread selected"}
        </div>
      </div>

      <div
        ref={ref}
        className="logPanel"
        onScroll={() => {
          const el = ref.current;
          if (!el) return;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
          setStickBottom(atBottom);
        }}
      >
        {!entries.length ? (
          <div className="logEmpty">
            <div className="emptyState">No transcript events yet</div>
            <div className="panelNote">When the agent starts acting, logs, tool calls, and state transitions will stream here.</div>
          </div>
        ) : (
          <div className="logStream">
            {entries.map((entry, index) => {
              const message = normalizeMessage(entry);
              const source = inferSource(message);
              const tone = getLevelTone(entry.level);
              const metaLabel = `${String(entry.level || "info").toUpperCase()} · ${source}`;

              return (
                <div key={`${entry.t || index}-${index}`} className="logRow">
                  <div className="logTimestamp mono">{formatTime(entry.t)}</div>
                  <div className="logRowAccent" />
                  <div className="logContent">
                    <div className="logMetaBar">
                      <span className={`logMetaChip ${tone} mono`}>{metaLabel}</span>
                    </div>
                    <div className="logMessage">{message || "No message payload"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
