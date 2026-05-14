const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { runAcpAgent } = require("../src/llm/acpAgentRunner");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-acp-"));
}

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
    thread: [],
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
  assert.ok(logs.some((entry) => entry.data === "agent: mock agent done"));
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
    logs.filter((entry) => String(entry.data).startsWith("agent: ")).map((entry) => entry.data),
    ["agent: I’ll check the workspace first."]
  );
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
