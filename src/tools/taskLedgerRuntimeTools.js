const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

function createTaskLedgerRuntimeTools(taskLedgerManager, taskManager, { taskId, onLog } = {}) {
  const getLedgerEntryId = () => {
    if (!taskId) return null;
    const summary = taskManager?.getTaskSummary?.(taskId);
    const ledgerEntryId = String(summary?.ledgerEntryId || "").trim();
    return ledgerEntryId || null;
  };

  const requireLedgerTask = () => {
    const ledgerEntryId = getLedgerEntryId();
    if (!ledgerEntryId) {
      return { ok: false, error: "ledger_entry_not_found", message: "Current task is not linked to a ledger entry." };
    }
    return { ok: true, ledgerEntryId };
  };

  const ledger_set_stage = tool(
    async ({ stage, summary }) => {
      const state = requireLedgerTask();
      if (!state.ok) return JSON.stringify(state);
      onLog?.({ level: "info", data: `ledger stage update: ${stage}` });
      return JSON.stringify(await taskLedgerManager.recordStage(state.ledgerEntryId, { stage, summary }));
    },
    {
      name: "ledger_set_stage",
      description: "Purpose: Record the current ledger task lifecycle stage. When to use: At the start of each major phase such as intake, workspace_scan, implement, or finalize. Constraints: Only use valid lifecycle stages and keep summaries concise. Side effects: updates the global task ledger entry for the current task. Requires explicit user intent: no. Output: updated ledger entry snapshot.",
      schema: z.object({
        stage: z.enum(["intake", "feasibility_check", "workspace_scan", "plan", "implement", "verify", "finalize"]),
        summary: z.string().nullable()
      })
    }
  );

  const ledger_report_feasibility = tool(
    async ({ outcome, summary }) => {
      const state = requireLedgerTask();
      if (!state.ok) return JSON.stringify(state);
      onLog?.({ level: "info", data: `ledger feasibility: ${outcome}` });
      return JSON.stringify(await taskLedgerManager.reportFeasibility(state.ledgerEntryId, { outcome, summary }));
    },
    {
      name: "ledger_report_feasibility",
      description: "Purpose: Record whether the ledger task is accomplishable with current information and constraints. When to use: After reviewing the task and workspace but before implementation. Constraints: outcome must be one of ready, needs_input, blocked, or rejected. Side effects: updates the global task ledger entry. Requires explicit user intent: no. Output: updated ledger entry snapshot.",
      schema: z.object({
        outcome: z.enum(["ready", "needs_input", "blocked", "rejected"]),
        summary: z.string().min(1)
      })
    }
  );

  const ledger_save_plan = tool(
    async ({ summary, checklist, verificationSteps }) => {
      const state = requireLedgerTask();
      if (!state.ok) return JSON.stringify(state);
      onLog?.({ level: "info", data: "ledger plan saved" });
      return JSON.stringify(await taskLedgerManager.savePlan(state.ledgerEntryId, {
        summary,
        checklist,
        verificationSteps
      }));
    },
    {
      name: "ledger_save_plan",
      description: "Purpose: Save the concrete implementation plan for the current ledger task. When to use: Once the task is feasible and before editing or making durable changes. Constraints: checklist and verification steps should be concise, actionable items. Side effects: updates the global task ledger entry. Requires explicit user intent: no. Output: updated ledger entry snapshot.",
      schema: z.object({
        summary: z.string().nullable(),
        checklist: z.array(z.string()).nullable(),
        verificationSteps: z.array(z.string()).nullable()
      })
    }
  );

  const ledger_report_verification = tool(
    async ({ status, summary, evidence }) => {
      const state = requireLedgerTask();
      if (!state.ok) return JSON.stringify(state);
      onLog?.({ level: "info", data: `ledger verification: ${status}` });
      return JSON.stringify(await taskLedgerManager.reportVerification(state.ledgerEntryId, {
        status,
        summary,
        evidence
      }));
    },
    {
      name: "ledger_report_verification",
      description: "Purpose: Record the verification result for the current ledger task. When to use: After running tests, checks, builds, or other validation steps. Constraints: evidence should list commands, files, or observable checks used to validate the work. Side effects: updates the global task ledger entry. Requires explicit user intent: no. Output: updated ledger entry snapshot.",
      schema: z.object({
        status: z.enum(["pending", "running", "passed", "failed", "skipped"]),
        summary: z.string().nullable(),
        evidence: z.array(z.string()).nullable()
      })
    }
  );

  return [ledger_set_stage, ledger_report_feasibility, ledger_save_plan, ledger_report_verification];
}

module.exports = { createTaskLedgerRuntimeTools };
