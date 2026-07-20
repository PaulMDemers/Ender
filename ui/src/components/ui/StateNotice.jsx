export default function StateNotice({
  tone = "neutral",
  title,
  detail,
  actionLabel,
  onAction,
  busy = false,
  compact = false,
  className = ""
}) {
  const isError = tone === "danger";
  return (
    <section
      className={`stateNotice ${tone} ${compact ? "compact" : ""} ${className}`.trim()}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-busy={busy || undefined}
    >
      <span className="stateNoticeMarker" aria-hidden="true" />
      <div className="stateNoticeCopy">
        {title ? <div className="stateNoticeTitle">{title}</div> : null}
        {detail ? <div className="stateNoticeDetail">{detail}</div> : null}
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="stateNoticeAction" onClick={onAction} disabled={busy}>
          {busy ? "Working..." : actionLabel}
        </button>
      ) : null}
    </section>
  );
}
