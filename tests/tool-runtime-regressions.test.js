const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { zodFunction } = require("openai/helpers/zod");

const { createChatModel } = require("../src/llm/factory");
const { runAgentLoop } = require("../src/runtime/runAgentLoop");
const { validateToolSchemasForBackend } = require("../src/llm/toolSchemaPreflight");
const { createCronTools } = require("../src/tools/cronTools");
const { createConfluenceTools } = require("../src/tools/confluenceTools");
const { createWebTools } = require("../src/tools/webTools");
const { createExecTool } = require("../src/tools/execTool");
const { createFileTools } = require("../src/tools/fileTools");
const { createGitTools } = require("../src/tools/gitTools");
const { createGitHubTools } = require("../src/tools/githubTools");
const { createGitLabTools } = require("../src/tools/gitlabTools");
const { createGoogleDriveTools } = require("../src/tools/googleDriveTools");
const { createJiraTools } = require("../src/tools/jiraTools");
const { createEmailTools } = require("../src/tools/emailTools");
const { createLedger } = require("../src/state/ledger");
const { createLedgerTools } = require("../src/tools/ledgerTools");
const { createSelfUpdateTools } = require("../src/tools/selfUpdateTools");
const { createTaskLedgerRuntimeTools } = require("../src/tools/taskLedgerRuntimeTools");
const { createThreadTools } = require("../src/tools/threadTools");

function getToolMap(tools) {
  return Object.fromEntries(tools.map((entry) => [entry.name, entry]));
}

test("createChatModel constructs upgraded LangChain backends", () => {
  const configs = [
    {
      backend: "openai",
      openai: { apiKey: "test-key", model: "gpt-4.1-mini" },
      bedrock: {},
      azure: {},
      ollama: {}
    },
    {
      backend: "bedrock",
      openai: {},
      bedrock: { region: "us-east-1", model: "anthropic.claude-3-5-sonnet-20240620-v1:0" },
      azure: {},
      ollama: {}
    },
    {
      backend: "ollama",
      openai: {},
      bedrock: {},
      azure: {},
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "llama3.1:8b" }
    },
    {
      backend: "azure",
      openai: {},
      bedrock: {},
      azure: {
        apiKey: "test-key",
        instanceName: "demo-instance",
        deploymentName: "demo-deployment",
        apiVersion: "2024-10-21",
        basePath: null
      },
      ollama: {}
    }
  ];

  for (const config of configs) {
    const model = createChatModel(config);
    assert.equal(typeof model?.invoke, "function", `${config.backend} should expose invoke()`);
    assert.equal(typeof model?.bindTools, "function", `${config.backend} should expose bindTools()`);
  }
});

