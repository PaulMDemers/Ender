import { useFocusTrap } from "../hooks/useFocusTrap";

export const NAVIGATION_ID = "ender-navigation";
export const MAIN_CONTENT_ID = "ender-main-content";

export default function ApplicationShell({
  railOpen,
  railCollapsed,
  hasDock,
  reviewMode,
  onDismissRail,
  children
}) {
  useFocusTrap({
    active: railOpen,
    onDismiss: onDismissRail,
    containerId: NAVIGATION_ID,
    initialFocusSelector: "[aria-current='page']"
  });

  return (
    <>
      <a className="skipLink" href={`#${MAIN_CONTENT_ID}`}>Skip to main content</a>
      <button
        type="button"
        className={`railScrim ${railOpen ? "visible" : ""}`}
        aria-label="Close navigation"
        tabIndex={railOpen ? 0 : -1}
        onClick={onDismissRail}
      />
      <div
        className={`layout ${railCollapsed ? "railCollapsed" : ""} ${hasDock ? "withDock" : ""} ${reviewMode ? "reviewMode" : ""}`}
      >
        {children}
      </div>
    </>
  );
}
