// @ts-check

const path = require("node:path");
const os = require("node:os");
const { z } = require("zod");
const { createSystemPrompt } = require("./agents/systemPrompt");

const schema = z.object({
  PORT: z.string().optional(),
  AGENT_WORKDIR: z.string().optional(),
  AGENT_WORKSPACE_BASE: z.string().optional(),
  AGENT_THREADS_DIR: z.string().optional(),
  AGENT_SCHEDULES_DIR: z.string().optional(),
  AGENT_WORKFLOW_SESSIONS_DIR: z.string().optional(),
  AGENT_SELF_ROOT: z.string().optional(),
  AGENT_MAX_STEPS: z.string().optional(),
  AGENT_STALL_LIMIT: z.string().optional(),
  ENDER_SUPERVISOR_URL: z.string().optional(),
  ENDER_SUPERVISOR_TOKEN: z.string().optional(),
  AGENT_SELF_UPDATE_VERIFY: z.string().optional(),
  AGENT_SELF_UPDATE_TIMEOUT_MS: z.string().optional(),
  LLM_BACKEND: z.enum(["openai", "bedrock", "azure", "ollama"]).default("openai"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),

  AWS_REGION: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().default("anthropic.claude-3-5-sonnet-20240620-v1:0"),

  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_INSTANCE_NAME: z.string().optional(),
  AZURE_OPENAI_API_DEPLOYMENT_NAME: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_BASE_PATH: z.string().optional(),

  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),

  GITLAB_BASE_URL: z.string().optional(),
  GITLAB_TOKEN: z.string().optional(),

  GITHUB_BASE_URL: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),

  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),

  CONFLUENCE_BASE_URL: z.string().optional(),
  CONFLUENCE_EMAIL: z.string().optional(),
  CONFLUENCE_API_TOKEN: z.string().optional(),

  GOOGLE_DRIVE_ACCESS_TOKEN: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.string().optional(),
  IMAP_SECURE: z.string().optional(),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),
  IMAP_MAILBOX: z.string().optional()
});

function describeRuntimeOs() {
  const platform = os.platform();
  const arch = os.arch();

  const platformLabel = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows",
    freebsd: "FreeBSD",
    openbsd: "OpenBSD",
    aix: "AIX",
    android: "Android",
    sunos: "Solaris"
  }[platform] || platform;

  return `${platformLabel} (${platform}, ${arch})`;
}

function loadConfig(env = process.env) {
  const parsed = schema.parse(env);
  const runtimeOs = describeRuntimeOs();
  const workdir = path.resolve(parsed.AGENT_WORKDIR || path.resolve(process.cwd(), "workspace"));
  const workspaceBase = path.resolve(parsed.AGENT_WORKSPACE_BASE || path.resolve(process.cwd(), ".."));
  const threadsDir = path.resolve(parsed.AGENT_THREADS_DIR || path.resolve(process.cwd(), "threads"));
  const schedulesDir = path.resolve(parsed.AGENT_SCHEDULES_DIR || path.resolve(process.cwd(), "schedules"));
  const workflowSessionsDir = path.resolve(
    parsed.AGENT_WORKFLOW_SESSIONS_DIR || path.resolve(process.cwd(), "workflow-sessions")
  );
  const selfRoot = path.resolve(parsed.AGENT_SELF_ROOT || process.cwd());
  const maxStepsRaw = String(parsed.AGENT_MAX_STEPS || "").trim();
  let maxSteps = null;
  if (maxStepsRaw) {
    const n = Number(maxStepsRaw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("AGENT_MAX_STEPS must be a positive number when set");
    }
    maxSteps = Math.floor(n);
  }

  const stallLimitRaw = String(parsed.AGENT_STALL_LIMIT || "").trim();
  let stallLimit = 4;
  if (stallLimitRaw) {
    const n = Number(stallLimitRaw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("AGENT_STALL_LIMIT must be a non-negative number when set");
    }
    stallLimit = Math.floor(n);
  }

  const selfUpdateTimeoutRaw = String(parsed.AGENT_SELF_UPDATE_TIMEOUT_MS || "").trim();
  let selfUpdateTimeoutMs = 90_000;
  if (selfUpdateTimeoutRaw) {
    const n = Number(selfUpdateTimeoutRaw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("AGENT_SELF_UPDATE_TIMEOUT_MS must be a positive number when set");
    }
    selfUpdateTimeoutMs = Math.floor(n);
  }

  return {
    port: Number(parsed.PORT || 3000),
    maxSteps,
    stallLimit,
    backend: parsed.LLM_BACKEND,
    runtimeOs,
    systemPrompt: createSystemPrompt({ runtimeOs }),
    workdir,
    workspaceBase,
    threadsDir,
    schedulesDir,
    workflowSessionsDir,
    selfRoot,
    selfUpdate: {
      rootDir: selfRoot,
      supervisorUrl: parsed.ENDER_SUPERVISOR_URL ? String(parsed.ENDER_SUPERVISOR_URL).trim() : null,
      supervisorToken: parsed.ENDER_SUPERVISOR_TOKEN ? String(parsed.ENDER_SUPERVISOR_TOKEN).trim() : null,
      verifyCommand: String(parsed.AGENT_SELF_UPDATE_VERIFY || "npm run verify").trim(),
      timeoutMs: selfUpdateTimeoutMs
    },

    openai: {
      apiKey: parsed.OPENAI_API_KEY,
      model: parsed.OPENAI_MODEL
    },

    bedrock: {
      region: parsed.AWS_REGION,
      model: parsed.BEDROCK_MODEL_ID
    },

    azure: {
      apiKey: parsed.AZURE_OPENAI_API_KEY,
      instanceName: parsed.AZURE_OPENAI_API_INSTANCE_NAME,
      deploymentName: parsed.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      apiVersion: parsed.AZURE_OPENAI_API_VERSION,
      basePath: parsed.AZURE_OPENAI_BASE_PATH
    },

    ollama: {
      baseUrl: parsed.OLLAMA_BASE_URL,
      model: parsed.OLLAMA_MODEL
    },

    gitlab: {
      baseUrl: parsed.GITLAB_BASE_URL || "https://gitlab.com",
      token: parsed.GITLAB_TOKEN
    },

    github: {
      baseUrl: parsed.GITHUB_BASE_URL || "https://github.com",
      token: parsed.GITHUB_TOKEN
    },

    jira: {
      baseUrl: parsed.JIRA_BASE_URL,
      email: parsed.JIRA_EMAIL,
      apiToken: parsed.JIRA_API_TOKEN
    },

    confluence: {
      baseUrl: parsed.CONFLUENCE_BASE_URL,
      email: parsed.CONFLUENCE_EMAIL,
      apiToken: parsed.CONFLUENCE_API_TOKEN
    },

    googleDrive: {
      accessToken: parsed.GOOGLE_DRIVE_ACCESS_TOKEN
    },

    email: {
      smtp: {
        host: parsed.SMTP_HOST,
        port: Number(parsed.SMTP_PORT || 587),
        secure: String(parsed.SMTP_SECURE || "").toLowerCase() === "true",
        user: parsed.SMTP_USER,
        pass: parsed.SMTP_PASS,
        from: parsed.SMTP_FROM
      },
      imap: {
        host: parsed.IMAP_HOST,
        port: Number(parsed.IMAP_PORT || 993),
        secure: String(parsed.IMAP_SECURE || "").toLowerCase() !== "false",
        user: parsed.IMAP_USER,
        pass: parsed.IMAP_PASS,
        mailbox: parsed.IMAP_MAILBOX || "INBOX"
      }
    }
  };
}

module.exports = { loadConfig };
