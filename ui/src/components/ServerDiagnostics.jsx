import StateNotice from "./ui/StateNotice";
import StatusIndicator from "./ui/StatusIndicator";
import {
  buildServerCapabilities,
  describeContract,
  formatConnectionState,
  formatHealthCheckedAt
} from "../serverPresentation";

function exposureSummary(health) {
  const access = health?.services?.apiAccess;
  if (access?.mode === "open" || access?.remoteAccess) {
    return { label: "Direct API open", tone: "attention", detail: `Bound on ${access?.bindHost || "all interfaces"}; protect this deployment boundary.` };
  }
  return { label: "Local API", tone: "ready", detail: "Direct API access is restricted to loopback clients." };
}

export default function ServerDiagnostics({
  serverName,
  serverUrl,
  health,
  stale = false,
  connectionState,
  contractStatus,
  uiVersion,
  healthChecking,
  healthError,
  healthCheckedAt,
  onRefresh,
  compact = false
}) {
  const connection = formatConnectionState(connectionState);
  const apiContract = describeContract(contractStatus?.api, "API");
  const sseContract = describeContract(contractStatus?.taskSse, "SSE");
  const exposure = exposureSummary(health);
  const capabilities = buildServerCapabilities(health);
  const newerContract = contractStatus?.api?.mode === "newer" || contractStatus?.taskSse?.mode === "newer";
  const serverVersion = health?.app?.version || "unknown";

  return (
    <section className={`serverDiagnostics ${compact ? "compact" : ""}`.trim()} aria-label="Server diagnostics">
      <div className="serverDiagnosticsHeader">
        <div>
          <div className="sectionLabel">Current endpoint</div>
          <div className="serverDiagnosticsName">{serverName || "Direct endpoint"}</div>
          <div className="serverEndpoint mono">{serverUrl}</div>
        </div>
        <div className="serverDiagnosticsActions">
          <StatusIndicator label={connection.label} tone={connection.tone} />
          {onRefresh ? <button type="button" className="miniButton" onClick={onRefresh} disabled={healthChecking}>{healthChecking ? "Checking..." : "Check now"}</button> : null}
        </div>
      </div>

      <div className="serverDiagnosticsSummary">
        <div className="serverDiagnosticMetric"><span>Versions</span><strong className="mono">UI {uiVersion} · server {serverVersion}</strong></div>
        <div className={`serverDiagnosticMetric ${apiContract.tone}`} title={apiContract.detail}><span>REST contract</span><strong>{apiContract.label}</strong></div>
        <div className={`serverDiagnosticMetric ${sseContract.tone}`} title={sseContract.detail}><span>Stream contract</span><strong>{sseContract.label}</strong></div>
        <div className={`serverDiagnosticMetric ${exposure.tone}`} title={exposure.detail}><span>Exposure</span><strong>{exposure.label}</strong></div>
      </div>

      <div className="serverDiagnosticsMeta">
        <span>{connection.detail}</span>
        <span className="mono">checked {formatHealthCheckedAt(healthCheckedAt)}{stale ? " · last known snapshot" : ""}</span>
      </div>

      {healthError ? <StateNotice tone="warning" title="Health check unavailable" detail={healthError} actionLabel="Retry check" onAction={onRefresh} busy={healthChecking} compact /> : null}
      {newerContract ? <StateNotice tone="warning" title="Newer server contract detected" detail={`${apiContract.detail} ${sseContract.detail}`} compact /> : null}
      {exposure.tone === "attention" ? <StateNotice tone="warning" title="Direct remote access enabled" detail={exposure.detail} compact /> : null}

      {health ? (
        <details className="serverCapabilityDisclosure" open={!compact}>
          <summary>Runtime capabilities <span className="mono">{capabilities.filter((item) => item.state === "ready").length} ready · {capabilities.filter((item) => item.state === "attention").length} attention</span></summary>
          <div className="serverCapabilityGrid">
            {capabilities.map((item) => (
              <div key={item.id} className={`serverCapabilityCard ${item.state}`}>
                <div className="serverCapabilityHeader"><span>{item.label}</span><span className="mono">{item.value}</span></div>
                <div className="panelNote">{item.detail}</div>
              </div>
            ))}
          </div>
          <div className="serverPathGrid">
            <div><span>Workspace root</span><strong className="mono">{health?.paths?.workspaceRoot || "not reported"}</strong></div>
            <div><span>Runtime backend</span><strong className="mono">{health?.backend || health?.services?.llm?.backend || "unknown"}</strong></div>
          </div>
        </details>
      ) : null}
    </section>
  );
}
