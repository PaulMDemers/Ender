const cp = require("node:child_process");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { createSafeJoin } = require("../utils/safePath");
const { sanitizeJsonValue } = require("../utils/jsonSafe");
const { createAbortError, throwIfAborted } = require("../utils/abort");

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
    { re: /(^|[;&|]\s*)(kill|pkill|killall)\b/i, type: "process_signal", label: "send signals to local processes" },
    { re: /(^|[;&|]\s*)launchctl\b/i, type: "service_control", label: "control local launch services" },
    { re: /\bdd\b/i, type: "disk_write", label: "write raw data to a device or file with dd" },
    { re: /\bmkfs(\.\w+)?\b/i, type: "filesystem_format", label: "format a filesystem" },
    { re: /\b(shutdown|reboot|halt|poweroff)\b/i, type: "system_power", label: "change system power state" }
  ];

  for (const pattern of patterns) {
    if (pattern.re.test(text)) return pattern;
  }

  return null;
}

function terminateCommand(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, "SIGTERM");
      return;
    }
  } catch {
    // Fall back to the direct shell process.
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // The command may already have exited.
  }
}

function createExecTool(rootDir, { requestApproval, onLog, signal = null } = {}) {
  const safeJoin = createSafeJoin(rootDir);

  return tool(
    async ({ cmd, cwd }) => {
      throwIfAborted(signal);
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

      throwIfAborted(signal);
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const child = cp.exec(
          cmd,
          {
            cwd: workingDir,
            timeout: 90_000,
            maxBuffer: 1024 * 1024,
            detached: process.platform !== "win32"
          },
          (error, stdout, stderr) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", abort);
            if (signal?.aborted) {
              reject(createAbortError(signal.reason));
              return;
            }
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

        const abort = () => {
          if (settled) return;
          settled = true;
          terminateCommand(child);
          reject(createAbortError(signal?.reason));
        };

        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      return JSON.stringify(sanitizeJsonValue(result));
    },
    {
      name: "exec_run",
      description: "Purpose: Run a shell command in the workspace. When to use: For local verification, testing, builds, and other workspace shell operations when appropriate. Constraints: Prefer read-only, verification, or user-requested project commands. Avoid destructive commands, credential inspection, or unrelated network access unless explicitly required by the user. Do not use shell commands to bypass higher-level tool safeguards or approval requirements. Quote paths safely and report failures faithfully. Side effects: depends on command. Requires explicit user intent: usually for mutating commands. Output: command stdout, stderr, and exit status.",
      schema: z.object({ cmd: z.string().min(1), cwd: z.string().nullable() })
    }
  );
}

module.exports = { createExecTool };
