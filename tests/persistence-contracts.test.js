const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  PERSISTED_RECORD_VERSIONS,
  migratePersistedRecord,
  versionPersistedRecord
} = require("../src/persistence/jsonRecord");
const { WorkflowManager } = require("../src/workflows/workflowManager");
const { ScheduleManager } = require("../src/runtime/scheduleManager");
const { TaskLedgerManager } = require("../src/runtime/taskLedgerManager");
const { ProjectManager } = require("../src/runtime/projectManager");
const { MemoryManager } = require("../src/runtime/memoryManager");
const { BeaconStore } = require("../src/beacon/store");
const { PillarStore } = require("../src/pillar/store");
const { CodeServerManager } = require("../src/runtime/codeServerManager");
const { readCheckpoint } = require("../src/selfUpdate/checkpoints");

async function makeTempDir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ender-persistence-contracts-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function createWorkflowDefinition() {
  return {
    id: "persisted_workflow",
    name: "Persisted workflow",
    description: "Persistence contract fixture",
    async createInitialState() {
      return { stage: "form" };
    },
    getCurrentStep() {
      return { id: "form", type: "form", title: "Form", fields: [] };
    },
    async advance() {
      return { ok: true };
    }
  };
}

for (const [kind, version] of Object.entries(PERSISTED_RECORD_VERSIONS)) {
  test(`${kind} contract migrates legacy records and rejects malformed or future versions`, () => {
    const legacy = migratePersistedRecord({ id: "legacy" }, kind);
    assert.equal(legacy.migrated, true);
    assert.equal(legacy.fromVersion, 0);
    assert.equal(legacy.version, version);
    assert.equal(legacy.record.recordVersion, version);

    const currentRecord = versionPersistedRecord(kind, { id: "current" });
    const current = migratePersistedRecord(JSON.parse(JSON.stringify(currentRecord)), kind);
    assert.equal(current.migrated, false);
    assert.equal(current.record.id, "current");

    assert.throws(
      () => migratePersistedRecord({ recordVersion: version + 1 }, kind),
      /Unsupported .* record version/
    );
    assert.throws(() => migratePersistedRecord([], kind), /must be a JSON object/);
    assert.throws(
      () => migratePersistedRecord({ recordVersion: "1" }, kind),
      /recordVersion must be a non-negative integer/
    );
  });
}

test("file-backed runtime managers rewrite legacy records without exposing disk versions", async (t) => {
  const root = await makeTempDir(t);
  const files = {
    workflow: path.join(root, "workflows", "workflow-1.json"),
    schedule: path.join(root, "schedules", "schedule-1.json"),
    ledger: path.join(root, "ledger", "ledger-1.json"),
    project: path.join(root, "projects", "project-1.json"),
    memory: path.join(root, "memories", "memory-1.json")
  };
  await writeJson(files.workflow, {
    id: "workflow-1",
    workflowId: "persisted_workflow",
    mode: "interactive",
    status: "active",
    shouldPersist: true,
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
    history: [],
    state: { stage: "form" }
  });
  await writeJson(files.schedule, {
    id: "schedule-1",
    name: "Legacy schedule",
    cron: "0 9 * * *",
    enabled: false,
    target: { kind: "prompt", prompt: "Run legacy task" },
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z"
  });
  await writeJson(files.ledger, {
    id: "ledger-1",
    title: "Legacy ledger entry",
    prompt: "Do the work",
    autoRun: false,
    status: "completed",
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z"
  });
  await writeJson(files.project, {
    id: "project-1",
    name: "Legacy project",
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z"
  });
  await writeJson(files.memory, {
    id: "memory-1",
    scope: "global",
    kind: "note",
    title: "Legacy memory",
    body: "Remember this",
    loadPolicy: "auto",
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z"
  });

  const workflowManager = new WorkflowManager({
    config: { workflowSessionsDir: path.dirname(files.workflow) },
    taskManager: {},
    definitions: [createWorkflowDefinition()]
  });
  const scheduleManager = new ScheduleManager({
    config: { schedulesDir: path.dirname(files.schedule) },
    taskManager: {},
    workflowManager: {}
  });
  const ledgerManager = new TaskLedgerManager({
    config: {
      taskLedgerDir: path.dirname(files.ledger),
      taskLedgerPollIntervalMs: 0,
      taskLedgerMaxAutoAgents: 0
    },
    taskManager: {}
  });
  const projectManager = new ProjectManager({
    config: { projectsDir: path.dirname(files.project) }
  });
  const memoryManager = new MemoryManager({
    config: { memoriesDir: path.dirname(files.memory) }
  });

  await workflowManager.init();
  await scheduleManager.init();
  await ledgerManager.init();
  await projectManager.init();
  await memoryManager.init();
  t.after(() => {
    scheduleManager.stop();
    ledgerManager.stop();
  });

  assert.ok(workflowManager.getSession("workflow-1"));
  assert.ok(scheduleManager.get("schedule-1"));
  assert.ok(ledgerManager.get("ledger-1"));
  assert.ok(projectManager.get("project-1"));
  assert.ok(memoryManager.get("memory-1"));
  assert.equal(workflowManager.getSession("workflow-1").recordVersion, undefined);
  assert.equal(ledgerManager.get("ledger-1").recordVersion, undefined);
  assert.equal(projectManager.get("project-1").recordVersion, undefined);
  assert.equal(memoryManager.get("memory-1").recordVersion, undefined);

  assert.equal((await readJson(files.workflow)).recordVersion, 1);
  assert.equal((await readJson(files.schedule)).recordVersion, 1);
  assert.equal((await readJson(files.ledger)).recordVersion, 1);
  assert.equal((await readJson(files.project)).recordVersion, 1);
  assert.equal((await readJson(files.memory)).recordVersion, 1);
});

