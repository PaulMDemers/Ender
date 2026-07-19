const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cloneRepository, runGit } = require("../tools/gitTools");
const { createSafeJoin } = require("../utils/safePath");
const { sanitizeJsonValue } = require("../utils/jsonSafe");
const { migratePersistedRecord, versionPersistedRecord } = require("../persistence/jsonRecord");

function slugify(value, fallback = "project") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function defaultDirectoryForRepo(repoUrl, name) {
  const fromRepo = path.basename(String(repoUrl || "").trim(), ".git").trim();
  return slugify(fromRepo || name, "project");
}

function normalizeResources(resources) {
  if (!Array.isArray(resources)) return [];
  return resources
    .map((resource) => {
      if (!resource || typeof resource !== "object") return null;
      const label = String(resource.label || resource.title || resource.url || "").trim();
      const url = String(resource.url || "").trim();
      const kind = String(resource.kind || resource.type || "link").trim() || "link";
      if (!label && !url) return null;
      return { kind, label: label || url, url: url || null };
    })
    .filter(Boolean);
}

function normalizeAliases(aliases) {
  if (!Array.isArray(aliases)) return [];
  return [...new Set(aliases.map((alias) => String(alias || "").trim()).filter(Boolean))];
}

function projectMatches(project, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [
    project.name,
    project.description,
    project.repoUrl,
    project.workspacePath,
    ...(project.aliases || [])
  ].some((value) => String(value || "").toLowerCase().includes(q));
}

class ProjectManager {
  constructor({ config, cloneRepositoryImpl = cloneRepository } = {}) {
    this.config = config || {};
    this.projectsDir = path.resolve(this.config.projectsDir || path.resolve(process.cwd(), "projects"));
    this.projects = new Map();
    this._persistQueue = Promise.resolve();
    this.cloneRepository = cloneRepositoryImpl;
  }

  async init() {
    await fs.mkdir(this.projectsDir, { recursive: true });
    await this._loadPersistedProjects();
  }

  list(query = "") {
    return [...this.projects.values()]
      .filter((project) => project.status !== "archived")
      .filter((project) => projectMatches(project, query))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((project) => this._serialize(project));
  }

  get(id) {
    const key = String(id || "").trim();
    if (!key) return null;
    const direct = this.projects.get(key);
    if (direct) return this._serialize(direct);
    const lower = key.toLowerCase();
    const matched = [...this.projects.values()].find((project) => (
      project.name.toLowerCase() === lower || (project.aliases || []).some((alias) => alias.toLowerCase() === lower)
    ));
    return matched ? this._serialize(matched) : null;
  }

  async create(input) {
    const validation = this._validate(input);
    if (!validation.ok) return validation;
    const now = new Date().toISOString();
    const id = validation.value.id || this._createId(validation.value.name);
    if (this.projects.has(id)) return { ok: false, error: "project_exists", message: "Project id already exists." };

    const project = {
      ...validation.value,
      id,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null
    };
    this.projects.set(id, project);
    await this._persistProject(project);
    return { ok: true, project: this._serialize(project) };
  }

  async update(id, input) {
    const current = this.projects.get(String(id || "").trim());
    if (!current) return { ok: false, error: "not_found" };

    const validation = this._validate({ ...current, ...(input || {}), id: current.id }, { partial: true });
    if (!validation.ok) return validation;
    Object.assign(current, validation.value, { id: current.id, updatedAt: new Date().toISOString() });
    await this._persistProject(current);
    return { ok: true, project: this._serialize(current) };
  }

  async archive(id) {
    const current = this.projects.get(String(id || "").trim());
    if (!current) return { ok: false, error: "not_found" };
    current.status = "archived";
    current.updatedAt = new Date().toISOString();
    await this._persistProject(current);
    return { ok: true, project: this._serialize(current) };
  }

  async ensureWorkspace(id) {
    const current = this.projects.get(String(id || "").trim());
    if (!current) return { ok: false, error: "not_found" };

    const resolved = this._resolveWorkspacePath(current);
    if (!resolved.ok) return resolved;
    const workspacePath = resolved.workspacePath;

    if (fsSync.existsSync(workspacePath)) {
      const stat = await fs.stat(workspacePath);
      if (!stat.isDirectory()) {
        return { ok: false, error: "workspace_not_directory", message: "Project workspace exists but is not a directory." };
      }
      const remoteCheck = await this._checkRemote(workspacePath, current.repoUrl);
      if (!remoteCheck.ok) return remoteCheck;
      current.workspacePath = workspacePath;
      current.lastOpenedAt = new Date().toISOString();
      current.updatedAt = current.lastOpenedAt;
      await this._persistProject(current);
      return { ok: true, created: false, project: this._serialize(current), workspacePath };
    }

    if (!current.repoUrl) {
      return { ok: false, error: "repo_url_required", message: "Project does not have a repoUrl to clone." };
    }

    const rootDir = path.resolve(this.config.workdir || path.resolve(process.cwd(), "workspace"));
    const directory = path.relative(rootDir, workspacePath);
    const cloneResult = await this.cloneRepository({
      rootDir,
      repoUrl: current.repoUrl,
      directory,
      githubConfig: this.config.github || {}
    });
    if (!cloneResult.ok) {
      return { ok: false, error: "clone_failed", message: cloneResult.stderr || cloneResult.stdout || "Clone failed." };
    }

    current.workspacePath = workspacePath;
    current.lastOpenedAt = new Date().toISOString();
    current.updatedAt = current.lastOpenedAt;
    await this._persistProject(current);
    return { ok: true, created: true, project: this._serialize(current), workspacePath };
  }

