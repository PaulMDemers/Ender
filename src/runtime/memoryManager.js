const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { sanitizeJsonValue, sanitizeString } = require("../utils/jsonSafe");
const { migratePersistedRecord, versionPersistedRecord } = require("../persistence/jsonRecord");

const SCOPE_VALUES = new Set(["global", "project", "thread"]);
const KIND_VALUES = new Set(["fact", "preference", "summary", "resource", "note"]);
const LOAD_POLICY_VALUES = new Set(["auto", "pinned", "manual", "off"]);
const STATUS_VALUES = new Set(["active", "archived"]);

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function scoreMemory(memory, query) {
  const terms = tokenize(query);
  if (!terms.length) return memory.loadPolicy === "pinned" ? 5 : 1;
  const haystack = [
    memory.title,
    memory.body,
    memory.scope,
    memory.kind,
    ...(memory.tags || [])
  ].join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
    + (memory.loadPolicy === "pinned" ? 2 : 0);
}

function summarizeContent(content) {
  if (typeof content === "string") return sanitizeString(content).trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => block?.type === "text" ? sanitizeString(block.text || "").trim() : "[attachment]")
    .filter(Boolean)
    .join(" ");
}

function buildThreadSummary(task, maxEntries = 18) {
  const thread = Array.isArray(task?.thread) ? task.thread : [];
  const entries = thread.slice(-maxEntries).map((entry) => {
    const role = String(entry.role || "user");
    const text = summarizeContent(entry.content).replace(/\s+/g, " ").slice(0, 800);
    return text ? `${role}: ${text}` : null;
  }).filter(Boolean);
  return entries.join("\n");
}

