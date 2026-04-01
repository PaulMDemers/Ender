const cp = require("node:child_process");

function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    cp.exec(cmd, { cwd, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || "")
      });
    });
  });
}

async function waitForHealth(healthUrl, timeoutMs = 90_000, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        return { ok: true };
      }
      lastError = `health check failed (${res.status})`;
    } catch (err) {
      lastError = err.message || String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    ok: false,
    error: "health_timeout",
    message: lastError || "Timed out waiting for health"
  };
}

async function runApplyOperation(operation, deps) {
  const {
    runCommandImpl = runCommand,
    restartChild,
    rollbackToCheckpoint,
    waitForHealthImpl = waitForHealth
  } = deps;

  const verify = await runCommandImpl(operation.verifyCommand, operation.rootDir);
  if (!verify.ok) {
    const rollback = await rollbackToCheckpoint(operation.rootDir, operation.checkpoint);
    return {
      status: "verify_failed",
      verify,
      rollback,
      rolledBack: rollback.ok
    };
  }

  await restartChild("self-update apply");

  const health = await waitForHealthImpl(operation.healthUrl, operation.timeoutMs);
  if (health.ok) {
    return {
      status: "applied",
      verify,
      health,
      rolledBack: false
    };
  }

  const rollback = await rollbackToCheckpoint(operation.rootDir, operation.checkpoint);
  await restartChild("self-update rollback");
  const rollbackHealth = await waitForHealthImpl(operation.healthUrl, operation.timeoutMs);

  return {
    status: rollback.ok ? "rolled_back" : "rollback_failed",
    verify,
    health,
    rollback,
    rollbackHealth,
    rolledBack: true
  };
}

module.exports = {
  runCommand,
  waitForHealth,
  runApplyOperation
};
