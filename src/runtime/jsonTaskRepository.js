// @ts-check

const fs = require("node:fs/promises");
const path = require("node:path");

function assertSafeTaskId(taskId) {
  const value = String(taskId || "").trim();
  if (
    !value
    || value.length > 200
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || value.includes("\0")
    || path.basename(value) !== value
  ) {
    throw new Error("Task id is not safe for filesystem persistence");
  }
  return value;
}

class JsonTaskRepository {
  constructor({ threadsDir, fsImpl = fs }) {
    this.threadsDir = path.resolve(threadsDir);
    this.fs = fsImpl;
    this._queue = Promise.resolve();
  }

  async init() {
    await this.fs.mkdir(this.threadsDir, { recursive: true });
  }

  async loadAll() {
    await this.init();
    const entries = await this.fs.readdir(this.threadsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    return Promise.all(files.map(async (fileName) => {
      const taskId = fileName.slice(0, -".json".length);
      const filePath = path.join(this.threadsDir, fileName);
      try {
        assertSafeTaskId(taskId);
        const raw = await this.fs.readFile(filePath, "utf8");
        return { taskId, filePath, record: JSON.parse(raw), error: null };
      } catch (error) {
        return { taskId, filePath, record: null, error };
      }
    }));
  }

  save(taskId, record) {
    const safeTaskId = assertSafeTaskId(taskId);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Task repository can only persist JSON object records");
    }
    const snapshot = JSON.stringify(record, null, 2);
    const target = this._taskFile(safeTaskId);
    const temp = `${target}.tmp`;

    return this._enqueue(async () => {
      await this.init();
      await this.fs.writeFile(temp, snapshot, "utf8");
      await this.fs.rename(temp, target);
    });
  }

  delete(taskId) {
    const safeTaskId = assertSafeTaskId(taskId);
    const target = this._taskFile(safeTaskId);
    const temp = `${target}.tmp`;
    return this._enqueue(async () => {
      await this.fs.rm(temp, { force: true });
      await this.fs.rm(target, { force: true });
    });
  }

  async flush() {
    await this._queue;
  }

  _taskFile(taskId) {
    return path.join(this.threadsDir, `${assertSafeTaskId(taskId)}.json`);
  }

  _enqueue(operation) {
    const queued = this._queue.catch(() => {}).then(operation);
    this._queue = queued;
    return queued;
  }
}

module.exports = { JsonTaskRepository, assertSafeTaskId };
