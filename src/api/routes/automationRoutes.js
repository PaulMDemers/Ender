// @ts-check

const express = require("express");

function createAutomationRoutes({ workflowManager, scheduleManager }) {
  const router = express.Router();

  router.get("/workflows", (_req, res) => {
    res.json({ items: workflowManager.list() });
  });

  router.get("/schedules", (_req, res) => {
    res.json({ items: scheduleManager.list() });
  });

  router.post("/schedules", async (req, res) => {
    const result = await scheduleManager.create(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result.schedule);
  });

  router.put("/schedules/:id", async (req, res) => {
    const result = await scheduleManager.update(req.params.id, req.body || {});
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 400).json(result);
    }
    return res.json(result.schedule);
  });

  router.post("/schedules/:id/run", async (req, res) => {
    const result = await scheduleManager.runNow(req.params.id);
    if (!result.ok && result.error === "not_found") return res.status(404).json(result);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  router.delete("/schedules/:id", async (req, res) => {
    const result = await scheduleManager.delete(req.params.id);
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 400).json(result);
    }
    return res.json({ ok: true });
  });

  router.post("/workflows/:id/sessions", async (req, res) => {
    const result = await workflowManager.createSession(req.params.id, req.body || {});
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 500).json(result);
    }
    return res.status(201).json(result.session);
  });

  router.get("/workflow-sessions/:id", (req, res) => {
    const session = workflowManager.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "not_found" });
    return res.json(session);
  });

  router.post("/workflow-sessions/:id/advance", async (req, res) => {
    const result = await workflowManager.advanceSession(req.params.id, req.body || {});
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : 400;
      return res.status(code).json(result);
    }
    return res.json({ session: result.session, startedTaskId: result.startedTaskId });
  });

  router.post("/workflow-sessions/:id/back", (req, res) => {
    const result = workflowManager.retreatSession(req.params.id);
    if (!result.ok) {
      const code = result.error === "not_found" ? 404 : 400;
      return res.status(code).json(result);
    }
    return res.json(result.session);
  });

  return router;
}

module.exports = { createAutomationRoutes };
