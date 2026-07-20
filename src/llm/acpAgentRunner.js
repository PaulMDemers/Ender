const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { Writable, Readable } = require("node:stream");
const acp = require("@agentclientprotocol/sdk");
const { createAbortError, isAbortError, throwIfAborted } = require("../utils/abort");
const {
  createActivityId,
  createAssistantProgressEvent,
  createRunPhaseEvent,
  createToolCallEvent,
  summarizeActivityValue
} = require("../runtime/activityEvents");

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
const AGENT_LOG_FLUSH_MS = 900;
const AGENT_LOG_MIN_CHARS = 80;
const CODEX_ACP_MIGRATION_MESSAGE = [
  "The configured Codex ACP runtime is outdated or incompatible.",
  "Set ACP_COMMAND=npx and ACP_ARGS=--yes @agentclientprotocol/codex-acp, remove any stale CODEX_PATH override, restart Ender, then run npm run smoke:acp-server."
].join(" ");

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

function killSubprocess(child) {
  if (!child || child.killed) return;

  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid);
      return;
    }
  } catch {
    // Fall through to killing the direct child; the process may have already exited.
  }

  try {
    child.kill();
  } catch {
    // Ignore cleanup failures.
  }
}

function createStdioTransport({ command, args, cwd, env }) {
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd,
    env,
    detached: process.platform !== "win32"
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
      killSubprocess(child);
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

function withTimeout(promise, timeoutMs, createError) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createError()), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createHandshakeTimeoutError(transport, stage) {
  const output = transport.stderr().trim();
  const suffix = output
    ? `\nACP ${transport.kind} output:\n${output.slice(-4000)}`
    : "";
  const err = new Error(`ACP agent did not respond to ${stage} within ${getHandshakeTimeoutMs()}ms. Check that ACP_COMMAND/ACP_ARGS start an ACP server, not an interactive TUI.${suffix}`);
  err.acpOutput = output;
  return err;
}

function formatAcpRuntimeError(err, output = "", transportKind = "stdio") {
  const message = String(err?.message || err || "ACP agent failed");
  const acpOutput = String(output || "").trim();
  const combined = `${message}\n${acpOutput}`.toLowerCase();
  const staleCodexRuntime = [
    "@zed-industries/codex-acp",
    "requires a newer version of codex",
    "unknown variant `max`",
    "unknown variant 'max'"
  ].some((signal) => combined.includes(signal));
  const outputSuffix = acpOutput && !message.includes(acpOutput)
    ? `\nACP ${transportKind} output:\n${acpOutput.slice(-4000)}`
    : "";

  if (staleCodexRuntime) {
    return `${CODEX_ACP_MIGRATION_MESSAGE}\nOriginal error: ${message}${outputSuffix}`;
  }

  return `${message}${outputSuffix}`;
}

