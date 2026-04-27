const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { sanitizeJsonValue } = require("../utils/jsonSafe");

function createMemoryTools(memoryManager, { taskId, taskManager, projectId, onLog } = {}) {
  const memory_search = tool(
    async ({ query, scope, limit }) => JSON.stringify(memoryManager.search({
      query,
      scope: scope || null,
      projectId: projectId || null,
      sourceThreadId: scope === "thread" ? taskId : null,
      limit
    })),
    {
      name: "memory_search",
      description: "Purpose: Search Ender memories for durable context. When to use: To recall global, project, or current-thread facts before acting. Side effects: no. Output: matching memories with ids.",
      schema: z.object({
        query: z.string().nullable(),
        scope: z.enum(["global", "project", "thread"]).nullable(),
        limit: z.number().int().positive().max(50).nullable()
      })
    }
  );

  const memory_create = tool(
    async ({ title, body, scope, kind, tags, loadPolicy, confidence }) => {
      const result = await memoryManager.create({
        title,
        body,
        scope: scope || (projectId ? "project" : "global"),
        kind: kind || "note",
        tags,
        loadPolicy: loadPolicy || "auto",
        confidence,
        projectId: scope === "project" || (!scope && projectId) ? projectId : null,
        sourceThreadId: scope === "thread" ? taskId : null
      });
      if (result.ok) onLog?.({ level: "info", data: `created memory ${result.memory.id}` });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "memory_create",
      description: "Purpose: Save a durable global, project, or thread memory. When to use: For stable user preferences, project facts, resource links, or compacted summaries. Constraints: Save only information supported by prompt or tool evidence. Side effects: yes, persists a memory record.",
      schema: z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        scope: z.enum(["global", "project", "thread"]).nullable(),
        kind: z.enum(["fact", "preference", "summary", "resource", "note"]).nullable(),
        tags: z.array(z.string()).nullable(),
        loadPolicy: z.enum(["auto", "pinned", "manual", "off"]).nullable(),
        confidence: z.number().min(0).max(1).nullable()
      })
    }
  );

  const memory_update = tool(
    async ({ memoryId, title, body, tags, loadPolicy, status }) => {
      const result = await memoryManager.update(memoryId, {
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
        ...(tags ? { tags } : {}),
        ...(loadPolicy ? { loadPolicy } : {}),
        ...(status ? { status } : {})
      });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "memory_update",
      description: "Purpose: Update an existing Ender memory by id. When to use: To correct stale information, adjust load policy, or archive a memory. Side effects: yes.",
      schema: z.object({
        memoryId: z.string().min(1),
        title: z.string().nullable(),
        body: z.string().nullable(),
        tags: z.array(z.string()).nullable(),
        loadPolicy: z.enum(["auto", "pinned", "manual", "off"]).nullable(),
        status: z.enum(["active", "archived"]).nullable()
      })
    }
  );

  const memory_compact_thread = tool(
    async ({ title, body }) => {
      const task = taskId && taskManager?.getTaskForContext ? taskManager.getTaskForContext(taskId) : null;
      const result = await memoryManager.compactThread(task, { title, body });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "memory_compact_thread",
      description: "Purpose: Compact the current thread into a durable memory summary. When to use: Before long context is lost or when a reusable project/thread summary has emerged. Side effects: yes.",
      schema: z.object({
        title: z.string().nullable(),
        body: z.string().nullable()
      })
    }
  );

  return [memory_search, memory_create, memory_update, memory_compact_thread];
}

module.exports = { createMemoryTools };
