const fs = require("node:fs");

function getBackendReadiness(config) {
  if (config.backend === "openai") {
    return {
      backend: "openai",
      ready: Boolean(config.openai.apiKey),
      missing: config.openai.apiKey ? [] : ["OPENAI_API_KEY"]
    };
  }

  if (config.backend === "bedrock") {
    return {
      backend: "bedrock",
      ready: Boolean(config.bedrock.region),
      missing: config.bedrock.region ? [] : ["AWS_REGION"]
    };
  }

  if (config.backend === "ollama") {
    const missing = [];
    if (!config.ollama.baseUrl) missing.push("OLLAMA_BASE_URL");
    if (!config.ollama.model) missing.push("OLLAMA_MODEL");

    return {
      backend: "ollama",
      ready: missing.length === 0,
      missing
    };
  }

  const missing = [];
  if (!config.azure.apiKey) missing.push("AZURE_OPENAI_API_KEY");
  if (!config.azure.deploymentName) missing.push("AZURE_OPENAI_API_DEPLOYMENT_NAME");
  if (!config.azure.instanceName && !config.azure.basePath) {
    missing.push("AZURE_OPENAI_API_INSTANCE_NAME|AZURE_OPENAI_BASE_PATH");
  }

  return {
    backend: "azure",
    ready: missing.length === 0,
    missing
  };
}

function getJiraReadiness(config) {
  const missing = [];
  if (!config.jira.baseUrl) missing.push("JIRA_BASE_URL");
  if (!config.jira.email) missing.push("JIRA_EMAIL");
  if (!config.jira.apiToken) missing.push("JIRA_API_TOKEN");

  return {
    ready: missing.length === 0,
    missing
  };
}

function getGitHubReadiness(config) {
  const missing = [];
  if (!config.github.token) missing.push("GITHUB_TOKEN");

  return {
    ready: missing.length === 0,
    missing
  };
}

function getConfluenceReadiness(config) {
  const missing = [];
  if (!config.confluence?.baseUrl) missing.push("CONFLUENCE_BASE_URL");
  if (!config.confluence?.email) missing.push("CONFLUENCE_EMAIL");
  if (!config.confluence?.apiToken) missing.push("CONFLUENCE_API_TOKEN");

  return {
    ready: missing.length === 0,
    missing
  };
}

function getGoogleDriveReadiness(config) {
  const missing = [];
  if (!config.googleDrive?.accessToken) missing.push("GOOGLE_DRIVE_ACCESS_TOKEN");

  return {
    ready: missing.length === 0,
    missing
  };
}

function getBrowserCaptureReadiness() {
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    return {
      ready: false,
      missing: ["playwright"],
      detail: "Playwright package is not installed"
    };
  }

  try {
    const executablePath = playwright?.chromium?.executablePath?.();
    if (!executablePath) {
      return {
        ready: false,
        missing: ["chromium"],
        detail: "Chromium executable path is unavailable"
      };
    }

    if (!fs.existsSync(executablePath)) {
      return {
        ready: false,
        missing: ["chromium"],
        detail: "Chromium browser binary is not installed"
      };
    }

    return {
      ready: true,
      missing: [],
      detail: "Playwright Chromium is available"
    };
  } catch {
    return {
      ready: false,
      missing: ["chromium"],
      detail: "Chromium browser binary is not installed"
    };
  }
}

function getEmailReadiness(config) {
  const smtpMissing = [];
  if (!config.email?.smtp?.host) smtpMissing.push("SMTP_HOST");
  if (!config.email?.smtp?.port) smtpMissing.push("SMTP_PORT");
  if (!config.email?.smtp?.user) smtpMissing.push("SMTP_USER");
  if (!config.email?.smtp?.pass) smtpMissing.push("SMTP_PASS");

  const imapMissing = [];
  if (!config.email?.imap?.host) imapMissing.push("IMAP_HOST");
  if (!config.email?.imap?.port) imapMissing.push("IMAP_PORT");
  if (!config.email?.imap?.user) imapMissing.push("IMAP_USER");
  if (!config.email?.imap?.pass) imapMissing.push("IMAP_PASS");

  return {
    ready: smtpMissing.length === 0 || imapMissing.length === 0,
    smtp: { ready: smtpMissing.length === 0, missing: smtpMissing },
    imap: { ready: imapMissing.length === 0, missing: imapMissing }
  };
}

const cp = require("node:child_process");

function commandExists(command) {
  const target = String(command || "").trim();
  if (!target) return false;
  const checker = process.platform === "win32" ? "where" : "which";
  const result = cp.spawnSync(checker, [target], {
    stdio: "ignore"
  });
  return result.status === 0;
}

function getSelfUpdateReadiness(config) {
  const missing = [];
  if (!config.selfUpdate?.rootDir) missing.push("AGENT_SELF_ROOT");
  if (!config.selfUpdate?.supervisorUrl) missing.push("ENDER_SUPERVISOR_URL");
  if (!config.selfUpdate?.supervisorToken) missing.push("ENDER_SUPERVISOR_TOKEN");

  return {
    ready: missing.length === 0,
    missing,
    rootDir: config.selfUpdate?.rootDir || null,
    supervisorUrl: config.selfUpdate?.supervisorUrl || null
  };
}