function getHandshakeTimeoutMs() {
  const parsed = Number(process.env.ENDER_ACP_HANDSHAKE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HANDSHAKE_TIMEOUT_MS;
}

function createAgentTextCollector(onLog, { turnId, provider }) {
  const segments = [];
  let segmentText = "";
  let pendingText = "";
  let segmentId = null;
  let sequence = 0;
  let timer = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    const text = pendingText;
    pendingText = "";
    if (text) {
      onLog({
        level: "info",
        data: createAssistantProgressEvent({
          turnId,
          provider,
          segmentId,
          sequence,
          content: text
        })
      });
      sequence += 1;
    }
  };

  const finishSegment = () => {
    flush();
    if (segmentText.trim()) segments.push(segmentText);
    segmentText = "";
    segmentId = null;
    sequence = 0;
  };

  return {
    push(text) {
      if (!segmentId) segmentId = `assistant-progress-${randomUUID()}`;
      segmentText += text;
      pendingText += text;

      if (
        pendingText.length >= AGENT_LOG_MIN_CHARS ||
        /[\n.!?]\s*$/.test(pendingText) ||
        /```$/.test(pendingText)
      ) {
        flush();
        return;
      }

      if (!timer) {
        timer = setTimeout(flush, AGENT_LOG_FLUSH_MS);
        timer.unref?.();
      }
    },
    boundary: finishSegment,
    finish() {
      finishSegment();
      return [...segments];
    }
  };
}

function createToolCallTracker(onLog, { turnId, provider }) {
  const calls = new Map();

  const update = (input, { initial = false } = {}) => {
    const toolCallId = String(input?.toolCallId || "").trim();
    if (!toolCallId) return null;

    const previous = calls.get(toolCallId) || null;
    const next = {
      toolCallId,
      title: input.title ?? previous?.title ?? null,
      toolKind: input.kind ?? previous?.toolKind ?? null,
      status: input.status ?? previous?.status ?? (initial ? "pending" : null),
      input: Object.prototype.hasOwnProperty.call(input, "rawInput")
        ? summarizeActivityValue(input.rawInput)
        : previous?.input ?? null,
      output: Object.prototype.hasOwnProperty.call(input, "rawOutput")
        ? summarizeActivityValue(input.rawOutput)
        : previous?.output ?? null,
      content: Object.prototype.hasOwnProperty.call(input, "content")
        ? summarizeActivityValue(input.content)
        : previous?.content ?? null,
      locations: Array.isArray(input.locations)
        ? input.locations.slice(0, 20).map((location) => ({ path: location.path, line: location.line ?? null }))
        : previous?.locations ?? []
    };
    calls.set(toolCallId, next);

    const semanticChange = !previous
      ? Boolean(next.title || next.status)
      : previous.status !== next.status
        || previous.title !== next.title
        || previous.toolKind !== next.toolKind;
    if (!semanticChange) return next;

    onLog({
      level: next.status === "failed" ? "warn" : "info",
      data: createToolCallEvent({
        turnId,
        provider,
        ...next
      })
    });
    return next;
  };

  return { update };
}

async function runAcpSession({
  goal,
  thread,
  activeWorkdir,
  onLog,
  requestApproval,
  toolsByName,
  transport,
  signal = null
}) {
  const stream = transport.stream;
  const turnId = createActivityId("turn");
  const provider = "acp";
  let agentOutput = "";
  const agentTextCollector = createAgentTextCollector(onLog, { turnId, provider });
  const toolCallTracker = createToolCallTracker(onLog, { turnId, provider });

  const endTurnStopReasons = new Set(["end_turn", "stopped"]);

  const clientHandler = {
    sessionUpdate: async (params) => {
      if (params.update.sessionUpdate === "agent_message_chunk") {
        const text = getTextFromContent(params.update.content || params.update.chunk?.content);
        if (text) {
          agentOutput += text;
          agentTextCollector.push(text);
        }
      } else if (params.update.sessionUpdate === "tool_call") {
        agentTextCollector.boundary();
        toolCallTracker.update(params.update, { initial: true });
      } else if (params.update.sessionUpdate === "tool_call_update") {
        agentTextCollector.boundary();
        toolCallTracker.update(params.update);
      } else if (params.update.sessionUpdate === "plan") {
        onLog({
          level: "info",
          data: {
            kind: "plan",
            turnId,
            provider,
            entries: Array.isArray(params.update.entries)
              ? params.update.entries.map((entry) => ({
                content: String(entry.content || ""),
                status: entry.status || "pending",
                priority: entry.priority || "medium"
              }))
              : []
          }
        });
      }
    },

    requestPermission: async (params) => {
      agentTextCollector.boundary();
      if (params.toolCall) toolCallTracker.update(params.toolCall, { initial: true });
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
          type: toolName,
          title: String(requested || "Approval required"),
          description: `The agent needs permission to ${String(requested || "continue this operation").toLowerCase()}.`,
          details: args,
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
        throwIfAborted(signal);
        const result = await tool.invoke(args, { signal });
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
        throwIfAborted(signal);
        const result = await tool.invoke({ path: params.path }, { signal });
        return { content: typeof result === "string" ? result : JSON.stringify(result) };
      } catch (err) {
        return { error: err.message };
      }
    },

    writeTextFile: async (params) => {
      const tool = toolsByName["file_write"];
      if (!tool) return { error: "file_write tool not available" };
      try {
        throwIfAborted(signal);
        await tool.invoke({ path: params.path, content: params.content }, { signal });
        return { success: true };
      } catch (err) {
        return { error: err.message };
      }
    }
  };

  const client = new acp.ClientSideConnection(() => clientHandler, stream);
  let sessionId = null;
  let rejectOnAbort = null;
  const aborted = new Promise((_, reject) => {
    rejectOnAbort = reject;
  });
  const abort = () => {
    if (sessionId) {
      client.cancel({ sessionId }).catch(() => {});
    }
    rejectOnAbort(createAbortError(signal?.reason));
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    throwIfAborted(signal);
    await withTimeout(
      Promise.race([client.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: { name: "ender-acp-client", version: "1.0.0" },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true }
        }
      }), aborted]),
      getHandshakeTimeoutMs(),
      () => createHandshakeTimeoutError(transport, "initialize")
    );

    const { sessionId: newSessionId } = await withTimeout(
      Promise.race([client.newSession({
        cwd: activeWorkdir,
        mcpServers: []
      }), aborted]),
      getHandshakeTimeoutMs(),
      () => createHandshakeTimeoutError(transport, "newSession")
    );
    sessionId = newSessionId;
    throwIfAborted(signal);

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
    if (!promptParts.length) {
      promptParts.push({ type: "text", text: String(goal || "") });
    }

    onLog({
      level: "info",
      data: createRunPhaseEvent({ turnId, provider, phase: "thinking", status: "started", step: 1 })
    });

    const response = await Promise.race([client.prompt({
      sessionId: newSessionId,
      prompt: promptParts
    }), aborted]);

    const assistantSegments = agentTextCollector.finish();
    onLog({ level: "info", data: `acp prompt finished: stopReason=${response.stopReason}` });

    return {
      result: assistantSegments.at(-1)?.trim() || agentOutput.trim() || `ACP agent completed with stop reason: ${response.stopReason}`,
      stopReason: response.stopReason,
      completed: endTurnStopReasons.has(response.stopReason)
    };
  } catch (err) {
    agentTextCollector.finish();
    const output = transport.stderr().trim();
    if (output && !err.acpOutput) err.acpOutput = output;
    err.message = formatAcpRuntimeError(err, output, transport.kind);
    throw err;
  } finally {
    signal?.removeEventListener("abort", abort);
    agentTextCollector.finish();
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
  tools,
  signal = null
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
      transport: stdioTransport,
      signal
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted || !shouldRetryWithPty(err, stdioTransport)) {
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
      transport: createPtyTransport(transportParams),
      signal
    });
  }
}

module.exports = { formatAcpRuntimeError, runAcpAgent };
