const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { createSafeJoin } = require("../utils/safePath");

function createFileTools(rootDir) {
  const safeJoin = createSafeJoin(rootDir);

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

  const file_write = tool(
    async ({ path: userPath, content }) => {
      const full = safeJoin(userPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
      return JSON.stringify({ ok: true, path: full, bytes: Buffer.byteLength(content, "utf8") });
    },
    {
      name: "file_write",
      description: "Write a UTF-8 text file within workspace root",
      schema: z.object({ path: z.string().min(1), content: z.string().min(1) })
    }
  );

  const file_read = tool(
    async ({ path: userPath }) => {
      const full = safeJoin(userPath);
      const content = await fs.readFile(full, "utf8");
      return JSON.stringify({ ok: true, path: full, content });
    },
    {
      name: "file_read",
      description: "Read a UTF-8 text file within workspace root",
      schema: z.object({ path: z.string().min(1) })
    }
  );

  const file_list = tool(
    async ({ path: userPath, recursive, maxItems }) => {
      const full = safeJoin(userPath || ".");
      const limit = Number.isFinite(maxItems) ? Math.max(1, Math.min(maxItems, 20000)) : 5000;

      if (!recursive) {
        const items = await fs.readdir(full);
        return JSON.stringify({ ok: true, path: full, recursive: false, items });
      }

      const items = [];
      await walkRecursive(full, "", items, limit);
      return JSON.stringify({ ok: true, path: full, recursive: true, truncated: items.length >= limit, items });
    },
    {
      name: "file_list",
      description: "List directory entries within workspace root. Set recursive=true to list nested files/dirs (ignores node_modules).",
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
      description: "Check whether a file or directory exists within workspace root",
      schema: z.object({ path: z.string().min(1) })
    }
  );

  return [file_write, file_read, file_list, file_exists];
}

module.exports = { createFileTools };
