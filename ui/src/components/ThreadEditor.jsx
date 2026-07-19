import StateNotice from "./ui/StateNotice";
import { useFocusTrap } from "../hooks/useFocusTrap";

function EditorPassword({ editor, compact = false }) {
  if (!editor.session?.password) return null;
  return (
    <button
      type="button"
      className={`${compact ? "editorPasswordButton" : "editorCredential editorCredentialButton"} ${editor.copiedPassword ? "copied" : ""}`}
      onClick={editor.copyPassword}
      aria-label="Copy editor password"
      title="Copy editor password"
    >
      <span className="headerChipLabel">Password</span>
      {compact ? (
        <span className="editorPasswordValue mono">{editor.session.password}</span>
      ) : (
        <span className="editorCredentialCopyRow">
          <span className="editorMetaValue mono">{editor.session.password}</span>
          <span className="editorPasswordState">{editor.copiedPassword ? "Copied" : "Copy"}</span>
        </span>
      )}
      {compact ? <span className="editorPasswordState">{editor.copiedPassword ? "Copied" : "Copy"}</span> : null}
    </button>
  );
}

function EditorDetails({ editor, workspace }) {
  if (!editor.detailsExpanded) return null;
  return (
    <div className="editorSessionDetails">
      <div className="panelNote">Use the direct URL if browser policy prevents the embedded editor from loading.</div>
      <div className="editorMetaGrid">
        <div className="editorMetaItem">
          <span className="headerChipLabel">Workspace</span>
          <span className="editorMetaValue mono" title={workspace || "none"}>{workspace || "No workspace scope"}</span>
        </div>
        <div className="editorMetaItem">
          <span className="headerChipLabel">Mode</span>
          <span className="editorMetaValue mono">{editor.session?.mode || "local"}</span>
        </div>
        <div className="editorMetaItem">
          <span className="headerChipLabel">Port</span>
          <span className="editorMetaValue mono">{editor.session?.port || "managed"}</span>
        </div>
      </div>
      <div className="editorCredentials">
        <div className="editorCredential">
          <span className="headerChipLabel">Direct URL</span>
          <a className="editorLink mono" href={editor.editorUrl} target="_blank" rel="noreferrer">
            {editor.editorUrl}
          </a>
        </div>
        <EditorPassword editor={editor} />
      </div>
    </div>
  );
}

function EditorActionError({ editor }) {
  if (!editor.actionError) return null;
  const retryLabel = editor.actionError.operation === "stop"
    ? "Retry stop"
    : editor.actionError.operation === "copy"
      ? "Copy again"
      : "Retry launch";
  return (
    <StateNotice
      tone="danger"
      title="Workspace editor action failed"
      detail={editor.actionError.message}
      actionLabel={retryLabel}
      onAction={editor.retryAction}
      busy={editor.busy}
      compact
    />
  );
}

function EditorToolbar({ editor, surface }) {
  const connected = editor.frameStatus === "loaded";
  return (
    <div className="editorToolbar" aria-label="Workspace editor controls">
      <span className={`statusPill ${connected ? "success" : "running"}`}>
        {connected ? "connected" : "connecting"}
      </span>
      <EditorPassword editor={editor} compact />
      <button type="button" className="miniButton" onClick={editor.toggleDetails} aria-expanded={editor.detailsExpanded}>
        {editor.detailsExpanded ? "Hide connection" : "Connection"}
      </button>
      {surface === "split" ? (
        <button type="button" className="miniButton" onClick={editor.openModal}>Modal</button>
      ) : null}
      {surface === "modal" && window.innerWidth >= 1180 ? (
        <button type="button" className="miniButton" onClick={editor.openSplit}>Dock right</button>
      ) : null}
      <button type="button" className="miniButton" onClick={editor.openTab}>New tab</button>
      <button type="button" className="miniButton miniButtonDanger" onClick={editor.stop} disabled={editor.busy}>
        {editor.busyOperation === "stop" ? "Stopping…" : "Stop editor"}
      </button>
      <button type="button" className="miniButton" onClick={editor.closeSurface}>Close view</button>
    </div>
  );
}

