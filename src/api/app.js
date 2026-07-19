// @ts-check

const express = require("express");
const cors = require("cors");
const { createApiAccessMiddleware, createCorsOptions } = require("./access");
const { createCodeServerProxy } = require("./codeServerProxy");
const { sendApiError } = require("./http");
const { setApiContractHeaders } = require("../shared/apiContracts");
const { createAutomationRoutes } = require("./routes/automationRoutes");
const { createContextRoutes } = require("./routes/contextRoutes");
const { createSystemRoutes } = require("./routes/systemRoutes");
const { createTaskLedgerRoutes } = require("./routes/taskLedgerRoutes");
const { createTaskRoutes } = require("./routes/taskRoutes");

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
  const dependencies = {
    taskManager,
    workflowManager,
    scheduleManager,
    config,
    selfUpdateManager,
    codeServerManager,
    taskLedgerManager,
    projectManager,
    memoryManager,
    llmProfileManager,
    codeServerProxy
  };

  app.locals.handleCodeServerProxyUpgrade = codeServerProxy.handleUpgrade;
  app.use((_req, res, next) => {
    setApiContractHeaders(res);
    next();
  });
  app.use(cors(createCorsOptions(config.apiAccess)));
  app.use(createApiAccessMiddleware(config.apiAccess));
  app.use(express.json({ limit: "12mb" }));

  app.use(createSystemRoutes(dependencies));
  app.use(createContextRoutes(dependencies));
  app.use(createAutomationRoutes(dependencies));
  app.use(createTaskLedgerRoutes(dependencies));
  app.use(createTaskRoutes(dependencies));

  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === "entity.parse.failed") {
      return sendApiError(res, 400, "invalid_json", "Request body contains malformed JSON.");
    }
    if (err?.type === "entity.too.large") {
      return sendApiError(res, 413, "request_too_large", "Request body exceeds the configured size limit.");
    }

    console.error(err && err.stack ? err.stack : String(err));
    return sendApiError(res, 500, "internal_error", "An unexpected server error occurred.");
  });

  return app;
}

module.exports = { createApp };