  ownsWorkspace(workspacePath) {
    const target = path.resolve(String(workspacePath || ""));
    return [...this.projects.values()].some((project) => (
      project.status !== "archived" && project.workspacePath && path.resolve(project.workspacePath) === target
    ));
  }

  async _checkRemote(workspacePath, repoUrl) {
    if (!repoUrl) return { ok: true };
    const gitDir = path.join(workspacePath, ".git");
    if (!fsSync.existsSync(gitDir)) {
      return { ok: false, error: "workspace_not_git_repo", message: "Project workspace exists but is not a git repository." };
    }
    const result = await runGit(["remote", "get-url", "origin"], workspacePath);
    if (!result.ok) {
      return { ok: false, error: "remote_check_failed", message: result.stderr || "Unable to inspect project remote." };
    }
    const actual = String(result.stdout || "").trim();
    if (actual && actual !== repoUrl) {
      return {
        ok: false,
        error: "remote_mismatch",
        message: `Project workspace remote is ${actual}, expected ${repoUrl}.`
      };
    }
    return { ok: true };
  }

  _resolveWorkspacePath(project) {
    if (project.workspacePath) {
      return { ok: true, workspacePath: path.resolve(project.workspacePath) };
    }
    const rootDir = path.resolve(this.config.workdir || path.resolve(process.cwd(), "workspace"));
    const directory = project.directory || defaultDirectoryForRepo(project.repoUrl, project.name);
    try {
      return { ok: true, workspacePath: createSafeJoin(rootDir)(directory) };
    } catch (err) {
      return { ok: false, error: "invalid_workspace", message: err.message || String(err) };
    }
  }

  _validate(input, options = {}) {
    const name = String(input?.name || "").trim();
    if (!name) return { ok: false, error: "name_required", message: "Project name is required." };
    const value = {
      id: options.partial ? input.id : (input.id ? slugify(input.id, "") : null),
      name,
      aliases: normalizeAliases(input.aliases),
      description: String(input.description || "").trim(),
      repoUrl: input.repoUrl ? String(input.repoUrl).trim() : null,
      directory: input.directory ? slugify(input.directory, "") : null,
      workspacePath: input.workspacePath ? path.resolve(String(input.workspacePath)) : null,
      defaultBranch: input.defaultBranch ? String(input.defaultBranch).trim() : null,
      resources: normalizeResources(input.resources),
      memoryIds: Array.isArray(input.memoryIds) ? input.memoryIds.map((id) => String(id)).filter(Boolean) : []
    };
    if (!value.id) delete value.id;
    return { ok: true, value };
  }

  _createId(name) {
    const base = slugify(name, "project");
    let id = base;
    while (this.projects.has(id)) id = `${base}-${randomUUID().slice(0, 8)}`;
    return id;
  }

  _projectFile(projectId) {
    return path.join(this.projectsDir, `${projectId}.json`);
  }

  _serialize(project) {
    return sanitizeJsonValue({
      id: project.id,
      name: project.name,
      aliases: project.aliases || [],
      description: project.description || "",
      repoUrl: project.repoUrl || null,
      directory: project.directory || null,
      workspacePath: project.workspacePath || null,
      defaultBranch: project.defaultBranch || null,
      resources: project.resources || [],
      memoryIds: project.memoryIds || [],
      status: project.status || "active",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      lastOpenedAt: project.lastOpenedAt || null
    });
  }

  _hydrate(data) {
    const now = new Date().toISOString();
    return {
      id: String(data.id || randomUUID()),
      name: String(data.name || "Untitled project"),
      aliases: normalizeAliases(data.aliases),
      description: String(data.description || ""),
      repoUrl: data.repoUrl ? String(data.repoUrl) : null,
      directory: data.directory ? String(data.directory) : null,
      workspacePath: data.workspacePath ? path.resolve(String(data.workspacePath)) : null,
      defaultBranch: data.defaultBranch ? String(data.defaultBranch) : null,
      resources: normalizeResources(data.resources),
      memoryIds: Array.isArray(data.memoryIds) ? data.memoryIds.map((id) => String(id)) : [],
      status: data.status === "archived" ? "archived" : "active",
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      lastOpenedAt: data.lastOpenedAt || null
    };
  }

  async _loadPersistedProjects() {
    const entries = await fs.readdir(this.projectsDir, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
      const filePath = path.join(this.projectsDir, entry.name);
      try {
        const migrated = migratePersistedRecord(
          JSON.parse(await fs.readFile(filePath, "utf8")),
          "project"
        );
        const data = migrated.record;
        const project = this._hydrate(data);
        this.projects.set(project.id, project);
        if (migrated.migrated) await this._persistProject(project);
      } catch (err) {
        console.warn(`Failed to load project ${filePath}: ${err.message || String(err)}`);
      }
    }
  }

  async _persistProject(project) {
    const snapshot = JSON.stringify(versionPersistedRecord("project", this._serialize(project)), null, 2);
    const target = this._projectFile(project.id);
    const temp = `${target}.tmp`;
    const writeProject = async () => {
      await fs.mkdir(this.projectsDir, { recursive: true });
      await fs.writeFile(temp, snapshot, "utf8");
      await fs.rename(temp, target);
    };
    this._persistQueue = this._persistQueue.catch(() => {}).then(writeProject);
    return this._persistQueue;
  }
}

module.exports = {
  ProjectManager,
  defaultDirectoryForRepo
};