function getCodeServerReadiness(config) {
  const enabled = config.codeServer?.enabled !== false;
  const mode = config.codeServer?.mode || "auto";
  const runtimePlatform = process.platform;
  const localCommand = String(config.codeServer?.command || "code-server").trim() || "code-server";
  const localCommandAvailable = commandExists(localCommand);
  const npxAvailable = commandExists("npx");
  const npxCompatible = String(config.codeServer?.npxPackage || "code-server@4.113.0").trim() === "code-server@4.113.0"
    ? Number.parseInt(String(process.versions.node || "").split(".")[0], 10) === 22
    : true;
  const dockerAvailable = commandExists("docker");
  const missing = [];
  if ((mode === "docker" || mode === "auto") && !config.codeServer?.image) missing.push("CODE_SERVER_IMAGE");

  const localReady = localCommandAvailable || (npxAvailable && npxCompatible);
  const dockerReady = dockerAvailable && Boolean(config.codeServer?.image);
  const autoUsesDocker = runtimePlatform !== "darwin";
  const ready = enabled && missing.length === 0 && (
    mode === "local" ? localReady
      : mode === "docker" ? dockerReady
        : autoUsesDocker ? (localReady || dockerReady) : localReady
  );

  return {
    ready,
    enabled,
    mode,
    runtimePlatform,
    missing,
    bindHost: config.codeServer?.bindHost || null,
    hostWorkdirMapped: Boolean(config.codeServer?.hostWorkdir),
    localCommand,
    localCommandAvailable,
    npxAvailable,
    npxCompatible,
    dockerAvailable,
    autoUsesDocker
  };
}

function getReadiness(config) {
  const llm = getBackendReadiness(config);
  const jira = getJiraReadiness(config);
  const github = getGitHubReadiness(config);
  const confluence = getConfluenceReadiness(config);
  const googleDrive = getGoogleDriveReadiness(config);
  const browserCapture = getBrowserCaptureReadiness();
  const email = getEmailReadiness(config);
  const selfUpdate = getSelfUpdateReadiness(config);
  const codeServer = getCodeServerReadiness(config);

  return {
    ok: true,
    backend: config.backend,
    paths: {
      workspaceRoot: config.workdir,
      threadsDir: config.threadsDir,
      schedulesDir: config.schedulesDir,
      workflowSessionsDir: config.workflowSessionsDir
    },
    services: {
      llm,
      jira,
      github,
      confluence,
      googleDrive,
      browserCapture,
      email,
      selfUpdate,
      codeServer
    },
    workflows: {
      jira_to_repo_task: {
        ready: llm.ready && jira.ready,
        missing: [...llm.missing, ...jira.missing],
        setupHint: llm.ready && jira.ready
          ? ""
          : "Configure the selected LLM backend plus Jira credentials, then restart the Ender server."
      }
    },
    setupHints: {
      llm: llm.ready ? "" : "Add the missing backend variables to .env and restart the server.",
      github: github.ready ? "" : "Set GITHUB_TOKEN to enable private GitHub access and PR features.",
      jira: jira.ready ? "" : "Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN to enable Jira workflows.",
      browserCapture: browserCapture.ready ? "" : browserCapture.detail,
      selfUpdate: selfUpdate.ready ? "" : "Run Ender under scripts/ender-supervisor.js to enable rollback-safe self updates.",
      codeServer: codeServer.ready
        ? ""
        : !codeServer.enabled
          ? "Set CODE_SERVER_ENABLED=true to allow thread-scoped code-server launches."
          : codeServer.mode === "local"
            ? codeServer.npxAvailable && !codeServer.npxCompatible
              ? "Install a local code-server binary, for example with Homebrew on macOS. The pinned npx fallback currently expects Node 22."
              : "Install a local code-server binary or use npx from a shell where the Ender server is running."
            : codeServer.mode === "docker"
              ? "Make sure Docker is available to the Ender server and CODE_SERVER_IMAGE points to a runnable code-server image."
              : codeServer.runtimePlatform === "darwin"
                ? codeServer.npxAvailable && !codeServer.npxCompatible
                  ? "On macOS, auto mode now expects a local code-server install. Install it with Homebrew or set CODE_SERVER_MODE=docker if you explicitly want Docker launches."
                  : "On macOS, auto mode uses a local code-server install. Install code-server or set CODE_SERVER_MODE=docker if you explicitly want Docker launches."
              : codeServer.npxAvailable && !codeServer.npxCompatible
                ? "Install a local code-server binary for Mac host launches, or keep Docker available for container-backed editor sessions. The pinned npx fallback currently expects Node 22."
                : "Install a local code-server launcher for best Mac support, or keep Docker available for container-backed editor sessions."
    }
  };
}

module.exports = { getReadiness };
