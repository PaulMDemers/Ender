const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { TaskManager } = require("../src/runtime/taskManager");
const {
  TASK_STATUS,
  canTransitionTaskStatus,
  isActiveTaskStatus,
  isTerminalTaskStatus,
  outcomeStatusToTaskStatus
} = require("../src/runtime/taskLifecycle");
const runTaskModule = require("../src/runtime/runTask");

async function createManager(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-task-lifecycle-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir: path.join(root, "threads")
  });
  await manager.init();
  return manager;
}

function createSubscriber(order) {
  return {
    write(payload) {
      const event = String(payload).match(/^event: ([^\n]+)/)?.[1];
      if (event) order.push(event);
    },
    end() {
      order.push("end");
    }
  };
}

test("task lifecycle policy defines active, terminal, continuation, and outcome transitions", () => {
  assert.equal(isActiveTaskStatus(TASK_STATUS.RUNNING), true);
  assert.equal(isActiveTaskStatus(TASK_STATUS.AWAITING_APPROVAL), true);
  assert.equal(isTerminalTaskStatus(TASK_STATUS.DONE), true);
  assert.equal(isTerminalTaskStatus(TASK_STATUS.NEEDS_INPUT), true);

  assert.equal(canTransitionTaskStatus(TASK_STATUS.RUNNING, TASK_STATUS.AWAITING_APPROVAL), true);
  assert.equal(canTransitionTaskStatus(TASK_STATUS.AWAITING_APPROVAL, TASK_STATUS.RUNNING), true);
  assert.equal(canTransitionTaskStatus(TASK_STATUS.DONE, TASK_STATUS.RUNNING), true);
  assert.equal(canTransitionTaskStatus(TASK_STATUS.DONE, TASK_STATUS.BLOCKED), false);
  assert.equal(canTransitionTaskStatus("legacy_status", TASK_STATUS.RUNNING), true);
  assert.equal(canTransitionTaskStatus(TASK_STATUS.RUNNING, "unknown_target"), false);

  assert.equal(outcomeStatusToTaskStatus("completed"), TASK_STATUS.DONE);
  assert.equal(outcomeStatusToTaskStatus("blocked"), TASK_STATUS.BLOCKED);
  assert.equal(outcomeStatusToTaskStatus("needs_input"), TASK_STATUS.NEEDS_INPUT);
});

test("termination publishes status then completion before resolving waiters and closing streams", async (t) => {
  const manager = await createManager(t);
  manager._runThread = () => {};
  const started = manager.start("Terminate this task");
  const task = manager.tasks.get(started.id);
  const order = [];
  task.subs.add(createSubscriber(order));

  const originalSchedulePersist = manager._schedulePersist.bind(manager);
  manager._schedulePersist = (activeTask) => {
    order.push("persist_requested");
    return originalSchedulePersist(activeTask);
  };
  const originalResolveWaiters = manager._resolveWaiters.bind(manager);
  manager._resolveWaiters = (activeTask) => {
    order.push("waiters");
    return originalResolveWaiters(activeTask);
  };
  const waited = manager.waitForTask(task.id, { timeoutMs: 1_000 });

  assert.equal(manager.terminate(task.id).ok, true);
  assert.equal((await waited).task.status, TASK_STATUS.TERMINATED);
  assert.deepEqual(order, [
    "status",
    "persist_requested",
    "persist_requested",
    "complete",
    "waiters",
    "end"
  ]);
});

test("approval publication and resolution follow the centralized event sequence", async (t) => {
  const manager = await createManager(t);
  manager._runThread = () => {};
  const started = manager.start("Request approval");
  const task = manager.tasks.get(started.id);
  const order = [];
  task.subs.add(createSubscriber(order));
  manager.setNotificationClient({
    notifyTaskEvent(_task, type) {
      order.push(`notify:${type}`);
      return Promise.resolve();
    }
  });

  const approvalPromise = manager._requestApproval(task, {
    type: "test",
    title: "Approve",
    description: "Approve this operation?"
  });
  const [approvalId] = task.pendingApprovals.keys();
  assert.deepEqual(order, ["status", "approval_required", "notify:approval_required"]);

  order.length = 0;
  manager.resolveApproval(task.id, approvalId, true);
  assert.equal(await approvalPromise, true);
  assert.deepEqual(order, ["log", "status"]);
  assert.equal(task.status, TASK_STATUS.RUNNING);
});

test("successful execution emits assistant log, terminal status, completion, notification, then closes", async (t) => {
  const manager = await createManager(t);
  const originalRunTask = runTaskModule.runTask;
  let finishRun;
  runTaskModule.runTask = () => new Promise((resolve) => {
    finishRun = resolve;
  });
  t.after(() => {
    runTaskModule.runTask = originalRunTask;
  });

  const started = manager.start("Complete this task");
  const task = manager.tasks.get(started.id);
  const runPromise = task.runPromise;
  const order = [];
  task.subs.add(createSubscriber(order));
  manager.setNotificationClient({
    notifyTaskEvent(_task, type) {
      order.push(`notify:${type}`);
      return Promise.resolve();
    }
  });
  manager._persistTask = async () => {
    order.push("persisted");
  };
  const originalResolveWaiters = manager._resolveWaiters.bind(manager);
  manager._resolveWaiters = (activeTask) => {
    order.push("waiters");
    return originalResolveWaiters(activeTask);
  };

  finishRun({ result: "DONE:\nfinished", outcomeStatus: "completed" });
  await runPromise;
  clearTimeout(task.persistTimer);

  assert.equal(task.status, TASK_STATUS.DONE);
  assert.deepEqual(order, [
    "log",
    "status",
    "persisted",
    "complete",
    "waiters",
    "notify:task_completed",
    "end"
  ]);
});

test("invalid lifecycle transitions fail before changing task state", async (t) => {
  const manager = await createManager(t);
  manager._runThread = () => {};
  const started = manager.start("Already done");
  const task = manager.tasks.get(started.id);
  manager._transitionTask(task, TASK_STATUS.DONE, { publishStatus: false });

  assert.throws(
    () => manager._transitionTask(task, TASK_STATUS.BLOCKED),
    /Invalid task status transition: done -> blocked/
  );
  assert.equal(task.status, TASK_STATUS.DONE);
});
