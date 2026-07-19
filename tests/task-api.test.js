const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/api/app");

function createTaskManager(overrides = {}) {
  const calls = [];
  const task = {
    id: "task-1",
    goal: "Existing task",
    status: "done",
    workspace: "/tmp/workspace"
  };

  const manager = {
    calls,
    list: () => [task],
    get: (id) => (id === task.id ? task : null),
    start(goal, workspace, options) {
      calls.push({ kind: "start", goal, workspace, options });
      return { ok: true, id: "task-created" };
    },
    terminate(id) {
      calls.push({ kind: "terminate", id });
      return { ok: true };
    },
    async delete(id, options) {
      calls.push({ kind: "delete", id, options });
      return { ok: true, workspaceDeletion: null };
    },
    rerun(id) {
      calls.push({ kind: "rerun", id });
      return { ok: true, id: "task-rerun" };
    },
    continueTask(id, input) {
      calls.push({ kind: "continue", id, input });
      return { ok: true, id };
    },
    resolveApproval(id, approvalId, approved) {
      calls.push({ kind: "approval", id, approvalId, approved });
      return { ok: true };
    },
    getLogs(id, from) {
      calls.push({ kind: "logs", id, from });
      return id === task.id ? { from, to: from, entries: [] } : null;
    },
    sse: () => false,
    ...overrides
  };

  return manager;
}

function createTaskApi(taskManager) {
  return createApp(
    taskManager,
    { list: () => [] },
    { list: () => [] },
    {},
    null,
    null,
    null,
    null,
    null,
    { list: () => [], defaultProfileId: null }
  );
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    const onError = (error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return {
    response,
    body: await response.json()
  };
}

test("task API validates and normalizes successful task operations", async (t) => {
  const taskManager = createTaskManager();
  const { server, baseUrl } = await listen(createTaskApi(taskManager));
  t.after(() => server.close());

  const created = await jsonRequest(baseUrl, "/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: "  Ship the runtime  ",
      workspace: null,
      projectId: null,
      llmProfileId: " local ",
      memoryMode: "manual"
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.id, "task-created");

  const continued = await jsonRequest(baseUrl, "/tasks/task-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Continue",
      content: [
        { type: "text", text: "Attached context" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA", detail: "auto" } }
      ],
      memoryMode: "auto"
    })
  });
  assert.equal(continued.response.status, 201);

  const approval = await jsonRequest(baseUrl, "/tasks/task-1/approvals/approval-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: false })
  });
  assert.equal(approval.response.status, 200);

  const deleted = await jsonRequest(baseUrl, "/tasks/task-1", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deleteWorkspace: true })
  });
  assert.equal(deleted.response.status, 200);

  const logs = await jsonRequest(baseUrl, "/tasks/task-1/logs?from=2");
  assert.equal(logs.response.status, 200);
  assert.equal(logs.body.from, 2);

  assert.deepEqual(taskManager.calls, [
    {
      kind: "start",
      goal: "Ship the runtime",
      workspace: undefined,
      options: {
        projectId: null,
        llmProfileId: "local",
        memoryMode: "manual"
      }
    },
    {
      kind: "continue",
      id: "task-1",
      input: {
        prompt: "Continue",
        content: [
          { type: "text", text: "Attached context" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA", detail: "auto" } }
        ],
        llmProfileId: null,
        memoryMode: "auto"
      }
    },
    { kind: "approval", id: "task-1", approvalId: "approval-1", approved: false },
    { kind: "delete", id: "task-1", options: { deleteWorkspace: true } },
    { kind: "logs", id: "task-1", from: 2 }
  ]);
});

test("task API returns consistent validation errors", async (t) => {
  const taskManager = createTaskManager();
  const { server, baseUrl } = await listen(createTaskApi(taskManager));
  t.after(() => server.close());

  const cases = [
    {
      path: "/tasks",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: "", memoryMode: "auto" })
      }
    },
    {
      path: "/tasks/task-1/messages",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "", content: [] })
      }
    },
    {
      path: "/tasks/task-1/approvals/approval-1",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: "false" })
      }
    },
    {
      path: "/tasks/task-1",
      options: {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteWorkspace: "false" })
      }
    },
    { path: "/tasks/task-1/logs?from=-1", options: {} }
  ];

  for (const entry of cases) {
    const result = await jsonRequest(baseUrl, entry.path, entry.options);
    assert.equal(result.response.status, 400, entry.path);
    assert.equal(result.body.ok, false, entry.path);
    assert.equal(result.body.error, "invalid_request", entry.path);
    assert.equal(typeof result.body.message, "string", entry.path);
    assert.ok(result.body.details?.issues?.length, entry.path);
  }

  assert.deepEqual(taskManager.calls, []);
});

test("task API returns JSON for malformed bodies and manager failures", async (t) => {
  const taskManager = createTaskManager({
    continueTask() {
      return { ok: false, error: "task_busy" };
    }
  });
  const { server, baseUrl } = await listen(createTaskApi(taskManager));
  t.after(() => server.close());

  const malformed = await jsonRequest(baseUrl, "/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(malformed.response.status, 400);
  assert.deepEqual(malformed.body, {
    ok: false,
    error: "invalid_json",
    message: "Request body contains malformed JSON."
  });

  const busy = await jsonRequest(baseUrl, "/tasks/task-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Continue" })
  });
  assert.equal(busy.response.status, 409);
  assert.equal(busy.body.ok, false);
  assert.equal(busy.body.error, "task_busy");
  assert.equal(busy.body.message, "Task is currently running or awaiting approval.");

  const missing = await jsonRequest(baseUrl, "/tasks/missing");
  assert.equal(missing.response.status, 404);
  assert.deepEqual(missing.body, {
    ok: false,
    error: "not_found",
    message: "Task not found."
  });
});
