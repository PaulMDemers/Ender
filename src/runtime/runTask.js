const fs = require("node:fs/promises");
const { createLedger } = require("../state/ledger");
const { createChatModel } = require("../llm/factory");
const { createFileTools } = require("../tools/fileTools");
const { createWebTools } = require("../tools/webTools");
const { createExecTool } = require("../tools/execTool");
const { createLedgerTools } = require("../tools/ledgerTools");
const { createGitTools } = require("../tools/gitTools");
const { createGitLabTools } = require("../tools/gitlabTools");
const { createGitHubTools } = require("../tools/githubTools");
const { createJiraTools } = require("../tools/jiraTools");
const { createEmailTools } = require("../tools/emailTools");
const { createCronTools } = require("../tools/cronTools");
const { runAgentLoop } = require("./runAgentLoop");
const { SYSTEM_PROMPT } = require("../agents/systemPrompt");

async function runTask({ goal, config, onLog, requestApproval, workspaceDir, taskId, scheduleManager }) {
  const activeWorkdir = workspaceDir || config.workdir;
  await fs.mkdir(activeWorkdir, { recursive: true });

  const ledger = createLedger();
  const model = createChatModel(config);

  const tools = [
    ...createFileTools(activeWorkdir),
    ...createWebTools(activeWorkdir),
    ...createGitTools(activeWorkdir, { requestApproval, onLog, githubConfig: config.github }),
    ...createGitLabTools(config.gitlab),
    ...createGitHubTools(config.github),
    ...createJiraTools(config.jira),
    ...createEmailTools(config.email),
    ...(scheduleManager ? createCronTools(scheduleManager, { taskId }) : []),
    createExecTool(activeWorkdir),
    ...createLedgerTools(ledger)
  ];

  onLog({ level: "info", data: `backend=${config.backend}` });
  onLog({ level: "info", data: `workspace=${activeWorkdir}` });
  onLog({ level: "info", data: `goal=${goal}` });

  const result = await runAgentLoop({
    model,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: goal,
    maxSteps: config.maxSteps,
    stallLimit: config.stallLimit,
    onLog
  });
  const finalText = result.result;
  ledger.progress.turns = result.steps;
  ledger.progress.maxTurnsReached = result.stopReason === "max_steps";
  ledger.progress.stallDetected = result.stopReason === "stall_detected";

  onLog({ level: "info", data: `loop stop reason=${result.stopReason}` });

  if (!ledger.progress.done && !String(finalText).startsWith("DONE:")) {
    const fallback = ledger.task.facts.length
      ? `DONE:\n${ledger.task.facts.map((f) => `- ${f}`).join("\n")}`
      : `DONE:\n- ${finalText}`;
    return { result: fallback, ledger };
  }

  return { result: finalText, ledger };
}

module.exports = { runTask };
