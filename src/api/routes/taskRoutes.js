// @ts-check

const express = require("express");
const { parseRequest, sendApiError, sendResultError } = require("../http");
const {
  approvalDecisionSchema,
  continueTaskSchema,
  createTaskSchema,
  deleteTaskSchema,
  taskLogsQuerySchema
} = require("../taskSchemas");

function getRequestOrigin(req, config) {
  const explicitHost = String(config?.codeServer?.publicHost || "").trim();
  const explicitProtocol = String(config?.codeServer?.publicProtocol || "").trim();
  if (explicitHost) {
    const hostHeader = String(req.get("x-forwarded-host") || req.get("host") || "").trim();
    return {
      protocol: explicitProtocol || req.protocol || "http",
      hostname: explicitHost.replace(/:\d+$/, ""),
      host: explicitHost,
      proxyHost: hostHeader || explicitHost,
      proxyProtocol: req.protocol || "http"
    };
  }

  const hostHeader = String(req.get("x-forwarded-host") || req.get("host") || "").trim();
  if (!hostHeader) {
    return {
      protocol: req.protocol || "http",
      hostname: "localhost",
      host: "localhost",
      proxyHost: "localhost",
      proxyProtocol: req.protocol || "http"
    };
  }

  try {
    const u = new URL(`${req.protocol || "http"}://${hostHeader}`);
    return {
      protocol: explicitProtocol || u.protocol.replace(/:$/, ""),
      hostname: u.hostname,
      host: hostHeader,
      proxyHost: hostHeader,
      proxyProtocol: u.protocol.replace(/:$/, "") || req.protocol || "http"
    };
  } catch {
    return {
      protocol: explicitProtocol || req.protocol || "http",
      hostname: hostHeader.replace(/:\d+$/, ""),
      host: hostHeader,
      proxyHost: hostHeader,
      proxyProtocol: req.protocol || "http"
    };
  }
}

