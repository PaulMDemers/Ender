import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const processes = new Set();

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

function startProcess(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  const capture = (chunk) => {
    output.push(String(chunk));
    if (output.length > 80) output.shift();
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.label = label;
  child.output = output;
  child.exitResult = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  processes.add(child);
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    processes.delete(child);
    return;
  }
  child.kill("SIGTERM");
  const result = await Promise.race([
    child.exitResult,
    new Promise((resolve) => setTimeout(() => resolve(null), 10_000))
  ]);
  if (!result) {
    child.kill("SIGKILL");
    await child.exitResult;
  }
  processes.delete(child);
}

async function waitForResponse(url, options = {}, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "no response"}`);
}

function createApiEnv(port, dataRoot, overrides = {}) {
  return {
    ...process.env,
    PORT: String(port),
    ENDER_API_ACCESS_MODE: "local",
    ENDER_API_BIND_HOST: "127.0.0.1",
    ENDER_CORS_ORIGINS: "",
    ENDER_SHUTDOWN_TIMEOUT_MS: "5000",
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
    CODE_SERVER_ENABLED: "false",
    CODE_SERVER_STATE_DIR: path.join(dataRoot, "code-server"),
    LLM_BACKEND: "acp",
    ACP_COMMAND: "",
    PILLAR_ENABLED: "false",
    BEACON_ENABLED: "false",
    ...overrides
  };
}

async function smokeDirectApi(dataRoot) {
  const port = await reservePort();
  const api = startProcess(
    "direct API",
    process.execPath,
    ["src/server.js"],
    createApiEnv(port, path.join(dataRoot, "direct-api"))
  );
  try {
    const healthResponse = await waitForResponse(`http://127.0.0.1:${port}/health`);
    const health = await healthResponse.json();
    assert.equal(health.app?.name, "Ender");
    assert.match(health.app?.version || "", /^\d+\.\d+\.\d+/);
    assert.equal(health.services?.apiAccess?.mode, "local");
    assert.equal(health.services?.apiAccess?.remoteAccess, false);
    assert.equal(healthResponse.headers.get("x-ender-api-version"), "1");

    const tasksResponse = await waitForResponse(`http://127.0.0.1:${port}/tasks`);
    assert.deepEqual(await tasksResponse.json(), { items: [] });
    return { port, version: health.app.version, apiContract: healthResponse.headers.get("x-ender-api-version") };
  } finally {
    await stopProcess(api);
  }
}

async function smokeProductionUi() {
  await fs.access(path.join(repoRoot, "ui", "dist", "index.html"));
  const port = await reservePort();
  const preview = startProcess(
    "production UI preview",
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--workspace", "ui", "run", "preview", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    process.env
  );
  try {
    const response = await waitForResponse(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    assert.match(html, /<div id="root"><\/div>/);
    const assetPaths = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((match) => match[1].slice(1));
    assert.ok(assetPaths.length >= 2, "production index should reference built JavaScript and CSS assets");
    for (const assetPath of assetPaths) {
      const assetResponse = await waitForResponse(`http://127.0.0.1:${port}${assetPath}`);
      const assetBody = await assetResponse.arrayBuffer();
      assert.ok(assetBody.byteLength > 0, `${assetPath} should not be empty`);
    }
    return { port, assets: assetPaths.length };
  } finally {
    await stopProcess(preview);
  }
}

async function smokePillarRelay(dataRoot) {
  const pillarPort = await reservePort();
  const apiPort = await reservePort();
  const pillarUrl = `http://127.0.0.1:${pillarPort}`;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const serverToken = "ender-release-smoke-server";
  const clientToken = "ender-release-smoke-client";
  const pillar = startProcess("Pillar relay", process.execPath, ["scripts/pillar-server.js"], {
    ...process.env,
    PORT: "",
    PILLAR_PORT: String(pillarPort),
    PILLAR_AUTH_MODE: "legacy",
    PILLAR_SERVER_TOKEN: serverToken,
    PILLAR_CLIENT_TOKEN: clientToken,
    PILLAR_DATA_FILE: path.join(dataRoot, "pillar", "pillar.json"),
    PILLAR_REQUEST_TIMEOUT_MS: "5000",
    PILLAR_POLL_TIMEOUT_MS: "200"
  });
  let api = null;
  try {
    await waitForResponse(`${pillarUrl}/health`);
    api = startProcess(
      "Pillar-connected API",
      process.execPath,
      ["src/server.js"],
      createApiEnv(apiPort, path.join(dataRoot, "pillar-api"), {
        PILLAR_ENABLED: "true",
        PILLAR_URL: pillarUrl,
        PILLAR_SERVER_ID: "home",
        PILLAR_SERVER_TOKEN: serverToken,
        PILLAR_LOCAL_BASE_URL: apiUrl,
        PILLAR_POLL_TIMEOUT_MS: "200",
        PILLAR_RETRY_DELAY_MS: "50"
      })
    );
    await waitForResponse(`${apiUrl}/health`);

    const relayResponse = await waitForResponse(`${pillarUrl}/api/home/health`, {
      headers: { authorization: `Bearer ${clientToken}` }
    });
    const relayedHealth = await relayResponse.json();
    assert.equal(relayedHealth.app?.name, "Ender");
    assert.equal(relayedHealth.services?.pillar?.enabled, true);
    assert.equal(relayResponse.headers.get("x-ender-api-version"), "1");

    const statusResponse = await waitForResponse(`${apiUrl}/pillar/status`);
    const status = await statusResponse.json();
    assert.equal(status.enabled, true);
    assert.equal(status.running, true);
    assert.equal(status.serverId, "home");
    assert.ok(status.lastPollAt, "Pillar connector should have completed a poll");
    return { pillarPort, apiPort, serverId: status.serverId, relayedApiContract: relayResponse.headers.get("x-ender-api-version") };
  } finally {
    await stopProcess(api);
    await stopProcess(pillar);
  }
}

async function main() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ender-release-smoke-"));
  try {
    const directApi = await smokeDirectApi(dataRoot);
    const productionUi = await smokeProductionUi();
    const pillar = await smokePillarRelay(dataRoot);
    console.log(JSON.stringify({ ok: true, directApi, productionUi, pillar }, null, 2));
  } finally {
    await Promise.all([...processes].map(stopProcess));
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  for (const child of processes) {
    console.error(`[${child.label}]\n${child.output.join("")}`);
  }
  process.exitCode = 1;
});
