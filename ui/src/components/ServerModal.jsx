import ServerPickerPanel from "./ServerPickerPanel";

export default function ServerModal({
  open,
  currentEndpoint,
  servers,
  onClose,
  onConnect,
  onToggleFavorite,
  onRemove
}) {
  if (!open) return null;

  return (
    <div className="modalBackdrop" onClick={() => onClose?.()}>
      <div
        className="modalCard serverModal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Server connections"
      >
        <div className="panelChrome">
          <div className="panelLabel mono">server.connections</div>
          <button type="button" className="iconButton" aria-label="Close server modal" onClick={() => onClose?.()}>
            Close
          </button>
        </div>

        <div className="modalBody">
          <div className="modalHeader">
            <div>
              <div className="modalTitle">Connect to Ender backends</div>
              <div className="modalSubtitle">
                Save multiple API endpoints, favorite the ones you use most, and switch control surfaces without losing the thread ledger.
              </div>
            </div>
          </div>
          <ServerPickerPanel
            currentEndpoint={currentEndpoint}
            servers={servers}
            onConnect={onConnect}
            onToggleFavorite={onToggleFavorite}
            onRemove={onRemove}
          />
        </div>
      </div>
    </div>
  );
}
