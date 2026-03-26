const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const entryFile = path.join(rootDir, "src", "server.js");
const watchTargets = [
  path.join(rootDir, "src"),
  path.join(rootDir, ".env")
];

let child = null;
let childRunning = false;
let shuttingDown = false;
let restartTimer = null;
let pendingRestartReason = null;

function relativePath(target) {
  return path.relative(rootDir, target) || ".";
}

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleRestart(reason) {
  pendingRestartReason = reason;
  clearRestartTimer();
  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartServer();
  }, 100);
}

function startServer() {
  child = cp.spawn(process.execPath, [entryFile], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  });
  childRunning = true;
  console.log(`[dev:api] Started server pid=${child.pid}`);

  child.on("exit", (code, signal) => {
    const exitedPid = child && child.pid ? child.pid : null;
    childRunning = false;
    child = null;

    if (shuttingDown) {
      return;
    }

    const reason = pendingRestartReason;
    pendingRestartReason = null;

    if (reason) {
      console.log(`[dev:api] Restarting after ${reason} (previous pid=${exitedPid ?? "unknown"})`);
      startServer();
      return;
    }

    const detail = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    console.error(`[dev:api] Server process stopped with ${detail}. No local restart reason was pending; waiting for file changes to restart.`);
  });

  child.on("error", (err) => {
    console.error(`[dev:api] Failed to launch server: ${err.message || String(err)}`);
  });
}

function restartServer() {
  if (!childRunning || !child) {
    const reason = pendingRestartReason;
    pendingRestartReason = null;
    if (reason) {
      console.log(`[dev:api] Restarting after ${reason}`);
    }
    startServer();
    return;
  }

  console.log(`[dev:api] Sending SIGTERM to pid=${child.pid} due to ${pendingRestartReason || "requested restart"}`);
  child.kill("SIGTERM");
}

function watchTarget(target) {
  try {
    fs.watch(target, { recursive: fs.statSync(target).isDirectory() }, (_eventType, filename) => {
      const changed = filename ? path.join(target, filename) : target;
      scheduleRestart(`change in ${relativePath(changed)}`);
    });
  } catch (err) {
    console.error(`[dev:api] Failed to watch ${relativePath(target)}: ${err.message || String(err)}`);
  }
}

function shutdown(signal) {
  shuttingDown = true;
  clearRestartTimer();
  if (!child) {
    process.exit(0);
    return;
  }

  child.once("exit", () => {
    process.exit(0);
  });
  child.kill(signal);
}

for (const target of watchTargets) {
  if (fs.existsSync(target)) {
    watchTarget(target);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startServer();
