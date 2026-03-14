import { useEffect, useMemo, useState } from "react";

function sortServers(items) {
  return [...items].sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    return Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
  });
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
  const hasSavedServers = sortedServers.length > 0;

  const submit = async (e) => {
    e?.preventDefault?.();
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
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Server connections"
      >
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Connect to Ender</div>
            <div className="modalSubtitle">Switch fast from saved servers, or add a new endpoint below.</div>
          </div>
          <button type="button" className="iconButton" aria-label="Close server modal" onClick={() => onClose?.()}>
            X
          </button>
        </div>

        {!hasSavedServers ? (
          <div className="serverHint">
            Save a server once and it will show up here for quick switching.
          </div>
        ) : (
          <section className="serverSection compact">
            <div className="sectionLabel">Saved Servers</div>
            <div className="serverGroups">
              {sortedServers.map((server) => (
                <div key={server.endpoint} className="serverRow">
                  <button
                    type="button"
                    className={`serverRowMain ${server.endpoint === currentEndpoint ? "active" : ""}`}
                    onClick={() => onConnect?.(server)}
                  >
                    <div className="serverNameRow">
                      <div className="serverName">{server.name}</div>
                      {server.favorite ? <span className="serverBadge">Favorite</span> : null}
                      <span className="serverConnectHint">
                        {server.endpoint === currentEndpoint ? "Connected" : "Connect"}
                      </span>
                    </div>
                    <div className="serverEndpoint">{server.endpoint}</div>
                  </button>
                  <div className="serverRowActions">
                    <button type="button" className="miniButton" onClick={() => onToggleFavorite?.(server.endpoint)}>
                      {server.favorite ? "Unfavorite" : "Favorite"}
                    </button>
                    <button type="button" className="miniButton miniButtonDanger" onClick={() => onRemove?.(server.endpoint)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="serverFormSection">
          <div className="sectionLabel">Add Server</div>
          <form className="serverForm" onSubmit={submit}>
            <input
              className="serverInput"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Friendly name"
            />
            <input
              className="serverInput"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="Server URL"
            />
            <button className="actionButton serverConnectButton" type="submit">
              Save & Connect
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
