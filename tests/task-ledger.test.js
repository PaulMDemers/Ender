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

function createAutonomousTaskManagerDouble({ onStart } = {}) {
  const tasks = new Map();
  const started = [];

  return {
    started,
    tasks,
    start(prompt, workspace, options = {}) {
      const id = `task-${started.length + 1}`;
      const task = {
        id,
        goal: prompt,
        status: "running",
        finishedAt: null,
        result: null,
        workspace: workspace || null,
        ledgerEntryId: options.ledgerEntryId ? String(options.ledgerEntryId) : null
      };
      tasks.set(id, task);
      started.push({ id, prompt, workspace, options });

      setTimeout(async () => {
        try {
          await onStart?.({ id, prompt, workspace, options, task });
        } catch (err) {
          const current = tasks.get(id);
          if (!current) return;
          current.status = "error";
          current.finishedAt = new Date().toISOString();
          current.result = `DONE:\n${err.message || String(err)}`;
        }
      }, 0);

      return { ok: true, id };
    },
    getTaskSummary(id) {
      const task = tasks.get(String(id));
      return task ? { ...task } : null;
    }
  };
}

async function waitFor(check, { timeoutMs = 4000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test("buildTaskLedgerTaskPrompt injects the required worker procedure", () => {
  const prompt = buildTaskLedgerTaskPrompt({
    title: "Ship the orchestration feature",
    prompt: "Implement the orchestration feature end-to-end.",
    workspace: "/tmp/example",
    source: {
      kind: "jira",
      label: "ABC-123",
      referenceId: "issue-42"
    }
  });

  assert.match(prompt, /global task ledger/i);
  assert.match(prompt, /Source: jira · ABC-123 · issue-42/i);
  assert.match(prompt, /Required procedure and execution lifecycle:/i);
  assert.match(prompt, /Inspect the workspace first/i);
  assert.match(prompt, /Build a concrete plan and a checklist/i);
  assert.match(prompt, /add tests when practical/i);
  assert.match(prompt, /evaluate whether the task can be accomplished/i);
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
    workspace: "/tmp/workspace-a",
    taskType: "coding",
    successCriteria: ["Feature works", "Tests pass"],
    constraints: ["Stay in repo"],
    verificationPlan: ["npm test"],
    source: {
      kind: "api",
      label: "manual submission",
      referenceId: "req-7"
    }
  });

  assert.equal(created.ok, true);
  assert.equal(taskManager.started.length, 1);

  const startedTaskId = taskManager.started[0].id;
  const runningEntry = manager.get(created.entry.id);
  assert.equal(runningEntry.status, "running");
  assert.equal(runningEntry.startedTaskId, startedTaskId);
  assert.deepEqual(runningEntry.source, {
    kind: "api",
    label: "manual submission",
    referenceId: "req-7"
  });
  assert.equal(runningEntry.taskType, "coding");
  assert.deepEqual(runningEntry.successCriteria, ["Feature works", "Tests pass"]);
  assert.deepEqual(runningEntry.constraints, ["Stay in repo"]);
  assert.deepEqual(runningEntry.verificationPlan, ["npm test"]);
  assert.equal(runningEntry.lifecycle.currentStage, "intake");
  assert.match(taskManager.started[0].prompt, /Required procedure and execution lifecycle:/);
  assert.match(taskManager.started[0].prompt, /Task envelope:/);

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

test("TaskLedgerManager maps autonomous needs_input task outcomes onto ledger entry status", async (t) => {
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
    title: "Need deployment target",
    prompt: "Ship the patch but only if the production hostname is known."
  });

  const startedTaskId = taskManager.started[0].id;
  taskManager.tasks.set(startedTaskId, {
    id: startedTaskId,
    goal: taskManager.started[0].prompt,
    status: "needs_input",
    finishedAt: "2026-04-08T10:08:00.000Z",
    result: "DONE:\nNeed the production hostname before deployment can continue."
  });

  await manager.reconcile({ dispatch: false });

  const entry = manager.get(created.entry.id);
  assert.equal(entry.status, "needs_input");
  assert.equal(entry.completedTaskId, startedTaskId);
  assert.match(entry.lastError || "", /needs additional information/i);
});

