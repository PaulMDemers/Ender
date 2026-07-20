const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { formatAcpRuntimeError, runAcpAgent } = require("../src/llm/acpAgentRunner");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-acp-"));
}

test("formatAcpRuntimeError explains how to replace a stale Codex ACP runtime", () => {
  const output = [
    "npm warn deprecated @zed-industries/codex-acp@0.16.0",
    "failed to load models cache: unknown variant `max`",
    "The 'gpt-5.6-sol' model requires a newer version of Codex."
  ].join("\n");
  const message = formatAcpRuntimeError(new Error("RequestError: Internal error"), output);

  assert.match(message, /outdated or incompatible/);
  assert.match(message, /ACP_COMMAND=npx/);
  assert.match(message, /ACP_ARGS=--yes @agentclientprotocol\/codex-acp/);
  assert.match(message, /npm run smoke:acp-server/);
  assert.match(message, /Original error: RequestError: Internal error/);
  assert.equal(message.match(/unknown variant `max`/g)?.length, 1);
});

test("runAcpAgent connects to current ACP SDK and captures streamed output", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const sdkUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
  const agentPath = path.join(root, "mock-acp-agent.mjs");
  await fs.writeFile(agentPath, `
import * as acp from ${JSON.stringify(sdkUrl)};
import { Readable, Writable } from "node:stream";

class MockAgent {
  constructor(connection) {
    this.connection = connection;
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: []
    };
  }

  async newSession() {
    return { sessionId: "mock-session" };
  }

  async authenticate() {
    return {};
  }

  async prompt(params) {
    if (params.prompt.length !== 1 || params.prompt[0]?.type !== "text" || params.prompt[0]?.text !== "do a mock turn") {
      throw new Error("ACP prompt duplicated the execution request");
    }
    await this.connection.requestPermission({
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: "tool-1",
        title: "Run echo",
        kind: "execute",
        status: "pending",
        rawInput: { cmd: "echo from-acp", cwd: null }
      },
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow" },
        { kind: "reject_once", name: "Reject", optionId: "reject" }
      ]
    });

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "mock agent done" }
      }
    });

    return { stopReason: "end_turn" };
  }

  async cancel() {}
}

new acp.AgentSideConnection(
  (connection) => new MockAgent(connection),
  acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
);
`, "utf8");

  const logs = [];
  let approvalRequest = null;
  let toolInvocation = null;

  const result = await runAcpAgent({
    goal: "do a mock turn",
    thread: [{ role: "user", content: "do a mock turn" }],
    config: {
      workdir: root,
      acp: { command: process.execPath, args: [agentPath] }
    },
    workspaceDir: root,
    onLog(entry) {
      logs.push(entry);
    },
    requestApproval(request) {
      approvalRequest = request;
      return true;
    },
    tools: [
      {
        name: "exec_run",
        async invoke(args) {
          toolInvocation = args;
          return JSON.stringify({ ok: true });
        }
      }
    ]
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.completed, true);
  assert.equal(result.result, "mock agent done");
  assert.equal(approvalRequest.tool, "exec_run");
  assert.deepEqual(toolInvocation, { cmd: "echo from-acp", cwd: null });
  assert.ok(logs.some((entry) => entry.data?.kind === "assistant_progress" && entry.data.content === "mock agent done"));
  const phase = logs.find((entry) => entry.data?.kind === "run_phase");
  const progress = logs.find((entry) => entry.data?.kind === "assistant_progress");
  const toolActivity = logs.find((entry) => entry.data?.kind === "tool_call");
  assert.equal(phase.data.provider, "acp");
  assert.equal(progress.data.provider, "acp");
  assert.equal(toolActivity.data.provider, "acp");
  assert.equal(progress.data.turnId, phase.data.turnId);
  assert.equal(toolActivity.data.turnId, phase.data.turnId);
});

