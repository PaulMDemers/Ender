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
      description: "Save a concise verified fact",
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
      description: "Add next actionable step",
      schema: z.object({ todo: z.string().min(1) })
    }
  );

  const get_ledgers = tool(
    async () => JSON.stringify(ledger),
    {
      name: "get_ledgers",
      description: "Read current task/progress ledger",
      schema: z.object({})
    }
  );

  const finalize = tool(
    async ({ note }) => {
      ledger.progress.done = true;
      const bullets = ledger.task.facts.map((f) => `- ${f}`);
      const output = bullets.length ? bullets.join("\n") : "- No facts collected";
      return `DONE:\n${output}${note ? `\n\n${note}` : ""}`;
    },
    {
      name: "finalize",
      description: "Mark task complete and return final answer",
      schema: z.object({ note: z.string().nullable() })
    }
  );

  return [save_fact, add_todo, get_ledgers, finalize];
}

module.exports = { createLedgerTools };