test("TaskLedgerManager records lifecycle updates for stage, feasibility, plan, and verification", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const manager = new TaskLedgerManager({
    config: {
      taskLedgerDir: path.join(root, "task-ledger"),
      taskLedgerPollIntervalMs: 0,
      taskLedgerMaxAutoAgents: 0
    },
    taskManager: createTaskManagerDouble()
  });

  await manager.init();
  const created = await manager.create({
    title: "Structured worker",
    prompt: "Implement the structured worker flow.",
    taskType: "coding",
    successCriteria: ["Task is complete"],
    verificationPlan: ["node --test"]
  });

  await manager.recordStage(created.entry.id, { stage: "workspace_scan", summary: "Located the target files." });
  await manager.reportFeasibility(created.entry.id, { outcome: "ready", summary: "Task is feasible in the current workspace." });
  await manager.savePlan(created.entry.id, {
    summary: "Make the change and verify it.",
    checklist: ["Edit runtime", "Add tests"],
    verificationSteps: ["node --test"]
  });
  await manager.reportVerification(created.entry.id, {
    status: "passed",
    summary: "Targeted tests passed.",
    evidence: ["node --test tests/task-ledger.test.js"]
  });

  const entry = manager.get(created.entry.id);
  assert.equal(entry.lifecycle.currentStage, "verify");
  assert.equal(entry.lifecycle.feasibility.outcome, "ready");
  assert.equal(entry.lifecycle.plan.summary, "Make the change and verify it.");
  assert.deepEqual(entry.lifecycle.plan.checklist, ["Edit runtime", "Add tests"]);
  assert.equal(entry.lifecycle.verification.status, "passed");
  assert.deepEqual(entry.lifecycle.verification.evidence, ["node --test tests/task-ledger.test.js"]);
});

