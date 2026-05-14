const { spawn } = require("node:child_process");
const { Writable, Readable } = require("node:stream");
const acp = require("@agentclientprotocol/sdk");

/**
 * Maps ACP capability names to Ender tool names.
 * When the ACP agent requests permission for a capability, Ender intercepts
 * and routes it through its own tool implementations.
 */
const CAPABILITY_TO_TOOL = {
  "shell": "exec_run",
  "read_file": "file_read",
  "write_file": "file_write",
  "read_text_file": "file_read",
  "write_text_file": "file_write",
  "git": "git",
  "bash": "exec_run"
};

const TOOL_KIND_TO_TOOL = {
  "execute": "exec_run",
  "read": "file_read",
  "edit": "file_write"
};

function getTextFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (content.type === "text") return String(content.text || "");
  if (content.content?.type === "text") return String(content.content.text || "");
  return "";
}

function selectPermissionOption(options, kinds) {
  return options.find((option) => kinds.includes(option.kind)) || options[0];
}

function getRequestedToolName(params) {
  const capability = String(params.capability || "").toLowerCase();
  if (capability && CAPABILITY_TO_TOOL[capability]) {
    return CAPABILITY_TO_TOOL[capability];
  }

  const kind = String(params.toolCall?.kind || "").toLowerCase();
  return TOOL_KIND_TO_TOOL[kind] || null;
}

function getRequestedToolArgs(toolName, params) {
  const input = params.input ?? params.toolCall?.rawInput ?? {};
  if (toolName !== "exec_run") return input;

  if (typeof input === "string") return { cmd: input, cwd: null };
  return {
    cmd: input.cmd || input.command || input.shell || String(input),
    cwd: input.cwd || null
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createStdioTransport({ command, args, cwd, env }) {
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd,
    env
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    kind: "stdio",
    stream: acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout)
    ),
    kill() {
      child.kill();
    },
    stderr() {
      return stderr;
    }
  };
}

function createPtyTransport({ command, args, cwd, env }) {
  let pty;
  try {
    pty = require("@lydell/node-pty");
  } catch (err) {
    throw new Error(`ACP agent requires a terminal, but @lydell/node-pty is not available: ${err.message}`);
  }

  const shellCommand = `stty -echo; exec ${[
    shellQuote(command),
    ...args.map(shellQuote)
  ].join(" ")}`;

  const ptyProcess = pty.spawn("/bin/sh", ["-lc", shellCommand], {
    name: "xterm-256color",
    cols: 4096,
    rows: 40,
    cwd,
    env: {
      ...env,
      TERM: "dumb",
      NO_COLOR: "1",
      FORCE_COLOR: "0"
    }
  });

  let output = "";
  let closed = false;
  let pendingLine = "";
  const echoedOutbound = new Map();

  const readable = new ReadableStream({
    start(controller) {
      ptyProcess.onData((data) => {
        output += data;
        pendingLine += data.replace(/\r\n/g, "\n");
        const lines = pendingLine.split("\n");
        pendingLine = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const echoCount = echoedOutbound.get(trimmed) || 0;
          if (echoCount > 0) {
            if (echoCount === 1) echoedOutbound.delete(trimmed);
            else echoedOutbound.set(trimmed, echoCount - 1);
            continue;
          }

          try {
            controller.enqueue(JSON.parse(trimmed));
          } catch {
            // PTY transports merge stdout/stderr; ignore non-protocol terminal output.
          }
        }
      });
      ptyProcess.onExit(() => {
        closed = true;
        const trimmed = pendingLine.trim();
        if (trimmed) {
          try {
            controller.enqueue(JSON.parse(trimmed));
          } catch {
            // Ignore trailing non-protocol output.
          }
        }
        controller.close();
      });
    }
  });

  const writable = new WritableStream({
    write(message) {
      if (closed) return;
      const line = JSON.stringify(message);
      echoedOutbound.set(line, (echoedOutbound.get(line) || 0) + 1);
      ptyProcess.write(`${line}\n`);
    },
    close() {
      closed = true;
    }
  });

  return {
    kind: "pty",
    stream: { readable, writable },
    kill() {
      if (!closed) ptyProcess.kill();
    },
    stderr() {
      return output;
    }
  };
}

function shouldRetryWithPty(err, transport) {
  if (transport.kind !== "stdio") return false;
  const text = `${err?.message || ""}\n${transport.stderr()}`.toLowerCase();
  return text.includes("stdin is not a terminal") || text.includes("input is not a terminal");
}

