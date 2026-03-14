const cp = require("node:child_process");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { createSafeJoin } = require("../utils/safePath");
const { sanitizeJsonValue } = require("../utils/jsonSafe");

function inferMissingCommand(cmd, stderrText) {
  const stderr = String(stderrText || "");
  const patterns = [
    /command not found:\s*([^\s]+)/i,
    /(?:sh|bash|zsh):\s*([^\s:]+):\s*command not found/i,
    /'([^']+)' is not recognized as an internal or external command/i
  ];

  for (const re of patterns) {
    const m = stderr.match(re);
    if (m && m[1]) return m[1];
  }

  const fallback = String(cmd || "").trim().split(/\s+/)[0];
  return fallback || null;
}

function createExecTool(rootDir) {
  const safeJoin = createSafeJoin(rootDir);

  return tool(
    async ({ cmd, cwd }) => {
      const workingDir = cwd ? safeJoin(cwd) : rootDir;
      const result = await new Promise((resolve) => {
        cp.exec(
          cmd,
          { cwd: workingDir, timeout: 90_000, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            const code = error && typeof error.code === "number" ? error.code : 0;
            const stderrText = String(stderr || "");
            const isTimeout = Boolean(error && error.killed);
            const missing = code === 127 || /command not found|not recognized as an internal or external command/i.test(stderrText);

            resolve({
              ok: !error,
              code,
              stdout,
              stderr,
              errorType: !error ? null : isTimeout ? "timeout" : missing ? "command_not_found" : "execution_failed",
              missingCommand: missing ? inferMissingCommand(cmd, stderrText) : null,
              guidance: !error
                ? null
                : isTimeout
                  ? "Command timed out. Consider narrowing scope or increasing timeout."
                  : missing
                    ? "Command is not installed. Try npm install / npx for JS CLIs first. If system-level, ask user to install via brew."
                    : null
            });
          }
        );
      });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "exec_run",
      description: "Run a shell command in workspace. Use for tests/build/verification.",
      schema: z.object({ cmd: z.string().min(1), cwd: z.string().nullable() })
    }
  );
}

module.exports = { createExecTool };
