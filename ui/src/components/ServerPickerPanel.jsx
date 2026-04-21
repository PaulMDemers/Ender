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

export default function ServerPickerPanel({
  currentEndpoint,
  servers,
  onConnect,
  onToggleFavorite,
  onRemove,
  submitLabel = "Save and connect",
  activeConnectionLabel = "Connected",
  inactiveConnectionLabel = "Standby",
  busy = false
}) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState(currentEndpoint || "http://localhost:3000");

  useEffect(() => {
    setEndpoint(currentEndpoint || "http://localhost:3000");
  }, [currentEndpoint]);

  const sortedServers = useMemo(() => sortServers(servers), [servers]);

  const submit = async (event) => {
    event?.preventDefault?.();
    const nextEndpoint = endpoint.trim();
    if (!nextEndpoint || busy) return;
    await onConnect?.({
      name: name.trim() || nextEndpoint,
      endpoint: nextEndpoint
    });
    setName("");
  };

  return (
    <div className="serverPickerPanel">
      <section className="serverSection">
        <div className="sectionHeading">
          <span>Saved servers</span>
          <span className="sectionCount mono">{sortedServers.length}</span>
        </div>

        <div className="serverGroups">
          {sortedServers.length ? sortedServers.map((server) => (
            <div key={server.endpoint} className={`serverRow ${server.endpoint === currentEndpoint ? "active" : ""}`}>
              <button type="button" className="serverRowMain" onClick={() => onConnect?.(server)} disabled={busy}>
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
                  {server.endpoint === currentEndpoint ? activeConnectionLabel : inactiveConnectionLabel}
                </span>
                <button type="button" className="miniButton" onClick={() => onToggleFavorite?.(server.endpoint)} disabled={busy}>
                  {server.favorite ? "Unfavorite" : "Favorite"}
                </button>
                <button
                  type="button"
                  className="miniButton miniButtonDanger"
                  onClick={() => onRemove?.(server.endpoint)}
                  disabled={busy}
                >
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
              disabled={busy}
            />
          </label>
          <label className="workflowField">
            <span className="workflowFieldLabel">Base URL</span>
            <input
              className="consoleInput mono"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://api.ender.dev:8443"
              disabled={busy}
            />
          </label>
          <button className="primaryButton serverConnectButton" type="submit" disabled={busy || !endpoint.trim()}>
            {submitLabel}
          </button>
        </form>
      </section>
    </div>
  );
}
