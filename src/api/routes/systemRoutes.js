// @ts-check

const express = require("express");
const { getReadiness } = require("../../health/readiness");

function createSystemRoutes({ config, taskManager, selfUpdateManager, llmProfileManager }) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json(getReadiness(config));
  });

  router.get("/pillar/status", (req, res) => {
    const status = req.app.locals.pillarClient?.status?.() || {
      enabled: Boolean(config.pillar?.enabled),
      running: false,
      url: config.pillar?.url || null,
      serverId: config.pillar?.serverId || null
    };
    res.json(status);
  });

  router.get("/beacon/status", (req, res) => {
    const status = req.app.locals.beaconClient?.status?.() || {
      enabled: Boolean(config.beacon?.enabled),
      url: config.beacon?.url || null,
      serverId: config.beacon?.serverId || null
    };
    res.json(status);
  });

  router.get("/workspaces", async (_req, res) => {
    try {
      const data = await taskManager.listWorkspaces();
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "workspace_list_failed",
        message: err.message || String(err)
      });
    }
  });

  router.get("/llm-profiles", (_req, res) => {
    return res.json({
      items: llmProfileManager?.list ? llmProfileManager.list() : [],
      defaultProfileId: llmProfileManager?.defaultProfileId || null
    });
  });

  router.get("/filesystem/directories", async (req, res) => {
    try {
      const data = await taskManager.listDirectories(String(req.query.path || ""));
      return res.json(data);
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: "directory_list_failed",
        message: err.message || String(err)
      });
    }
  });

  router.get("/self-update/status", async (_req, res) => {
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

  router.get("/self-update/operations", async (_req, res) => {
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

  router.get("/self-update/operations/:id", async (req, res) => {
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

  return router;
}

module.exports = { createSystemRoutes };
