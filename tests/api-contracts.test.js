const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { TaskManager } = require("../src/runtime/taskManager");
const {
  API_CONTRACT_HEADER,
  API_CONTRACT_VERSION,
  TASK_SSE_CONTRACT_EVENT,
  TASK_SSE_CONTRACT_HEADER,
  TASK_SSE_CONTRACT_VERSION,
  createTaskSseContractPayload,
  formatTaskSseEvent
} = require("../src/shared/apiContracts");

function createSseResponse() {
  const headers = new Map();
  const writes = [];
  const listeners = new Map();
  return {
    headers,
    writes,
    listeners,
    ended: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    flushHeaders() {},
    write(value) {
      writes.push(String(value));
    },
    end() {
      this.ended = true;
    },
    on(event, handler) {
      listeners.set(event, handler);
    }
  };
}

test("shared API and task SSE contract metadata is stable", () => {
  assert.equal(API_CONTRACT_VERSION, 1);
  assert.equal(API_CONTRACT_HEADER, "X-Ender-API-Version");
  assert.equal(TASK_SSE_CONTRACT_VERSION, 1);
  assert.equal(TASK_SSE_CONTRACT_HEADER, "X-Ender-SSE-Version");
  assert.equal(TASK_SSE_CONTRACT_EVENT, "contract");
  assert.deepEqual(createTaskSseContractPayload(), { version: 1, apiVersion: 1 });
  assert.equal(
    formatTaskSseEvent("status", { status: "running" }),
    "event: status\ndata: {\"status\":\"running\"}\n\n"
  );
});

test("TaskManager task streams advertise contracts before replay and live events", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-api-contract-"));
  const manager = new TaskManager({
    workdir: root,
    workspaceBase: root,
    threadsDir: path.join(root, "threads")
  });
  await manager.init();
  manager._runThread = () => {};
  t.after(async () => {
    await manager.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  });

  const started = manager.start("Stream contract test");
  const response = createSseResponse();
  assert.equal(manager.sse(started.id, response), true);
  assert.equal(response.headers.get(API_CONTRACT_HEADER.toLowerCase()), "1");
  assert.equal(response.headers.get(TASK_SSE_CONTRACT_HEADER.toLowerCase()), "1");
  assert.match(response.writes[0], /^event: contract\n/);
  assert.match(response.writes[0], /"version":1/);
  assert.match(response.writes[1], /^event: status\n/);

  const task = manager.tasks.get(started.id);
  manager._broadcastEvent(task, "status", { status: "running" });
  assert.match(response.writes.at(-1), /^event: status\n/);
  response.listeners.get("close")?.();
});

test("frontend contract tracking accepts legacy/current metadata and reports newer versions", async () => {
  const { createContractTracker, parseContractVersion } = await import("../ui/src/contractVersions.js");
  assert.equal(parseContractVersion(null), null);
  assert.equal(parseContractVersion("invalid"), null);
  assert.equal(parseContractVersion("1"), 1);

  const legacy = createContractTracker({ api: 1, taskSse: 1 });
  legacy.observeApiHeader(null);
  legacy.observeTaskSse(null);
  assert.deepEqual(legacy.getStatus(), {
    api: { supportedVersion: 1, observedVersion: null, compatible: true, mode: "legacy" },
    taskSse: { supportedVersion: 1, observedVersion: null, compatible: true, mode: "legacy" }
  });

  const current = createContractTracker({ api: 1, taskSse: 1 });
  current.observeApiHeader("1");
  current.observeTaskSse({ version: 1 });
  assert.equal(current.getStatus().api.mode, "compatible");
  assert.equal(current.getStatus().taskSse.mode, "compatible");

  current.observeApiHeader("2");
  current.observeTaskSse({ version: 3 });
  assert.deepEqual(current.getStatus(), {
    api: { supportedVersion: 1, observedVersion: 2, compatible: false, mode: "newer" },
    taskSse: { supportedVersion: 1, observedVersion: 3, compatible: false, mode: "newer" }
  });

  const changes = [];
  const unsubscribe = current.subscribe((status) => changes.push(status));
  current.reset();
  current.observeApiHeader("1");
  unsubscribe();
  current.observeApiHeader("2");
  assert.equal(changes.length, 2);
  assert.equal(changes[0].api.mode, "legacy");
  assert.equal(changes[1].api.mode, "compatible");
});
