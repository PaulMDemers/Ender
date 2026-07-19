const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createApiAccessMiddleware,
  createCorsOptions,
  isApiAccessAllowed,
  isLoopbackAddress
} = require("../src/api/access");
const { loadConfig } = require("../src/config");
const { createShutdownCoordinator } = require("../src/runtime/shutdown");
const { runAgentLoop } = require("../src/runtime/runAgentLoop");
const { TaskManager } = require("../src/runtime/taskManager");
const { createExecTool } = require("../src/tools/execTool");
const { createAbortError } = require("../src/utils/abort");
const runTaskModule = require("../src/runtime/runTask");
const { API_CONTRACT_HEADER } = require("../src/shared/apiContracts");
const { getReadiness } = require("../src/health/readiness");

test("ACP readiness reports its own command requirement instead of Azure credentials", () => {
  const base = {
    backend: "acp",
    jira: {},
    github: {},
    confluence: {},
    googleDrive: {},
    email: { smtp: {}, imap: {} },
    selfUpdate: {},
    codeServer: { enabled: false },
    pillar: { enabled: false },
    beacon: { enabled: false }
  };
  const missing = getReadiness({ ...base, acp: {} });
  assert.deepEqual(missing.services.llm, { backend: "acp", ready: false, missing: ["ACP_COMMAND"] });

  const ready = getReadiness({ ...base, acp: { command: "npx" } });
  assert.deepEqual(ready.services.llm, { backend: "acp", ready: true, missing: [] });
});

test("API access defaults to local-only and accepts explicit open mode", () => {
  const local = loadConfig({});
  assert.equal(local.apiAccess.mode, "local");
  assert.equal(local.apiAccess.bindHost, "0.0.0.0");
  assert.deepEqual(local.apiAccess.corsOrigins, []);

  const open = loadConfig({
    ENDER_API_ACCESS_MODE: "open",
    ENDER_API_BIND_HOST: "127.0.0.1",
    ENDER_CORS_ORIGINS: "https://ender.example, http://localhost:5173"
  });
  assert.equal(open.apiAccess.mode, "open");
  assert.deepEqual(open.apiAccess.corsOrigins, ["https://ender.example", "http://localhost:5173"]);
  assert.throws(() => loadConfig({ ENDER_API_ACCESS_MODE: "token" }), /must be local or open/);
});

test("local API access rejects remote sockets and permits loopback variants", () => {
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.20"), false);
  assert.equal(isApiAccessAllowed({ mode: "local" }, "10.0.0.8"), false);
  assert.equal(isApiAccessAllowed({ mode: "open" }, "10.0.0.8"), true);

  const middleware = createApiAccessMiddleware({ mode: "local" });
  let nextCalled = false;
  middleware({ socket: { remoteAddress: "127.0.0.1" } }, {}, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  middleware({ socket: { remoteAddress: "10.0.0.8" } }, response, () => {});
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "remote_access_disabled");
});

test("CORS defaults match the configured API exposure boundary", async () => {
  const local = createCorsOptions({ mode: "local", corsOrigins: [] });
  const open = createCorsOptions({ mode: "open", corsOrigins: ["https://ender.example"] });
  assert.deepEqual(local.exposedHeaders, [API_CONTRACT_HEADER]);
  assert.deepEqual(open.exposedHeaders, [API_CONTRACT_HEADER]);

  const check = (options, origin) => new Promise((resolve, reject) => {
    options.origin(origin, (err, allowed) => err ? reject(err) : resolve(allowed));
  });

  assert.equal(await check(local, "http://localhost:5173"), true);
  assert.equal(await check(local, "https://remote.example"), false);
  assert.equal(await check(open, "https://ender.example"), true);
  assert.equal(await check(open, "https://remote.example"), false);
});

test("TaskManager termination aborts the active runtime without converting it to an error", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-cancel-task-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));

  const originalRunTask = runTaskModule.runTask;
  let releaseSignal;
  const signalReady = new Promise((resolve) => {
    releaseSignal = resolve;
  });
  let receivedSignal = null;
  runTaskModule.runTask = ({ signal }) => new Promise((resolve, reject) => {
    receivedSignal = signal;
    releaseSignal();
    signal.addEventListener("abort", () => reject(createAbortError(signal.reason)), { once: true });
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
  const started = manager.start("Run until canceled");
  assert.equal(started.ok, true);
  await signalReady;

  const task = manager.tasks.get(started.id);
  const runPromise = task.runPromise;
  assert.equal(manager.terminate(started.id).ok, true);
  await runPromise;

  assert.equal(receivedSignal.aborted, true);
  assert.equal(manager.get(started.id).status, "terminated");
  assert.equal(manager.get(started.id).result, null);
});

test("runtime cancellation reaches model invocations and shell subprocesses", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-cancel-runtime-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));

  const modelController = new AbortController();
  let modelSignal = null;
  const loopPromise = runAgentLoop({
    model: {
      bindTools() {
        return this;
      },
      invoke(_messages, options) {
        modelSignal = options.signal;
        return new Promise((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(createAbortError(options.signal.reason)),
            { once: true }
          );
        });
      }
    },
    tools: [],
    systemPrompt: "test",
    userPrompt: "wait",
    onLog() {},
    signal: modelController.signal
  });
  modelController.abort(new Error("stop model"));
  await assert.rejects(loopPromise, { name: "AbortError" });
  assert.equal(modelSignal, modelController.signal);

  const shellController = new AbortController();
  const execTool = createExecTool(root, { signal: shellController.signal });
  const shellPromise = execTool.invoke({
    cmd: `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`,
    cwd: null
  });
  setTimeout(() => shellController.abort(new Error("stop shell")), 50);
  await assert.rejects(shellPromise, { name: "AbortError" });
});

test("shutdown coordinator is idempotent and drains each service once", async () => {
  const calls = [];
  const server = {
    listening: true,
    close(callback) {
      calls.push("server.close");
      this.listening = false;
      setImmediate(callback);
    },
    closeIdleConnections() {
      calls.push("server.closeIdleConnections");
    }
  };
  const shutdown = createShutdownCoordinator({
    server,
    taskManager: { shutdown: async () => calls.push("tasks.shutdown") },
    scheduleManager: { stop: () => calls.push("schedules.stop") },
    taskLedgerManager: { stop: () => calls.push("ledger.stop") },
    codeServerManager: { stopAllTaskSessions: async () => calls.push("code.stopAll") },
    pillarClient: { stop: async () => calls.push("pillar.stop") },
    timeoutMs: 1_000,
    logger: { log() {}, warn() {} }
  });

  const [first, second] = await Promise.all([shutdown("test"), shutdown("test-again")]);
  assert.equal(first.timedOut, false);
  assert.deepEqual(second, first);
  assert.equal(calls.filter((entry) => entry === "tasks.shutdown").length, 1);
  assert.equal(calls.filter((entry) => entry === "server.close").length, 1);
  assert.equal(calls.filter((entry) => entry === "schedules.stop").length, 1);
});
