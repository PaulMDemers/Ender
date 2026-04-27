const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { WorkflowManager } = require("../src/workflows/workflowManager");
const { ScheduleManager } = require("../src/runtime/scheduleManager");
const { TaskManager } = require("../src/runtime/taskManager");
const { ProjectManager } = require("../src/runtime/projectManager");
const { MemoryManager } = require("../src/runtime/memoryManager");
const { LlmProfileManager } = require("../src/llm/profileManager");
const runTaskModule = require("../src/runtime/runTask");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-group2-"));
}

function createTestWorkflow() {
  return {
    id: "test_workflow",
    name: "Test Workflow",
    description: "A workflow used for persistence coverage.",
    async createInitialState() {
      return {
        stage: "form",
        values: {},
        debug: []
      };
    },
    getCurrentStep(session) {
      if (session.state.stage === "complete") {
        return {
          id: "complete",
          type: "complete",
          title: "Complete",
          description: "Workflow complete"
        };
      }

      return {
        id: "form",
        type: "form",
        title: "Enter value",
        description: "Provide a test value",
        fields: [
          {
            id: "value",
            label: "Value",
            type: "text",
            required: true
          }
        ]
      };
    },
    async advance(session, input) {
      session.state.values = {
        ...(session.state.values || {}),
        value: String(input.value || "").trim()
      };
      session.state.stage = "complete";
      session.status = "completed";
      return { ok: true };
    }
  };
}

test("WorkflowManager persists interactive sessions and reloads them after restart", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const config = { workflowSessionsDir: path.join(root, "workflow-sessions") };
  const definitions = [createTestWorkflow()];

  const manager = new WorkflowManager({ config, taskManager: {}, definitions });
  await manager.init();
  const created = await manager.createSession("test_workflow");
  assert.equal(created.ok, true);

  const advanced = await manager.advanceSession(created.session.id, { value: "saved progress" });
  assert.equal(advanced.ok, true);

  const reloaded = new WorkflowManager({ config, taskManager: {}, definitions });
  await reloaded.init();
  const session = reloaded.getSession(created.session.id);

  assert.ok(session);
  assert.equal(session.resumedFromDisk, true);
  assert.equal(session.currentStep.type, "complete");
});

test("WorkflowManager does not persist scheduled_run sessions", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const config = { workflowSessionsDir: path.join(root, "workflow-sessions") };
  const definitions = [createTestWorkflow()];

  const manager = new WorkflowManager({ config, taskManager: {}, definitions });
  await manager.init();
  const created = await manager.createSession("test_workflow", { mode: "scheduled_run" });
  assert.equal(created.ok, true);

  const files = await fs.readdir(config.workflowSessionsDir);
  assert.deepEqual(files, []);
});

test("ScheduleManager persists run status for prompt schedules", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const started = [];
  const manager = new ScheduleManager({
    config: { schedulesDir: path.join(root, "schedules") },
    taskManager: {
      start(prompt, workspace) {
        started.push({ prompt, workspace });
        return { ok: true, id: "task-1" };
      }
    },
    workflowManager: {}
  });

  await manager.init();
  const created = await manager.create({
    name: "Morning prompt",
    cron: "0 9 * * *",
    enabled: false,
    target: {
      kind: "prompt",
      prompt: "Run the daily summary",
      workspace: "/tmp/example"
    }
  });
  assert.equal(created.ok, true);

  const runNow = await manager.runNow(created.schedule.id);
  assert.equal(runNow.ok, true);
  assert.equal(started.length, 1);
  assert.equal(started[0].prompt, "Run the daily summary");

  const reloaded = new ScheduleManager({
    config: { schedulesDir: path.join(root, "schedules") },
    taskManager: { start() { return { ok: true, id: "task-1" }; } },
    workflowManager: {}
  });
  await reloaded.init();
  const schedule = reloaded.get(created.schedule.id);
  assert.ok(schedule);
  assert.equal(schedule.lastRunStatus, "ok");
});

