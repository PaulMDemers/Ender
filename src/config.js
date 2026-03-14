const path = require("node:path");
const { z } = require("zod");

const schema = z.object({
  PORT: z.string().optional(),
  AGENT_WORKDIR: z.string().optional(),
  AGENT_WORKSPACE_BASE: z.string().optional(),
  AGENT_THREADS_DIR: z.string().optional(),
  AGENT_SCHEDULES_DIR: z.string().optional(),
  AGENT_MAX_STEPS: z.string().optional(),
  AGENT_STALL_LIMIT: z.string().optional(),
  LLM_BACKEND: z.enum(["openai", "bedrock", "azure"]).default("openai"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),

  AWS_REGION: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().default("anthropic.claude-3-5-sonnet-20240620-v1:0"),

  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_INSTANCE_NAME: z.string().optional(),
  AZURE_OPENAI_API_DEPLOYMENT_NAME: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_BASE_PATH: z.string().optional(),

  GITLAB_BASE_URL: z.string().optional(),
  GITLAB_TOKEN: z.string().optional(),

  GITHUB_BASE_URL: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),

  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),

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

function loadConfig(env = process.env) {
  const parsed = schema.parse(env);
  const workdir = path.resolve(parsed.AGENT_WORKDIR || path.resolve(process.cwd(), "workspace"));
  const workspaceBase = path.resolve(parsed.AGENT_WORKSPACE_BASE || path.resolve(process.cwd(), ".."));
  const threadsDir = path.resolve(parsed.AGENT_THREADS_DIR || path.resolve(process.cwd(), "threads"));
  const schedulesDir = path.resolve(parsed.AGENT_SCHEDULES_DIR || path.resolve(process.cwd(), "schedules"));
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

  return {
    port: Number(parsed.PORT || 3000),
    maxSteps,
    stallLimit,
    backend: parsed.LLM_BACKEND,
    workdir,
    workspaceBase,
    threadsDir,
    schedulesDir,

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
