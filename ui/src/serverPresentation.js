export function formatConnectionState(state) {
  if (state === "connected") return { label: "Connected", tone: "ready", detail: "Health and thread synchronization are current." };
  if (state === "checking") return { label: "Checking", tone: "checking", detail: "Confirming health and loading the server workspace." };
  if (state === "offline") return { label: "Unavailable", tone: "notReady", detail: "The console is retaining this endpoint while it waits for recovery." };
  return { label: "Not connected", tone: "neutral", detail: "Choose a saved endpoint or add a server to begin." };
}

export function describeContract(contract, kind) {
  if (!contract) return { label: `${kind} unknown`, tone: "neutral", detail: "No compatibility metadata is available." };
  if (contract.mode === "newer") {
    return {
      label: `${kind} v${contract.observedVersion} newer`,
      tone: "notReady",
      detail: `This UI supports ${kind} through v${contract.supportedVersion}. Some behavior may require a UI update.`
    };
  }
  if (contract.mode === "legacy") {
    return {
      label: kind === "SSE" ? "SSE not observed" : "API legacy-compatible",
      tone: "neutral",
      detail: kind === "SSE"
        ? "A task stream has not advertised its contract in this session."
        : `The endpoint did not advertise a version; the UI is using its legacy-compatible API path.`
    };
  }
  return {
    label: `${kind} v${contract.observedVersion} compatible`,
    tone: "ready",
    detail: `Supported through v${contract.supportedVersion}.`
  };
}

function missingDetail(service, fallback) {
  if (service?.missing?.length) return `Missing ${service.missing.join(", ")}.`;
  return fallback || "No setup guidance reported.";
}

export function buildServerCapabilities(health) {
  const services = health?.services || {};
  const hints = health?.setupHints || {};
  return [
    {
      id: "llm",
      label: "Agent runtime",
      state: services.llm?.ready ? "ready" : "attention",
      value: `${services.llm?.backend || health?.backend || "unknown"} backend`,
      detail: services.llm?.ready ? "Configured for task execution." : missingDetail(services.llm, hints.llm)
    },
    {
      id: "editor",
      label: "Thread editor",
      state: services.codeServer?.ready ? "ready" : "attention",
      value: services.codeServer?.ready ? `${services.codeServer?.mode || "auto"} mode` : "unavailable",
      detail: services.codeServer?.ready ? "Workspace editor sessions can be launched." : missingDetail(services.codeServer, hints.codeServer)
    },
    {
      id: "browser",
      label: "Browser capture",
      state: services.browserCapture?.ready ? "ready" : "attention",
      value: services.browserCapture?.ready ? "available" : "unavailable",
      detail: services.browserCapture?.ready ? (services.browserCapture?.detail || "Chromium is available.") : missingDetail(services.browserCapture, hints.browserCapture)
    },
    {
      id: "workflow",
      label: "Jira workflow",
      state: health?.workflows?.jira_to_repo_task?.ready ? "ready" : "attention",
      value: health?.workflows?.jira_to_repo_task?.ready ? "ready" : "needs setup",
      detail: health?.workflows?.jira_to_repo_task?.ready
        ? "Guided Jira-to-repository launches are available."
        : health?.workflows?.jira_to_repo_task?.setupHint || missingDetail(health?.workflows?.jira_to_repo_task, hints.jira)
    },
    {
      id: "github",
      label: "GitHub",
      state: services.github?.ready ? "ready" : "optional",
      value: services.github?.ready ? "configured" : "optional setup",
      detail: services.github?.ready ? "Private repository and pull-request access is available." : missingDetail(services.github, hints.github)
    },
    {
      id: "self-update",
      label: "Self-update",
      state: services.selfUpdate?.ready ? "ready" : "optional",
      value: services.selfUpdate?.ready ? "supervised" : "not supervised",
      detail: services.selfUpdate?.ready ? "Rollback-safe self-update operations are available." : missingDetail(services.selfUpdate, hints.selfUpdate)
    },
    {
      id: "pillar",
      label: "Pillar relay",
      state: services.pillar?.enabled ? (services.pillar?.ready ? "ready" : "attention") : "optional",
      value: services.pillar?.enabled ? (services.pillar?.ready ? "configured" : "incomplete") : "disabled",
      detail: hints.pillar || "Pillar relay is not configured."
    },
    {
      id: "beacon",
      label: "Beacon notifications",
      state: services.beacon?.enabled ? (services.beacon?.ready ? "ready" : "attention") : "optional",
      value: services.beacon?.enabled ? (services.beacon?.ready ? "configured" : "incomplete") : "disabled",
      detail: hints.beacon || "Beacon notifications are not configured."
    }
  ];
}

export function formatHealthCheckedAt(value) {
  if (!value) return "not checked";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
