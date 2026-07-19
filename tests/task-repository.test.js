const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { JsonTaskRepository, assertSafeTaskId } = require("../src/runtime/jsonTaskRepository");
const { TaskManager } = require("../src/runtime/taskManager");
const {
  TASK_RECORD_VERSION,
  getTaskRecordVersion,
  migrateTaskRecord
} = require("../src/runtime/taskRecord");

async function makeTempDir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-task-repository-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("task record migration upgrades legacy records and rejects invalid future versions", () => {
  const legacy = migrateTaskRecord({ id: "legacy", goal: "Old record" });
  assert.equal(legacy.fromVersion, 0);
  assert.equal(legacy.version, TASK_RECORD_VERSION);
  assert.equal(legacy.migrated, true);
  assert.equal(legacy.record.recordVersion, TASK_RECORD_VERSION);

  const current = migrateTaskRecord({ recordVersion: TASK_RECORD_VERSION, id: "current" });
  assert.equal(current.migrated, false);
  assert.equal(getTaskRecordVersion(current.record), TASK_RECORD_VERSION);

  assert.throws(
    () => migrateTaskRecord({ recordVersion: TASK_RECORD_VERSION + 1, id: "future" }),
    /Unsupported task record version/
  );
  assert.throws(() => migrateTaskRecord([]), /must be a JSON object/);
  assert.throws(() => migrateTaskRecord({ recordVersion: "invalid" }), /non-negative integer/);
  assert.throws(() => migrateTaskRecord({ recordVersion: "1" }), /non-negative integer/);
});

test("JSON task repository serializes queued atomic writes and round-trips records", async (t) => {
  const root = await makeTempDir(t);
  const repository = new JsonTaskRepository({ threadsDir: root });
  await repository.init();

  await Promise.all([
    repository.save("task-1", { recordVersion: 1, id: "task-1", revision: 1 }),
    repository.save("task-1", { recordVersion: 1, id: "task-1", revision: 2 }),
    repository.save("task-1", { recordVersion: 1, id: "task-1", revision: 3 })
  ]);
  await repository.flush();

  const stored = JSON.parse(await fs.readFile(path.join(root, "task-1.json"), "utf8"));
  assert.equal(stored.revision, 3);
  await assert.rejects(fs.stat(path.join(root, "task-1.json.tmp")));

  const entries = await repository.loadAll();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].taskId, "task-1");
  assert.equal(entries[0].record.revision, 3);
  assert.equal(entries[0].error, null);
});

test("repository queue recovers after a failed write", async (t) => {
  const root = await makeTempDir(t);
  let failNextWrite = true;
  const fsImpl = {
    ...fs,
    async writeFile(...args) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("simulated write failure");
      }
      return fs.writeFile(...args);
    }
  };
  const repository = new JsonTaskRepository({ threadsDir: root, fsImpl });

  await assert.rejects(
    repository.save("task-1", { recordVersion: 1, id: "task-1", revision: 1 }),
    /simulated write failure/
  );
  await repository.save("task-1", { recordVersion: 1, id: "task-1", revision: 2 });
  const stored = JSON.parse(await fs.readFile(path.join(root, "task-1.json"), "utf8"));
  assert.equal(stored.revision, 2);
});

test("repository reports malformed records, ignores temp files, and deletes target plus temp", async (t) => {
  const root = await makeTempDir(t);
  const repository = new JsonTaskRepository({ threadsDir: root });
  await repository.init();
  await repository.save("valid", { recordVersion: 1, id: "valid" });
  await fs.writeFile(path.join(root, "broken.json"), "{", "utf8");
  await fs.writeFile(path.join(root, "orphan.json.tmp"), "temporary", "utf8");

  const entries = await repository.loadAll();
  assert.deepEqual(entries.map((entry) => entry.taskId), ["broken", "valid"]);
  assert.ok(entries[0].error instanceof Error);
  assert.equal(entries[1].record.id, "valid");

  await fs.writeFile(path.join(root, "valid.json.tmp"), "temporary", "utf8");
  await repository.delete("valid");
  await assert.rejects(fs.stat(path.join(root, "valid.json")));
  await assert.rejects(fs.stat(path.join(root, "valid.json.tmp")));
});

test("repository rejects task ids that could escape the threads directory", () => {
  assert.equal(assertSafeTaskId("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  for (const taskId of ["", ".", "..", "../escape", "nested/task", "nested\\task", "bad\0id"]) {
    assert.throws(() => assertSafeTaskId(taskId), /not safe/);
  }
});

test("TaskManager migrates valid legacy records and skips malformed, mismatched, and future records", async (t) => {
  const root = await makeTempDir(t);
  const threadsDir = path.join(root, "threads");
  await fs.mkdir(threadsDir, { recursive: true });
  const now = new Date().toISOString();
  const legacy = {
    id: "legacy",
    goal: "Legacy task",
    status: "done",
    startedAt: now,
    finishedAt: now,
    logs: [],
    thread: [{ role: "user", content: "Legacy task" }],
    workspace: root,
    workspaceLabel: root,
    pendingApprovals: []
  };
  await fs.writeFile(path.join(threadsDir, "legacy.json"), JSON.stringify(legacy), "utf8");
  await fs.writeFile(path.join(threadsDir, "broken.json"), "{", "utf8");
  await fs.writeFile(
    path.join(threadsDir, "mismatch.json"),
    JSON.stringify({ ...legacy, id: "different" }),
    "utf8"
  );
  await fs.writeFile(
    path.join(threadsDir, "future.json"),
    JSON.stringify({ ...legacy, id: "future", recordVersion: TASK_RECORD_VERSION + 1 }),
    "utf8"
  );

  const warnings = [];
  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir
  }, {
    logger: { warn: (message) => warnings.push(String(message)) }
  });
  manager._runThread = () => {};
  await manager.init();

  assert.deepEqual(manager.list().map((task) => task.id), ["legacy"]);
  const migrated = JSON.parse(await fs.readFile(path.join(threadsDir, "legacy.json"), "utf8"));
  assert.equal(migrated.recordVersion, TASK_RECORD_VERSION);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((warning) => warning.includes("broken.json")));
  assert.ok(warnings.some((warning) => warning.includes("does not match filename")));
  assert.ok(warnings.some((warning) => warning.includes("Unsupported task record version")));
});

test("TaskManager uses an injected repository for load, save, delete, and flush", async () => {
  const calls = [];
  const record = {
    recordVersion: TASK_RECORD_VERSION,
    id: "task-1",
    goal: "Injected record",
    status: "done",
    startedAt: new Date().toISOString(),
    logs: [],
    thread: [],
    workspace: "/tmp",
    workspaceLabel: "/tmp",
    pendingApprovals: []
  };
  const repository = {
    init: async () => calls.push("init"),
    loadAll: async () => [{ taskId: "task-1", filePath: "/virtual/task-1.json", record, error: null }],
    save: async (id, savedRecord) => calls.push(["save", id, savedRecord.recordVersion]),
    delete: async (id) => calls.push(["delete", id]),
    flush: async () => calls.push("flush")
  };
  const manager = new TaskManager({
    workdir: "/tmp",
    workspaceBase: "/tmp",
    threadsDir: "/virtual"
  }, { taskRepository: repository });
  manager._runThread = () => {};

  await manager.init();
  assert.equal(manager.get("task-1").goal, "Injected record");
  await manager.delete("task-1");
  await manager.shutdown();
  assert.deepEqual(calls, [
    "init",
    ["save", "task-1", TASK_RECORD_VERSION],
    ["delete", "task-1"],
    "flush"
  ]);
});
