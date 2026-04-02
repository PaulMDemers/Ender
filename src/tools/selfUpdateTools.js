const path = require("node:path");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { sanitizeJsonValue } = require("../utils/jsonSafe");

function createSelfUpdateTools(selfUpdateManager, { requestApproval, onLog, activeWorkdir } = {}) {
  const selfRoot = path.resolve(selfUpdateManager?.config?.selfUpdate?.rootDir || "");
  const activeRoot = path.resolve(activeWorkdir || "");

  function requireSelfWorkspace() {
    if (!selfUpdateManager?.isConfigured?.()) {
      return {
        ok: false,
        error: "self_update_not_configured",
        message: "Self-update requires running Ender under scripts/ender-supervisor.js."
      };
    }
    if (!selfRoot || selfRoot !== activeRoot) {
      return {
        ok: false,
        error: "not_self_workspace",
        message: `Current workspace must be the Ender repo root (${selfRoot}) before using self-update tools.`
      };
    }
    return { ok: true };
  }

  const self_update_status = tool(
    async () => JSON.stringify(sanitizeJsonValue(await selfUpdateManager.status())),
    {
      name: "self_update_status",
      description: "Purpose: Inspect supervisor availability and recent self-update state. When to use: Only when working with Ender self-update flows. Side effects: no. Requires explicit user intent: no. Output: status information.",
      schema: z.object({})
    }
  );

  const self_update_checkpoint_create = tool(
    async ({ label }) => {
      const allowed = requireSelfWorkspace();
      if (!allowed.ok) return JSON.stringify(allowed);
      const result = await selfUpdateManager.createCheckpoint(label);
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "self_update_checkpoint_create",
      description: "Purpose: Create a rollback checkpoint before editing Ender's own source. When to use: Before modifying Ender's own repository under supervisor control. Side effects: yes. Requires explicit user intent: usually. Output: checkpoint id.",
      schema: z.object({
        label: z.string().nullable()
      })
    }
  );

  const self_update_apply = tool(
    async ({ checkpointId, reason, verifyCommand, timeoutMs }) => {
      const allowed = requireSelfWorkspace();
      if (!allowed.ok) return JSON.stringify(allowed);

      onLog?.({ level: "warn", data: `self-update apply approval required: checkpoint=${checkpointId}` });
      const approved = await requestApproval?.({
        type: "self_update_apply",
        title: "Approve self-update apply",
        description: "Allow Ender to verify its own source, restart under the supervisor, and roll back on failure?",
        details: {
          checkpointId,
          reason: reason || "",
          verifyCommand: verifyCommand || selfUpdateManager.config.selfUpdate.verifyCommand,
          workspace: activeRoot
        }
      });

      if (!approved) {
        return JSON.stringify({
          ok: false,
          error: "approval_denied",
          message: "self-update apply denied by user"
        });
      }

      const result = await selfUpdateManager.applyUpdate({
        checkpointId,
        reason,
        verifyCommand,
        timeoutMs
      });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "self_update_apply",
      description: "Purpose: Ask the supervisor to verify and restart with rollback on failure. When to use: After modifying Ender's own source under supervisor control. Side effects: yes. Requires explicit user intent: yes. Output: operation details.",
      schema: z.object({
        checkpointId: z.string().min(1),
        reason: z.string().nullable(),
        verifyCommand: z.string().nullable(),
        timeoutMs: z.number().int().positive().nullable()
      })
    }
  );

  const self_update_operations = tool(
    async ({ operationId }) => {
      const result = operationId
        ? await selfUpdateManager.getOperation(operationId)
        : await selfUpdateManager.listOperations();
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "self_update_operations",
      description: "Purpose: Inspect recent self-update operations. When to use: To monitor or verify self-update attempts. Side effects: no. Requires explicit user intent: no. Output: operation history or details.",
      schema: z.object({
        operationId: z.string().nullable()
      })
    }
  );

  return [
    self_update_status,
    self_update_checkpoint_create,
    self_update_apply,
    self_update_operations
  ];
}

module.exports = { createSelfUpdateTools };
