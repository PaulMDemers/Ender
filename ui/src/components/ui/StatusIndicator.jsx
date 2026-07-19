export default function StatusIndicator({ label, ready, tone, className = "" }) {
  const resolvedTone = tone || (ready ? "ready" : "notReady");
  return (
    <div className={`connectionStatus ${resolvedTone} ${className}`.trim()} role="status" aria-live="polite">
      <span className="statusDot" aria-hidden="true" />
      {label}
    </div>
  );
}
