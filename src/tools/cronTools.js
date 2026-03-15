const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

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
      description: "Get current server time (UTC + local timezone) for relative scheduling calculations",
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
      description: "Create a cron schedule for a prompt, thread continuation, or workflow run",
      schema: z.object({
        name: z.string().min(1),
        cron: z.string().min(1),
        timezone: z.string().optional().nullable(),
        targetKind: z.enum(["prompt", "thread", "workflow"]),
        prompt: z.string().optional().nullable(),
        workspace: z.string().optional().nullable(),
        threadId: z.string().optional().nullable(),
        workflowId: z.string().optional().nullable(),
        workflowInputs: z.array(z.record(z.any())).optional().nullable()
      })
    }
  );

  const cron_list = tool(
    async () => JSON.stringify({ ok: true, items: scheduleManager.list() }),
    {
      name: "cron_list",
      description: "List all schedules",
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
      description: "Delete a schedule by id",
      schema: z.object({ id: z.string().min(1) })
    }
  );

  return [time_now, cron_schedule, cron_list, cron_delete];
}

module.exports = { createCronTools };
