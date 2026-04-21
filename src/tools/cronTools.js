const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

const workflowInputValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const workflowInputSchema = z.object({}).catchall(workflowInputValueSchema);

function getTimeSnapshot() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    isoUtc: now.toISOString(),
    epochMs: now.getTime(),
    timezone: tz,
    local: new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now)
  };
}

function createCronTools(scheduleManager, { taskId, requestApproval, onLog } = {}) {
  const time_now = tool(
    async () => JSON.stringify({ ok: true, now: getTimeSnapshot() }),
    {
      name: "time_now",
      description: "Purpose: Get current server time. When to use: Before relative scheduling calculations. Side effects: no. Requires explicit user intent: no. Output: current UTC and local time.",
      schema: z.object({})
    }
  );

  const cron_schedule = tool(
    async ({ name, cron, timezone, targetKind, prompt, workspace, threadId, workflowId, workflowInputs }) => {
      const target = (() => {
        if (targetKind === "prompt") {
          return {
            kind: "prompt",
            prompt: String(prompt || "").trim(),
            workspace: workspace ? String(workspace).trim() : null
          };
        }
        if (targetKind === "thread") {
          return {
            kind: "thread",
            threadId: String(threadId || taskId || "").trim(),
            prompt: String(prompt || "").trim()
          };
        }
        return {
          kind: "workflow",
          workflowId: String(workflowId || "").trim(),
          inputs: Array.isArray(workflowInputs) ? workflowInputs : []
        };
      })();

      onLog?.({ level: "warn", data: `schedule create approval required: ${name} (${targetKind})` });
      const approved = await requestApproval?.({
        type: "cron_schedule",
        title: "Approve schedule creation",
        description: `Allow Ender to create schedule \"${name}\"?`,
        details: { name, cron, timezone: timezone || null, targetKind, target }
      });

      if (!approved) {
        return JSON.stringify({ ok: false, error: "approval_denied", message: "schedule creation denied by user" });
      }

      const result = await scheduleManager.create({
        name,
        cron,
        timezone: timezone || null,
        target,
        createdByTaskId: taskId || null
      });
      return JSON.stringify(result);
    },
    {
      name: "cron_schedule",
      description: "Purpose: Create a recurring schedule. When to use: When the user requests automation or recurring execution. Side effects: yes. Requires explicit user intent: yes. Output: schedule details.",
      schema: z.object({
        name: z.string().min(1),
        cron: z.string().min(1),
        timezone: z.string().nullable(),
        targetKind: z.enum(["prompt", "thread", "workflow"]),
        prompt: z.string().nullable(),
        workspace: z.string().nullable(),
        threadId: z.string().nullable(),
        workflowId: z.string().nullable(),
        workflowInputs: z.array(workflowInputSchema).nullable()
      })
    }
  );

  const cron_list = tool(
    async () => JSON.stringify({ ok: true, items: scheduleManager.list() }),
    {
      name: "cron_list",
      description: "Purpose: List schedules. When to use: To inspect existing automation. Side effects: no. Requires explicit user intent: no. Output: schedule list.",
      schema: z.object({})
    }
  );

  const cron_delete = tool(
    async ({ id }) => {
      onLog?.({ level: "warn", data: `schedule delete approval required: ${id}` });
      const approved = await requestApproval?.({
        type: "schedule_delete",
        title: "Approve schedule deletion",
        description: `Allow Ender to delete schedule ${id}?`,
        details: { scheduleId: String(id) }
      });

      if (!approved) {
        return JSON.stringify({
          ok: false,
          error: "approval_denied",
          message: "schedule deletion denied by user"
        });
      }

      return JSON.stringify(await scheduleManager.delete(String(id)));
    },
    {
      name: "cron_delete",
      description: "Purpose: Delete a schedule. When to use: When requested to remove automation. Side effects: yes. Requires explicit user intent: yes. Output: deletion result.",
      schema: z.object({ id: z.string().min(1) })
    }
  );

  return [time_now, cron_schedule, cron_list, cron_delete];
}

module.exports = { createCronTools };