function EditorFrame({ editor, surface, className = "" }) {
  const waiting = editor.frameStatus !== "loaded";
  return (
    <div className={`editorFrameShell ${className}`}>
      {waiting ? (
        <div className="editorFrameOverlay" role="status" aria-live="polite">
          <div className="editorFrameSpinner" aria-hidden="true" />
          <div className="editorFrameOverlayTitle">Connecting to workspace editor</div>
          <div className="editorFrameOverlayText">Ender is checking the session and will reload the embed automatically when it responds.</div>
          <div className="editorFrameOverlayActions">
            <button type="button" className="miniButton" onClick={editor.retryFrame}>Retry connection</button>
            <button type="button" className="miniButton" onClick={editor.openTab}>Open in new tab</button>
          </div>
        </div>
      ) : null}
      <iframe
        key={`${surface}-${editor.frameKey}-${editor.editorUrl}`}
        className="editorFrame"
        src={editor.editorUrl}
        title="Thread workspace editor"
        onLoad={editor.onFrameLoad}
      />
    </div>
  );
}

function EditorHeading({ title }) {
  return (
    <div className="editorDockHeading">
      <div className="panelLabel mono">thread.editor</div>
      <div className="editorDockTitle">{title}</div>
    </div>
  );
}

export function StackedThreadEditor({ editor, workspace }) {
  if (!editor.session?.url) return null;
  return (
    <section className="threadEditorStack" aria-label="Thread workspace editor">
      <div className="threadEditorStackHeader">
        <EditorHeading title="Workspace editor" />
        <EditorToolbar editor={editor} surface="stacked" />
      </div>
      <EditorDetails editor={editor} workspace={workspace} />
      <EditorActionError editor={editor} />
      <EditorFrame editor={editor} surface="stacked" className="threadEditorStackViewport" />
    </section>
  );
}

export function DockedThreadEditor({ editor, workspace }) {
  if (!editor.hasSplit) return null;
  return (
    <aside className="editorDock" role="dialog" aria-label="Docked workspace editor" style={{ width: `${editor.dockWidth}px` }}>
      <button
        type="button"
        className="editorDockResizeHandle"
        aria-label="Resize docked editor"
        title="Drag to resize"
        onPointerDown={editor.beginDockResize}
      />
      <div className="editorDockHeader">
        <div className="editorDockTopBar">
          <EditorHeading title="Docked workspace editor" />
          <EditorToolbar editor={editor} surface="split" />
        </div>
        <EditorDetails editor={editor} workspace={workspace} />
        <EditorActionError editor={editor} />
      </div>
      <EditorFrame editor={editor} surface="split" />
    </aside>
  );
}

export function ModalThreadEditor({ editor, workspace }) {
  const dialogRef = useFocusTrap({
    active: editor.surface === "modal" && Boolean(editor.session?.url),
    onDismiss: editor.closeSurface,
    initialFocusSelector: "[data-overlay-initial-focus]"
  });

  if (editor.surface !== "modal" || !editor.session?.url) return null;
  return (
    <div className="modalBackdrop" onClick={editor.closeSurface}>
      <div
        ref={dialogRef}
        className="modalCard editorModal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace editor"
      >
        <div className="panelChrome">
          <div className="panelLabel mono">thread.editor</div>
          <button type="button" className="iconButton" aria-label="Close workspace editor" data-overlay-initial-focus onClick={editor.closeSurface}>Close</button>
        </div>
        <div className="editorModalBody">
          <div className="editorModalHeader">
            <div>
              <div className="modalTitle">Workspace editor</div>
              <div className="modalSubtitle">A live editor scoped to this thread workspace, with direct access available if embedding is blocked.</div>
            </div>
            <EditorToolbar editor={editor} surface="modal" />
            <EditorDetails editor={editor} workspace={workspace} />
            <EditorActionError editor={editor} />
          </div>
          <EditorFrame editor={editor} surface="modal" className="editorModalViewport" />
        </div>
      </div>
    </div>
  );
}
