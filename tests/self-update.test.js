const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const { createCheckpoint, readCheckpoint, rollbackToCheckpoint } = require("../src/selfUpdate/checkpoints");
const { runApplyOperation } = require("../src/selfUpdate/runner");

async function exec(command, cwd) {
  return new Promise((resolve, reject) => {
    cp.exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message || String(error)));
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-self-update-"));
  await exec("git init", root);
  await exec("git config user.email test@example.com", root);
  await exec("git config user.name Test User", root);
  await fs.writeFile(path.join(root, "file.txt"), "v1\n", "utf8");
  await exec("git add file.txt", root);
  await exec("git commit -m \"initial\"", root);
  return root;
}

test("checkpoint creation requires a clean repo and rollback restores the checkpointed commit", async (t) => {
  const root = await makeRepo();
  const storageDir = path.join(root, ".checkpoints");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const created = await createCheckpoint(root, storageDir, "before self update");
  assert.equal(created.ok, true);

  await fs.writeFile(path.join(root, "file.txt"), "broken\n", "utf8");
  await fs.writeFile(path.join(root, "temp.txt"), "temp\n", "utf8");

  const loaded = await readCheckpoint(storageDir, created.checkpoint.id);
  assert.equal(loaded.ok, true);

  const rolledBack = await rollbackToCheckpoint(root, loaded.checkpoint);
  assert.equal(rolledBack.ok, true);
  assert.equal(await fs.readFile(path.join(root, "file.txt"), "utf8"), "v1\n");

  let tempExists = true;
  try {
    await fs.stat(path.join(root, "temp.txt"));
  } catch {
    tempExists = false;
  }
  assert.equal(tempExists, false);
});

test("checkpoint creation refuses a dirty repo", async (t) => {
  const root = await makeRepo();
  const storageDir = path.join(root, ".checkpoints");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(root, "file.txt"), "dirty\n", "utf8");
  const created = await createCheckpoint(root, storageDir, "dirty state");
  assert.equal(created.ok, false);
  assert.equal(created.error, "repo_not_clean");
});

test("runApplyOperation rolls back when verify fails", async () => {
  const calls = [];
  const result = await runApplyOperation({
    verifyCommand: "npm run verify",
    rootDir: "/repo",
    checkpoint: { id: "cp-1", headSha: "abc123" },
    healthUrl: "http://127.0.0.1:3000/health",
    timeoutMs: 1000
  }, {
    runCommandImpl: async () => ({ ok: false, code: 1, stdout: "", stderr: "verify failed" }),
    restartChild: async () => {
      calls.push("restart");
    },
    rollbackToCheckpoint: async () => {
      calls.push("rollback");
      return { ok: true };
    }
  });

  assert.equal(result.status, "verify_failed");
  assert.equal(result.rolledBack, true);
  assert.deepEqual(calls, ["rollback"]);
});

test("runApplyOperation restarts, waits for health, and rolls back on unhealthy boot", async () => {
  const calls = [];
  const result = await runApplyOperation({
    verifyCommand: "npm run verify",
    rootDir: "/repo",
    checkpoint: { id: "cp-1", headSha: "abc123" },
    healthUrl: "http://127.0.0.1:3000/health",
    timeoutMs: 1000
  }, {
    runCommandImpl: async () => ({ ok: true, code: 0, stdout: "ok", stderr: "" }),
    restartChild: async (reason) => {
      calls.push(`restart:${reason}`);
    },
    rollbackToCheckpoint: async () => {
      calls.push("rollback");
      return { ok: true };
    },
    waitForHealthImpl: async (_url, _timeout) => {
      calls.push("health");
      if (calls.filter((entry) => entry === "health").length === 1) {
        return { ok: false, error: "health_timeout", message: "down" };
      }
      return { ok: true };
    }
  });

  assert.equal(result.status, "rolled_back");
  assert.equal(result.rolledBack, true);
  assert.deepEqual(calls, [
    "restart:self-update apply",
    "health",
    "rollback",
    "restart:self-update rollback",
    "health"
  ]);
});
