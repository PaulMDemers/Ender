require("dotenv").config();

const { loadConfig } = require("./config");
const { ensureRuntimeDirectories } = require("./startup/ensureRuntimeDirectories");
const { TaskManager } = require("./runtime/taskManager");
const { ScheduleManager } = require("./runtime/scheduleManager");
const { createApp } = require("./api/app");
const { WorkflowManager } = require("./workflows/workflowManager");
const { SelfUpdateManager } = require("./selfUpdate/manager");
const { CodeServerManager } = require("./runtime/codeServerManager");
const { TaskLedgerManager } = require("./runtime/taskLedgerManager");
const { ProjectManager } = require("./runtime/projectManager");
const { MemoryManager } = require("./runtime/memoryManager");
const { LlmProfileManager } = require("./llm/profileManager");
const { APP_NAME, APP_VERSION } = require("./version");
const { PillarClient, loadPillarClientConfig } = require("./pillar/client");
const { BeaconClient, loadBeaconClientConfig } = require("./beacon/client");
const { createShutdownCoordinator } = require("./runtime/shutdown");
const { isApiAccessAllowed } = require("./api/access");

async function main() {
  const config = loadConfig(process.env);
  await ensureRuntimeDirectories(config);
  const llmProfileManager = new LlmProfileManager(config);
  const beaconClientConfig = loadBeaconClientConfig(process.env);
  const beaconClient = new BeaconClient(beaconClientConfig);
  const projectManager = new ProjectManager({ config });
  const memoryManager = new MemoryManager({ config });
  const taskManager = new TaskManager(config);
  taskManager.setLlmProfileManager(llmProfileManager);
  taskManager.setProjectManager(projectManager);
  taskManager.setMemoryManager(memoryManager);
  taskManager.setNotificationClient(beaconClient);
  await projectManager.init();
  await memoryManager.init();
  await taskManager.init();
  const workflowManager = new WorkflowManager({ config, taskManager });
  await workflowManager.init();
  const scheduleManager = new ScheduleManager({ config, taskManager, workflowManager });
  const taskLedgerManager = new TaskLedgerManager({ config, taskManager });
  const selfUpdateManager = new SelfUpdateManager(config);
  const codeServerManager = new CodeServerManager(config);
  await scheduleManager.init();
  await taskLedgerManager.init();
  await codeServerManager.init();
  taskManager.setScheduleManager(scheduleManager);
  taskManager.setSelfUpdateManager(selfUpdateManager);
  taskManager.setTaskLedgerManager(taskLedgerManager);
  const app = createApp(
    taskManager,
    workflowManager,
    scheduleManager,
    config,
    selfUpdateManager,
    codeServerManager,
    taskLedgerManager,
    projectManager,
    memoryManager,
    llmProfileManager
  );
  const pillarClientConfig = loadPillarClientConfig(process.env, {
    localBaseUrl: `http://127.0.0.1:${config.port}`,
    serverId: config.pillar?.serverId || null
  });
  const pillarClient = new PillarClient(pillarClientConfig);
  app.locals.pillarClient = pillarClient;
  app.locals.beaconClient = beaconClient;

  const server = app.listen(config.port, config.apiAccess.bindHost);

  server.on("upgrade", async (req, socket, head) => {
    if (!isApiAccessAllowed(config.apiAccess, req.socket?.remoteAddress)) {
      socket.destroy();
      return;
    }
    const handled = await app.locals.handleCodeServerProxyUpgrade?.(req, socket, head);
    if (!handled) {
      socket.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
  });

  console.log(`${APP_NAME} ${APP_VERSION} server listening on http://${config.apiAccess.bindHost}:${config.port}`);
  console.log(`backend=${config.backend} workdir=${config.workdir}`);
  console.log(
    `apiAccess=${config.apiAccess.mode} bindHost=${config.apiAccess.bindHost}`
    + ` corsOrigins=${config.apiAccess.corsOrigins.join(",") || "automatic"}`
  );
  console.log(`runtimeOs=${config.runtimeOs}`);
  console.log(`threadsDir=${config.threadsDir}`);
  console.log(`projectsDir=${config.projectsDir}`);
  console.log(`memoriesDir=${config.memoriesDir}`);
  console.log(`llmProfiles=${llmProfileManager.list().map((profile) => profile.id).join(",")}`);
  console.log(`taskLedgerDir=${config.taskLedgerDir}`);
  console.log(
    `taskLedgerPollIntervalMs=${config.taskLedgerPollIntervalMs} maxAutoAgents=${config.taskLedgerMaxAutoAgents}`
  );
  console.log(
    `codeServer=${config.codeServer?.enabled ? "enabled" : "disabled"}`
    + ` mode=${config.codeServer?.mode || "auto"}`
    + ` bindHost=${config.codeServer?.bindHost || "n/a"}`
  );
  console.log(
    `pillar=${pillarClientConfig.enabled ? "enabled" : "disabled"}`
    + ` serverId=${pillarClientConfig.serverId || "n/a"}`
    + ` url=${pillarClientConfig.url || "n/a"}`
  );
  console.log(
    `beacon=${beaconClientConfig.enabled ? "enabled" : "disabled"}`
    + ` serverId=${beaconClientConfig.serverId || "n/a"}`
    + ` url=${beaconClientConfig.url || "n/a"}`
  );
  try {
    pillarClient.start();
  } catch (err) {
    await new Promise((resolve) => server.close(resolve));
    throw err;
  }

  const shutdown = createShutdownCoordinator({
    server,
    taskManager,
    scheduleManager,
    taskLedgerManager,
    codeServerManager,
    pillarClient,
    timeoutMs: config.shutdownTimeoutMs
  });

  let signalCount = 0;
  const handleSignal = async (signal) => {
    signalCount += 1;
    if (signalCount > 1) {
      console.error(`[shutdown] received ${signal} again; forcing exit`);
      process.exit(1);
    }
    const result = await shutdown(signal);
    process.exit(result.timedOut ? 1 : 0);
  };
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  return {
    app,
    server,
    config,
    taskManager,
    scheduleManager,
    taskLedgerManager,
    codeServerManager,
    pillarClient,
    shutdown
  };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

module.exports = { main };
