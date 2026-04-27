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
const { createThreadTools } = require("../tools/threadTools");
const { createConfluenceTools } = require("../tools/confluenceTools");
const { createGoogleDriveTools } = require("../tools/googleDriveTools");
const { createSelfUpdateTools } = require("../tools/selfUpdateTools");
const { createTaskLedgerRuntimeTools } = require("../tools/taskLedgerRuntimeTools");
const { createMemoryTools } = require("../tools/memoryTools");
const { createProjectTools } = require("../tools/projectTools");
const { runAgentLoop } = require("./runAgentLoop");
const { SYSTEM_PROMPT } = require("../agents/systemPrompt");
const { validateToolSchemasForBackend } = require("../llm/toolSchemaPreflight");

function inferLedgerAutonomousStatus(text) {
  const body = String(text || "").trim().toLowerCase();
  if (!body) return "blocked";

  const needsInputSignals = [
    "need more information",
    "need additional information",
    "need more info",
    "need additional info",
    "i need",
    "please provide",
    "can you provide",
    "which would you like",
    "how would you like",
    "what would you like",
    "do you want",
    "would you like",
    "should i",
    "question"
  ];

  if (body.includes("?") || needsInputSignals.some((signal) => body.includes(signal))) {
    return "needs_input";
  }

  return "blocked";
}

function buildLedgerTaskSystemPrompt(basePrompt) {
  return [
    String(basePrompt || SYSTEM_PROMPT).trim(),
    "",
    "Ledger-run autonomy policy:",
    "- This run is autonomous. Do not stop to ask the operator for preferences, confirmation, or optional next steps.",
    "- Make reasonable implementation decisions yourself whenever they are reversible or low risk.",
    "- Only end with finalize status=completed when the requested work is actually fulfilled.",
    "- If required information is genuinely missing and the task cannot continue, call finalize with status=needs_input and explain exactly what information is missing.",
    "- If the task cannot be fulfilled because of an external constraint, missing dependency, permission boundary, or hard blocker, call finalize with status=blocked and explain the blocker clearly.",
    "- Do not treat a request for operator guidance as successful completion.",
    "- Use the dedicated ledger tools to keep the entry updated as you move through intake, feasibility_check, workspace_scan, plan, implement, verify, and finalize.",
    "- Before implementation begins, you must save a concrete plan and checklist into the ledger.",
    "- For coding tasks, verification is required unless impossible; record the reason if verification must be skipped."
  ].join("\n");
}

async function runTask({
  goal,
  thread,
  config,
  onLog,
  requestApproval,
  workspaceDir,
  taskId,
  taskMeta,
  scheduleManager,
  taskManager,
  selfUpdateManager,
  taskLedgerManager,
  projectManager,
  memoryManager
}) {
  const activeWorkdir = workspaceDir || config.workdir;
  await fs.mkdir(activeWorkdir, { recursive: true });

  const ledger = createLedger();
  const model = createChatModel(config);
  const taskSummary = taskId && taskManager?.getTaskSummary ? taskManager.getTaskSummary(taskId) : null;
  const isLedgerTask = Boolean(taskSummary?.ledgerEntryId);
  const project = taskSummary?.projectId && projectManager?.get ? projectManager.get(taskSummary.projectId) : null;
  const memoryContext = memoryManager?.buildContextPack
    ? memoryManager.buildContextPack({
      task: taskMeta || taskSummary,
      project,
      memoryMode: taskSummary?.memoryMode || "auto"
    })
    : { items: [], text: "" };
  let finalizedOutcome = null;

  const tools = [
    ...createFileTools(activeWorkdir),
    ...createWebTools(activeWorkdir),
    ...createGitTools(activeWorkdir, { requestApproval, onLog, githubConfig: config.github }),
    ...createGitLabTools(config.gitlab, { requestApproval, onLog }),
    ...createGitHubTools(config.github, { requestApproval, onLog }),
    ...createJiraTools(config.jira, { requestApproval, onLog }),
    ...createConfluenceTools(config.confluence, { requestApproval, onLog }),
    ...createGoogleDriveTools(config.googleDrive, { requestApproval, onLog }),
    ...createEmailTools(config.email, { requestApproval, onLog }),
    ...(scheduleManager ? createCronTools(scheduleManager, { taskId, requestApproval, onLog }) : []),
    ...(taskManager ? createThreadTools(taskManager, { taskId, onLog }) : []),
    ...(selfUpdateManager ? createSelfUpdateTools(selfUpdateManager, { requestApproval, onLog, activeWorkdir }) : []),
    ...(projectManager ? createProjectTools(projectManager, { onLog }) : []),
    ...(memoryManager ? createMemoryTools(memoryManager, {
      taskId,
      taskManager,
      projectId: taskSummary?.projectId || null,
      onLog
    }) : []),
    ...(isLedgerTask && taskLedgerManager && taskManager
      ? createTaskLedgerRuntimeTools(taskLedgerManager, taskManager, { taskId, onLog })
      : []),
    createExecTool(activeWorkdir, { requestApproval, onLog }),
    ...createLedgerTools(ledger, {
      onFinalize(outcome) {
        finalizedOutcome = outcome;
      }
    })
  ];

  validateToolSchemasForBackend(config.backend, tools, { onLog });

  onLog({
    level: "info",
    data: `backend=${config.backend}${config.activeLlmProfileId ? ` profile=${config.activeLlmProfileId}` : ""}`
  });
  onLog({ level: "info", data: `workspace=${activeWorkdir}` });
  if (project) onLog({ level: "info", data: `project=${project.id}` });
  if (memoryContext.items.length) onLog({ level: "info", data: `memories_loaded=${memoryContext.items.length}` });

  const result = await runAgentLoop({
    model,
    tools,
    systemPrompt: isLedgerTask
      ? buildLedgerTaskSystemPrompt(config.systemPrompt || SYSTEM_PROMPT)
      : (config.systemPrompt || SYSTEM_PROMPT),
    runtimeContext: memoryContext.text,
    userPrompt: goal,
    thread,
    maxSteps: config.maxSteps,
    stallLimit: config.stallLimit,
    onLog
  });
  const finalText = result.result;
  ledger.progress.turns = result.steps;
  ledger.progress.maxTurnsReached = result.stopReason === "max_steps";
  ledger.progress.stallDetected = result.stopReason === "stall_detected";

  onLog({ level: "info", data: `loop stop reason=${result.stopReason}` });

  if (isLedgerTask && finalizedOutcome) {
    return {
      result: finalizedOutcome.note,
      ledger,
      outcomeStatus: finalizedOutcome.status
    };
  }

  if (isLedgerTask && !ledger.progress.done && !String(finalText).startsWith("DONE:")) {
    const inferredStatus = inferLedgerAutonomousStatus(finalText);
    return {
      result: `DONE:\n${String(finalText || "Autonomous ledger task stopped before reaching completion.").trim()}`,
      ledger,
      outcomeStatus: inferredStatus
    };
  }

  if (!ledger.progress.done && !String(finalText).startsWith("DONE:")) {
    const fallbackBody = ledger.task.facts.length
      ? ledger.task.facts.map((f) => `- ${f}`).join("\n")
      : `- ${finalText}`;
    return { result: `DONE:\n${fallbackBody}`, ledger };
  }

  return {
    result: finalText,
    ledger,
    outcomeStatus: finalizedOutcome?.status || "completed"
  };
}

module.exports = { runTask };
