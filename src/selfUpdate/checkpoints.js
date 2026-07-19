const fs = require("node:fs/promises");
const path = require("node:path");
const cp = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { migratePersistedRecord, versionPersistedRecord } = require("../persistence/jsonRecord");

function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = cp.spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      resolve({ ok: false, code: 1, stdout, stderr: err.message || String(err) });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, code: code || 0, stdout, stderr });
    });
  });
}

async function ensureCleanRepo(rootDir) {
  const status = await runGit(["status", "--porcelain"], rootDir);
  if (!status.ok) {
    return {
      ok: false,
      error: "git_status_failed",
      message: status.stderr || "Unable to inspect git status"
    };
  }

  if (String(status.stdout || "").trim()) {
    return {
      ok: false,
      error: "repo_not_clean",
      message: "Create a self-update checkpoint before editing Ender, while the repo is clean."
    };
  }

  return { ok: true };
}

async function currentHead(rootDir) {
  const result = await runGit(["rev-parse", "HEAD"], rootDir);
  if (!result.ok) {
    return {
      ok: false,
      error: "git_rev_parse_failed",
      message: result.stderr || "Unable to resolve HEAD"
    };
  }
  return { ok: true, sha: String(result.stdout || "").trim() };
}

async function createCheckpoint(rootDir, storageDir, label) {
  const clean = await ensureCleanRepo(rootDir);
  if (!clean.ok) return clean;

  const head = await currentHead(rootDir);
  if (!head.ok) return head;

  const id = randomUUID();
  const now = new Date().toISOString();
  const checkpoint = {
    id,
    label: String(label || "").trim() || "Self-update checkpoint",
    createdAt: now,
    rootDir: path.resolve(rootDir),
    headSha: head.sha
  };

  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(
    path.join(storageDir, `${id}.json`),
    JSON.stringify(versionPersistedRecord("selfUpdateCheckpoint", checkpoint), null, 2),
    "utf8"
  );
  return { ok: true, checkpoint };
}

async function readCheckpoint(storageDir, checkpointId) {
  try {
    const file = path.join(storageDir, `${checkpointId}.json`);
    const raw = await fs.readFile(file, "utf8");
    const migrated = migratePersistedRecord(JSON.parse(raw), "selfUpdateCheckpoint");
    const { recordVersion: _recordVersion, ...checkpoint } = migrated.record;
    if (migrated.migrated) {
      await fs.writeFile(
        file,
        JSON.stringify(versionPersistedRecord("selfUpdateCheckpoint", checkpoint), null, 2),
        "utf8"
      );
    }
    return { ok: true, checkpoint };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { ok: false, error: "checkpoint_not_found", message: "Checkpoint not found" };
    }
    return { ok: false, error: "checkpoint_read_failed", message: err.message || String(err) };
  }
}

async function rollbackToCheckpoint(rootDir, checkpoint) {
  const reset = await runGit(["reset", "--hard", checkpoint.headSha], rootDir);
  if (!reset.ok) {
    return {
      ok: false,
      error: "git_reset_failed",
      message: reset.stderr || "Unable to reset to checkpoint"
    };
  }

  const clean = await runGit(["clean", "-fd"], rootDir);
  if (!clean.ok) {
    return {
      ok: false,
      error: "git_clean_failed",
      message: clean.stderr || "Unable to clean repo after rollback"
    };
  }

  return { ok: true };
}

module.exports = {
  runGit,
  createCheckpoint,
  readCheckpoint,
  rollbackToCheckpoint
};
