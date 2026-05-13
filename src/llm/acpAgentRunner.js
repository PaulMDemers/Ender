const { spawn } = require("node:child_process");
const { Writable, Readable } = require("node:stream");
const acp = require("@agentclientprotocol/sdk");

/**
 * Maps ACP capability names to Ender tool names.
 * When the ACP agent requests permission for a capability, Ender intercepts
 * and routes it through its own tool implementations.
 */
const CAPABILITY_TO_TOOL = {
  "shell": "shell",
  "read_file": "file_read",
  "write_file": "file_write",
  "read_text_file": "file_read",
  "write_text_file": "file_write",
  "git": "git",
  "bash": "shell"
};

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

  const child = spawn(config.acp.command, config.acp.args, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: activeWorkdir,
    env: { ...process.env }
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout)
  );

  let sessionId = null;
  let agentOutput = "";

  const client = new acp.ClientSideConnection({
    sessionUpdate: async (params) => {
      if (params.update.sessionUpdate === "agent_message_chunk") {
        const chunk = params.update.chunk;
        if (chunk.content) {
          agentOutput += chunk.content;
          onLog({ level: "info", data: `agent: ${chunk.content}` });
        }
      } else if (params.update.sessionUpdate === "tool_call_update") {
        onLog({ level: "info", data: `tool call status: ${params.update.status}` });
      }
    },

    requestPermission: async (params) => {
      const cap = String(params.capability || "").toLowerCase();
      onLog({ level: "info", data: `acp permission request: ${params.capability}` });

      const toolName = CAPABILITY_TO_TOOL[cap];
      if (!toolName || !toolsByName[toolName]) {
        return {
          outcome: {
            outcome: "selected",
            optionId: params.options.find(o => o.kind === "reject")?.optionId || params.options[0]?.optionId
          }
        };
      }

      const tool = toolsByName[toolName];
      const args = params.input || {};

      let approved = false;
      if (requestApproval) {
        approved = await requestApproval({
          tool: toolName,
          input: args,
          reason: `ACP agent requested: ${params.capability}`
        });
      }

      if (!approved) {
        return {
          outcome: {
            outcome: "selected",
            optionId: params.options.find(o => o.kind === "reject")?.optionId || params.options[0]?.optionId
          }
        };
      }

      try {
        const result = await tool.invoke(args);
        const resultContent = typeof result === "string" ? result : JSON.stringify(result);
        return {
          outcome: {
            outcome: "selected",
            optionId: params.options.find(o => o.kind === "accept_once")?.optionId || params.options[0]?.optionId,
            result: resultContent
          }
        };
      } catch (err) {
        return {
          outcome: {
            outcome: "selected",
            optionId: params.options.find(o => o.kind === "reject")?.optionId || params.options[0]?.optionId,
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
  }, stream);

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
  sessionId = newSessionId;

  onLog({ level: "info", data: `acp session started: ${sessionId}` });
  onLog({ level: "info", data: `workspace=${activeWorkdir}` });
  onLog({ level: "info", data: "backend=acp" });

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
    sessionId,
    prompt: promptParts
  });

  onLog({ level: "info", data: `acp prompt finished: stopReason=${response.stopReason}` });

  child.kill();

  return {
    result: agentOutput || `ACP agent completed with stop reason: ${response.stopReason}`,
    stopReason: response.stopReason
  };
}

module.exports = { runAcpAgent };