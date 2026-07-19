// @ts-check

const express = require("express");

function unavailable(res) {
  return res.status(503).json({
    ok: false,
    error: "task_ledger_unavailable",
    message: "Task ledger manager is not configured."
  });
}

function resultStatus(result) {
  if (result.error === "not_found") return 404;
  if (result.error === "entry_running") return 409;
  return 400;
}

function createTaskLedgerRoutes({ taskLedgerManager }) {
  const router = express.Router();

  router.get("/task-ledger", (_req, res) => {
    if (!taskLedgerManager) return unavailable(res);
    return res.json({
      items: taskLedgerManager.list(),
      maxAutoAgents: taskLedgerManager.maxAutoAgents,
      pollIntervalMs: taskLedgerManager.pollIntervalMs
    });
  });

  router.get("/task-ledger/:id", (req, res) => {
    if (!taskLedgerManager) return unavailable(res);
    const entry = taskLedgerManager.get(req.params.id);
    if (!entry) return res.status(404).json({ error: "not_found" });
    return res.json(entry);
  });

  router.post("/task-ledger", async (req, res) => {
    if (!taskLedgerManager) return unavailable(res);
    const result = await taskLedgerManager.create(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result.entry);
  });

  router.put("/task-ledger/:id", async (req, res) => {
    if (!taskLedgerManager) return unavailable(res);
    const result = await taskLedgerManager.update(req.params.id, req.body || {});
    if (!result.ok) return res.status(resultStatus(result)).json(result);
    return res.json(result.entry);
  });

  router.post("/task-ledger/:id/run", async (req, res) => {
    if (!taskLedgerManager) return unavailable(res);
    const result = await taskLedgerManager.runNow(req.params.id);
    if (!result.ok) return res.status(resultStatus(result)).json(result);
    return res.status(201).json(result);
  });

  router.delete("/task-ledger/:id", async (req, res) => {
    if (!taskLedgerManager) return unavailable(res);
    const result = await taskLedgerManager.delete(req.params.id);
    if (!result.ok) return res.status(resultStatus(result)).json(result);
    return res.json(result);
  });

  return router;
}

module.exports = { createTaskLedgerRoutes };
