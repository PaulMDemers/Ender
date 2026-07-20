import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

const DEFAULT_TIMEOUT_MS = 180_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function parseTimeout() {
  const value = Number(
    process.env.ENDER_LLM_SMOKE_TIMEOUT_MS
    || process.env.ENDER_ACP_SMOKE_TIMEOUT_MS
    || DEFAULT_TIMEOUT_MS
  );
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("ENDER_LLM_SMOKE_TIMEOUT_MS must be a positive number when set");
  }
  return Math.floor(value);
}

function parseProfileIds() {
  const argumentIndex = process.argv.indexOf("--profiles");
  const raw = argumentIndex >= 0
    ? process.argv[argumentIndex + 1]
    : process.env.ENDER_LLM_SMOKE_PROFILE_IDS || "acp";
  const profiles = String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!profiles.length) throw new Error("Provide at least one profile id through --profiles or ENDER_LLM_SMOKE_PROFILE_IDS");
  if (profiles.some((profile) => !/^[a-z0-9][a-z0-9-]*$/i.test(profile))) {
    throw new Error("Smoke profile ids may contain only letters, numbers, and hyphens");
  }
  return [...new Set(profiles)];
}

function markerForProfile(profileId) {
  return `ENDER_${profileId.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_SMOKE_OK`;
}

function assertAdapterConfiguration(profileIds) {
  if (!profileIds.includes("acp")) return;
  const args = String(process.env.ACP_ARGS || "").trim();
  if (args.includes("@zed-industries/codex-acp")) {
    throw new Error(
      "The configured Codex ACP adapter is deprecated. Set ACP_ARGS=--yes @agentclientprotocol/codex-acp and retry."
    );
  }
}

function createServerEnv(port, dataRoot, profileIds) {
  const handshakeTimeout = Math.max(
    Number(process.env.ENDER_ACP_HANDSHAKE_TIMEOUT_MS || 0) || 0,
    30_000
  );

  return {
    ...process.env,
    PORT: String(port),
    ENDER_API_ACCESS_MODE: "local",
    ENDER_API_BIND_HOST: "127.0.0.1",
    ENDER_CORS_ORIGINS: "",
    ENDER_SHUTDOWN_TIMEOUT_MS: "10000",
    ENDER_ACP_HANDSHAKE_TIMEOUT_MS: String(handshakeTimeout),
    AGENT_WORKDIR: path.join(dataRoot, "workspace"),
    AGENT_WORKSPACE_BASE: path.join(dataRoot, "workspace"),
    AGENT_THREADS_DIR: path.join(dataRoot, "threads"),
    AGENT_PROJECTS_DIR: path.join(dataRoot, "projects"),
    AGENT_MEMORIES_DIR: path.join(dataRoot, "memories"),
    AGENT_SCHEDULES_DIR: path.join(dataRoot, "schedules"),
    AGENT_TASK_LEDGER_DIR: path.join(dataRoot, "task-ledger"),
    AGENT_WORKFLOW_SESSIONS_DIR: path.join(dataRoot, "workflow-sessions"),
    AGENT_SELF_ROOT: repoRoot,
    AGENT_TASK_LEDGER_POLL_INTERVAL_MS: "0",
    AGENT_TASK_LEDGER_MAX_AUTO_AGENTS: "0",
    AGENT_AUTO_RESTART_INTERRUPTED_THREADS: "false",
    CODE_SERVER_ENABLED: "false",
    CODE_SERVER_STATE_DIR: path.join(dataRoot, "code-server"),
    LLM_BACKEND: process.env.LLM_BACKEND || profileIds[0],
    PILLAR_ENABLED: "false",
    PILLAR_URL: "",
    BEACON_ENABLED: "false",
    BEACON_URL: ""
  };
}

function startServer(port, dataRoot, profileIds) {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: repoRoot,
    env: createServerEnv(port, dataRoot, profileIds),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  const capture = (chunk) => {
    output.push(String(chunk));
    if (output.length > 120) output.shift();
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.output = output;
  child.exitResult = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    child.exitResult.then(() => true),
    sleep(12_000).then(() => false)
  ]);
  if (!stopped) {
    child.kill("SIGKILL");
    await child.exitResult;
  }
}

