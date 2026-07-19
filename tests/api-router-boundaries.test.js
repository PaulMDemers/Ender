const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/api/app");
const { loadConfig } = require("../src/config");
const { API_CONTRACT_HEADER } = require("../src/shared/apiContracts");

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
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function requestJson(baseUrl, route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  return { response, body: await response.json() };
}

function createBaseDependencies(overrides = {}) {
  const task = { id: "task-1", goal: "Test task", workspace: "/tmp/project", status: "done" };
  return {
    taskManager: {
      list: () => [task],
      get: (id) => id === task.id ? task : null,
      listWorkspaces: async () => ({ base: "/tmp", items: [{ label: "project", value: "project" }] }),
      listDirectories: async (input) => ({ current: input || "/", parent: null, items: [] }),
      getLogs: () => ({ from: 0, to: 0, entries: [] }),
      sse: () => false
    },
    workflowManager: {
      list: () => [],
      createSession: async () => ({ ok: false, error: "not_found" }),
      getSession: () => null,
      advanceSession: async () => ({ ok: false, error: "not_found" }),
      retreatSession: () => ({ ok: false, error: "not_found" })
    },
    scheduleManager: {
      list: () => [],
      create: async () => ({ ok: false, error: "invalid" }),
      update: async () => ({ ok: false, error: "not_found" }),
      runNow: async () => ({ ok: false, error: "not_found" }),
      delete: async () => ({ ok: false, error: "not_found" })
    },
    config: loadConfig({ CODE_SERVER_ENABLED: "false" }),
    selfUpdateManager: null,
    codeServerManager: null,
    taskLedgerManager: null,
    projectManager: null,
    memoryManager: null,
    llmProfileManager: { list: () => [], defaultProfileId: null },
    ...overrides
  };
}

function createTestApp(dependencies) {
  return createApp(
    dependencies.taskManager,
    dependencies.workflowManager,
    dependencies.scheduleManager,
    dependencies.config,
    dependencies.selfUpdateManager,
    dependencies.codeServerManager,
    dependencies.taskLedgerManager,
    dependencies.projectManager,
    dependencies.memoryManager,
    dependencies.llmProfileManager
  );
}

function collectRoutes(stack, routes = []) {
  for (const layer of stack || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (layer.handle?.stack) {
      collectRoutes(layer.handle.stack, routes);
    }
  }
  return routes;
}

test("the full public REST and SSE route inventory remains registered", () => {
  const app = createTestApp(createBaseDependencies());
  const routes = collectRoutes(app.router.stack).sort();
  assert.deepEqual(routes, [
    "DELETE /memories/:id",
    "DELETE /schedules/:id",
    "DELETE /task-ledger/:id",
    "DELETE /tasks/:id",
    "DELETE /tasks/:id/code-server",
    "GET /beacon/status",
    "GET /filesystem/directories",
    "GET /health",
    "GET /llm-profiles",
    "GET /memories",
    "GET /pillar/status",
    "GET /projects",
    "GET /schedules",
    "GET /self-update/operations",
    "GET /self-update/operations/:id",
    "GET /self-update/status",
    "GET /task-ledger",
    "GET /task-ledger/:id",
    "GET /tasks",
    "GET /tasks/:id",
    "GET /tasks/:id/code-server",
    "GET /tasks/:id/logs",
    "GET /tasks/:id/stream",
    "GET /workflow-sessions/:id",
    "GET /workflows",
    "GET /workspaces",
    "POST /memories",
    "POST /projects",
    "POST /projects/:id/ensure-workspace",
    "POST /schedules",
    "POST /schedules/:id/run",
    "POST /task-ledger",
    "POST /task-ledger/:id/run",
    "POST /tasks",
    "POST /tasks/:id/approvals/:approvalId",
    "POST /tasks/:id/code-server",
    "POST /tasks/:id/messages",
    "POST /tasks/:id/rerun",
    "POST /tasks/:id/terminate",
    "POST /workflow-sessions/:id/advance",
    "POST /workflow-sessions/:id/back",
    "POST /workflows/:id/sessions",
    "PUT /memories/:id",
    "PUT /projects/:id",
    "PUT /schedules/:id",
    "PUT /task-ledger/:id"
  ].sort());
  assert.equal(typeof app.locals.handleCodeServerProxyUpgrade, "function");
});

