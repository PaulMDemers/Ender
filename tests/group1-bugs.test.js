const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { TaskManager } = require("../src/runtime/taskManager");
const { advance, buildCollisionErrorMessage } = require("../src/workflows/jiraToRepoWorkflow");
const { cloneRepository } = require("../src/tools/gitTools");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-group1-"));
}

test("continueTask preserves the original goal for reruns", async (t) => {
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

  const started = manager.start("Original goal");
  assert.equal(started.ok, true);

  const task = manager.tasks.get(started.id);
  task.status = "done";

  const continued = manager.continueTask(started.id, "Follow-up prompt");
  assert.equal(continued.ok, true);
  assert.equal(task.goal, "Original goal");
  assert.equal(task.initialGoal, "Original goal");
  assert.equal(task.latestPrompt, "Follow-up prompt");

  let rerunGoal = null;
  let rerunWorkspace = null;
  manager.start = (goal, workspace) => {
    rerunGoal = goal;
    rerunWorkspace = workspace;
    return { ok: true, id: "rerun-id" };
  };

  const rerun = manager.rerun(started.id);
  assert.equal(rerun.ok, true);
  assert.equal(rerunGoal, "Original goal");
  assert.equal(rerunWorkspace, task.workspaceLabel || task.workspace);
});

test("ledger tasks keep operator-facing chat separate from private execution context", async (t) => {
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

  const started = manager.start("Respond with hello", root, {
    title: "Example ledger task",
    ledgerEntryId: "ledger-1",
    executionPrompt: "Private ledger envelope\nOriginal task request:\nRespond with hello"
  });
  assert.equal(started.ok, true);

  const task = manager.tasks.get(started.id);
  assert.equal(task.title, "Example ledger task");
  assert.equal(task.goal, "Respond with hello");
  assert.equal(task.thread[0].content, "Respond with hello");
  assert.equal(task.logs[0].data.content, "Respond with hello");
  assert.equal(manager.getTaskSummary(started.id).goal, "Respond with hello");
  assert.equal(manager.getTaskSummary(started.id).title, "Example ledger task");
  assert.equal(manager._getExecutionThread(task)[0].content, task.executionPrompt);

  for (let index = 0; index < 13; index += 1) {
    task.thread.push({ role: index % 2 === 0 ? "assistant" : "user", content: `Follow-up ${index}` });
  }
  const boundedExecutionThread = manager._getExecutionThread(task);
  assert.equal(boundedExecutionThread.length, 12);
  assert.equal(boundedExecutionThread[0].content, task.executionPrompt);
  assert.equal(boundedExecutionThread.at(-1).content, "Follow-up 12");
  assert.ok(boundedExecutionThread.some((entry) => entry.content === "Follow-up 11"));

  const serialized = manager._serializeTask(task);
  assert.equal(serialized.executionPrompt, task.executionPrompt);
  assert.equal(serialized.title, "Example ledger task");
});

test("continueTask accepts structured multimodal user content", async (t) => {
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

  const started = manager.start("Original goal");
  assert.equal(started.ok, true);

  const task = manager.tasks.get(started.id);
  task.status = "done";

  const continued = manager.continueTask(started.id, {
    content: [
      { type: "text", text: "Please inspect this screenshot." },
      { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==", detail: "auto" } }
    ]
  });

  assert.equal(continued.ok, true);
  assert.equal(task.latestPrompt, "Please inspect this screenshot.");
  assert.ok(Array.isArray(task.thread.at(-1).content));
  assert.deepEqual(task.thread.at(-1).content, [
    { type: "text", text: "Please inspect this screenshot." },
    { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==", detail: "auto" } }
  ]);

  const runThread = manager._getRunThread(task.thread);
  assert.ok(Array.isArray(runThread.at(-1).content));
  assert.deepEqual(runThread.at(-1).content, [
    { type: "text", text: "Please inspect this screenshot." },
    { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==", detail: "auto" } }
  ]);
});

test("schedule_config repo step defers cloning and only stores the plan", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const session = {
    mode: "schedule_config",
    state: { stage: "repo", debug: [] }
  };
  let cloneCalled = false;

  const result = await advance(
    session,
    { repoUrl: "https://github.com/acme/private.git" },
    {
      config: { workdir: root, github: {} },
      cloneRepositoryImpl: async () => {
        cloneCalled = true;
        return { ok: true };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(cloneCalled, false);
  assert.equal(session.state.stage, "delivery");
  assert.equal(session.state.repo.repoUrl, "https://github.com/acme/private.git");
  assert.equal(session.state.repo.directory, "private");
  assert.equal(session.state.repo.deferredClone, true);
});

test("scheduled_run repo step auto-renames non-empty clone targets", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const existingDir = path.join(root, "private");
  await fs.mkdir(existingDir, { recursive: true });
  await fs.writeFile(path.join(existingDir, "README.md"), "occupied", "utf8");

  const session = {
    mode: "scheduled_run",
    state: { stage: "repo", debug: [] }
  };
  let cloneArgs = null;

  const result = await advance(
    session,
    { repoUrl: "https://github.com/acme/private.git", directory: "private" },
    {
      config: { workdir: root, github: {} },
      cloneRepositoryImpl: async (args) => {
        cloneArgs = args;
        return { ok: true, code: 0, stdout: "", stderr: "" };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.ok(cloneArgs);
  assert.notEqual(cloneArgs.directory, "private");
  assert.match(cloneArgs.directory, /^private-/);
  assert.equal(session.state.stage, "delivery");
  assert.equal(session.state.repo.requestedDirectory, "private");
  assert.equal(session.state.repo.autoRenamed, true);
});

test("interactive repo step fails clearly when the target directory is already occupied", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const existingDir = path.join(root, "private");
  await fs.mkdir(existingDir, { recursive: true });
  await fs.writeFile(path.join(existingDir, "README.md"), "occupied", "utf8");

  const session = {
    mode: "interactive",
    state: { stage: "repo", debug: [] }
  };
  let cloneCalled = false;

  const result = await advance(
    session,
    { repoUrl: "https://github.com/acme/private.git", directory: "private" },
    {
      config: { workdir: root, github: {} },
      cloneRepositoryImpl: async () => {
        cloneCalled = true;
        return { ok: true, code: 0, stdout: "", stderr: "" };
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, buildCollisionErrorMessage("private"));
  assert.equal(cloneCalled, false);
});

test("cloneRepository injects GitHub auth headers for GitHub remotes", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  let capturedArgs = null;
  let capturedCwd = null;
  const result = await cloneRepository({
    rootDir: root,
    repoUrl: "https://github.com/acme/private.git",
    directory: "private",
    githubConfig: {
      baseUrl: "https://github.com",
      token: "secret-token"
    },
    runGitImpl: async (args, cwd) => {
      capturedArgs = args;
      capturedCwd = cwd;
      return { ok: true, code: 0, stdout: "", stderr: "" };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(capturedCwd, root);
  assert.equal(capturedArgs[0], "-c");
  assert.match(capturedArgs[1], /extraheader=AUTHORIZATION: basic /);
  assert.equal(capturedArgs[2], "clone");
  assert.equal(capturedArgs[3], "https://github.com/acme/private.git");
});
