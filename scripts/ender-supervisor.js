const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const cp = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { createCheckpoint, readCheckpoint, rollbackToCheckpoint } = require("../src/selfUpdate/checkpoints");
const { runApplyOperation } = require("../src/selfUpdate/runner");

const rootDir = path.resolve(__dirname, "..");
const entryFile = path.join(rootDir, "src", "server.js");
const storageDir = path.join(rootDir, ".ender-supervisor");
const checkpointsDir = path.join(storageDir, "checkpoints");
const operationsDir = path.join(storageDir, "operations");
const controlHost = process.env.ENDER_SUPERVISOR_HOST || "127.0.0.1";
const controlPort = Number(process.env.ENDER_SUPERVISOR_PORT || 3002);
const controlToken = String(process.env.ENDER_SUPERVISOR_TOKEN || randomUUID());
const childPort = Number(process.env.PORT || 3000);
const healthUrl = process.env.ENDER_SUPERVISOR_HEALTH_URL || `http://127.0.0.1:${childPort}/health`;
const defaultVerifyCommand = String(process.env.AGENT_SELF_UPDATE_VERIFY || "npm run verify").trim();
const defaultTimeoutMs = Number(process.env.AGENT_SELF_UPDATE_TIMEOUT_MS || 90_000);

let child = null;
let childRunning = false;
let shuttingDown = false;
let activeOperationId = null;
const operations = new Map();

function operationFile(id) {
  return path.join(operationsDir, `${id}.json`);
}

async function persistOperation(operation) {
  await fs.mkdir(operationsDir, { recursive: true });
  await fs.writeFile(operationFile(operation.id), JSON.stringify(operation, null, 2), "utf8");
}

async function loadOperations() {
  await fs.mkdir(operationsDir, { recursive: true });
  const entries = await fs.readdir(operationsDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(operationsDir, file.name), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.id) operations.set(parsed.id, parsed);
    } catch {
      // best effort
    }
  }
}

function currentStatus() {
  return {
    ok: true,
    supervisor: {
      host: controlHost,
      port: controlPort,
      rootDir,
      activeOperationId,
      child: {
        running: childRunning,
        pid: child?.pid || null,
        healthUrl
      }
    }
  };
}

function startChild() {
  const env = {
    ...process.env,
    AGENT_SELF_ROOT: rootDir,
    ENDER_SUPERVISOR_URL: `http://${controlHost}:${controlPort}`,
    ENDER_SUPERVISOR_TOKEN: controlToken,
    AGENT_SELF_UPDATE_VERIFY: defaultVerifyCommand,
    AGENT_SELF_UPDATE_TIMEOUT_MS: String(defaultTimeoutMs)
  };

  child = cp.spawn(process.execPath, [entryFile], {
    cwd: rootDir,
    stdio: "inherit",
    env
  });
  childRunning = true;
  console.log(`[supervisor] Started Ender child pid=${child.pid}`);

  child.on("exit", (code, signal) => {
    const exitedPid = child?.pid || null;
    childRunning = false;
    child = null;
    if (shuttingDown) return;
    console.log(`[supervisor] Child exited pid=${exitedPid ?? "unknown"} code=${code ?? 0} signal=${signal || "none"}`);
  });

  child.on("error", (err) => {
    console.error(`[supervisor] Failed to launch child: ${err.message || String(err)}`);
  });
}

async function restartChild(reason) {
  console.log(`[supervisor] Restart requested: ${reason}`);
  if (!childRunning || !child) {
    startChild();
    return;
  }

  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
  startChild();
}

function requireAuth(req, res) {
  const token = String(req.headers["x-ender-supervisor-token"] || "");
  if (token && token === controlToken) return true;
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "forbidden", message: "Invalid supervisor token" }));
  return false;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function listOperationsPayload() {
  const items = [...operations.values()]
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return { ok: true, items };
}

async function handleCreateCheckpoint(res, body) {
  const result = await createCheckpoint(rootDir, checkpointsDir, body.label);
  res.writeHead(result.ok ? 201 : 400, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

async function handleApply(res, body) {
  if (activeOperationId) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      error: "operation_in_progress",
      message: "A self-update operation is already running.",
      operationId: activeOperationId
    }));
    return;
  }

  const checkpointResult = await readCheckpoint(checkpointsDir, String(body.checkpointId || ""));
  if (!checkpointResult.ok) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(checkpointResult));
    return;
  }

  const operation = {
    id: randomUUID(),
    type: "apply",
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checkpoint: checkpointResult.checkpoint,
    checkpointId: checkpointResult.checkpoint.id,
    reason: String(body.reason || "").trim(),
    verifyCommand: String(body.verifyCommand || defaultVerifyCommand).trim(),
    timeoutMs: Number(body.timeoutMs || defaultTimeoutMs),
    rootDir,
    healthUrl,
    result: null
  };

  activeOperationId = operation.id;
  operations.set(operation.id, operation);
  await persistOperation(operation);

  (async () => {
    operation.status = "running";
    operation.updatedAt = new Date().toISOString();
    await persistOperation(operation);

    try {
      operation.result = await runApplyOperation(operation, {
        restartChild,
        rollbackToCheckpoint
      });
      operation.status = operation.result.status;
    } catch (err) {
      operation.status = "failed";
      operation.result = {
        error: "operation_failed",
        message: err.message || String(err)
      };
    } finally {
      operation.updatedAt = new Date().toISOString();
      activeOperationId = null;
      await persistOperation(operation);
    }
  })().catch(() => {});

  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    ok: true,
    accepted: true,
    operationId: operation.id,
    status: operation.status
  }));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${controlHost}:${controlPort}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(currentStatus()));
    return;
  }

  if (!requireAuth(req, res)) return;

  if (req.method === "GET" && url.pathname === "/operations") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listOperationsPayload()));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/operations/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const operation = operations.get(id);
    res.writeHead(operation ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(operation ? { ok: true, operation } : { ok: false, error: "not_found", message: "Operation not found" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/checkpoints") {
    const body = await readJsonBody(req);
    await handleCreateCheckpoint(res, body);
    return;
  }

  if (req.method === "POST" && url.pathname === "/apply") {
    const body = await readJsonBody(req);
    await handleApply(res, body);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found", message: "Unknown supervisor route" }));
}

function shutdown(signal) {
  shuttingDown = true;
  if (!child) {
    process.exit(0);
    return;
  }
  child.once("exit", () => process.exit(0));
  child.kill(signal);
}

async function main() {
  await fs.mkdir(checkpointsDir, { recursive: true });
  await fs.mkdir(operationsDir, { recursive: true });
  await loadOperations();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "internal_error", message: err.message || String(err) }));
    });
  });

  server.listen(controlPort, controlHost, () => {
    console.log(`[supervisor] Control server listening on http://${controlHost}:${controlPort}`);
    console.log(`[supervisor] Token ${controlToken}`);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  startChild();
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
