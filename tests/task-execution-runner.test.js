const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { TaskExecutionRunner } = require("../src/runtime/taskExecutionRunner");
const { TaskManager } = require("../src/runtime/taskManager");

function createRunnerInput(overrides = {}) {
  const signal = overrides.signal || new AbortController().signal;
  const task = {
    id: "task-1",
    goal: "Run the task",
    workspace: "/workspace/original",
    projectId: "project-1",
    llmProfileId: "profile-1",
    ...overrides.task
  };
  const taskManager = overrides.taskManager || {
    getTaskForContext: (id) => ({ id, workspace: task.workspace })
  };
  return {
    task,
    thread: [{ role: "user", content: "Run the task" }],
    signal,
    onLog: overrides.onLog || (() => {}),
    requestApproval: overrides.requestApproval || (async () => false),
    onWorkspacePrepared: overrides.onWorkspacePrepared || (() => {}),
    runtime: {
      config: { backend: "openai" },
      scheduleManager: { id: "schedules" },
      taskManager,
      selfUpdateManager: { id: "updates" },
      taskLedgerManager: { id: "ledger" },
      projectManager: overrides.projectManager || null,
      memoryManager: { id: "memory" },
      llmProfileManager: overrides.llmProfileManager || null
    }
  };
}

async function createTaskManager(t, taskRunner) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-task-runner-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir: path.join(root, "threads")
  }, { taskRunner });
  await manager.init();
  return manager;
}

test("TaskExecutionRunner prepares project workspace, resolves profile, and forwards runtime dependencies", async () => {
  const order = [];
  let received = null;
  const runner = new TaskExecutionRunner({
    runTaskImpl: async (input) => {
      order.push("runTask");
      received = input;
      return { result: "DONE:\ncomplete", outcomeStatus: "completed" };
    }
  });
  const onLog = () => {};
  const requestApproval = async () => true;
  const taskManager = {
    getTaskForContext(id) {
      order.push("context");
      return { id, workspace: "/workspace/prepared" };
    }
  };
  const input = createRunnerInput({
    onLog,
    requestApproval,
    taskManager,
    projectManager: {
      async ensureWorkspace(id) {
        order.push(`project:${id}`);
        return { ok: true, workspacePath: "/workspace/prepared" };
      }
    },
    llmProfileManager: {
      buildRunConfig(id) {
        order.push(`profile:${id}`);
        return { backend: "ollama", activeLlmProfileId: id };
      }
    },
    onWorkspacePrepared(workspace) {
      order.push(`workspace:${workspace}`);
    }
  });

  const result = await runner.run(input);
  assert.equal(result.outcomeStatus, "completed");
  assert.deepEqual(order, [
    "project:project-1",
    "workspace:/workspace/prepared",
    "profile:profile-1",
    "context",
    "runTask"
  ]);
  assert.equal(received.workspaceDir, "/workspace/prepared");
  assert.equal(received.config.backend, "ollama");
  assert.equal(received.onLog, onLog);
  assert.equal(received.requestApproval, requestApproval);
  assert.equal(received.taskManager, taskManager);
  assert.equal(received.signal, input.signal);
});

test("TaskExecutionRunner preserves blocked and needs-input outcomes", async () => {
  for (const outcomeStatus of ["blocked", "needs_input"]) {
    const runner = new TaskExecutionRunner({
      runTaskImpl: async () => ({ result: outcomeStatus, outcomeStatus })
    });
    const result = await runner.run(createRunnerInput({
      task: { projectId: null },
      llmProfileManager: null
    }));
    assert.deepEqual(result, { result: outcomeStatus, outcomeStatus });
  }
});

test("TaskExecutionRunner propagates project failures and execution errors", async () => {
  let runCalls = 0;
  const projectFailure = new TaskExecutionRunner({
    runTaskImpl: async () => {
      runCalls += 1;
    }
  });
  await assert.rejects(
    projectFailure.run(createRunnerInput({
      projectManager: { ensureWorkspace: async () => ({ ok: false, error: "clone_failed", message: "Clone failed" }) }
    })),
    /Clone failed/
  );
  assert.equal(runCalls, 0);

  const executionFailure = new TaskExecutionRunner({
    runTaskImpl: async () => {
      throw new Error("provider failed");
    }
  });
  await assert.rejects(
    executionFailure.run(createRunnerInput({ task: { projectId: null } })),
    /provider failed/
  );
});

test("TaskExecutionRunner stops after cancellation during workspace preparation", async () => {
  const controller = new AbortController();
  let finishWorkspace;
  let runCalls = 0;
  const runner = new TaskExecutionRunner({
    runTaskImpl: async () => {
      runCalls += 1;
    }
  });
  const promise = runner.run(createRunnerInput({
    signal: controller.signal,
    projectManager: {
      ensureWorkspace: () => new Promise((resolve) => {
        finishWorkspace = resolve;
      })
    }
  }));

  controller.abort(new Error("superseded"));
  finishWorkspace({ ok: true, workspacePath: "/workspace/prepared" });
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(runCalls, 0);
});

test("TaskManager maps injected runner outcomes and errors onto lifecycle states", async (t) => {
  const outcomes = [
    { response: { result: "blocked", outcomeStatus: "blocked" }, status: "blocked" },
    { response: { result: "input", outcomeStatus: "needs_input" }, status: "needs_input" },
    { error: new Error("runner failed"), status: "error" }
  ];

  for (const entry of outcomes) {
    const runner = {
      async run() {
        if (entry.error) throw entry.error;
        return entry.response;
      }
    };
    const manager = await createTaskManager(t, runner);
    const started = manager.start(`Outcome ${entry.status}`);
    const waited = await manager.waitForTask(started.id, { timeoutMs: 1_000 });
    assert.equal(waited.task.status, entry.status);
  }
});

test("TaskManager ignores stale runner logs, approvals, results, and errors after supersession", async (t) => {
  const runs = [];
  const runner = {
    run(input) {
      return new Promise((resolve, reject) => {
        runs.push({ input, resolve, reject });
      });
    }
  };
  const manager = await createTaskManager(t, runner);
  const started = manager.start("Race two runs");
  const task = manager.tasks.get(started.id);
  const firstPromise = task.runPromise;
  assert.equal(runs.length, 1);

  manager._runThread(task);
  const secondPromise = task.runPromise;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].input.signal.aborted, true);

  runs[0].input.onLog({ level: "info", data: "stale log" });
  assert.equal(await runs[0].input.requestApproval({ title: "Stale approval" }), false);
  runs[0].resolve({ result: "old result", outcomeStatus: "completed" });
  await firstPromise;

  assert.equal(task.status, "running");
  assert.equal(task.logs.some((entry) => String(entry.data).includes("stale log")), false);
  assert.equal(task.pendingApprovals.size, 0);
  assert.equal(task.thread.some((entry) => entry.content === "old result"), false);

  runs[1].resolve({ result: "new result", outcomeStatus: "completed" });
  await secondPromise;
  assert.equal(task.status, "done");
  assert.equal(task.result, "new result");
  assert.equal(task.thread.at(-1).content, "new result");
  assert.equal(task.runCount, 2);
});