test("system and context routers preserve runtime, project, and memory contracts", async (t) => {
  const calls = [];
  const dependencies = createBaseDependencies({
    selfUpdateManager: {
      status: async () => ({ ok: true, supervised: true }),
      listOperations: async () => ({ ok: true, items: [{ id: "op-1" }] }),
      getOperation: async (id) => ({ ok: true, operation: { id } })
    },
    projectManager: {
      list: (query) => {
        calls.push({ kind: "project.list", query });
        return [{ id: "project-1" }];
      },
      create: async (input) => ({ ok: true, project: { id: "project-2", ...input } }),
      update: async (id, input) => ({ ok: true, project: { id, ...input } }),
      ensureWorkspace: async (id) => ({ ok: true, created: true, workspacePath: `/tmp/${id}` })
    },
    memoryManager: {
      search: (input) => {
        calls.push({ kind: "memory.search", input });
        return { items: [{ id: "memory-1" }] };
      },
      create: async (input) => ({ ok: true, memory: { id: "memory-2", ...input } }),
      update: async (id, input) => ({ ok: true, memory: { id, ...input } }),
      archive: async (id) => ({ ok: true, memory: { id, archived: true } })
    },
    llmProfileManager: {
      list: () => [{ id: "local" }],
      defaultProfileId: "local"
    }
  });
  const app = createTestApp(dependencies);
  app.locals.pillarClient = { status: () => ({ enabled: true, running: true, serverId: "home" }) };
  app.locals.beaconClient = { status: () => ({ enabled: true, serverId: "home" }) };
  const { server, baseUrl } = await listen(app);
  t.after(() => server.close());

  const health = await requestJson(baseUrl, "/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.response.headers.get(API_CONTRACT_HEADER), "1");
  assert.equal(health.body.ok, true);

  const pillar = await requestJson(baseUrl, "/pillar/status");
  assert.deepEqual(pillar.body, { enabled: true, running: true, serverId: "home" });
  const beacon = await requestJson(baseUrl, "/beacon/status");
  assert.deepEqual(beacon.body, { enabled: true, serverId: "home" });

  const workspaces = await requestJson(baseUrl, "/workspaces");
  assert.equal(workspaces.body.items[0].value, "project");
  const profiles = await requestJson(baseUrl, "/llm-profiles");
  assert.equal(profiles.body.defaultProfileId, "local");
  const directories = await requestJson(baseUrl, "/filesystem/directories?path=%2Ftmp");
  assert.equal(directories.body.current, "/tmp");

  const projects = await requestJson(baseUrl, "/projects?q=ender");
  assert.equal(projects.body.items[0].id, "project-1");
  const projectCreate = await requestJson(baseUrl, "/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "New project" })
  });
  assert.equal(projectCreate.response.status, 201);
  const ensured = await requestJson(baseUrl, "/projects/project-1/ensure-workspace", { method: "POST" });
  assert.equal(ensured.response.status, 201);

  const memories = await requestJson(baseUrl, "/memories?q=runtime&scope=project&projectId=project-1&limit=5");
  assert.equal(memories.body.items[0].id, "memory-1");
  const archived = await requestJson(baseUrl, "/memories/memory-1", { method: "DELETE" });
  assert.equal(archived.body.archived, true);

  const selfUpdate = await requestJson(baseUrl, "/self-update/operations/op-1");
  assert.equal(selfUpdate.body.operation.id, "op-1");
  assert.deepEqual(calls, [
    { kind: "project.list", query: "ender" },
    {
      kind: "memory.search",
      input: { query: "runtime", scope: "project", projectId: "project-1", limit: 5 }
    }
  ]);
});

