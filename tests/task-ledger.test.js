const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../src/api/app");
const { TaskLedgerManager, buildTaskLedgerTaskPrompt } = require("../src/runtime/taskLedgerManager");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-task-ledger-"));
}

function createTaskManagerDouble() {
  const tasks = new Map();
  const started = [];

  return {
    started,
    tasks,
    start(prompt, workspace) {
      const id = `task-${started.length + 1}`;
      const task = {
        id,
        goal: prompt,
        status: "running",
        finishedAt: null,
        result: null,
        workspace: workspace || null
      };
      tasks.set(id, task);
      started.push({ id, prompt, workspace });
      return { ok: true, id };
    },
    getTaskSummary(id) {
      const task = tasks.get(String(id));
      return task ? { ...task } : null;
    }
  };
}

test("buildTaskLedgerTaskPrompt injects the required worker procedure", () => {
  const prompt = buildTaskLedgerTaskPrompt({
    title: "Ship the orchestration feature",
    prompt: "Implement the orchestration feature end-to-end.",
    workspace: "/tmp/example"
  });

  assert.match(prompt, /global task ledger/i);
  assert.match(prompt, /Inspect the workspace first/i);
  assert.match(prompt, /Build a concrete plan and a checklist/i);
  assert.match(prompt, /add tests when practical/i);
  assert.match(prompt, /Original task request:/i);
});

test("TaskLedgerManager auto-dispatches pending work and marks it complete when the linked task finishes", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const taskManager = createTaskManagerDouble();
  const manager = new TaskLedgerManager({
    config: {
      taskLedgerDir: path.join(root, "task-ledger"),
      taskLedgerPollIntervalMs: 0,
      taskLedgerMaxAutoAgents: 1
    },
    taskManager
  });

  await manager.init();
  const created = await manager.create({
    title: "Implement queued orchestration",
    prompt: "Add a global work ledger with slot-based auto dispatch.",
    workspace: "/tmp/workspace-a"
  });

  assert.equal(created.ok, true);
  assert.equal(taskManager.started.length, 1);

  const startedTaskId = taskManager.started[0].id;
  const runningEntry = manager.get(created.entry.id);
  assert.equal(runningEntry.status, "running");
  assert.equal(runningEntry.startedTaskId, startedTaskId);
  assert.match(taskManager.started[0].prompt, /Required procedure:/);

  taskManager.tasks.set(startedTaskId, {
    id: startedTaskId,
    goal: taskManager.started[0].prompt,
    status: "done",
    finishedAt: "2026-04-08T10:00:00.000Z",
    result: "DONE:\nfeature shipped"
  });

  await manager.reconcile({ dispatch: false });
  const completedEntry = manager.get(created.entry.id);

  assert.equal(completedEntry.status, "completed");
  assert.equal(completedEntry.completedTaskId, startedTaskId);
  assert.equal(completedEntry.lastTaskStatus, "done");
  assert.equal(completedEntry.result, "DONE:\nfeature shipped");
});

test("TaskLedgerManager respects max auto agent slots and dispatches the next item after capacity frees up", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const taskManager = createTaskManagerDouble();
  const manager = new TaskLedgerManager({
    config: {
      taskLedgerDir: path.join(root, "task-ledger"),
      taskLedgerPollIntervalMs: 0,
      taskLedgerMaxAutoAgents: 1
    },
    taskManager
  });

  await manager.init();

  const first = await manager.create({
    title: "Task one",
    prompt: "First queued task"
  });
  const second = await manager.create({
    title: "Task two",
    prompt: "Second queued task"
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(taskManager.started.length, 1);
  assert.equal(manager.get(second.entry.id).status, "pending");

  const firstTaskId = taskManager.started[0].id;
  taskManager.tasks.set(firstTaskId, {
    id: firstTaskId,
    goal: taskManager.started[0].prompt,
    status: "done",
    finishedAt: "2026-04-08T10:05:00.000Z",
    result: "DONE:\nfirst task done"
  });

  await manager.reconcile({ dispatch: true });

  assert.equal(taskManager.started.length, 2);
  assert.equal(manager.get(second.entry.id).status, "running");
  assert.equal(manager.get(second.entry.id).startedTaskId, taskManager.started[1].id);
});

test("task ledger API exposes create, list, and run endpoints", async (t) => {
  const calls = [];
  const taskLedgerManager = {
    maxAutoAgents: 2,
    pollIntervalMs: 5000,
    list() {
      return [{ id: "entry-1", title: "Queued", status: "pending" }];
    },
    get(id) {
      return id === "entry-1" ? { id: "entry-1", title: "Queued", status: "pending" } : null;
    },
    async create(input) {
      calls.push({ kind: "create", input });
      return {
        ok: true,
        entry: { id: "entry-2", title: String(input.title), status: "pending" }
      };
    },
    async update(id, input) {
      calls.push({ kind: "update", id, input });
      return {
        ok: true,
        entry: { id, title: "Updated", status: input.status || "pending" }
      };
    },
    async runNow(id) {
      calls.push({ kind: "runNow", id });
      return {
        ok: true,
        entry: { id, title: "Queued", status: "running" },
        startedTaskId: "task-123"
      };
    }
  };

  const app = createApp(
    { list: () => [] },
    { list: () => [] },
    { list: () => [] },
    {},
    null,
    null,
    taskLedgerManager
  );

  const server = app.listen(0);
  t.after(() => {
    server.close();
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const listRes = await fetch(`${baseUrl}/task-ledger`);
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.maxAutoAgents, 2);

  const createRes = await fetch(`${baseUrl}/task-ledger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New ledger item", prompt: "Do the work" })
  });
  assert.equal(createRes.status, 201);
  const createdBody = await createRes.json();
  assert.equal(createdBody.id, "entry-2");

  const runRes = await fetch(`${baseUrl}/task-ledger/entry-1/run`, { method: "POST" });
  assert.equal(runRes.status, 201);
  const runBody = await runRes.json();
  assert.equal(runBody.startedTaskId, "task-123");

  assert.deepEqual(calls, [
    { kind: "create", input: { title: "New ledger item", prompt: "Do the work" } },
    { kind: "runNow", id: "entry-1" }
  ]);
});
