const fs = require("node:fs/promises");
const path = require("node:path");

function collectRuntimeDirectories(config = {}) {
  const directories = [
    config.workdir,
    config.workspaceBase,
    config.threadsDir,
    config.schedulesDir,
    config.taskLedgerDir,
    config.workflowSessionsDir,
    config.codeServer?.stateDir,
    config.codeServer?.hostWorkdir
  ];

  return [...new Set(
    directories
      .filter(Boolean)
      .map((target) => path.resolve(String(target)))
  )];
}

async function ensureRuntimeDirectories(config = {}) {
  const directories = collectRuntimeDirectories(config);
  await Promise.all(directories.map((target) => fs.mkdir(target, { recursive: true })));
  return directories;
}

module.exports = {
  collectRuntimeDirectories,
  ensureRuntimeDirectories
};
