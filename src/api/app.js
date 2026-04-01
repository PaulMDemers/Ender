const express = require("express");
const cors = require("cors");
const { getReadiness } = require("../health/readiness");

function createApp(taskManager, workflowManager, scheduleManager, config, selfUpdateManager = null) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json(getReadiness(config));
  });

  app.get("/workspaces", async (_req, res) => {
    try {
      const data = await taskManager.listWorkspaces();
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "workspace_list_failed", message: err.message || String(err) });
    }
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

  app.post("/tasks", (req, res) => {
    const goal = String(req.body && req.body.goal ? req.body.goal : "").trim();
    const workspace = String(req.body && req.body.workspace ? req.body.workspace : "").trim();
    if (!goal) {
      return res.status(400).json({ error: "goal_required" });
    }
    const started = taskManager.start(goal, workspace || undefined);
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
    const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
    const result = taskManager.continueTask(req.params.id, prompt);
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
