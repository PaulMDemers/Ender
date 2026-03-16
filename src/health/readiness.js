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

function getReadiness(config) {
  const llm = getBackendReadiness(config);
  const jira = getJiraReadiness(config);
  const github = getGitHubReadiness(config);
  const browserCapture = getBrowserCaptureReadiness();
  const email = getEmailReadiness(config);

  return {
    ok: true,
    backend: config.backend,
    paths: {
      workspaceRoot: config.workdir
    },
    services: {
      llm,
      jira,
      github,
      browserCapture,
      email
    },
    workflows: {
      jira_to_repo_task: {
        ready: llm.ready && jira.ready,
        missing: [...llm.missing, ...jira.missing]
      }
    }
  };
}

module.exports = { getReadiness };