async function api(baseUrl, requestPath, init = undefined) {
  const response = await fetch(`${baseUrl}${requestPath}`, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${requestPath} failed (${response.status}): ${text}`);
  }
  return body;
}

async function waitForHealth(baseUrl, child, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const result = await child.exitResult;
      throw new Error(`Ender exited before becoming healthy (${JSON.stringify(result)})`);
    }
    try {
      return await api(baseUrl, "/health");
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Ender health: ${lastError?.message || "no response"}`);
}

async function waitForTask(baseUrl, taskId, timeoutMs) {
  const terminal = new Set(["done", "error", "blocked", "needs_input", "terminated", "canceled"]);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const task = await api(baseUrl, `/tasks/${encodeURIComponent(taskId)}`);
    if (terminal.has(task.status)) return task;
    await sleep(750);
  }
  throw new Error(`Task ${taskId} did not reach a terminal state within ${timeoutMs}ms`);
}

function lastLogLines(logs, limit = 12) {
  return (logs.entries || []).slice(-limit).map((entry) => {
    const data = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data);
    return `[${entry.level || "info"}] ${data}`;
  });
}

async function run() {
  const profileIds = parseProfileIds();
  assertAdapterConfiguration(profileIds);
  const timeoutMs = parseTimeout();
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ender-llm-server-smoke-"));
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = startServer(port, dataRoot, profileIds);
  let taskId = null;

  try {
    const health = await waitForHealth(baseUrl, child);
    assert.equal(health.app?.name, "Ender");
    const catalog = await api(baseUrl, "/llm-profiles");
    const availableProfiles = catalog.items || [];
    const tasks = [];

    for (const profileId of profileIds) {
      const profile = availableProfiles.find((item) => item.id === profileId);
      assert.ok(profile, `Profile ${profileId} was not published by /llm-profiles`);
      assert.equal(
        profile.ready,
        true,
        `Profile ${profileId} is not ready: ${(profile.missing || []).join(", ") || "unknown configuration error"}`
      );

      const marker = markerForProfile(profileId);
      const startedAt = Date.now();
      const started = await api(baseUrl, "/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: `Reply with exactly ${marker}. Do not call tools or modify files.`,
          workspace: null,
          llmProfileId: profileId,
          memoryMode: "off"
        })
      });
      taskId = started.id;

      const task = await waitForTask(baseUrl, taskId, timeoutMs);
      const logs = await api(baseUrl, `/tasks/${encodeURIComponent(taskId)}/logs?from=0`);
      const diagnostic = {
        id: taskId,
        profileId,
        backend: profile.backend,
        status: task.status,
        durationMs: Date.now() - startedAt,
        result: task.result,
        lastLogs: lastLogLines(logs)
      };

      assert.equal(
        task.status,
        "done",
        `${profileId} smoke task did not complete:\n${JSON.stringify(diagnostic, null, 2)}`
      );
      assert.match(
        String(task.result || ""),
        new RegExp(marker),
        `${profileId} smoke task omitted the expected marker:\n${JSON.stringify(diagnostic, null, 2)}`
      );
      tasks.push({
        taskId,
        profileId,
        backend: profile.backend,
        status: task.status,
        durationMs: diagnostic.durationMs,
        marker
      });
      taskId = null;
    }

    console.log(JSON.stringify({
      ok: true,
      server: baseUrl,
      defaultProfileId: catalog.defaultProfileId,
      requestedProfiles: profileIds,
      availableProfiles: availableProfiles.map(({ id, backend, model, ready }) => ({ id, backend, model, ready })),
      tasks
    }, null, 2));
  } catch (error) {
    if (taskId) {
      try {
        const logs = await api(baseUrl, `/tasks/${encodeURIComponent(taskId)}/logs?from=0`);
        error.message = `${error.message}\nTask logs:\n${lastLogLines(logs, 20).join("\n")}`;
      } catch {
        // The server may already be unavailable; its captured output is printed below.
      }
    }
    const serverOutput = child.output.join("").trim();
    if (serverOutput) {
      error.message = `${error.message}\nServer output:\n${serverOutput.slice(-8000)}`;
    }
    throw error;
  } finally {
    await stopServer(child);
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
