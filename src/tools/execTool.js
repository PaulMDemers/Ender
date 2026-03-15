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

function inferApprovalReason(cmd) {
  const text = String(cmd || "").trim();
  if (!text) return null;

  const patterns = [
    { re: /(^|[;&|]\s*)sudo\b/i, type: "privileged_shell", label: "run a privileged shell command" },
    { re: /\bgit\s+push\b/i, type: "shell_git_push", label: "push commits from a shell command" },
    { re: /(^|[;&|]\s*)(rm|rmdir)\b/i, type: "shell_delete", label: "delete files or directories" },
    { re: /\bfind\b[\s\S]*\s-delete\b/i, type: "shell_delete", label: "delete files via find -delete" },
    { re: /\bdd\b/i, type: "disk_write", label: "write raw data to a device or file with dd" },
    { re: /\bmkfs(\.\w+)?\b/i, type: "filesystem_format", label: "format a filesystem" },
    { re: /\b(shutdown|reboot|halt|poweroff)\b/i, type: "system_power", label: "change system power state" }
  ];

  for (const pattern of patterns) {
    if (pattern.re.test(text)) return pattern;
  }

  return null;
}

function createExecTool(rootDir, { requestApproval, onLog } = {}) {
  const safeJoin = createSafeJoin(rootDir);

  return tool(
    async ({ cmd, cwd }) => {
      const workingDir = cwd ? safeJoin(cwd) : rootDir;
      const approval = inferApprovalReason(cmd);
      if (approval) {
        onLog?.({ level: "warn", data: `approval required: ${approval.label} (${cmd})` });
        const approved = await requestApproval?.({
          type: approval.type,
          title: "Approve shell command",
          description: `Allow Ender to ${approval.label}?`,
          details: { cmd, cwd: workingDir }
        });

        if (!approved) {
          return JSON.stringify({
            ok: false,
            code: 1,
            stdout: "",
            stderr: "command denied by user",
            errorType: "approval_denied",
            missingCommand: null,
            guidance: null
          });
        }
      }

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
