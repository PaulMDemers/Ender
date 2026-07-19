const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { TaskApprovalCoordinator } = require("../src/runtime/taskApprovalCoordinator");
const { TaskManager } = require("../src/runtime/taskManager");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-approval-test-"));
}

async function createManager(t, options = {}) {
  const root = await makeTempDir();
  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir: path.join(root, "threads"),
    selfRoot: path.join(root, "self")
  }, options);
  await manager.init();
  t.after(async () => {
    await manager.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { manager, root };
}

test("TaskApprovalCoordinator creates, resolves, lists, and rejects approvals", async () => {
  const ids = ["approval-1", "approval-2"];
  const coordinator = new TaskApprovalCoordinator({
    createId: () => ids.shift(),
    now: () => "2026-07-18T12:00:00.000Z"
  });
  const task = { pendingApprovals: coordinator.createStore() };

  const first = coordinator.request(task, {
    id: "caller-controlled-id",
    type: "shell",
    title: "Run command",
    description: "Allow this command?",
    details: { command: "npm test" },
    requestedAt: "2000-01-01T00:00:00.000Z"
  });
  const second = coordinator.request(task, {});

  assert.equal(coordinator.count(task), 2);
  assert.deepEqual(coordinator.list(task), [
    {
      id: "approval-1",
      type: "shell",
      title: "Run command",
      description: "Allow this command?",
      details: { command: "npm test" },
      requestedAt: "2026-07-18T12:00:00.000Z"
    },
    {
      id: "approval-2",
      type: "generic",
      title: "Approval required",
      description: "Please confirm this action",
      details: {},
      requestedAt: "2026-07-18T12:00:00.000Z"
    }
  ]);

  assert.deepEqual(coordinator.resolve(task, "approval-1", true), {
    ok: true,
    approval: first.approval,
    remaining: 1
  });
  assert.equal(await first.decision, true);
  assert.deepEqual(coordinator.resolve(task, "missing", true), {
    ok: false,
    error: "approval_not_found"
  });

  assert.equal(coordinator.rejectAll(task), 1);
  assert.equal(await second.decision, false);
  assert.equal(coordinator.count(task), 0);
});

test("TaskApprovalCoordinator hydrates serializable approval records", () => {
  const coordinator = new TaskApprovalCoordinator({
    now: () => "2026-07-18T12:00:00.000Z"
  });
  const task = {
    pendingApprovals: coordinator.createStore([
      {
        id: "persisted-approval",
        type: "git",
        title: "Push branch",
        description: "Allow push?",
        details: { branch: "codex/example" },
        requestedAt: "2026-07-17T10:00:00.000Z"
      },
      { title: "Invalid record without an id" }
    ])
  };

  assert.deepEqual(coordinator.list(task), [{
    id: "persisted-approval",
    type: "git",
    title: "Push branch",
    description: "Allow push?",
    details: { branch: "codex/example" },
    requestedAt: "2026-07-17T10:00:00.000Z"
  }]);
});

test("TaskManager delegates approval mechanics and preserves lifecycle policy", async (t) => {
  const ids = ["approval-1", "approval-2", "approval-3", "approval-4"];
  const coordinator = new TaskApprovalCoordinator({
    createId: () => ids.shift(),
    now: () => "2026-07-18T12:00:00.000Z"
  });
  const { manager } = await createManager(t, { approvalCoordinator: coordinator });
  manager._runThread = () => {};

  const started = manager.start("Coordinate approvals");
  const task = manager.tasks.get(started.id);
  const first = manager._requestApproval(task, { title: "First" });
  const second = manager._requestApproval(task, { title: "Second" });

  assert.equal(task.status, "awaiting_approval");
  assert.deepEqual(manager.get(task.id).pendingApprovals.map((item) => item.id), [
    "approval-1",
    "approval-2"
  ]);

  assert.equal(manager.resolveApproval(task.id, "approval-1", true).ok, true);
  assert.equal(await first, true);
  assert.equal(task.status, "awaiting_approval");
  assert.equal(manager.resolveApproval(task.id, "approval-2", false).ok, true);
  assert.equal(await second, false);
  assert.equal(task.status, "running");

  const terminatedDecision = manager._requestApproval(task, { title: "Terminate" });
  assert.equal(manager.terminate(task.id).ok, true);
  assert.equal(await terminatedDecision, false);
  assert.equal(coordinator.count(task), 0);

  const shutdownTaskId = manager.start("Shutdown approval").id;
  const shutdownTask = manager.tasks.get(shutdownTaskId);
  const shutdownDecision = manager._requestApproval(shutdownTask, { title: "Shutdown" });
  await manager.shutdown();
  assert.equal(await shutdownDecision, false);
  assert.equal(coordinator.count(shutdownTask), 0);
});

test("TaskManager rejects approvals owned by a superseded run", async (t) => {
  let runCount = 0;
  let firstDecision;
  let finishSecond;
  const runner = {
    run(input) {
      runCount += 1;
      if (runCount === 1) {
        return input.requestApproval({ title: "Old run approval" }).then((approved) => {
          firstDecision = approved;
          return { result: "old result", outcomeStatus: "done" };
        });
      }
      return new Promise((resolve) => {
        finishSecond = resolve;
      });
    }
  };
  const { manager } = await createManager(t, { taskRunner: runner });
  const started = manager.start("Supersede approval run");
  const task = manager.tasks.get(started.id);
  const firstRun = task.runPromise;

  assert.equal(task.status, "awaiting_approval");
  assert.equal(task.pendingApprovals.size, 1);
  manager._runThread(task);
  const secondRun = task.runPromise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(firstDecision, false);
  assert.equal(task.pendingApprovals.size, 0);
  assert.equal(task.status, "running");

  finishSecond({ result: "new result", outcomeStatus: "done" });
  await Promise.all([firstRun, secondRun]);
  assert.equal(task.status, "done");
  assert.equal(task.result, "new result");
  assert.equal(task.logs.some((entry) => entry.data === "old result"), false);
});

test("TaskManager clears persisted approvals when restart interrupts a waiting task", async (t) => {
  const root = await makeTempDir();
  const threadsDir = path.join(root, "threads");
  const taskId = "waiting-task";
  await fs.mkdir(threadsDir, { recursive: true });
  await fs.writeFile(path.join(threadsDir, `${taskId}.json`), JSON.stringify({
    recordVersion: 1,
    id: taskId,
    goal: "Wait for approval",
    status: "awaiting_approval",
    startedAt: "2026-07-18T10:00:00.000Z",
    logs: [],
    result: null,
    runCount: 1,
    thread: [{ role: "user", content: "Wait for approval" }],
    workspace: root,
    workspaceLabel: root,
    autoRestartOnInterruption: false,
    pendingApprovals: [{
      id: "persisted-approval",
      type: "shell",
      title: "Run command",
      description: "Allow command?",
      details: {},
      requestedAt: "2026-07-18T10:01:00.000Z"
    }]
  }, null, 2));

  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir,
    selfRoot: path.join(root, "self")
  });
  t.after(async () => {
    await manager.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  });

  await manager.init();
  const task = manager.tasks.get(taskId);
  assert.equal(task.status, "error");
  assert.equal(task.pendingApprovals.size, 0);

  const persisted = JSON.parse(await fs.readFile(path.join(threadsDir, `${taskId}.json`), "utf8"));
  assert.equal(persisted.status, "error");
  assert.deepEqual(persisted.pendingApprovals, []);
});
