const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { createSafeJoin } = require("../utils/safePath");

function createFileTools(rootDir) {
  const safeJoin = createSafeJoin(rootDir);
  const normalizedRoot = path.resolve(rootDir);

  async function walkRecursive(baseDir, relDir, out, maxItems) {
    if (out.length >= maxItems) return;
    const current = path.join(baseDir, relDir);
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
      out.push(relPath);
      if (out.length >= maxItems) return;
      if (entry.isDirectory()) {
        await walkRecursive(baseDir, relPath, out, maxItems);
        if (out.length >= maxItems) return;
      }
    }
  }

  function scorePathCandidate(requestedRelPath, candidateRelPath) {
    const requested = String(requestedRelPath || "").replace(/\\/g, "/").toLowerCase();
    const candidate = String(candidateRelPath || "").replace(/\\/g, "/").toLowerCase();
    if (!requested || !candidate) return 0;

    const requestedParts = requested.split("/").filter(Boolean);
    const candidateParts = candidate.split("/").filter(Boolean);
    const requestedBase = requestedParts[requestedParts.length - 1] || "";
    const candidateBase = candidateParts[candidateParts.length - 1] || "";

    let score = 0;
    if (requested === candidate) score += 200;
    if (requestedBase && requestedBase === candidateBase) score += 120;
    if (requestedBase && candidateBase.includes(requestedBase)) score += 35;
    if (requestedBase && requestedBase.includes(candidateBase)) score += 20;
    if (candidate.endsWith(requested)) score += 80;
    if (requested.endsWith(candidate)) score += 30;

    let suffixMatches = 0;
    while (
      suffixMatches < requestedParts.length
      && suffixMatches < candidateParts.length
      && requestedParts[requestedParts.length - 1 - suffixMatches] === candidateParts[candidateParts.length - 1 - suffixMatches]
    ) {
      suffixMatches += 1;
    }
    score += suffixMatches * 45;

    return score;
  }

  async function nearestExistingAncestor(fullPath) {
    let current = path.resolve(fullPath);
    while (current.startsWith(normalizedRoot)) {
      try {
        const stat = await fs.stat(current);
        return { path: current, isDir: stat.isDirectory() };
      } catch (err) {
        if (!err || err.code !== "ENOENT") throw err;
      }

      if (current === normalizedRoot) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return { path: normalizedRoot, isDir: true };
  }

  async function listDirectoryPreview(dirPath, maxItems = 25) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .slice(0, maxItems)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
  }

  async function findPathSuggestions(requestedRelPath, limit = 8, scanLimit = 12000) {
    const candidates = [];
    const items = [];
    await walkRecursive(normalizedRoot, "", items, scanLimit);

    for (const relPath of items) {
      const score = scorePathCandidate(requestedRelPath, relPath);
      if (score <= 0) continue;
      candidates.push({ relPath, score });
    }

    return candidates
      .sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath))
      .slice(0, limit)
      .map((entry) => entry.relPath);
  }

  async function buildMissingPathResult(userPath, fullPath, kind) {
    const requestedPath = String(userPath || "");
    const ancestor = await nearestExistingAncestor(fullPath);
    const anchorDir = ancestor.isDir ? ancestor.path : path.dirname(ancestor.path);

    let nearby = [];
    try {
      nearby = await listDirectoryPreview(anchorDir);
    } catch {
      nearby = [];
    }

    let suggestions = [];
    try {
      suggestions = await findPathSuggestions(requestedPath);
    } catch {
      suggestions = [];
    }

    return {
      ok: false,
      error: `${kind}_not_found`,
      requestedPath,
      path: fullPath,
      nearestExistingPath: ancestor.path,
      nearestExistingPathIsDir: ancestor.isDir,
      nearbyEntries: nearby,
      suggestions,
      message: suggestions.length
        ? `${kind} not found. Try one of the suggested paths or inspect the nearest existing directory.`
        : `${kind} not found. Inspect the nearest existing directory and try again with a corrected path.`
    };
  }

  const file_write = tool(
    async ({ path: userPath, content }) => {
      const full = safeJoin(userPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
      return JSON.stringify({ ok: true, path: full, bytes: Buffer.byteLength(content, "utf8") });
    },
    {
      name: "file_write",
      description: "Purpose: Write a UTF-8 text file within the workspace root. When to use: To create or update a text file in the workspace when the task requires it. Constraints: Path must remain within workspace root; parent traversal outside workspace is rejected; content is UTF-8 text only. Side effects: yes. Requires explicit user intent: usually. Output: confirmation of write result.",
      schema: z.object({ path: z.string().min(1), content: z.string().min(1) })
    }
  );

  const file_read = tool(
    async ({ path: userPath }) => {
      const full = safeJoin(userPath);
      try {
        const content = await fs.readFile(full, "utf8");
        return JSON.stringify({ ok: true, path: full, content });
      } catch (err) {
        if (err && err.code === "ENOENT") {
          return JSON.stringify(await buildMissingPathResult(userPath, full, "file"));
        }
        throw err;
      }
    },
    {
      name: "file_read",
      description: "Purpose: Read a UTF-8 text file within the workspace root. When to use: To inspect text files in the workspace. Constraints: Path must remain within workspace root; UTF-8 text only. Use other tools for binary or image inspection. Side effects: no. Requires explicit user intent: no. Output: file contents.",
      schema: z.object({ path: z.string().min(1) })
    }
  );

  const file_list = tool(
    async ({ path: userPath, recursive, maxItems }) => {
      const full = safeJoin(userPath || ".");
      const limit = Number.isFinite(maxItems) ? Math.max(1, Math.min(maxItems, 20000)) : 5000;

      try {
        if (!recursive) {
          const items = await fs.readdir(full);
          return JSON.stringify({ ok: true, path: full, recursive: false, items });
        }

        const items = [];
        await walkRecursive(full, "", items, limit);
        return JSON.stringify({ ok: true, path: full, recursive: true, truncated: items.length >= limit, items });
      } catch (err) {
        if (err && err.code === "ENOENT") {
          return JSON.stringify(await buildMissingPathResult(userPath || ".", full, "path"));
        }
        throw err;
      }
    },
    {
      name: "file_list",
      description: "Purpose: List directory entries within the workspace root. When to use: To inspect workspace structure. Constraints: Path must remain within workspace root; recursive listing ignores node_modules. Side effects: no. Requires explicit user intent: no. Output: directory entries.",
      schema: z.object({
        path: z.string().nullable(),
        recursive: z.boolean().nullable(),
        maxItems: z.number().int().positive().nullable()
      })
    }
  );

  const file_exists = tool(
    async ({ path: userPath }) => {
      const full = safeJoin(userPath);
      try {
        const st = await fs.stat(full);
        return JSON.stringify({ ok: true, exists: true, isDir: st.isDirectory(), path: full });
      } catch (err) {
        if (err && err.code === "ENOENT") {
          return JSON.stringify({ ok: true, exists: false, path: full });
        }
        throw err;
      }
    },
    {
      name: "file_exists",
      description: "Purpose: Check whether a file or directory exists within the workspace root. When to use: To verify workspace paths before reading or writing. Constraints: Path must remain within workspace root. Side effects: no. Requires explicit user intent: no. Output: existence boolean.",
      schema: z.object({ path: z.string().min(1) })
    }
  );

  return [file_write, file_read, file_list, file_exists];
}

module.exports = { createFileTools };