function createTaskRoutes({
  taskManager,
  projectManager,
  codeServerManager,
  codeServerProxy,
  config
}) {
  const router = express.Router();

  router.get("/tasks", (_req, res) => {
    res.json({ items: taskManager.list() });
  });

  router.get("/tasks/:id", (req, res) => {
    const task = taskManager.get(req.params.id);
    if (!task) return sendApiError(res, 404, "not_found", "Task not found.");
    return res.json(task);
  });

  router.get("/tasks/:id/code-server", async (req, res) => {
    if (!codeServerManager) {
      return res.status(503).json({
        ok: false,
        error: "code_server_unavailable",
        message: "code-server support is not configured on this server."
      });
    }

    const task = taskManager.get(req.params.id);
    if (!task) return sendApiError(res, 404, "not_found", "Task not found.");

    const result = await codeServerManager.getTaskSession(task, getRequestOrigin(req, config));
    if (!result.ok) {
      return sendResultError(
        res,
        result.error === "code_server_disabled" ? 503 : 400,
        result,
        "Unable to load the workspace editor session."
      );
    }
    return res.json(result);
  });

  router.use("/tasks/:id/code-server/proxy", codeServerProxy.handleHttp);

  router.post("/tasks/:id/code-server", async (req, res) => {
    if (!codeServerManager) {
      return res.status(503).json({
        ok: false,
        error: "code_server_unavailable",
        message: "code-server support is not configured on this server."
      });
    }

    const task = taskManager.get(req.params.id);
    if (!task) return sendApiError(res, 404, "not_found", "Task not found.");

    try {
      const result = await codeServerManager.launchTaskSession(task, getRequestOrigin(req, config));
      if (!result.ok) {
        return sendResultError(
          res,
          result.error === "code_server_disabled" ? 503 : 400,
          result,
          "Unable to launch the workspace editor."
        );
      }
      return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "code_server_launch_failed",
        message: err.message || String(err)
      });
    }
  });

  router.delete("/tasks/:id/code-server", async (req, res) => {
    if (!codeServerManager) {
      return res.status(503).json({
        ok: false,
        error: "code_server_unavailable",
        message: "code-server support is not configured on this server."
      });
    }

    const task = taskManager.get(req.params.id);
    if (!task) return sendApiError(res, 404, "not_found", "Task not found.");

    const result = await codeServerManager.stopTaskSession(req.params.id);
    if (!result.ok) return sendResultError(res, 500, result, "Unable to stop the workspace editor.");
    return res.json(result);
  });

  router.post("/tasks", async (req, res) => {
    const input = parseRequest(res, createTaskSchema, req.body || {}, {
      message: "Task creation request is invalid."
    });
    if (!input) return undefined;

    const { goal, projectId, llmProfileId, memoryMode } = input;
    let { workspace } = input;
    if (projectId && projectManager) {
      const ensured = await projectManager.ensureWorkspace(projectId);
      if (!ensured.ok) {
        return sendResultError(res, 400, ensured, "Unable to prepare the selected project workspace.");
      }
      workspace = ensured.workspacePath || workspace;
    }
    const started = taskManager.start(goal, workspace || undefined, {
      projectId: projectId || null,
      llmProfileId: llmProfileId || null,
      memoryMode
    });
    if (!started.ok) {
      return sendResultError(
        res,
        started.error === "invalid_workspace" ? 400 : 500,
        started,
        "Unable to start the task."
      );
    }
    return res.status(201).json({ id: started.id });
  });

  router.post("/tasks/:id/terminate", (req, res) => {
    const result = taskManager.terminate(req.params.id);
    if (!result.ok) {
      return sendResultError(
        res,
        result.error === "not_found" ? 404 : 500,
        result,
        result.error === "not_found" ? "Task not found." : "Unable to terminate the task."
      );
    }
    return res.json({ ok: true });
  });

  router.delete("/tasks/:id", async (req, res) => {
    const input = parseRequest(res, deleteTaskSchema, req.body || {}, {
      message: "Task deletion request is invalid."
    });
    if (!input) return undefined;

    const { deleteWorkspace } = input;
    if (codeServerManager) {
      const editorResult = await codeServerManager.stopTaskSession(req.params.id);
      if (!editorResult.ok) {
        return sendResultError(res, 500, editorResult, "Unable to stop the workspace editor before deletion.");
      }
    }
    const result = await taskManager.delete(req.params.id, { deleteWorkspace });
    if (!result.ok) {
      return sendResultError(
        res,
        result.error === "not_found" ? 404 : 500,
        result,
        result.error === "not_found" ? "Task not found." : "Unable to delete the task."
      );
    }
    return res.json({ ok: true, workspaceDeletion: result.workspaceDeletion || null });
  });

  router.post("/tasks/:id/rerun", (req, res) => {
    const result = taskManager.rerun(req.params.id);
    if (!result.ok) {
      return sendResultError(
        res,
        result.error === "not_found" ? 404 : 500,
        result,
        result.error === "not_found" ? "Task not found." : "Unable to rerun the task."
      );
    }
    return res.status(201).json({ id: result.id });
  });

  router.post("/tasks/:id/messages", (req, res) => {
    const input = parseRequest(res, continueTaskSchema, req.body || {}, {
      message: "Task continuation request is invalid."
    });
    if (!input) return undefined;

    const result = taskManager.continueTask(req.params.id, input);
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : result.error === "prompt_required" ? 400 : 409;
      const message = result.error === "not_found"
        ? "Task not found."
        : result.error === "task_busy"
          ? "Task is currently running or awaiting approval."
          : "Unable to continue the task.";
      return sendResultError(res, code, result, message);
    }
    return res.status(201).json({ id: result.id });
  });

  router.post("/tasks/:id/approvals/:approvalId", (req, res) => {
    const input = parseRequest(res, approvalDecisionSchema, req.body || {}, {
      message: "Approval decision request is invalid."
    });
    if (!input) return undefined;

    const result = taskManager.resolveApproval(req.params.id, req.params.approvalId, input.approved);
    if (!result.ok) {
      const code = result.error === "not_found" || result.error === "approval_not_found" ? 404 : 500;
      const message = result.error === "approval_not_found" ? "Approval request not found." : "Task not found.";
      return sendResultError(res, code, result, message);
    }
    return res.json({ ok: true });
  });

  router.get("/tasks/:id/logs", (req, res) => {
    const input = parseRequest(res, taskLogsQuerySchema, req.query || {}, {
      message: "Task log query is invalid."
    });
    if (!input) return undefined;

    const logs = taskManager.getLogs(req.params.id, input.from);
    if (!logs) return sendApiError(res, 404, "not_found", "Task not found.");
    return res.json(logs);
  });

  router.get("/tasks/:id/stream", (req, res) => {
    const ok = taskManager.sse(req.params.id, res);
    if (!ok) return sendApiError(res, 404, "not_found", "Task not found.");
    return undefined;
  });

  return router;
}

module.exports = { createTaskRoutes, getRequestOrigin };
