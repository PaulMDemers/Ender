export default function DisclosureButton({
  expanded,
  controls,
  label,
  className = "summaryToggle",
  iconClassName = "summaryToggleIcon",
  children,
  onClick
}) {
  return (
    <button
      type="button"
      className={className}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children || (
        <span className={`${iconClassName} ${expanded ? "expanded" : "collapsed"}`} aria-hidden="true" />
      )}
    </button>
  );
}
