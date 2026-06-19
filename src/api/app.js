const express = require("express");
const cors = require("cors");
const { getReadiness } = require("../health/readiness");
const { createCodeServerProxy } = require("./codeServerProxy");

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

function createApp(
  taskManager,
  workflowManager,
  scheduleManager,
  config,
  selfUpdateManager = null,
  codeServerManager = null,
  taskLedgerManager = null,
  projectManager = null,
  memoryManager = null,
  llmProfileManager = null
) {
  const app = express();
  const codeServerProxy = createCodeServerProxy({ taskManager, codeServerManager });
  app.locals.handleCodeServerProxyUpgrade = codeServerProxy.handleUpgrade;
  app.use(cors());
  app.use(express.json({ limit: "12mb" }));

  app.get("/health", (_req, res) => {
    res.json(getReadiness(config));
  });

  app.get("/pillar/status", (_req, res) => {
    const status = app.locals.pillarClient?.status?.() || {
      enabled: Boolean(config.pillar?.enabled),
      running: false,
      url: config.pillar?.url || null,
      serverId: config.pillar?.serverId || null
    };
    res.json(status);
  });

  app.get("/beacon/status", (_req, res) => {
    const status = app.locals.beaconClient?.status?.() || {
      enabled: Boolean(config.beacon?.enabled),
      url: config.beacon?.url || null,
      serverId: config.beacon?.serverId || null
    };
    res.json(status);
  });

  app.get("/workspaces", async (_req, res) => {
    try {
      const data = await taskManager.listWorkspaces();
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "workspace_list_failed", message: err.message || String(err) });
    }
  });

  app.get("/llm-profiles", (_req, res) => {
    return res.json({
      items: llmProfileManager?.list ? llmProfileManager.list() : [],
      defaultProfileId: llmProfileManager?.defaultProfileId || null
    });
  });

  app.get("/projects", (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    return res.json({ items: projectManager.list(String(req.query.q || "")) });
  });

  app.post("/projects", async (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    const result = await projectManager.create(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result.project);
  });

  app.put("/projects/:id", async (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    const result = await projectManager.update(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.json(result.project);
  });

  app.post("/projects/:id/ensure-workspace", async (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    const result = await projectManager.ensureWorkspace(req.params.id);
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.status(result.created ? 201 : 200).json(result);
  });

  app.get("/memories", (req, res) => {
    if (!memoryManager) {
      return res.status(503).json({ ok: false, error: "memories_unavailable" });
    }
    return res.json(memoryManager.search({
      query: String(req.query.q || ""),
      scope: req.query.scope ? String(req.query.scope) : null,
      projectId: req.query.projectId ? String(req.query.projectId) : null,
      limit: req.query.limit ? Number(req.query.limit) : 100
    }));
  });

  app.post("/memories", async (req, res) => {
    if (!memoryManager) {
      return res.status(503).json({ ok: false, error: "memories_unavailable" });
    }
    const result = await memoryManager.create(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result.memory);
  });

  app.put("/memories/:id", async (req, res) => {
    if (!memoryManager) {
      return res.status(503).json({ ok: false, error: "memories_unavailable" });
    }
    const result = await memoryManager.update(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.json(result.memory);
  });

  app.delete("/memories/:id", async (req, res) => {
    if (!memoryManager) {
      return res.status(503).json({ ok: false, error: "memories_unavailable" });
    }
    const result = await memoryManager.archive(req.params.id);
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.json(result.memory);
  });

  app.get("/filesystem/directories", async (req, res) => {
    try {
      const data = await taskManager.listDirectories(String(req.query.path || ""));
      return res.json(data);
    } catch (err) {
      return res.status(400).json({ ok: false, error: "directory_list_failed", message: err.message || String(err) });
    }
  });

  app.get("/tasks", (_req, res) => {
    res.json({ items: taskManager.list() });
  });

  app.get("/workflows", (_req, res) => {
    res.json({ items: workflowManager.list() });
  });

  app.get("/schedules", (_req, res) => {
    res.json({ items: scheduleManager.list() });
  });

  app.get("/task-ledger", (_req, res) => {
    if (!taskLedgerManager) {
      return res.status(503).json({
        ok: false,
        error: "task_ledger_unavailable",
        message: "Task ledger manager is not configured."
      });
    }

    return res.json({
      items: taskLedgerManager.list(),
      maxAutoAgents: taskLedgerManager.maxAutoAgents,
      pollIntervalMs: taskLedgerManager.pollIntervalMs
    });
  });

  app.get("/task-ledger/:id", (req, res) => {
    if (!taskLedgerManager) {
      return res.status(503).json({
        ok: false,
        error: "task_ledger_unavailable",
        message: "Task ledger manager is not configured."
      });
    }

    const entry = taskLedgerManager.get(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(entry);
  });

  app.get("/self-update/status", async (_req, res) => {
    if (!selfUpdateManager) {
      return res.status(503).json({
        ok: false,
        error: "self_update_not_configured",
        message: "Self-update supervisor is not configured."
      });
    }
    const result = await selfUpdateManager.status();
    return res.status(result.ok ? 200 : 503).json(result);
  });

  app.get("/self-update/operations", async (_req, res) => {
    if (!selfUpdateManager) {
      return res.status(503).json({
        ok: false,
        error: "self_update_not_configured",
        message: "Self-update supervisor is not configured."
      });
    }
    const result = await selfUpdateManager.listOperations();
    return res.status(result.ok ? 200 : 503).json(result);
  });

  app.get("/self-update/operations/:id", async (req, res) => {
    if (!selfUpdateManager) {
      return res.status(503).json({
        ok: false,
        error: "self_update_not_configured",
        message: "Self-update supervisor is not configured."
      });
    }
    const result = await selfUpdateManager.getOperation(req.params.id);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.post("/schedules", async (req, res) => {
    const result = await scheduleManager.create(req.body || {});
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(201).json(result.schedule);
  });

  app.post("/task-ledger", async (req, res) => {
    if (!taskLedgerManager) {
      return res.status(503).json({
        ok: false,
        error: "task_ledger_unavailable",
        message: "Task ledger manager is not configured."
      });
    }

    const result = await taskLedgerManager.create(req.body || {});
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.status(201).json(result.entry);
  });

  app.put("/task-ledger/:id", async (req, res) => {
    if (!taskLedgerManager) {
      return res.status(503).json({
        ok: false,
        error: "task_ledger_unavailable",
        message: "Task ledger manager is not configured."
      });
    }

    const result = await taskLedgerManager.update(req.params.id, req.body || {});
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : result.error === "entry_running" ? 409 : 400;
      return res.status(code).json(result);
    }
    return res.json(result.entry);
  });

  app.post("/task-ledger/:id/run", async (req, res) => {
    if (!taskLedgerManager) {
      return res.status(503).json({
        ok: false,
        error: "task_ledger_unavailable",
        message: "Task ledger manager is not configured."
      });
    }

    const result = await taskLedgerManager.runNow(req.params.id);
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : result.error === "entry_running" ? 409 : 400;
      return res.status(code).json(result);
    }
    return res.status(201).json(result);
  });

  app.delete("/task-ledger/:id", async (req, res) => {
    if (!taskLedgerManager) {
      return res.status(503).json({
        ok: false,
        error: "task_ledger_unavailable",
        message: "Task ledger manager is not configured."
      });
    }

    const result = await taskLedgerManager.delete(req.params.id);
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : result.error === "entry_running" ? 409 : 400;
      return res.status(code).json(result);
    }
    return res.json(result);
  });

  app.put("/schedules/:id", async (req, res) => {
    const result = await scheduleManager.update(req.params.id, req.body || {});
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 400).json(result);
    }
    return res.json(result.schedule);
  });

  app.post("/schedules/:id/run", async (req, res) => {
    const result = await scheduleManager.runNow(req.params.id);
    if (!result.ok && result.error === "not_found") {
      return res.status(404).json(result);
    }
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.delete("/schedules/:id", async (req, res) => {
    const result = await scheduleManager.delete(req.params.id);
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 400).json(result);
    }
    return res.json({ ok: true });
  });

  app.post("/workflows/:id/sessions", async (req, res) => {
    const result = await workflowManager.createSession(req.params.id, req.body || {});
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 500).json(result);
    }
    return res.status(201).json(result.session);
  });

  app.get("/workflow-sessions/:id", (req, res) => {
    const session = workflowManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(session);
  });

  app.post("/workflow-sessions/:id/advance", async (req, res) => {
    const result = await workflowManager.advanceSession(req.params.id, req.body || {});
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : 400;
      return res.status(code).json(result);
    }
    return res.json({ session: result.session, startedTaskId: result.startedTaskId });
  });

  app.post("/workflow-sessions/:id/back", (req, res) => {
    const result = workflowManager.retreatSession(req.params.id);
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : 400;
      return res.status(code).json(result);
    }
    return res.json(result.session);
  });

  app.get("/tasks/:id", (req, res) => {
    const task = taskManager.get(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(task);
  });

  app.get("/tasks/:id/code-server", async (req, res) => {
    if (!codeServerManager) {
      return res.status(503).json({
        ok: false,
        error: "code_server_unavailable",
        message: "code-server support is not configured on this server."
      });
    }

    const task = taskManager.get(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "not_found" });
    }

    const result = await codeServerManager.getTaskSession(task, getRequestOrigin(req, config));
    if (!result.ok) {
      return res.status(result.error === "code_server_disabled" ? 503 : 400).json(result);
    }
    return res.json(result);
  });

  app.use("/tasks/:id/code-server/proxy", codeServerProxy.handleHttp);

  app.post("/tasks/:id/code-server", async (req, res) => {
    if (!codeServerManager) {
      return res.status(503).json({
        ok: false,
        error: "code_server_unavailable",
        message: "code-server support is not configured on this server."
      });
    }

    const task = taskManager.get(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "not_found" });
    }

    try {
      const result = await codeServerManager.launchTaskSession(task, getRequestOrigin(req, config));
      if (!result.ok) {
        return res.status(result.error === "code_server_disabled" ? 503 : 400).json(result);
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

  app.delete("/tasks/:id/code-server", async (req, res) => {
    if (!codeServerManager) {
      return res.status(503).json({
        ok: false,
        error: "code_server_unavailable",
        message: "code-server support is not configured on this server."
      });
    }

    const task = taskManager.get(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "not_found" });
    }

    const result = await codeServerManager.stopTaskSession(req.params.id);
    if (!result.ok) {
      return res.status(500).json(result);
    }
    return res.json(result);
  });

  app.post("/tasks", async (req, res) => {
    const goal = String(req.body && req.body.goal ? req.body.goal : "").trim();
    let workspace = String(req.body && req.body.workspace ? req.body.workspace : "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const llmProfileId = String(req.body?.llmProfileId || "").trim();
    const memoryMode = String(req.body?.memoryMode || "auto").trim();
    if (!goal) {
      return res.status(400).json({ error: "goal_required" });
    }
    if (projectId && projectManager) {
      const ensured = await projectManager.ensureWorkspace(projectId);
      if (!ensured.ok) {
        return res.status(400).json(ensured);
      }
      workspace = ensured.workspacePath || workspace;
    }
    const started = taskManager.start(goal, workspace || undefined, {
      projectId: projectId || null,
      llmProfileId: llmProfileId || null,
      memoryMode
    });
    if (!started.ok) {
      return res.status(started.error === "invalid_workspace" ? 400 : 500).json(started);
    }
    return res.status(201).json({ id: started.id });
  });

  app.post("/tasks/:id/terminate", (req, res) => {
    const result = taskManager.terminate(req.params.id);
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 500).json(result);
    }
    return res.json({ ok: true });
  });

  app.delete("/tasks/:id", async (req, res) => {
    const deleteWorkspace = Boolean(req.body && req.body.deleteWorkspace);
    if (codeServerManager) {
      const editorResult = await codeServerManager.stopTaskSession(req.params.id);
      if (!editorResult.ok) {
        return res.status(500).json(editorResult);
      }
    }
    const result = await taskManager.delete(req.params.id, { deleteWorkspace });
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 500).json(result);
    }
    return res.json({ ok: true, workspaceDeletion: result.workspaceDeletion || null });
  });

  app.post("/tasks/:id/rerun", (req, res) => {
    const result = taskManager.rerun(req.params.id);
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 500).json(result);
    }
    return res.status(201).json({ id: result.id });
  });

  app.post("/tasks/:id/messages", (req, res) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const content = Array.isArray(req.body?.content) ? req.body.content : undefined;
    const result = taskManager.continueTask(req.params.id, {
      prompt,
      content,
      llmProfileId: req.body?.llmProfileId,
      memoryMode: req.body?.memoryMode
    });
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : result.error === "prompt_required" ? 400 : 409;
      return res.status(code).json(result);
    }
    return res.status(201).json({ id: result.id });
  });

  app.post("/tasks/:id/approvals/:approvalId", (req, res) => {
    const approved = Boolean(req.body && req.body.approved);
    const result = taskManager.resolveApproval(req.params.id, req.params.approvalId, approved);
    if (!result.ok) {
      const code = result.error === "not_found" || result.error === "approval_not_found" ? 404 : 500;
      return res.status(code).json(result);
    }
    return res.json({ ok: true });
  });

  app.get("/tasks/:id/logs", (req, res) => {
    const from = Number.parseInt(String(req.query.from || "0"), 10);
    const logs = taskManager.getLogs(req.params.id, Number.isFinite(from) ? from : 0);
    if (!logs) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(logs);
  });

  app.get("/tasks/:id/stream", (req, res) => {
    const ok = taskManager.sse(req.params.id, res);
    if (!ok) {
      return res.status(404).json({ error: "not_found" });
    }
    return undefined;
  });

  return app;
}

module.exports = { createApp };
