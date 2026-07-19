import ServerPickerPanel from "./ServerPickerPanel";
import StatusIndicator from "./ui/StatusIndicator";
import StateNotice from "./ui/StateNotice";

const logoIcon = "/icons/icon-rounded-master.png";

function getStatusCopy({ busy, error, currentEndpoint }) {
  if (busy) {
    return {
      label: "Connecting",
      detail: currentEndpoint
        ? `Checking ${currentEndpoint} and preparing the console.`
        : "Checking the selected server and preparing the console.",
      tone: "notReady"
    };
  }

  if (error) {
    return {
      label: "Offline",
      detail: "The console has not connected yet. Pick another server or retry with an updated endpoint.",
      tone: "notReady"
    };
  }

  return {
    label: "Ready",
    detail: "This screen is bundled with the app, so it still opens when every Ender backend is offline.",
    tone: "ready"
  };
}

export default function ServerPickerShell({
  currentEndpoint,
  currentServerName,
  servers,
  busy,
  error,
  connectionState,
  onConnect,
  onRetry,
  onToggleFavorite,
  onRemove
}) {
  const status = getStatusCopy({ busy, error, currentEndpoint });
  const showLastTarget = Boolean(currentServerName || busy || error);

  return (
    <div className="serverPickerShellPage">
      <div className="serverPickerShell">
        <section className="serverPickerHero">
          <div className="brand serverPickerBrand">
            <div className="brandMarkWrap">
              <img className="brandMark" src={logoIcon} alt="Ender logo" />
            </div>
            <div className="brandCopy">
              <div className="brandEyebrow">Agent operations console</div>
              <h1 className="title">Ender</h1>
              <p className="subtitle">Choose a server before opening the main console.</p>
            </div>
          </div>

          <div className="serverPickerHeroCopy">
            <div className="workflowBadge">Connection Shell</div>
            <h2 className="serverPickerHeroTitle">Offline-first server picker</h2>
            <p className="serverPickerHeroSubtitle">
              Save the backends you use most, switch between environments, and let the hosted shell stay usable even when no server is reachable.
            </p>
          </div>

          <div className="serverPickerHeroStatus">
            <StatusIndicator label={status.label} tone={status.tone} />
            <div className="panelNote">{status.detail}</div>
            {showLastTarget && currentEndpoint ? (
              <div className="serverPickerLastTarget">
                Last target: <span className="mono">{currentServerName || currentEndpoint}</span>
                {currentServerName && currentServerName !== currentEndpoint ? (
                  <span className="mono serverPickerEndpointInline">{currentEndpoint}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className="consolePanel serverPickerShellPanel">
          <div className="panelChrome">
            <div className="panelLabel mono">server.connections</div>
          </div>
          <div className="panelBody serverPickerShellBody">
            {error ? <StateNotice tone="danger" title="Connection failed" detail={error} actionLabel="Retry last target" onAction={onRetry} busy={busy} /> : null}
            <ServerPickerPanel
              currentEndpoint={currentEndpoint}
              servers={servers}
              onConnect={onConnect}
              onToggleFavorite={onToggleFavorite}
              onRemove={onRemove}
              submitLabel={busy ? "Connecting..." : "Save and connect"}
              activeConnectionLabel={busy ? "Trying" : "Selected"}
              inactiveConnectionLabel="Saved"
              busy={busy}
              connectionState={connectionState}
              error={error}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
