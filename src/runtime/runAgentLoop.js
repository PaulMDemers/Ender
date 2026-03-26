const { HumanMessage, SystemMessage, AIMessage, ToolMessage } = require("@langchain/core/messages");
const { sanitizeJsonValue, sanitizeString } = require("../utils/jsonSafe");

function toConversationMessage(entry) {
  if (!entry || typeof entry !== "object") return null;
  const role = String(entry.role || "").toLowerCase();
  const content = sanitizeString(entry.content || "");
  if (!content) return null;
  if (role === "assistant") return new AIMessage(content);
  if (role === "user" || role === "human") return new HumanMessage(content);
  return null;
}

function normalizeToolInvokeResult(result) {
  if (result && typeof result === "object" && Array.isArray(result.toolMessageContent)) {
    const content = sanitizeJsonValue(result.toolMessageContent);
    const logSummary = sanitizeString(
      result.logSummary || JSON.stringify({ ok: true, blocks: result.toolMessageContent.length })
    );
    const fingerprint = sanitizeString(result.fingerprint || logSummary);
    return {
      content,
      contentForLog: logSummary,
      fingerprint,
      doneSignal: false
    };
  }

  const content = typeof result === "string"
    ? sanitizeString(result)
    : JSON.stringify(sanitizeJsonValue(result));
  return {
    content,
    contentForLog: content,
    fingerprint: content.slice(0, 300),
    doneSignal: content.startsWith("DONE:")
  };
}

async function runAgentLoop({ model, tools, systemPrompt, userPrompt, thread = null, maxSteps = null, stallLimit = 4, onLog }) {
  const conversation = Array.isArray(thread) && thread.length
    ? thread.map(toConversationMessage).filter(Boolean)
    : [new HumanMessage(sanitizeString(userPrompt))];
  const messages = [new SystemMessage(sanitizeString(systemPrompt)), ...conversation];
  const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const bound = model.bindTools(tools);
  let step = 0;
  let lastFingerprint = null;
  let repeatedIterationCount = 0;

  while (true) {
    if (maxSteps !== null && step >= maxSteps) {
      return {
        result: "Loop limit reached without completion",
        steps: step,
        stopReason: "max_steps"
      };
    }
    step += 1;
    onLog({ level: "info", data: `step ${step}: invoking model` });
    const ai = await bound.invoke(messages);
    const toolCalls = sanitizeJsonValue(ai.tool_calls || ai.toolCalls || []);
    const aiContent = sanitizeJsonValue(ai.content);

    messages.push(new AIMessage({ content: aiContent, tool_calls: toolCalls }));

    if (!toolCalls.length) {
      const text = Array.isArray(aiContent)
        ? aiContent.map((c) => (typeof c === "string" ? c : c.text || "")).join(" ")
        : String(aiContent || "");
      return {
        result: text || "Model returned without tool calls",
        steps: step,
        stopReason: "no_tool_calls"
      };
    }

    const fingerprintParts = [];
    for (const call of toolCalls) {
      const name = call.name;
      const tool = toolsByName[name];
      const callId = call.id;
      let args;

      try {
        args = typeof call.args === "string" ? JSON.parse(call.args || "{}") : call.args || {};
      } catch (err) {
        const content = JSON.stringify({
          ok: false,
          error: "tool_args_invalid_json",
          message: err?.message || "Tool arguments were not valid JSON"
        });
        onLog({ level: "error", data: `tool args parse failed (${name}): ${content}` });
        messages.push(new ToolMessage({ content, tool_call_id: callId, name }));
        continue;
      }

      if (!tool) {
        const err = `ERROR: unknown tool ${name}`;
        onLog({ level: "error", data: err });
        messages.push(new ToolMessage({ content: err, tool_call_id: callId, name }));
        continue;
      }

      onLog({ level: "info", data: `tool call: ${name}` });
      let result;
      try {
        result = await tool.invoke(args);
      } catch (err) {
        const content = JSON.stringify(sanitizeJsonValue({
          ok: false,
          error: "tool_invocation_failed",
          tool: name,
          message: err?.message || "Tool invocation failed"
        }));
        onLog({ level: "error", data: `tool error (${name}): ${content}` });
        fingerprintParts.push(
          JSON.stringify({
            name,
            args: sanitizeJsonValue(args),
            content: content.slice(0, 300)
          })
        );
        messages.push(new ToolMessage({ content, tool_call_id: callId, name }));
        continue;
      }

      const normalized = normalizeToolInvokeResult(result);
      const content = normalized.content;
      const logContent = normalized.contentForLog;
      onLog({ level: "info", data: `tool result (${name}): ${logContent.slice(0, 400)}` });
      fingerprintParts.push(
        JSON.stringify({
          name,
          args: sanitizeJsonValue(args),
          content: normalized.fingerprint.slice(0, 300)
        })
      );

      if (normalized.doneSignal) {
        return {
          result: content,
          steps: step,
          stopReason: "done"
        };
      }

      messages.push(new ToolMessage({ content, tool_call_id: callId, name }));
    }

    const iterationFingerprint = fingerprintParts.join("||");
    if (iterationFingerprint && iterationFingerprint === lastFingerprint) {
      repeatedIterationCount += 1;
      onLog({ level: "warn", data: `potential stall detected: repeated iteration x${repeatedIterationCount + 1}` });
      if (stallLimit > 0 && repeatedIterationCount >= stallLimit) {
        return {
          result: "Stall detected from repeated tool-call cycles",
          steps: step,
          stopReason: "stall_detected"
        };
      }
    } else {
      repeatedIterationCount = 0;
    }
    lastFingerprint = iterationFingerprint;
  }
}

module.exports = { runAgentLoop };
