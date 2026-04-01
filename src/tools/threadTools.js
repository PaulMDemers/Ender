const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { sanitizeJsonValue } = require("../utils/jsonSafe");

function createThreadTools(taskManager, { taskId, onLog } = {}) {
  const requireCurrentTask = () => {
    if (!taskId) {
      return { ok: false, error: "task_id_required" };
    }
    const current = taskManager.getTaskSummary(taskId);
    if (!current) {
      return { ok: false, error: "task_not_found" };
    }
    return { ok: true, current };
  };

  const validateChildAccess = (current, targetId) => {
    if (targetId === current.id) return { ok: true };
    if (Array.isArray(current.childTaskIds) && current.childTaskIds.includes(targetId)) {
      return { ok: true };
    }
    return { ok: false, error: "thread_not_child" };
  };

  const thread_spawn = tool(
    async ({ prompt, workspace }) => {
      const currentState = requireCurrentTask();
      if (!currentState.ok) {
        return JSON.stringify(currentState);
      }

      const cleanPrompt = String(prompt || "").trim();
      if (!cleanPrompt) {
        return JSON.stringify({ ok: false, error: "prompt_required" });
      }

      const result = taskManager.startChildTask(taskId, cleanPrompt, workspace || undefined);
      if (!result.ok) {
        return JSON.stringify(result);
      }

      onLog?.({ level: "info", data: `spawned child thread ${result.id}` });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "thread_spawn",
      description: "Purpose: Start a child thread for delegated work. When to use: Only for independent subtasks where concurrency is beneficial. Side effects: yes, creates background work. Requires explicit user intent: no. Output: child thread id.",
      schema: z.object({
        prompt: z.string().min(1),
        workspace: z.string().nullable().default(null)
      })
    }
  );

  const thread_status = tool(
    async ({ threadId, includeLogs }) => {
      const currentState = requireCurrentTask();
      if (!currentState.ok) {
        return JSON.stringify(currentState);
      }

      const targetId = String(threadId || "").trim();
      if (!targetId) {
        return JSON.stringify({ ok: false, error: "thread_id_required" });
      }

      const access = validateChildAccess(currentState.current, targetId);
      if (!access.ok) {
        return JSON.stringify(access);
      }

      const summary = taskManager.getTaskSummary(targetId, { includeLogs });
      if (!summary) {
        return JSON.stringify({ ok: false, error: "not_found" });
      }
      return JSON.stringify(sanitizeJsonValue({ ok: true, task: summary }));
    },
    {
      name: "thread_status",
      description: "Purpose: Check child thread status without blocking. When to use: For non-blocking polling. Side effects: no. Requires explicit user intent: no. Output: current status snapshot.",
      schema: z.object({
        threadId: z.string().min(1),
        includeLogs: z.boolean().nullable().default(false)
      })
    }
  );

  const thread_await = tool(
    async ({ threadId, timeoutMs, includeLogs }) => {
      const currentState = requireCurrentTask();
      if (!currentState.ok) {
        return JSON.stringify(currentState);
      }

      const targetId = String(threadId || "").trim();
      if (!targetId) {
        return JSON.stringify({ ok: false, error: "thread_id_required" });
      }

      const access = validateChildAccess(currentState.current, targetId);
      if (!access.ok) {
        return JSON.stringify(access);
      }

      onLog?.({ level: "info", data: `awaiting child thread ${targetId}` });
      const result = await taskManager.waitForTask(targetId, { timeoutMs, includeLogs });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "thread_await",
      description: "Purpose: Wait for a child thread to finish. When to use: For blocking join behavior. Constraints: timeoutMs 0 returns an immediate snapshot. Side effects: no. Requires explicit user intent: no. Output: final or current status snapshot.",
      schema: z.object({
        threadId: z.string().min(1),
        timeoutMs: z.number().int().nonnegative().nullable().default(null),
        includeLogs: z.boolean().nullable().default(false)
      })
    }
  );

  return [thread_spawn, thread_status, thread_await];
}

module.exports = { createThreadTools };