test("LlmProfileManager exposes configured profiles and builds run configs", () => {
  const manager = new LlmProfileManager({
    backend: "openai",
    openai: { apiKey: "openai-key", model: "gpt-default" },
    bedrock: { region: "us-east-1", model: "bedrock-default" },
    azure: {},
    ollama: { baseUrl: "http://127.0.0.1:11434", model: "llama3.1" },
    llmProfilesJson: JSON.stringify([
      { id: "fast", label: "Fast OpenAI", backend: "openai", model: "gpt-fast" },
      { id: "local", label: "Local", backend: "ollama", model: "qwen" }
    ]),
    defaultLlmProfileId: "local"
  });

  assert.equal(manager.defaultProfileId, "local");
  assert.deepEqual(manager.list().map((profile) => profile.id), ["fast", "local"]);
  const runConfig = manager.buildRunConfig("fast");
  assert.equal(runConfig.backend, "openai");
  assert.equal(runConfig.openai.model, "gpt-fast");
  assert.equal(runConfig.openai.apiKey, "openai-key");
});

test("ProjectManager persists projects and ensures missing workspaces with clone", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  let cloneArgs = null;
  const manager = new ProjectManager({
    config: {
      workdir: path.join(root, "workspace"),
      projectsDir: path.join(root, "projects"),
      github: {}
    },
    cloneRepositoryImpl: async (args) => {
      cloneArgs = args;
      await fs.mkdir(path.join(args.rootDir, args.directory), { recursive: true });
      return { ok: true, code: 0, stdout: "", stderr: "" };
    }
  });
  await manager.init();

  const created = await manager.create({
    name: "Ender App",
    repoUrl: "https://github.com/acme/ender.git"
  });
  assert.equal(created.ok, true);

  const ensured = await manager.ensureWorkspace(created.project.id);
  assert.equal(ensured.ok, true);
  assert.equal(ensured.created, true);
  assert.equal(cloneArgs.repoUrl, "https://github.com/acme/ender.git");
  assert.equal(cloneArgs.directory, "ender");
  assert.equal(manager.ownsWorkspace(ensured.workspacePath), true);
});

test("MemoryManager creates searchable memories and builds scoped context packs", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const manager = new MemoryManager({
    config: { memoriesDir: path.join(root, "memories") }
  });
  await manager.init();

  const global = await manager.create({
    scope: "global",
    kind: "preference",
    title: "Review style",
    body: "Prefer concise code review findings before summaries.",
    loadPolicy: "pinned"
  });
  const project = await manager.create({
    scope: "project",
    kind: "fact",
    title: "Ender repo",
    body: "Ender uses JSON files for runtime persistence.",
    projectId: "ender",
    loadPolicy: "auto"
  });

  assert.equal(global.ok, true);
  assert.equal(project.ok, true);
  assert.equal(manager.search({ query: "runtime persistence", projectId: "ender" }).items.length, 2);

  const pack = manager.buildContextPack({
    task: { id: "task-1", goal: "Work on runtime persistence", projectId: "ender", memoryMode: "auto" },
    project: { id: "ender", name: "Ender", repoUrl: "https://github.com/acme/ender.git" },
    memoryMode: "auto"
  });
  assert.match(pack.text, /Review style/);
  assert.match(pack.text, /Ender repo/);
});

test("TaskManager marks interrupted running tasks as error on restart by default", async (t) => {
  const root = await makeTempDir();
  const threadsDir = path.join(root, "threads");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(threadsDir, { recursive: true });
  const taskId = "task-restart";
  await fs.writeFile(path.join(threadsDir, `${taskId}.json`), JSON.stringify({
    id: taskId,
    goal: "Resume me",
    status: "running",
    startedAt: new Date().toISOString(),
    logs: [],
    result: null,
    runCount: 1,
    thread: [{ role: "user", content: "Resume me" }],
    workspace: root,
    workspaceLabel: root,
    pendingApprovals: []
  }, null, 2));

  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir,
    selfRoot: path.join(root, "ender-self")
  });
  await manager.init();

  const task = manager.get(taskId);
  assert.ok(task);
  assert.equal(task.status, "error");

  const logs = manager.getLogs(taskId, 0);
  assert.ok(logs.entries.some((entry) => String(entry.data).includes("server restart")));
});

