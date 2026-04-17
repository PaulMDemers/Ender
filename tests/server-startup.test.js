const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  collectRuntimeDirectories,
  ensureRuntimeDirectories
} = require("../src/startup/ensureRuntimeDirectories");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-startup-"));
}

test("collectRuntimeDirectories returns unique configured runtime paths", () => {
  const config = {
    workdir: "/tmp/ender/workspace",
    workspaceBase: "/tmp/ender",
    threadsDir: "/tmp/ender/threads",
    schedulesDir: "/tmp/ender/schedules",
    taskLedgerDir: "/tmp/ender/task-ledger",
    workflowSessionsDir: "/tmp/ender/workflow-sessions",
    codeServer: {
      stateDir: "/tmp/ender/.ender-code-server",
      hostWorkdir: "/tmp/ender/workspace"
    }
  };

  assert.deepEqual(collectRuntimeDirectories(config), [
    "/tmp/ender/workspace",
    "/tmp/ender",
    "/tmp/ender/threads",
    "/tmp/ender/schedules",
    "/tmp/ender/task-ledger",
    "/tmp/ender/workflow-sessions",
    "/tmp/ender/.ender-code-server"
  ]);
});

test("ensureRuntimeDirectories creates missing runtime directories used by server startup", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const config = {
    workdir: path.join(root, "workspace"),
    workspaceBase: path.join(root, "workspace-base"),
    threadsDir: path.join(root, "threads"),
    schedulesDir: path.join(root, "schedules"),
    taskLedgerDir: path.join(root, "task-ledger"),
    workflowSessionsDir: path.join(root, "workflow-sessions"),
    codeServer: {
      stateDir: path.join(root, ".ender-code-server"),
      hostWorkdir: path.join(root, "workspace")
    }
  };

  await ensureRuntimeDirectories(config);

  for (const target of collectRuntimeDirectories(config)) {
    const stat = await fs.stat(target);
    assert.equal(stat.isDirectory(), true, `${target} should exist`);
  }
});
