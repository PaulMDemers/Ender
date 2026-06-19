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

  const server = app.listen(config.port, () => {
    console.log(`${APP_NAME} ${APP_VERSION} server listening on http://localhost:${config.port}`);
    console.log(`backend=${config.backend} workdir=${config.workdir}`);
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
      console.error(err && err.stack ? err.stack : String(err));
      process.exit(1);
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    const handled = await app.locals.handleCodeServerProxyUpgrade?.(req, socket, head);
    if (!handled) {
      socket.destroy();
    }
  });
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