test("runAcpAgent coalesces streamed token chunks into readable log entries", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const sdkUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
  const agentPath = path.join(root, "mock-chunky-acp-agent.mjs");
  await fs.writeFile(agentPath, `
import * as acp from ${JSON.stringify(sdkUrl)};
import { Readable, Writable } from "node:stream";

class MockAgent {
  constructor(connection) {
    this.connection = connection;
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: []
    };
  }

  async newSession() {
    return { sessionId: "chunky-session" };
  }

  async authenticate() {
    return {};
  }

  async prompt(params) {
    for (const text of ["I", "’ll", " check", " the", " workspace", " first."]) {
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text }
        }
      });
    }

    return { stopReason: "end_turn" };
  }

  async cancel() {}
}

new acp.AgentSideConnection(
  (connection) => new MockAgent(connection),
  acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
);
`, "utf8");

  const logs = [];
  const result = await runAcpAgent({
    goal: "do a mock chunky turn",
    thread: [],
    config: {
      workdir: root,
      acp: { command: process.execPath, args: [agentPath] }
    },
    workspaceDir: root,
    onLog(entry) {
      logs.push(entry);
    },
    requestApproval() {
      return true;
    },
    tools: []
  });

  assert.equal(result.result, "I’ll check the workspace first.");
  assert.deepEqual(
    logs.filter((entry) => entry.data?.kind === "assistant_progress").map((entry) => entry.data.content),
    ["I’ll check the workspace first."]
  );
});

test("runAcpAgent separates live progress from the final response and normalizes partial tool updates", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const sdkUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
  const agentPath = path.join(root, "mock-progress-acp-agent.mjs");
  await fs.writeFile(agentPath, `
import * as acp from ${JSON.stringify(sdkUrl)};
import { Readable, Writable } from "node:stream";

class MockAgent {
  constructor(connection) { this.connection = connection; }
  async initialize() { return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, authMethods: [] }; }
  async newSession() { return { sessionId: "progress-session" }; }
  async authenticate() { return {}; }
  async send(sessionId, update) { await this.connection.sessionUpdate({ sessionId, update }); }

  async prompt(params) {
    await this.send(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "I’ll inspect the workspace first." } });
    await this.send(params.sessionId, { sessionUpdate: "plan", entries: [
      { content: "Inspect workspace", priority: "high", status: "completed" },
      { content: "Verify server", priority: "high", status: "in_progress" }
    ] });
    await this.send(params.sessionId, { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Start test server", kind: "execute", status: "pending", rawInput: { cmd: "npm test", env: { API_TOKEN: "super-secret-value" } } });
    await this.send(params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "in_progress" });
    await this.send(params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", rawOutput: { error: "port denied" } });
    await this.send(params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", locations: [{ path: "server.js" }] });
    await this.send(params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "failed" });
    await this.send(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The first check hit a port restriction, so I’m retrying safely." } });
    await this.send(params.sessionId, { sessionUpdate: "tool_call", toolCallId: "tool-2", title: "Retry HTTP verification", kind: "execute", status: "in_progress" });
    await this.send(params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-2", rawOutput: { stdout: "ok" } });
    await this.send(params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tool-2", status: "completed" });
    await this.send(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Finished successfully." } });
    return { stopReason: "end_turn" };
  }
  async cancel() {}
}

new acp.AgentSideConnection(
  (connection) => new MockAgent(connection),
  acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
);
`, "utf8");

  const logs = [];
  const result = await runAcpAgent({
    goal: "build and verify a project",
    thread: [],
    config: { workdir: root, acp: { command: process.execPath, args: [agentPath] } },
    workspaceDir: root,
    onLog(entry) { logs.push(entry); },
    requestApproval() { return true; },
    tools: []
  });

  assert.equal(result.result, "Finished successfully.");
  assert.deepEqual(
    logs.filter((entry) => entry.data?.kind === "assistant_progress").map((entry) => entry.data.content),
    [
      "I’ll inspect the workspace first.",
      "The first check hit a port restriction, so I’m retrying safely.",
      "Finished successfully."
    ]
  );
  assert.equal(logs.some((entry) => String(entry.data).includes("undefined")), false);
  assert.equal(logs.filter((entry) => entry.data?.kind === "tool_call").length, 5);
  const failed = logs.find((entry) => entry.data?.kind === "tool_call" && entry.data.status === "failed");
  assert.equal(failed.data.title, "Start test server");
  assert.match(failed.data.output, /port denied/);
  assert.match(failed.data.input, /\[redacted\]/);
  assert.doesNotMatch(failed.data.input, /super-secret-value/);
  assert.ok(logs.some((entry) => entry.data?.kind === "plan" && entry.data.entries[1].status === "in_progress"));
});

