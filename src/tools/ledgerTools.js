const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { addUnique } = require("../state/ledger");

function createLedgerTools(ledger) {
  const save_fact = tool(
    async ({ fact }) => {
      const saved = addUnique(ledger.task.facts, fact);
      return JSON.stringify({ ok: true, saved });
    },
    {
      name: "save_fact",
      description: "Purpose: Save a concise verified fact for task continuity. When to use: For multi-step tasks when a fact is directly supported by prompt content or tool output. Constraints: Do not save hypotheses, plans, or interpretations as facts. Side effects: internal state only. Requires explicit user intent: no. Output: confirmation of saved fact.",
      schema: z.object({ fact: z.string().min(1) })
    }
  );

  const add_todo = tool(
    async ({ todo }) => {
      const saved = addUnique(ledger.task.todos, todo);
      return JSON.stringify({ ok: true, saved });
    },
    {
      name: "add_todo",
      description: "Purpose: Add a next actionable step. When to use: For multi-step or stateful tasks. Constraints: Keep todos concise and actionable. Side effects: internal state only. Requires explicit user intent: no. Output: confirmation of saved todo.",
      schema: z.object({ todo: z.string().min(1) })
    }
  );

  const get_ledgers = tool(
    async () => JSON.stringify(ledger),
    {
      name: "get_ledgers",
      description: "Purpose: Read current task and progress ledger. When to use: To inspect saved plan, facts, and progress. Side effects: no. Requires explicit user intent: no. Output: current ledger state.",
      schema: z.object({})
    }
  );

  const finalize = tool(
    async ({ note }) => {
      ledger.progress.done = true;
      const finalNote = String(note || "").trim();
      const normalized = finalNote.startsWith("DONE:") ? finalNote : `DONE:${finalNote ? `\n${finalNote}` : ""}`;
      return normalized;
    },
    {
      name: "finalize",
      description: "Purpose: Mark task completion and emit the final user-visible response. When to use: Once the task is complete or cannot proceed further. Constraints: note must begin with DONE:; if it does not, the tool will normalize it. Side effects: ends the task. Requires explicit user intent: no. Output: final completion message.",
      schema: z.object({ note: z.string().nullable() })
    }
  );

  return [save_fact, add_todo, get_ledgers, finalize];
}

module.exports = { createLedgerTools };
