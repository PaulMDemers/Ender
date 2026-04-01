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
      description: "Inspect whether the external Ender supervisor is available and view recent self-update state.",
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
      description: "Create a rollback checkpoint before editing Ender's own source. Call this before modifying the self workspace.",
      schema: z.object({
        label: z.string().nullable().default(null)
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
      description: "Ask the external supervisor to verify the current Ender source tree, restart the parent process, and roll back to a checkpoint on failure. This is asynchronous because the current server process may be restarted.",
      schema: z.object({
        checkpointId: z.string().min(1),
        reason: z.string().nullable().default(null),
        verifyCommand: z.string().nullable().default(null),
        timeoutMs: z.number().int().positive().nullable().default(null)
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
      description: "List recent self-update operations or inspect one specific operation by id after a restart attempt.",
      schema: z.object({
        operationId: z.string().nullable().default(null)
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