test("connector stores migrate legacy envelopes while keeping runtime state clean", async (t) => {
  const root = await makeTempDir(t);
  const beaconFile = path.join(root, "beacon.json");
  const pillarFile = path.join(root, "pillar.json");
  await writeJson(beaconFile, {
    devices: { phone: { id: "phone", userId: "user-1" } },
    servers: {},
    notifications: {}
  });
  await writeJson(pillarFile, {
    servers: { home: { id: "home", userId: "user-1" } }
  });

  const beacon = new BeaconStore({ dataFile: beaconFile });
  await beacon.init();
  const pillar = new PillarStore({ dataFile: pillarFile });

  assert.equal(beacon.data.recordVersion, undefined);
  assert.equal(pillar.data.recordVersion, undefined);
  assert.equal(beacon.data.devices.phone.id, "phone");
  assert.equal(pillar.data.servers.home.id, "home");
  assert.equal((await readJson(beaconFile)).recordVersion, 1);
  assert.equal((await readJson(pillarFile)).recordVersion, 1);
});

test("code-server metadata and self-update checkpoints migrate without leaking versions", async (t) => {
  const root = await makeTempDir(t);
  const stateDir = path.join(root, "code-server");
  const metadataFile = path.join(stateDir, "task-1", "session.json");
  const checkpointFile = path.join(root, "checkpoints", "checkpoint-1.json");
  await writeJson(metadataFile, {
    taskId: "task-1",
    mode: "local",
    pid: 123,
    port: 4321
  });
  await writeJson(checkpointFile, {
    id: "checkpoint-1",
    label: "Legacy checkpoint",
    createdAt: "2026-07-18T10:00:00.000Z",
    rootDir: root,
    headSha: "abc123"
  });

  const codeServer = new CodeServerManager({
    workdir: root,
    codeServer: { enabled: false, stateDir }
  });
  const metadata = await codeServer._readSessionMetadata("task-1");
  const checkpoint = await readCheckpoint(path.dirname(checkpointFile), "checkpoint-1");

  assert.equal(metadata.recordVersion, undefined);
  assert.equal(metadata.port, 4321);
  assert.equal(checkpoint.ok, true);
  assert.equal(checkpoint.checkpoint.recordVersion, undefined);
  assert.equal(checkpoint.checkpoint.headSha, "abc123");
  assert.equal((await readJson(metadataFile)).recordVersion, 1);
  assert.equal((await readJson(checkpointFile)).recordVersion, 1);
});

test("persistence consumers do not overwrite future-version records", async (t) => {
  const root = await makeTempDir(t);
  const beaconFile = path.join(root, "beacon-future.json");
  const pillarFile = path.join(root, "pillar-future.json");
  const metadataFile = path.join(root, "code", "task-1", "session.json");
  const checkpointFile = path.join(root, "checkpoints", "checkpoint-1.json");
  const future = { recordVersion: 2, marker: "preserve-me" };
  await writeJson(beaconFile, future);
  await writeJson(pillarFile, future);
  await writeJson(metadataFile, future);
  await writeJson(checkpointFile, future);

  const beacon = new BeaconStore({ dataFile: beaconFile });
  await assert.rejects(() => beacon.init(), /Unsupported beaconStore record version/);
  assert.throws(() => new PillarStore({ dataFile: pillarFile }), /Unsupported pillarStore record version/);

  const codeServer = new CodeServerManager({
    workdir: root,
    codeServer: { enabled: false, stateDir: path.join(root, "code") }
  });
  assert.equal(await codeServer._readSessionMetadata("task-1"), null);
  const checkpoint = await readCheckpoint(path.dirname(checkpointFile), "checkpoint-1");
  assert.equal(checkpoint.ok, false);
  assert.equal(checkpoint.error, "checkpoint_read_failed");

  assert.deepEqual(await readJson(beaconFile), future);
  assert.deepEqual(await readJson(pillarFile), future);
  assert.deepEqual(await readJson(metadataFile), future);
  assert.deepEqual(await readJson(checkpointFile), future);
  assert.equal(fsSync.existsSync(`${beaconFile}.tmp`), false);
  assert.equal(fsSync.existsSync(`${pillarFile}.tmp`), false);
});