test("tool schemas accept provider-safe null placeholders", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ender-tool-schema-"));

  try {
    const webTools = getToolMap(createWebTools(tmpRoot));
    const fileTools = getToolMap(createFileTools(tmpRoot));
    const gitTools = getToolMap(createGitTools(tmpRoot, {
      requestApproval: async () => false,
      onLog: () => {},
      githubConfig: {}
    }));
    const githubTools = getToolMap(createGitHubTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const gitlabTools = getToolMap(createGitLabTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const jiraTools = getToolMap(createJiraTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const emailTools = getToolMap(createEmailTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const ledgerTools = getToolMap(createLedgerTools(createLedger()));
    const execTool = createExecTool(tmpRoot, { requestApproval: async () => false, onLog: () => {} });

    assert.equal(webTools.http_get.schema.safeParse({ url: "https://example.com", maxBytes: null, offset: null }).success, true);
    assert.equal(webTools.web_page_read.schema.safeParse({ url: "https://example.com", maxChars: null, offset: null, includeLinks: null }).success, true);
    assert.equal(webTools.browser_snapshot_page.schema.safeParse({ url: "https://example.com", width: null, height: null, waitMs: null, quality: null }).success, true);
    assert.equal(fileTools.file_list.schema.safeParse({ path: null, recursive: null, maxItems: null }).success, true);
    assert.equal(execTool.schema.safeParse({ cmd: "pwd", cwd: null }).success, true);
    assert.equal(gitTools.git_status.schema.safeParse({ repoPath: null, short: null }).success, true);
    assert.equal(githubTools.github_list_repos.schema.safeParse({ visibility: null, affiliation: null, type: null, sort: null, perPage: null, page: null }).success, true);
    assert.equal(gitlabTools.gitlab_list_projects.schema.safeParse({ membership: null, owned: null, search: null, perPage: null, page: null }).success, true);
    assert.equal(jiraTools.jira_get_issue.schema.safeParse({ issueKey: "ABC-123", fields: null }).success, true);
    assert.equal(emailTools.email_send.schema.safeParse({ to: "a@example.com", subject: "hi", text: null, html: null }).success, true);
    assert.equal(ledgerTools.finalize.schema.safeParse({ note: null, status: null }).success, true);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("tool schemas compile cleanly through the OpenAI zod helper", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ender-tool-json-schema-"));

  try {
    const webTools = getToolMap(createWebTools(tmpRoot));
    const fileTools = getToolMap(createFileTools(tmpRoot));
    const gitTools = getToolMap(createGitTools(tmpRoot, {
      requestApproval: async () => false,
      onLog: () => {},
      githubConfig: {}
    }));
    const githubTools = getToolMap(createGitHubTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const gitlabTools = getToolMap(createGitLabTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const jiraTools = getToolMap(createJiraTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const emailTools = getToolMap(createEmailTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const ledgerTools = getToolMap(createLedgerTools(createLedger()));
    const cronTools = getToolMap(createCronTools(
      { create: async () => ({ ok: true }), list: () => [], delete: async () => ({ ok: true }) },
      { requestApproval: async () => false, onLog: () => {} }
    ));
    const confluenceTools = getToolMap(createConfluenceTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const googleDriveTools = getToolMap(createGoogleDriveTools({}, { requestApproval: async () => false, onLog: () => {} }));
    const threadTools = getToolMap(createThreadTools(
      { getTaskSummary: () => null, waitForTask: async () => ({ ok: true }), startChildTask: () => ({ ok: true, id: "child" }) },
      { taskId: "task-1", onLog: () => {} }
    ));
    const taskLedgerRuntimeTools = getToolMap(createTaskLedgerRuntimeTools(
      {
        recordStage: async () => ({ ok: true }),
        reportFeasibility: async () => ({ ok: true }),
        savePlan: async () => ({ ok: true }),
        reportVerification: async () => ({ ok: true })
      },
      { getTaskSummary: () => ({ ledgerEntryId: "ledger-1" }) },
      { taskId: "task-1", onLog: () => {} }
    ));
    const selfUpdateTools = getToolMap(createSelfUpdateTools(
      { config: { selfUpdate: { rootDir: tmpRoot, verifyCommand: "npm test" } }, isConfigured: () => true },
      { requestApproval: async () => false, onLog: () => {}, activeWorkdir: tmpRoot }
    ));
    const execTool = createExecTool(tmpRoot, { requestApproval: async () => false, onLog: () => {} });

    const tools = [
      ...Object.values(webTools),
      ...Object.values(fileTools),
      ...Object.values(gitTools),
      ...Object.values(githubTools),
      ...Object.values(gitlabTools),
      ...Object.values(jiraTools),
      ...Object.values(confluenceTools),
      ...Object.values(googleDriveTools),
      ...Object.values(emailTools),
      ...Object.values(cronTools),
      ...Object.values(threadTools),
      ...Object.values(taskLedgerRuntimeTools),
      ...Object.values(selfUpdateTools),
      execTool,
      ...Object.values(ledgerTools)
    ];

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.map((item) => String(item)).join(" "));
    };

    try {
      validateToolSchemasForBackend("openai", tools, { onLog: () => {} });
      for (const toolDef of tools) {
        if (!toolDef?.schema) continue;
        const compiled = zodFunction({ name: toolDef.name, parameters: toolDef.schema });
        const parameters = compiled?.function?.parameters || compiled?.parameters;
        const rendered = JSON.stringify(parameters);
        assert.ok(rendered);
        assert.ok(!rendered.includes("\"format\":\"uri\""), `${toolDef.name} should not emit uri format`);
        assert.ok(!rendered.includes("\"propertyNames\""), `${toolDef.name} should not emit propertyNames`);
        if (parameters?.type === "object" && parameters.properties) {
          const props = Object.keys(parameters.properties);
          const required = new Set(parameters.required || []);
          assert.deepEqual(
            props.filter((name) => !required.has(name)),
            [],
            `${toolDef.name} should require every top-level property for OpenAI compatibility`
          );
        }
      }
    } finally {
      console.warn = originalWarn;
    }

    assert.deepEqual(warnings, []);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("tool schema preflight rejects propertyNames for strict backends", () => {
  const brokenTool = tool(
    async () => "ok",
    {
      name: "broken_record_tool",
      description: "Synthetic test tool",
      schema: z.object({
        input: z.record(z.string(), z.string())
      })
    }
  );

  assert.throws(
    () => validateToolSchemasForBackend("openai", [brokenTool], { onLog: () => {} }),
    /unsupported keyword 'propertyNames'/
  );
});

test("tool schema preflight rejects object properties omitted from required", () => {
  const brokenTool = tool(
    async () => "ok",
    {
      name: "broken_optional_tool",
      description: "Synthetic test tool",
      schema: z.object({
        note: z.string(),
        status: z.string().optional()
      })
    }
  );

  assert.throws(
    () => validateToolSchemasForBackend("openai", [brokenTool], { onLog: () => {} }),
    /all-fields-must-be-required|missing required entries for status/
  );
});

test("runAgentLoop sends multimodal tool results back in a provider-safe shape", async () => {
  let invokeCount = 0;
  const visualTool = tool(
    async ({ url }) => ({
      logSummary: JSON.stringify({ ok: true, url }),
      toolMessageContent: [
        {
          type: "text",
          text: `Snapshot ready for ${url}`
        },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,AAAA" }
        }
      ],
      fingerprint: `snapshot:${url}`
    }),
    {
      name: "browser_snapshot_page",
      description: "Synthetic test tool",
      schema: z.object({ url: z.string().url() })
    }
  );

  const model = {
    bindTools() {
      return this;
    },
    async invoke(messages) {
      invokeCount += 1;

      if (invokeCount === 1) {
        return {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              name: "browser_snapshot_page",
              args: { url: "https://example.com" }
            }
          ]
        };
      }

      const lastTwo = messages.slice(-2);
      assert.equal(lastTwo[0]?._getType(), "tool");
      assert.equal(typeof lastTwo[0]?.content, "string");
      assert.match(lastTwo[0]?.content || "", /"ok":true/);

      assert.equal(lastTwo[1]?._getType(), "human");
      assert.ok(Array.isArray(lastTwo[1]?.content));
      assert.ok(lastTwo[1].content.some((item) => item.type === "image_url"));
      assert.ok(lastTwo[1].content.some((item) => item.type === "text"));

      return {
        content: "DONE:\nvisual review complete",
        tool_calls: []
      };
    }
  };

  const result = await runAgentLoop({
    model,
    tools: [visualTool],
    systemPrompt: "Test system prompt",
    userPrompt: "Inspect the screenshot",
    onLog: () => {}
  });

  assert.equal(invokeCount, 2);
  assert.equal(result.stopReason, "no_tool_calls");
  assert.equal(result.result, "DONE:\nvisual review complete");
});

test("runAgentLoop preserves multimodal thread messages when replaying conversation history", async () => {
  let invokeCount = 0;
  const thread = [
    {
      role: "user",
      content: [
        { type: "text", text: "Review this image." },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA", detail: "auto" } }
      ]
    }
  ];

  const model = {
    bindTools() {
      return this;
    },
    async invoke(messages) {
      invokeCount += 1;
      assert.equal(invokeCount, 1);
      assert.equal(messages[1]?._getType(), "human");
      assert.ok(Array.isArray(messages[1]?.content));
      assert.equal(messages[1].content[0]?.type, "text");
      assert.equal(messages[1].content[1]?.type, "image_url");
      return {
        content: "DONE:\nthread replay preserved multimodal content",
        tool_calls: []
      };
    }
  };

  const result = await runAgentLoop({
    model,
    tools: [],
    systemPrompt: "Test system prompt",
    userPrompt: "unused",
    thread,
    onLog: () => {}
  });

  assert.equal(result.stopReason, "no_tool_calls");
  assert.equal(result.result, "DONE:\nthread replay preserved multimodal content");
});

test("task ledger runtime tools persist lifecycle updates through the current task context", async () => {
  const calls = [];
  const taskLedgerManager = {
    async recordStage(id, input) {
      calls.push({ kind: "stage", id, input });
      return { ok: true };
    },
    async reportFeasibility(id, input) {
      calls.push({ kind: "feasibility", id, input });
      return { ok: true };
    },
    async savePlan(id, input) {
      calls.push({ kind: "plan", id, input });
      return { ok: true };
    },
    async reportVerification(id, input) {
      calls.push({ kind: "verification", id, input });
      return { ok: true };
    }
  };

  const tools = getToolMap(createTaskLedgerRuntimeTools(
    taskLedgerManager,
    { getTaskSummary: () => ({ ledgerEntryId: "ledger-42" }) },
    { taskId: "task-42", onLog: () => {} }
  ));

  await tools.ledger_set_stage.invoke({ stage: "workspace_scan", summary: "Located the mock files." });
  await tools.ledger_report_feasibility.invoke({ outcome: "ready", summary: "Task is feasible." });
  await tools.ledger_save_plan.invoke({
    summary: "Implement and verify the mock task.",
    checklist: ["Update the file", "Review the result"],
    verificationSteps: ["Read the generated output"]
  });
  await tools.ledger_report_verification.invoke({
    status: "passed",
    summary: "Mock verification succeeded.",
    evidence: ["workspace/task-ledger-smoke-coding/src/index.js"]
  });

  assert.deepEqual(calls, [
    {
      kind: "stage",
      id: "ledger-42",
      input: { stage: "workspace_scan", summary: "Located the mock files." }
    },
    {
      kind: "feasibility",
      id: "ledger-42",
      input: { outcome: "ready", summary: "Task is feasible." }
    },
    {
      kind: "plan",
      id: "ledger-42",
      input: {
        summary: "Implement and verify the mock task.",
        checklist: ["Update the file", "Review the result"],
        verificationSteps: ["Read the generated output"]
      }
    },
    {
      kind: "verification",
      id: "ledger-42",
      input: {
        status: "passed",
        summary: "Mock verification succeeded.",
        evidence: ["workspace/task-ledger-smoke-coding/src/index.js"]
      }
    }
  ]);
});
