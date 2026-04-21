import dotenv from "dotenv";
import process from "node:process";

import { createRequire } from "node:module";

dotenv.config();

const require = createRequire(import.meta.url);
const { loadConfig } = require("../src/config");
const { ensureRuntimeDirectories } = require("../src/startup/ensureRuntimeDirectories");
const { TaskManager } = require("../src/runtime/taskManager");
const { ScheduleManager } = require("../src/runtime/scheduleManager");
const { WorkflowManager } = require("../src/workflows/workflowManager");
const { SelfUpdateManager } = require("../src/selfUpdate/manager");
const { CodeServerManager } = require("../src/runtime/codeServerManager");
const { TaskLedgerManager } = require("../src/runtime/taskLedgerManager");
const { createApp } = require("../src/api/app");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const config = loadConfig({ ...process.env, PORT: "0" });
  await ensureRuntimeDirectories(config);

  const taskManager = new TaskManager(config);
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
    taskLedgerManager
  );

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind in-process smoke server");
  }

  const base = `http://127.0.0.1:${address.port}`;

  async function waitForHealth(timeoutMs = 20_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${base}/health`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // retry
      }
      await sleep(500);
    }
    throw new Error("server health timeout");
  }

  async function api(path, init) {
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      throw new Error(`${init?.method || "GET"} ${path} failed (${res.status})\n${text}`);
    }

    return body;
  }

  async function pollTask(id, timeoutMs = 120_000) {
    const terminal = new Set(["done", "error", "blocked", "needs_input", "terminated", "canceled"]);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const tasks = await api("/tasks");
      const task = (tasks.items || []).find((item) => item.id === id) || null;
      if (task && terminal.has(task.status)) {
        return task;
      }
      await sleep(1000);
    }

    throw new Error(`task ${id} did not finish in time`);
  }

  async function findSchemaErrorTask() {
    const tasks = await api("/tasks");
    const errorTasks = (tasks.items || [])
      .filter((item) => item.status === "error")
      .sort((a, b) => new Date(b.finishedAt || b.startedAt || 0).getTime() - new Date(a.finishedAt || a.startedAt || 0).getTime());

    for (const task of errorTasks) {
      const logs = await api(`/tasks/${task.id}/logs?from=0`);
      const entries = logs.entries || [];
      if (entries.some((entry) => String(entry.data || "").includes("Invalid schema for function 'cron_schedule'"))) {
        return task;
      }
    }

    return null;
  }

  const summary = {
    base,
    health: null,
    rerun: null,
    freshThreads: []
  };

  try {
    summary.health = await waitForHealth();

    const schemaErrorTask = await findSchemaErrorTask();
    if (!schemaErrorTask) {
      throw new Error("could not find an existing errored task with the cron_schedule schema failure");
    }

    const rerun = await api(`/tasks/${schemaErrorTask.id}/rerun`, { method: "POST" });
    const rerunFinal = await pollTask(rerun.id);
    const rerunLogs = await api(`/tasks/${rerun.id}/logs?from=0`);
    summary.rerun = {
      sourceTaskId: schemaErrorTask.id,
      rerunTaskId: rerun.id,
      status: rerunFinal.status,
      lastLogs: (rerunLogs.entries || []).slice(-8)
    };
    if (rerunFinal.status !== "done") {
      throw new Error([
        `rerun task ${rerun.id} finished as ${rerunFinal.status}`,
        JSON.stringify(summary.rerun, null, 2)
      ].join("\n"));
    }

    for (const goal of [
      "Reply with exactly DONE: server smoke one",
      "Reply with exactly DONE: server smoke two"
    ]) {
      const started = await api("/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, workspace: null })
      });
      const finalTask = await pollTask(started.id);
      const logs = await api(`/tasks/${started.id}/logs?from=0`);
      summary.freshThreads.push({
        id: started.id,
        goal,
        status: finalTask.status,
        lastLogs: (logs.entries || []).slice(-6)
      });

      if (finalTask.status !== "done") {
        throw new Error([
          `fresh task ${started.id} finished as ${finalTask.status}`,
          JSON.stringify(summary.freshThreads[summary.freshThreads.length - 1], null, 2)
        ].join("\n"));
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