test("TaskManager auto-restarts interrupted tasks when config opt-in is enabled", async (t) => {
  const root = await makeTempDir();
  const threadsDir = path.join(root, "threads");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(threadsDir, { recursive: true });
  const taskId = "task-auto-restart";
  await fs.writeFile(path.join(threadsDir, `${taskId}.json`), JSON.stringify({
    id: taskId,
    goal: "Resume me",
    status: "running",
    startedAt: new Date().toISOString(),
    logs: [],
    result: null,
    runCount: 1,
    thread: [{ role: "user", content: "Resume me" }],
    workspace: root,
    workspaceLabel: root,
    pendingApprovals: []
  }, null, 2));

  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir,
    selfRoot: path.join(root, "ender-self"),
    autoRestartInterruptedThreads: true
  });

  const restarted = [];
  manager._runThread = (task) => {
    restarted.push(task.id);
  };

  await manager.init();

  const task = manager.get(taskId);
  assert.ok(task);
  assert.equal(task.status, "running");
  assert.deepEqual(restarted, [taskId]);

  const logs = manager.getLogs(taskId, 0);
  assert.ok(logs.entries.some((entry) => String(entry.data).includes("auto-restarting thread")));
});

test("TaskManager auto-restarts interrupted tasks in self root by default", async (t) => {
  const root = await makeTempDir();
  const selfRoot = path.join(root, "ender-self");
  const threadsDir = path.join(root, "threads");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(threadsDir, { recursive: true });
  await fs.mkdir(selfRoot, { recursive: true });
  const taskId = "task-self-root-restart";
  await fs.writeFile(path.join(threadsDir, `${taskId}.json`), JSON.stringify({
    id: taskId,
    goal: "Resume me",
    status: "awaiting_approval",
    startedAt: new Date().toISOString(),
    logs: [],
    result: null,
    runCount: 1,
    thread: [{ role: "user", content: "Resume me" }],
    workspace: selfRoot,
    workspaceLabel: selfRoot,
    pendingApprovals: [{
      id: "approval-1",
      type: "generic",
      title: "Approval required",
      description: "Please confirm",
      details: {},
      requestedAt: new Date().toISOString()
    }]
  }, null, 2));

  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir,
    selfRoot
  });

  const restarted = [];
  manager._runThread = (task) => {
    restarted.push(task.id);
  };

  await manager.init();

  const task = manager.tasks.get(taskId);
  assert.ok(task);
  assert.equal(task.status, "running");
  assert.equal(task.pendingApprovals.size, 0);
  assert.deepEqual(restarted, [taskId]);
});

test("TaskManager approval flow resumes the task after approval", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir: path.join(root, "threads")
  });
  manager._runThread = () => {};

  const started = manager.start("Need approval");
  assert.equal(started.ok, true);
  const task = manager.tasks.get(started.id);

  const approvalPromise = manager._requestApproval(task, {
    type: "test",
    title: "Approve test action",
    description: "Approve?"
  });
  const [approvalId] = [...task.pendingApprovals.keys()];

  assert.equal(task.status, "awaiting_approval");
  assert.ok(approvalId);

  const resolved = manager.resolveApproval(task.id, approvalId, true);
  assert.equal(resolved.ok, true);
  assert.equal(await approvalPromise, true);
  assert.equal(task.status, "running");
});

test("TaskManager records autonomous needs_input outcomes without marking the thread done", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const originalRunTask = runTaskModule.runTask;
  runTaskModule.runTask = async () => ({
    result: "DONE:\nNeed the target production URL before continuing.",
    outcomeStatus: "needs_input",
    ledger: {}
  });

  t.after(() => {
    runTaskModule.runTask = originalRunTask;
  });

  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir: path.join(root, "threads")
  });
  await manager.init();

  const started = manager.start("Autonomous ledger run", undefined, { ledgerEntryId: "ledger-1" });
  assert.equal(started.ok, true);

  const waited = await manager.waitForTask(started.id, { timeoutMs: 1000 });
  assert.equal(waited.ok, true);
  assert.equal(waited.timedOut, false);

  const task = manager.get(started.id);
  assert.ok(task);
  assert.equal(task.status, "needs_input");
  assert.match(task.result || "", /Need the target production URL/i);
});