class MemoryManager {
  constructor({ config } = {}) {
    this.config = config || {};
    this.memoriesDir = path.resolve(this.config.memoriesDir || path.resolve(process.cwd(), "memories"));
    this.memories = new Map();
    this._persistQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.memoriesDir, { recursive: true });
    await this._loadPersistedMemories();
  }

  list(filters = {}) {
    return this.search({ ...filters, query: filters.query || "", limit: filters.limit || 200 }).items;
  }

  get(id) {
    const memory = this.memories.get(String(id || "").trim());
    return memory ? this._serialize(memory) : null;
  }

  search(input = {}) {
    const query = String(input.query || "").trim();
    const projectId = input.projectId ? String(input.projectId).trim() : null;
    const sourceThreadId = input.sourceThreadId ? String(input.sourceThreadId).trim() : null;
    const scope = input.scope ? String(input.scope).trim() : null;
    const includeArchived = Boolean(input.includeArchived);
    const limit = Math.max(1, Math.min(200, Number(input.limit) || 20));

    const items = [...this.memories.values()]
      .filter((memory) => includeArchived || memory.status !== "archived")
      .filter((memory) => !scope || memory.scope === scope)
      .filter((memory) => !projectId || memory.projectId === projectId || memory.scope === "global")
      .filter((memory) => !sourceThreadId || memory.sourceThreadId === sourceThreadId)
      .map((memory) => ({ memory, score: scoreMemory(memory, query) }))
      .filter((item) => !query || item.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.memory.updatedAt).getTime() - new Date(a.memory.updatedAt).getTime())
      .slice(0, limit)
      .map((item) => this._serialize(item.memory));

    return { ok: true, items };
  }

  async create(input = {}) {
    const validation = this._validate(input);
    if (!validation.ok) return validation;
    const now = new Date().toISOString();
    const memory = {
      ...validation.value,
      id: randomUUID(),
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.memories.set(memory.id, memory);
    await this._persistMemory(memory);
    return { ok: true, memory: this._serialize(memory) };
  }

  async update(id, input = {}) {
    const current = this.memories.get(String(id || "").trim());
    if (!current) return { ok: false, error: "not_found" };
    const validation = this._validate({ ...current, ...(input || {}) });
    if (!validation.ok) return validation;
    Object.assign(current, validation.value, { id: current.id, updatedAt: new Date().toISOString() });
    if (STATUS_VALUES.has(String(input.status || ""))) current.status = String(input.status);
    await this._persistMemory(current);
    return { ok: true, memory: this._serialize(current) };
  }

  async archive(id) {
    const current = this.memories.get(String(id || "").trim());
    if (!current) return { ok: false, error: "not_found" };
    current.status = "archived";
    current.updatedAt = new Date().toISOString();
    await this._persistMemory(current);
    return { ok: true, memory: this._serialize(current) };
  }

  async compactThread(task, input = {}) {
    if (!task?.id) return { ok: false, error: "thread_required" };
    const body = String(input.body || "").trim() || buildThreadSummary(task);
    if (!body) return { ok: false, error: "thread_empty", message: "Thread has no compactable content." };
    return this.create({
      scope: "thread",
      kind: "summary",
      title: input.title || `Thread summary ${String(task.id).slice(0, 8)}`,
      body,
      sourceThreadId: task.id,
      projectId: task.projectId || null,
      tags: ["thread-summary"],
      loadPolicy: "auto",
      confidence: 0.7
    });
  }

  buildContextPack({ task, project, memoryMode = "auto" } = {}) {
    if (memoryMode === "off" || memoryMode === "manual") return { items: [], text: "" };
    const projectId = task?.projectId || project?.id || null;
    const goal = task?.latestPrompt || task?.goal || "";
    const selected = new Map();

    const add = (memory) => {
      if (!memory || memory.status === "archived" || memory.loadPolicy === "off") return;
      selected.set(memory.id, memory);
    };

    for (const memory of this.memories.values()) {
      if (memory.loadPolicy === "pinned" && (memory.scope === "global" || memory.projectId === projectId)) add(memory);
      if (memory.scope === "thread" && memory.sourceThreadId === task?.id && memory.loadPolicy !== "manual") add(memory);
      if (memory.scope === "project" && projectId && memory.projectId === projectId && memory.loadPolicy === "auto") add(memory);
    }

    for (const memory of this.search({ query: goal, projectId, limit: 6 }).items) {
      if (memory.loadPolicy !== "manual") add(memory);
    }

    const items = [...selected.values()].slice(0, 12).map((memory) => this._serialize(memory));
    const projectLines = project ? [
      `Project: ${project.name}`,
      project.repoUrl ? `Repo: ${project.repoUrl}` : "",
      project.workspacePath ? `Workspace: ${project.workspacePath}` : "",
      project.description ? `Description: ${project.description}` : ""
    ].filter(Boolean) : [];
    const memoryLines = items.map((memory) => (
      `- [${memory.id}] ${memory.scope}/${memory.kind}: ${memory.title}\n  ${memory.body}`
    ));
    const text = [...projectLines, memoryLines.length ? "Memories:" : "", ...memoryLines].filter(Boolean).join("\n");
    return { items, text };
  }

  _validate(input) {
    const scope = SCOPE_VALUES.has(String(input.scope || "")) ? String(input.scope) : "global";
    const kind = KIND_VALUES.has(String(input.kind || "")) ? String(input.kind) : "note";
    const loadPolicy = LOAD_POLICY_VALUES.has(String(input.loadPolicy || "")) ? String(input.loadPolicy) : "auto";
    const title = String(input.title || "").trim();
    const body = String(input.body || "").trim();
    if (!title) return { ok: false, error: "title_required", message: "Memory title is required." };
    if (!body) return { ok: false, error: "body_required", message: "Memory body is required." };
    return {
      ok: true,
      value: {
        scope,
        kind,
        title,
        body,
        projectId: input.projectId ? String(input.projectId).trim() : null,
        sourceThreadId: input.sourceThreadId ? String(input.sourceThreadId).trim() : null,
        tags: normalizeArray(input.tags),
        loadPolicy,
        confidence: Number.isFinite(Number(input.confidence)) ? Math.max(0, Math.min(1, Number(input.confidence))) : null
      }
    };
  }

  _memoryFile(memoryId) {
    return path.join(this.memoriesDir, `${memoryId}.json`);
  }

  _serialize(memory) {
    return sanitizeJsonValue({
      id: memory.id,
      scope: memory.scope,
      kind: memory.kind,
      title: memory.title,
      body: memory.body,
      projectId: memory.projectId || null,
      sourceThreadId: memory.sourceThreadId || null,
      tags: memory.tags || [],
      loadPolicy: memory.loadPolicy || "auto",
      confidence: memory.confidence ?? null,
      status: memory.status || "active",
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt
    });
  }

  _hydrate(data) {
    const now = new Date().toISOString();
    const validation = this._validate(data);
    const value = validation.ok ? validation.value : {
      scope: "global",
      kind: "note",
      title: String(data.title || "Untitled memory"),
      body: String(data.body || ""),
      tags: [],
      loadPolicy: "manual",
      projectId: null,
      sourceThreadId: null,
      confidence: null
    };
    return {
      ...value,
      id: String(data.id || randomUUID()),
      status: data.status === "archived" ? "archived" : "active",
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    };
  }

  async _loadPersistedMemories() {
    const entries = await fs.readdir(this.memoriesDir, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      const filePath = path.join(this.memoriesDir, entry.name);
      try {
        const migrated = migratePersistedRecord(
          JSON.parse(await fs.readFile(filePath, "utf8")),
          "memory"
        );
        const data = migrated.record;
        const memory = this._hydrate(data);
        if (memory.body) {
          this.memories.set(memory.id, memory);
          if (migrated.migrated) await this._persistMemory(memory);
        }
      } catch (err) {
        console.warn(`Failed to load memory ${filePath}: ${err.message || String(err)}`);
      }
    }
  }

  async _persistMemory(memory) {
    const snapshot = JSON.stringify(versionPersistedRecord("memory", this._serialize(memory)), null, 2);
    const target = this._memoryFile(memory.id);
    const temp = `${target}.tmp`;
    const writeMemory = async () => {
      await fs.mkdir(this.memoriesDir, { recursive: true });
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, target);
    };
    this._persistQueue = this._persistQueue.catch(() => {}).then(writeMemory);
    return this._persistQueue;
  }
}

module.exports = {
  MemoryManager,
  buildThreadSummary
};
