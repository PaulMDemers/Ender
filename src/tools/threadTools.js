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
      description: "Start a child thread for parallel or delegated work. Returns the child thread id so you can either keep going and poll later, or await it like a join.",
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
      description: "Check the current status of a child thread without blocking. This is the async polling option and returns immediately.",
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
      description: "Wait for a child thread to finish. This is the blocking await/join option. If timeoutMs is omitted or null, wait until the child reaches a terminal status. If timeoutMs is 0, return immediately with the current snapshot and timedOut=true when the child is still running. Prefer thread_status for normal polling.",
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
