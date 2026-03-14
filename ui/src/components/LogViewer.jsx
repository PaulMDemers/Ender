import { useEffect, useRef, useState } from "react";

export default function LogViewer({ entries }) {
  const ref = useRef(null);
  const [stickBottom, setStickBottom] = useState(true);

  useEffect(() => {
    if (ref.current && stickBottom) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [entries, stickBottom]);

  return (
    <div className="logPanel" ref={ref} onScroll={() => {
      const el = ref.current;
      if (!el) return;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      setStickBottom(atBottom);
    }}>
      {!entries.length ? (
        <div className="logLine muted">No logs yet</div>
      ) : (
        entries.map((entry, index) => (
          <div key={index} className={`logLine ${entry.level || "info"}`}>
            [{new Date(entry.t || Date.now()).toLocaleTimeString()}] {entry.level || "info"} {entry.data}
          </div>
        ))
      )}
    </div>
  );
}