test("runAcpAgent retries with PTY transport when an ACP agent requires a terminal", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const sdkUrl = pathToFileURL(require.resolve("@agentclientprotocol/sdk")).href;
  const agentPath = path.join(root, "mock-tty-acp-agent.mjs");
  await fs.writeFile(agentPath, `
import * as acp from ${JSON.stringify(sdkUrl)};
import { Readable, Writable } from "node:stream";

if (!process.stdin.isTTY) {
  console.error("Error: stdin is not a terminal");
  process.exit(1);
}

class MockAgent {
  constructor(connection) {
    this.connection = connection;
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: []
    };
  }

  async newSession() {
    return { sessionId: "tty-session" };
  }

  async authenticate() {
    return {};
  }

  async prompt(params) {
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "pty agent done" }
      }
    });

    return { stopReason: "end_turn" };
  }

  async cancel() {}
}

new acp.AgentSideConnection(
  (connection) => new MockAgent(connection),
  acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
);
`, "utf8");

  const logs = [];
  const result = await runAcpAgent({
    goal: "do a mock tty turn",
    thread: [],
    config: {
      workdir: root,
      acp: { command: process.execPath, args: [agentPath] }
    },
    workspaceDir: root,
    onLog(entry) {
      logs.push(entry);
    },
    requestApproval() {
      return true;
    },
    tools: []
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.completed, true);
  assert.equal(result.result, "pty agent done");
  assert.ok(logs.some((entry) => entry.data === "ACP agent requires a terminal; retrying with PTY transport"));
  assert.ok(logs.some((entry) => entry.data === "backend=acp transport=pty"));
});

test("runAcpAgent times out clearly when a TTY process never speaks ACP", async (t) => {
  const root = await makeTempDir();
  const oldTimeout = process.env.ENDER_ACP_HANDSHAKE_TIMEOUT_MS;
  process.env.ENDER_ACP_HANDSHAKE_TIMEOUT_MS = "200";

  t.after(async () => {
    if (oldTimeout === undefined) delete process.env.ENDER_ACP_HANDSHAKE_TIMEOUT_MS;
    else process.env.ENDER_ACP_HANDSHAKE_TIMEOUT_MS = oldTimeout;
    await fs.rm(root, { recursive: true, force: true });
  });

  const agentPath = path.join(root, "mock-tui-agent.mjs");
  await fs.writeFile(agentPath, `
if (!process.stdin.isTTY) {
  console.error("Error: stdin is not a terminal");
  process.exit(1);
}

console.error("fake interactive TUI ready");
setInterval(() => {}, 1000);
`, "utf8");

  await assert.rejects(
    runAcpAgent({
      goal: "do a mock tui turn",
      thread: [],
      config: {
        workdir: root,
        acp: { command: process.execPath, args: [agentPath] }
      },
      workspaceDir: root,
      onLog() {},
      requestApproval() {
        return true;
      },
      tools: []
    }),
    (err) => {
      assert.match(err.message, /did not respond to initialize/);
      assert.match(err.message, /not an interactive TUI/);
      assert.match(err.message, /fake interactive TUI ready/);
      return true;
    }
  );
});
