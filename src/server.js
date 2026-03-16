require("dotenv").config();

const { loadConfig } = require("./config");
const { TaskManager } = require("./runtime/taskManager");
const { ScheduleManager } = require("./runtime/scheduleManager");
const { createApp } = require("./api/app");
const { WorkflowManager } = require("./workflows/workflowManager");

async function main() {
  const config = loadConfig(process.env);
  const taskManager = new TaskManager(config);
  await taskManager.init();
  const workflowManager = new WorkflowManager({ config, taskManager });
  const scheduleManager = new ScheduleManager({ config, taskManager, workflowManager });
  await scheduleManager.init();
  taskManager.setScheduleManager(scheduleManager);
  const app = createApp(taskManager, workflowManager, scheduleManager, config);

  app.listen(config.port, () => {
    console.log(`Ender server listening on http://localhost:${config.port}`);
    console.log(`backend=${config.backend} workdir=${config.workdir}`);
    console.log(`runtimeOs=${config.runtimeOs}`);
    console.log(`threadsDir=${config.threadsDir}`);
  });
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