test("TaskLedgerManager smoke-runs structured ledger tasks against mock workspace folders", async (t) => {
  const root = await makeTempDir();
  const workspaceRoot = path.join(process.cwd(), "workspace");
  const codingWorkspace = path.join(workspaceRoot, "task-ledger-smoke-coding");
  const docsWorkspace = path.join(workspaceRoot, "task-ledger-smoke-docs");

  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(codingWorkspace, { recursive: true, force: true });
    await fs.rm(docsWorkspace, { recursive: true, force: true });
  });

  await fs.rm(codingWorkspace, { recursive: true, force: true });
  await fs.rm(docsWorkspace, { recursive: true, force: true });
  await fs.mkdir(path.join(codingWorkspace, "src"), { recursive: true });
  await fs.mkdir(docsWorkspace, { recursive: true });
  await fs.writeFile(
    path.join(codingWorkspace, "src", "index.js"),
    "module.exports = function greet() {\n  return 'todo';\n};\n"
  );
  await fs.writeFile(
    path.join(codingWorkspace, "README.md"),
    "# Mock coding workspace\n\nImplement the greeting.\n"
  );
  await fs.writeFile(
    path.join(docsWorkspace, "notes.md"),
    "Ship checklist:\n- capture release notes\n- summarize operator next steps\n"
  );

  let manager;
  const taskManager = createAutonomousTaskManagerDouble({
    onStart: async ({ id, workspace, options }) => {
      const currentTask = taskManager.tasks.get(id);
      const ledgerEntryId = String(options.ledgerEntryId || "");
      if (!currentTask || !ledgerEntryId) return;

      const entry = manager.get(ledgerEntryId);
      if (!entry) return;

      await manager.recordStage(ledgerEntryId, {
        stage: "workspace_scan",
        summary: `Scanned ${path.basename(workspace)} for task assets.`
      });
      await manager.reportFeasibility(ledgerEntryId, {
        outcome: "ready",
        summary: "Workspace and requirements are sufficient for autonomous execution."
      });

      if (entry.taskType === "coding") {
        await manager.savePlan(ledgerEntryId, {
          summary: "Update the implementation and verify the generated greeting.",
          checklist: ["Inspect src/index.js", "Implement the greeting", "Read the updated file"],
          verificationSteps: ["Confirm src/index.js contains the shipped greeting"]
        });
        await manager.recordStage(ledgerEntryId, {
          stage: "implement",
          summary: "Applying the mock coding change."
        });
        await fs.writeFile(
          path.join(workspace, "src", "index.js"),
          "module.exports = function greet() {\n  return 'shipped';\n};\n"
        );
        const codingOutput = await fs.readFile(path.join(workspace, "src", "index.js"), "utf8");
        await manager.reportVerification(ledgerEntryId, {
          status: "passed",
          summary: "Verified the updated implementation in the mock workspace.",
          evidence: [path.relative(process.cwd(), path.join(workspace, "src", "index.js"))]
        });
        currentTask.status = "done";
        currentTask.finishedAt = new Date().toISOString();
        currentTask.result = `DONE:\nUpdated mock coding workspace.\n${codingOutput.trim()}`;
      } else {
        await manager.savePlan(ledgerEntryId, {
          summary: "Create a concise release summary from the mock notes.",
          checklist: ["Read notes.md", "Write summary.md", "Review summary output"],
          verificationSteps: ["Confirm summary.md contains release notes and next steps"]
        });
        await manager.recordStage(ledgerEntryId, {
          stage: "implement",
          summary: "Writing the mock documentation deliverable."
        });
        const notes = await fs.readFile(path.join(workspace, "notes.md"), "utf8");
        const summaryPath = path.join(workspace, "summary.md");
        await fs.writeFile(
          summaryPath,
          "# Release Summary\n\n- Release notes captured from the mock workspace.\n- Next steps documented for the operator.\n\n## Source\n\n"
            + notes
        );
        await manager.reportVerification(ledgerEntryId, {
          status: "passed",
          summary: "Verified the summary file exists and contains the source notes.",
          evidence: [path.relative(process.cwd(), summaryPath)]
        });
        currentTask.status = "done";
        currentTask.finishedAt = new Date().toISOString();
        currentTask.result = "DONE:\nCreated mock documentation summary.";
      }

      await manager.reconcile({ dispatch: false });
    }
  });

  manager = new TaskLedgerManager({
    config: {
      taskLedgerDir: path.join(root, "task-ledger"),
      taskLedgerPollIntervalMs: 0,
      taskLedgerMaxAutoAgents: 2
    },
    taskManager
  });

  await manager.init();

  const codingEntry = await manager.create({
    title: "Mock coding task",
    prompt: "Implement the greeting in the mock coding workspace.",
    workspace: codingWorkspace,
    taskType: "coding",
    successCriteria: ["Greeting returns shipped", "Workspace file updated"],
    verificationPlan: ["Confirm src/index.js contains the final implementation"]
  });
  const docsEntry = await manager.create({
    title: "Mock docs task",
    prompt: "Summarize the mock release notes into a summary file.",
    workspace: docsWorkspace,
    taskType: "documentation",
    successCriteria: ["summary.md exists", "Summary includes next steps"],
    verificationPlan: ["Confirm summary.md is present and populated"]
  });

  await waitFor(() => {
    const codingStatus = manager.get(codingEntry.entry.id)?.status;
    const docsStatus = manager.get(docsEntry.entry.id)?.status;
    return codingStatus === "completed" && docsStatus === "completed";
  });

  const codingResult = manager.get(codingEntry.entry.id);
  const docsResult = manager.get(docsEntry.entry.id);
  const codingFile = await fs.readFile(path.join(codingWorkspace, "src", "index.js"), "utf8");
  const docsFile = await fs.readFile(path.join(docsWorkspace, "summary.md"), "utf8");

  assert.equal(codingResult.lifecycle.currentStage, "finalize");
  assert.equal(codingResult.lifecycle.verification.status, "passed");
  assert.match(codingFile, /return 'shipped'/);
  assert.equal(docsResult.lifecycle.currentStage, "finalize");
  assert.equal(docsResult.lifecycle.verification.status, "passed");
  assert.match(docsFile, /Release Summary/);
  assert.match(docsFile, /Next steps documented for the operator/);
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
    },
    async delete(id) {
      calls.push({ kind: "delete", id });
      return {
        ok: true,
        id
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

  const deleteRes = await fetch(`${baseUrl}/task-ledger/entry-1`, { method: "DELETE" });
  assert.equal(deleteRes.status, 200);
  const deleteBody = await deleteRes.json();
  assert.equal(deleteBody.id, "entry-1");

  assert.deepEqual(calls, [
    { kind: "create", input: { title: "New ledger item", prompt: "Do the work" } },
    { kind: "runNow", id: "entry-1" },
    { kind: "delete", id: "entry-1" }
  ]);
});

test("TaskLedgerManager deletes non-running ledger entries", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const manager = new TaskLedgerManager({
    config: {
      taskLedgerDir: path.join(root, "task-ledger"),
      taskLedgerPollIntervalMs: 0,
      taskLedgerMaxAutoAgents: 0
    },
    taskManager: createTaskManagerDouble()
  });

  await manager.init();
  const created = await manager.create({
    title: "Delete me",
    prompt: "This entry should be removable."
  });

  const result = await manager.delete(created.entry.id);
  assert.equal(result.ok, true);
  assert.equal(manager.get(created.entry.id), null);
  await assert.rejects(fs.stat(path.join(root, "task-ledger", `${created.entry.id}.json`)));
});