test("automation and ledger routers preserve success and conflict status behavior", async (t) => {
  const calls = [];
  const workflowSession = { id: "session-1", status: "active" };
  const dependencies = createBaseDependencies({
    workflowManager: {
      list: () => [{ id: "workflow-1" }],
      createSession: async (id, input) => ({ ok: true, session: { ...workflowSession, workflowId: id, input } }),
      getSession: (id) => id === workflowSession.id ? workflowSession : null,
      advanceSession: async (id, input) => ({ ok: true, session: { id, status: "completed", input }, startedTaskId: "task-2" }),
      retreatSession: (id) => ({ ok: true, session: { id, status: "active" } })
    },
    scheduleManager: {
      list: () => [{ id: "schedule-1" }],
      create: async (input) => ({ ok: true, schedule: { id: "schedule-2", ...input } }),
      update: async (id, input) => ({ ok: true, schedule: { id, ...input } }),
      runNow: async (id) => ({ ok: true, status: "ok", message: id }),
      delete: async () => ({ ok: true })
    },
    taskLedgerManager: {
      maxAutoAgents: 2,
      pollIntervalMs: 15000,
      list: () => [{ id: "entry-1" }],
      get: (id) => id === "entry-1" ? { id } : null,
      create: async (input) => ({ ok: true, entry: { id: "entry-2", ...input } }),
      update: async (id) => id === "busy" ? { ok: false, error: "entry_running" } : { ok: true, entry: { id } },
      runNow: async (id) => ({ ok: true, startedTaskId: `task-for-${id}` }),
      delete: async (id) => {
        calls.push({ kind: "ledger.delete", id });
        return { ok: true, id };
      }
    }
  });
  const { server, baseUrl } = await listen(createTestApp(dependencies));
  t.after(() => server.close());

  assert.equal((await requestJson(baseUrl, "/workflows")).body.items[0].id, "workflow-1");
  assert.equal((await requestJson(baseUrl, "/schedules")).body.items[0].id, "schedule-1");
  const scheduleCreate = await requestJson(baseUrl, "/schedules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Daily" })
  });
  assert.equal(scheduleCreate.response.status, 201);
  const scheduleRun = await requestJson(baseUrl, "/schedules/schedule-1/run", { method: "POST" });
  assert.equal(scheduleRun.response.status, 200);

  const workflowCreate = await requestJson(baseUrl, "/workflows/workflow-1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "interactive" })
  });
  assert.equal(workflowCreate.response.status, 201);
  const advanced = await requestJson(baseUrl, "/workflow-sessions/session-1/advance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "done" })
  });
  assert.equal(advanced.body.startedTaskId, "task-2");

  const ledger = await requestJson(baseUrl, "/task-ledger");
  assert.equal(ledger.body.maxAutoAgents, 2);
  const ledgerRun = await requestJson(baseUrl, "/task-ledger/entry-1/run", { method: "POST" });
  assert.equal(ledgerRun.response.status, 201);
  const conflict = await requestJson(baseUrl, "/task-ledger/busy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(conflict.response.status, 409);
  await requestJson(baseUrl, "/task-ledger/entry-1", { method: "DELETE" });
  assert.deepEqual(calls, [{ kind: "ledger.delete", id: "entry-1" }]);
});

test("task router preserves editor, proxy-error, and SSE paths", async (t) => {
  const calls = [];
  const dependencies = createBaseDependencies();
  dependencies.taskManager.sse = (id, res) => {
    calls.push({ kind: "sse", id });
    res.setHeader("content-type", "text/event-stream");
    res.end(`event: status\ndata: ${JSON.stringify({ status: "done" })}\n\n`);
    return true;
  };
  dependencies.codeServerManager = {
    getTaskSession: async (task, origin) => {
      calls.push({ kind: "editor.get", taskId: task.id, host: origin.host });
      return { ok: true, session: null };
    },
    launchTaskSession: async (task, origin) => {
      calls.push({ kind: "editor.launch", taskId: task.id, host: origin.host });
      return { ok: true, created: true, session: { taskId: task.id } };
    },
    stopTaskSession: async (id) => {
      calls.push({ kind: "editor.stop", id });
      return { ok: true, stopped: true };
    },
    getTaskProxyTarget: async () => ({ ok: true, session: null, target: null })
  };
  const app = createTestApp(dependencies);
  assert.equal(typeof app.locals.handleCodeServerProxyUpgrade, "function");
  const { server, baseUrl } = await listen(app);
  t.after(() => server.close());

  const editor = await requestJson(baseUrl, "/tasks/task-1/code-server");
  assert.equal(editor.response.status, 200);
  const launched = await requestJson(baseUrl, "/tasks/task-1/code-server", { method: "POST" });
  assert.equal(launched.response.status, 201);
  const stopped = await requestJson(baseUrl, "/tasks/task-1/code-server", { method: "DELETE" });
  assert.equal(stopped.body.stopped, true);

  const proxy = await requestJson(baseUrl, "/tasks/task-1/code-server/proxy/");
  assert.equal(proxy.response.status, 404);
  assert.equal(proxy.response.headers.get(API_CONTRACT_HEADER), "1");
  assert.equal(proxy.body.error, "code_server_proxy_failed");

  const streamResponse = await fetch(`${baseUrl}/tasks/task-1/stream`);
  const stream = await streamResponse.text();
  assert.equal(streamResponse.status, 200);
  assert.match(stream, /event: status/);
  assert.deepEqual(calls.map((entry) => entry.kind), ["editor.get", "editor.launch", "editor.stop", "sse"]);
});