async function runAcpSession({
  goal,
  thread,
  activeWorkdir,
  onLog,
  requestApproval,
  toolsByName,
  transport
}) {
  const stream = transport.stream;
  let agentOutput = "";

  const endTurnStopReasons = new Set(["end_turn", "stopped"]);

  const clientHandler = {
    sessionUpdate: async (params) => {
      if (params.update.sessionUpdate === "agent_message_chunk") {
        const text = getTextFromContent(params.update.content || params.update.chunk?.content);
        if (text) {
          agentOutput += text;
          onLog({ level: "info", data: `agent: ${text}` });
        }
      } else if (params.update.sessionUpdate === "tool_call_update") {
        onLog({ level: "info", data: `tool call status: ${params.update.status}` });
      }
    },

    requestPermission: async (params) => {
      const requested = params.capability || params.toolCall?.title || params.toolCall?.kind || "unknown";
      onLog({ level: "info", data: `acp permission request: ${requested}` });

      const toolName = getRequestedToolName(params);
      if (!toolName || !toolsByName[toolName]) {
        return {
          outcome: {
            outcome: "selected",
            optionId: selectPermissionOption(params.options, ["reject_once", "reject_always", "reject"])?.optionId
          }
        };
      }

      const tool = toolsByName[toolName];
      const args = getRequestedToolArgs(toolName, params);

      let approved = false;
      if (requestApproval) {
        approved = await requestApproval({
          tool: toolName,
          input: args,
          reason: `ACP agent requested: ${requested}`
        });
      }

      if (!approved) {
        return {
          outcome: {
            outcome: "selected",
            optionId: selectPermissionOption(params.options, ["reject_once", "reject_always", "reject"])?.optionId
          }
        };
      }

      try {
        const result = await tool.invoke(args);
        const resultContent = typeof result === "string" ? result : JSON.stringify(result);
        return {
          outcome: {
            outcome: "selected",
            optionId: selectPermissionOption(params.options, ["allow_once", "allow_always", "accept_once"])?.optionId,
            result: resultContent
          }
        };
      } catch (err) {
        return {
          outcome: {
            outcome: "selected",
            optionId: selectPermissionOption(params.options, ["reject_once", "reject_always", "reject"])?.optionId,
            result: JSON.stringify({ ok: false, error: err.message })
          }
        };
      }
    },

    readTextFile: async (params) => {
      const tool = toolsByName["file_read"];
      if (!tool) return { error: "file_read tool not available" };
      try {
        const result = await tool.invoke({ path: params.path });
        return { content: typeof result === "string" ? result : JSON.stringify(result) };
      } catch (err) {
        return { error: err.message };
      }
    },

    writeTextFile: async (params) => {
      const tool = toolsByName["file_write"];
      if (!tool) return { error: "file_write tool not available" };
      try {
        await tool.invoke({ path: params.path, content: params.content });
        return { success: true };
      } catch (err) {
        return { error: err.message };
      }
    }
  };

  const client = new acp.ClientSideConnection(() => clientHandler, stream);

  try {
    await client.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: "ender-acp-client", version: "1.0.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true }
      }
    });

    const { sessionId: newSessionId } = await client.newSession({
      cwd: activeWorkdir,
      mcpServers: []
    });

    onLog({ level: "info", data: `acp session started: ${newSessionId}` });
    onLog({ level: "info", data: `workspace=${activeWorkdir}` });
    onLog({ level: "info", data: `backend=acp transport=${transport.kind}` });

    const promptParts = [];
    if (thread && thread.length) {
      for (const msg of thread) {
        if (msg.role === "user" || msg.role === "human") {
          promptParts.push({ type: "text", text: String(msg.content || "") });
        }
      }
    }
    promptParts.push({ type: "text", text: String(goal || "") });

    const response = await client.prompt({
      sessionId: newSessionId,
      prompt: promptParts
    });

    onLog({ level: "info", data: `acp prompt finished: stopReason=${response.stopReason}` });

    return {
      result: agentOutput || `ACP agent completed with stop reason: ${response.stopReason}`,
      stopReason: response.stopReason,
      completed: endTurnStopReasons.has(response.stopReason)
    };
  } catch (err) {
    const output = transport.stderr().trim();
    if (output && !err.acpOutput) {
      err.acpOutput = output;
      err.message = `${err.message}\nACP ${transport.kind} output:\n${output.slice(-4000)}`;
    }
    throw err;
  } finally {
    transport.kill();
  }
}

async function runAcpAgent({
  goal,
  thread,
  config,
  onLog,
  requestApproval,
  workspaceDir,
  tools
}) {
  const activeWorkdir = workspaceDir || config.workdir;
  const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const transportParams = {
    command: config.acp.command,
    args: config.acp.args,
    cwd: activeWorkdir,
    env: { ...process.env }
  };

  const stdioTransport = createStdioTransport(transportParams);
  try {
    return await runAcpSession({
      goal,
      thread,
      activeWorkdir,
      onLog,
      requestApproval,
      toolsByName,
      transport: stdioTransport
    });
  } catch (err) {
    if (!shouldRetryWithPty(err, stdioTransport)) {
      throw err;
    }

    onLog({
      level: "warn",
      data: "ACP agent requires a terminal; retrying with PTY transport"
    });

    return runAcpSession({
      goal,
      thread,
      activeWorkdir,
      onLog,
      requestApproval,
      toolsByName,
      transport: createPtyTransport(transportParams)
    });
  }
}

module.exports = { runAcpAgent };
