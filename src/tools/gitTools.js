const cp = require("node:child_process");
const path = require("node:path");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { createSafeJoin } = require("../utils/safePath");

function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = cp.spawn("git", args, {
      cwd,
      shell: false
    });

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

function ensureEnderPrefix(text) {
  const value = String(text || "").trim();
  if (!value) return "[Ender]";
  return value.startsWith("[Ender]") ? value : `[Ender] ${value}`;
}

function normalizeGitHubOriginBase(baseUrl) {
  const raw = String(baseUrl || "https://github.com").trim();
  const root = raw.endsWith("/") ? raw : `${raw}/`;
  return new URL(root);
}

function isGitHubRepoUrl(repoUrl, githubConfig) {
  try {
    const target = new URL(String(repoUrl));
    const expected = normalizeGitHubOriginBase(githubConfig.baseUrl);
    return target.hostname === expected.hostname;
  } catch {
    return false;
  }
}

function buildGitHubExtraHeader(repoUrl, githubConfig) {
  if (!githubConfig?.token) return null;
  if (!isGitHubRepoUrl(repoUrl, githubConfig)) return null;
  const auth = Buffer.from(`x-access-token:${githubConfig.token}`).toString("base64");
  const origin = normalizeGitHubOriginBase(githubConfig.baseUrl);
  const scope = `${origin.protocol}//${origin.host}/`;
  return `http.${scope}.extraheader=AUTHORIZATION: basic ${auth}`;
}

async function getRemoteUrl(cwd, remoteName = "origin") {
  const result = await runGit(["remote", "get-url", remoteName], cwd);
  if (!result.ok) return null;
  return String(result.stdout || "").trim() || null;
}

async function withGitHubAuth(args, cwd, githubConfig, repoUrlHint, remoteNameHint) {
  const repoUrl = repoUrlHint || await getRemoteUrl(cwd, remoteNameHint || "origin");
  const extraHeader = repoUrl ? buildGitHubExtraHeader(repoUrl, githubConfig) : null;
  if (!extraHeader) return args;
  return ["-c", extraHeader, ...args];
}

async function cloneRepository({ rootDir, repoUrl, directory, githubConfig, runGitImpl = runGit }) {
  const safeJoin = createSafeJoin(rootDir);
  const targetDir = safeJoin(directory || path.basename(repoUrl, ".git"));
  const args = await withGitHubAuth(["clone", repoUrl, targetDir], rootDir, githubConfig, repoUrl);
  const result = await runGitImpl(args, rootDir);
  return { ...result, path: targetDir };
}

function createGitTools(rootDir, { requestApproval, onLog, githubConfig }) {
  const safeJoin = createSafeJoin(rootDir);

  const git_clone = tool(
    async ({ repoUrl, directory }) => {
      const result = await cloneRepository({ rootDir, repoUrl, directory, githubConfig });
      return JSON.stringify(result);
    },
    {
      name: "git_clone",
      description: "Clone a git repository into workspace",
      schema: z.object({
        repoUrl: z.string().url(),
        directory: z.string().nullable()
      })
    }
  );

  const git_fetch = tool(
    async ({ repoPath, remote, prune }) => {
      const cwd = safeJoin(repoPath || ".");
      const args = ["fetch"];
      if (prune) args.push("--prune");
      if (remote) args.push(remote);
      const authArgs = await withGitHubAuth(args, cwd, githubConfig, null, remote || "origin");
      const result = await runGit(authArgs, cwd);
      return JSON.stringify(result);
    },
    {
      name: "git_fetch",
      description: "Fetch updates from remote",
      schema: z.object({
        repoPath: z.string().nullable(),
        remote: z.string().nullable(),
        prune: z.boolean().nullable()
      })
    }
  );

  const git_status = tool(
    async ({ repoPath, short }) => {
      const cwd = safeJoin(repoPath || ".");
      const args = ["status"];
      if (short) args.push("--short");
      const result = await runGit(args, cwd);
      return JSON.stringify(result);
    },
    {
      name: "git_status",
      description: "Read git status",
      schema: z.object({
        repoPath: z.string().nullable(),
        short: z.boolean().nullable()
      })
    }
  );

  const git_add = tool(
    async ({ repoPath, paths, all }) => {
      const cwd = safeJoin(repoPath || ".");
      const args = ["add"];
      if (all || !paths || paths.length === 0) {
        args.push("--all");
      } else {
        args.push(...paths);
      }
      const result = await runGit(args, cwd);
      return JSON.stringify(result);
    },
    {
      name: "git_add",
      description: "Stage file changes",
      schema: z.object({
        repoPath: z.string().nullable(),
        paths: z.array(z.string()).nullable(),
        all: z.boolean().nullable()
      })
    }
  );

  const git_commit = tool(
    async ({ repoPath, message, all }) => {
      const cwd = safeJoin(repoPath || ".");
      const args = ["commit", "-m", ensureEnderPrefix(message)];
      if (all) args.push("-a");
      const result = await runGit(args, cwd);
      return JSON.stringify(result);
    },
    {
      name: "git_commit",
      description: "Commit staged changes",
      schema: z.object({
        repoPath: z.string().nullable(),
        message: z.string().min(1),
        all: z.boolean().nullable()
      })
    }
  );

  const git_pull = tool(
    async ({ repoPath, remote, branch, rebase }) => {
      const cwd = safeJoin(repoPath || ".");
      const args = ["pull"];
      if (rebase) args.push("--rebase");
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const authArgs = await withGitHubAuth(args, cwd, githubConfig, null, remote || "origin");
      const result = await runGit(authArgs, cwd);
      return JSON.stringify(result);
    },
    {
      name: "git_pull",
      description: "Pull changes from remote",
      schema: z.object({
        repoPath: z.string().nullable(),
        remote: z.string().nullable(),
        branch: z.string().nullable(),
        rebase: z.boolean().nullable()
      })
    }
  );

  const git_push = tool(
    async ({ repoPath, remote, branch, setUpstream, forceWithLease }) => {
      const cwd = safeJoin(repoPath || ".");
      const pushSummary = `git push${remote ? ` ${remote}` : ""}${branch ? ` ${branch}` : ""}${setUpstream ? " --set-upstream" : ""}${forceWithLease ? " --force-with-lease" : ""}`;

      onLog?.({ level: "warn", data: `push approval required: ${pushSummary} (cwd=${cwd})` });
      const approved = await requestApproval({
        type: "git_push",
        title: "Approve git push",
        description: `Allow Ender to run: ${pushSummary}`,
        details: { cwd, remote: remote || "origin", branch: branch || "(current)" }
      });

      if (!approved) {
        return JSON.stringify({ ok: false, code: 1, stdout: "", stderr: "push denied by user" });
      }

      const args = ["push"];
      if (setUpstream) args.push("--set-upstream");
      if (forceWithLease) args.push("--force-with-lease");
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const authArgs = await withGitHubAuth(args, cwd, githubConfig, null, remote || "origin");
      const result = await runGit(authArgs, cwd);
      return JSON.stringify(result);
    },
    {
      name: "git_push",
      description: "Push commits to remote. Requires explicit UI approval.",
      schema: z.object({
        repoPath: z.string().nullable(),
        remote: z.string().nullable(),
        branch: z.string().nullable(),
        setUpstream: z.boolean().nullable(),
        forceWithLease: z.boolean().nullable()
      })
    }
  );

  return [git_clone, git_fetch, git_status, git_add, git_commit, git_pull, git_push];
}

module.exports = { createGitTools, runGit, withGitHubAuth, cloneRepository };
