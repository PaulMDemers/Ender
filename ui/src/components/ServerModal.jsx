import { useEffect, useMemo, useState } from "react";

function sortServers(items) {
  return [...items].sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    return Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
  });
}

function formatLastUsed(value) {
  if (!value) return "never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function ServerModal({
  open,
  currentEndpoint,
  servers,
  onClose,
  onConnect,
  onToggleFavorite,
  onRemove
}) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState(currentEndpoint || "http://localhost:3000");

  useEffect(() => {
    if (!open) return;
    setEndpoint(currentEndpoint || "http://localhost:3000");
  }, [open, currentEndpoint]);

  const sortedServers = useMemo(() => sortServers(servers), [servers]);

  const submit = async (event) => {
    event?.preventDefault?.();
    const nextEndpoint = endpoint.trim();
    if (!nextEndpoint) return;
    await onConnect?.({
      name: name.trim() || nextEndpoint,
      endpoint: nextEndpoint
    });
    setName("");
  };

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

          <section className="serverSection">
            <div className="sectionHeading">
              <span>Saved servers</span>
              <span className="sectionCount mono">{sortedServers.length}</span>
            </div>

            <div className="serverGroups">
              {sortedServers.length ? sortedServers.map((server) => (
                <div key={server.endpoint} className={`serverRow ${server.endpoint === currentEndpoint ? "active" : ""}`}>
                  <button type="button" className="serverRowMain" onClick={() => onConnect?.(server)}>
                    <div className="serverNameRow">
                      <div className="serverName">{server.name}</div>
                      {server.favorite ? <span className="threadTag">Favorite</span> : null}
                    </div>
                    <div className="serverEndpoint mono">{server.endpoint}</div>
                    <div className="panelNote">Last connected {formatLastUsed(server.lastUsedAt)}</div>
                  </button>

                  <div className="serverRowActions">
                    <span className={`connectionStatus ${server.endpoint === currentEndpoint ? "ready" : "notReady"}`}>
                      <span className="statusDot" />
                      {server.endpoint === currentEndpoint ? "Connected" : "Standby"}
                    </span>
                    <button type="button" className="miniButton" onClick={() => onToggleFavorite?.(server.endpoint)}>
                      {server.favorite ? "Unfavorite" : "Favorite"}
                    </button>
                    <button type="button" className="miniButton miniButtonDanger" onClick={() => onRemove?.(server.endpoint)}>
                      Remove
                    </button>
                  </div>
                </div>
              )) : (
                <div className="emptyState">Save a server once and it will appear here for quick switching.</div>
              )}
            </div>
          </section>

          <section className="serverFormSection">
            <div className="sectionHeading">
              <span>Add server</span>
            </div>
            <form className="serverForm" onSubmit={submit}>
              <label className="workflowField">
                <span className="workflowFieldLabel">Friendly name</span>
                <input
                  className="consoleInput"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Production API"
                />
              </label>
              <label className="workflowField">
                <span className="workflowFieldLabel">Base URL</span>
                <input
                  className="consoleInput mono"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://api.ender.dev:8443"
                />
              </label>
              <button className="primaryButton serverConnectButton" type="submit">
                Save and connect
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
