// @ts-check

const express = require("express");

function createContextRoutes({ projectManager, memoryManager }) {
  const router = express.Router();

  router.get("/projects", (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    return res.json({ items: projectManager.list(String(req.query.q || "")) });
  });

  router.post("/projects", async (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    const result = await projectManager.create(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result.project);
  });

  router.put("/projects/:id", async (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    const result = await projectManager.update(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.json(result.project);
  });

  router.post("/projects/:id/ensure-workspace", async (req, res) => {
    if (!projectManager) {
      return res.status(503).json({ ok: false, error: "projects_unavailable" });
    }
    const result = await projectManager.ensureWorkspace(req.params.id);
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.status(result.created ? 201 : 200).json(result);
  });

  router.get("/memories", (req, res) => {
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

  router.post("/memories", async (req, res) => {
    if (!memoryManager) {
      return res.status(503).json({ ok: false, error: "memories_unavailable" });
    }
    const result = await memoryManager.create(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result.memory);
  });

  router.put("/memories/:id", async (req, res) => {
    if (!memoryManager) {
      return res.status(503).json({ ok: false, error: "memories_unavailable" });
    }
    const result = await memoryManager.update(req.params.id, req.body || {});
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.json(result.memory);
  });

  router.delete("/memories/:id", async (req, res) => {
    if (!memoryManager) {
      return res.status(503).json({ ok: false, error: "memories_unavailable" });
    }
    const result = await memoryManager.archive(req.params.id);
    if (!result.ok) return res.status(result.error === "not_found" ? 404 : 400).json(result);
    return res.json(result.memory);
  });

  return router;
}

module.exports = { createContextRoutes };
