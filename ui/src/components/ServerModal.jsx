import ServerPickerPanel from "./ServerPickerPanel";
import ServerDiagnostics from "./ServerDiagnostics";
import StateNotice from "./ui/StateNotice";
import { useFocusTrap } from "../hooks/useFocusTrap";

export default function ServerModal({
  open,
  currentEndpoint,
  currentServerName,
  servers,
  busy,
  error,
  connectionState,
  health,
  lastHealth,
  healthChecking,
  healthError,
  healthCheckedAt,
  contractStatus,
  uiVersion,
  onClose,
  onConnect,
  onRefreshHealth,
  onToggleFavorite,
  onRemove
}) {
  const dialogRef = useFocusTrap({
    active: open,
    onDismiss: onClose,
    initialFocusSelector: "[data-overlay-initial-focus]"
  });

  if (!open) return null;

  return (
    <div className="modalBackdrop" onClick={() => onClose?.()}>
      <div
        ref={dialogRef}
        className="modalCard serverModal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Server connections"
      >
        <div className="panelChrome">
          <div className="panelLabel mono">server.connections</div>
          <button type="button" className="iconButton" aria-label="Close server modal" data-overlay-initial-focus onClick={() => onClose?.()}>
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
          <ServerDiagnostics
            serverName={currentServerName}
            serverUrl={currentEndpoint}
            health={health || lastHealth}
            stale={!health && Boolean(lastHealth)}
            connectionState={connectionState}
            contractStatus={contractStatus}
            uiVersion={uiVersion}
            healthChecking={healthChecking}
            healthError={healthError}
            healthCheckedAt={healthCheckedAt}
            onRefresh={onRefreshHealth}
          />
          {error ? <StateNotice tone="danger" title="Connection or synchronization failed" detail={error} compact /> : null}
          <ServerPickerPanel
            currentEndpoint={currentEndpoint}
            servers={servers}
            onConnect={onConnect}
            onToggleFavorite={onToggleFavorite}
            onRemove={onRemove}
            busy={busy}
            connectionState={connectionState}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}
