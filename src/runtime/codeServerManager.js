const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const os = require("node:os");
const cp = require("node:child_process");
const { randomBytes } = require("node:crypto");

function runDockerCommand(args, options = {}) {
  return new Promise((resolve) => {
    const child = cp.spawn("docker", args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: stderr || err.message || String(err),
        error: err
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr
      });
    });
  });
}

function commandExists(command) {
  const target = String(command || "").trim();
  if (!target) return false;
  const checker = process.platform === "win32" ? "where" : "which";
  const result = cp.spawnSync(checker, [target], {
    stdio: "ignore"
  });
  return result.status === 0;
}

function isPidRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getHealthCheckHost(bindHost) {
  const target = String(bindHost || "").trim();
  if (!target || target === "0.0.0.0") return "127.0.0.1";
  if (target === "::") return "::1";
  return target;
}

function spawnDetachedProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const logFile = String(options.logFile || path.join(os.tmpdir(), "ender-code-server.log"));
    fsSync.mkdirSync(path.dirname(logFile), { recursive: true });

    let fd = null;
    try {
      fd = fsSync.openSync(logFile, "a");
      const child = cp.spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          ...(options.env || {})
        },
        detached: true,
        shell: false,
        stdio: ["ignore", fd, fd]
      });

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          if (fd !== null) fsSync.closeSync(fd);
        } catch {
          // no-op
        }
        resolve(result);
      };

      child.on("error", (err) => {
        finish({
          ok: false,
          error: err,
          message: err.message || String(err)
        });
      });

      child.on("spawn", () => {
        child.unref();
        finish({
          ok: true,
          pid: child.pid
        });
      });
    } catch (err) {
      try {
        if (fd !== null) fsSync.closeSync(fd);
      } catch {
        // no-op
      }
      resolve({
        ok: false,
        error: err,
        message: err.message || String(err)
      });
    }
  });
}

function findAvailablePort(bindHost) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();

    server.on("error", reject);

    server.listen(0, bindHost, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((err) => {
        if (err) return reject(err);
        if (!port) return reject(new Error("Unable to reserve a local port for code-server."));
        return resolve(port);
      });
    });
  });
}

function canConnect(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

async function waitForPort(options = {}) {
  const host = getHealthCheckHost(options.host);
  const port = Number(options.port);
  const pid = Number(options.pid);
  const timeoutMs = Number(options.timeoutMs || 15_000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (pid && !isPidRunning(pid)) {
      return {
        ok: false,
        message: "code-server exited before it became reachable."
      };
    }

    // eslint-disable-next-line no-await-in-loop
    if (await canConnect(host, port)) {
      return { ok: true };
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(250);
  }

  return {
    ok: false,
    message: "code-server did not become reachable before the startup timeout."
  };
}

async function terminateProcessTree(pid) {
  if (!isPidRunning(pid)) return { ok: true, stopped: false };

  const target = process.platform === "win32" ? Number(pid) : -Number(pid);

  const sendSignal = (signal) => {
    try {
      process.kill(target, signal);
      return true;
    } catch (err) {
      if (err && err.code === "ESRCH") return true;
      return false;
    }
  };

  if (!sendSignal("SIGTERM")) {
    return { ok: false, stopped: false, message: "Unable to stop code-server." };
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return { ok: true, stopped: true };
    // eslint-disable-next-line no-await-in-loop
    await wait(200);
  }

  if (!sendSignal("SIGKILL")) {
    return { ok: false, stopped: false, message: "Unable to force-stop code-server." };
  }

  const forceDeadline = Date.now() + 2_000;
  while (Date.now() < forceDeadline) {
    if (!isPidRunning(pid)) return { ok: true, stopped: true };
    // eslint-disable-next-line no-await-in-loop
    await wait(100);
  }

  return { ok: false, stopped: false, message: "code-server did not exit after SIGKILL." };
}

class CodeServerManager {
  constructor(config, options = {}) {
    this.config = config;
    this.codeServerConfig = config.codeServer || {};
    this.runDocker = options.runDocker || runDockerCommand;
    this.spawnProcess = options.spawnProcess || spawnDetachedProcess;
    this.commandExists = options.commandExists || commandExists;
    this.findAvailablePort = options.findAvailablePort || findAvailablePort;
    this.waitForPort = options.waitForPort || waitForPort;
    this.runtimePlatform = options.runtimePlatform || process.platform;
    this.runtimeNodeVersion = options.runtimeNodeVersion || process.versions.node;
  }

  async init() {
    await fs.mkdir(this.codeServerConfig.stateDir, { recursive: true });
  }

  capability() {
    const enabled = Boolean(this.codeServerConfig.enabled);
    const localCommand = this._localBinaryCommand();
    return {
      enabled,
      mode: this.codeServerConfig.mode || "auto",
      image: this.codeServerConfig.image || null,
      bindHost: this.codeServerConfig.bindHost || null,
      publicHost: this.codeServerConfig.publicHost || null,
      publicProtocol: this.codeServerConfig.publicProtocol || null,
      stateDir: this.codeServerConfig.stateDir || null,
      hostWorkdirMapped: Boolean(this.codeServerConfig.hostWorkdir),
      localCommand,
      localCommandAvailable: this.commandExists(localCommand),
      npxAvailable: this.commandExists("npx"),
      npxCompatible: this._isNpxCompatible()
    };
  }

  async getTaskSession(task, requestOrigin = null) {
    if (!this.codeServerConfig.enabled) {
      return { ok: false, error: "code_server_disabled", message: "code-server support is disabled." };
    }
    if (!task?.id) return { ok: false, error: "task_required", message: "Task is required." };

    const metadata = await this._readSessionMetadata(task.id);
    if (!metadata) {
      return { ok: true, session: null };
    }

    const inspect = metadata.mode === "docker"
      ? await this._inspectContainer(metadata.containerName || this._containerName(task.id))
      : await this._inspectLocalSession(metadata);

    if (!inspect.ok || !inspect.running) {
      await this._deleteSessionMetadata(task.id);
      return { ok: true, session: null };
    }

    if (!metadata?.password) {
      await this.stopTaskSession(task.id);
      return { ok: true, session: null };
    }

    return {
      ok: true,
      session: this._buildSessionSummary(task, metadata, inspect, requestOrigin)
    };
  }

  async launchTaskSession(task, requestOrigin = null) {
    if (!this.codeServerConfig.enabled) {
      return { ok: false, error: "code_server_disabled", message: "code-server support is disabled." };
    }
    if (!task?.id) return { ok: false, error: "task_required", message: "Task is required." };
    if (!task.workspace) {
      return { ok: false, error: "workspace_required", message: "This thread does not have a workspace directory." };
    }

    const current = await this.getTaskSession(task, requestOrigin);
    if (!current.ok) return current;
    if (current.session) {
      return { ok: true, created: false, session: current.session };
    }

    const strategies = this._launchStrategies();
    const errors = [];

    for (const strategy of strategies) {
      // eslint-disable-next-line no-await-in-loop
      const result = strategy.type === "docker"
        ? await this._launchDockerSession(task, requestOrigin)
        : await this._launchLocalSession(task, requestOrigin, strategy);

      if (result.ok) {
        return result;
      }

      errors.push(result.message || result.error || `${strategy.id} failed`);
      if (!result.retryable) {
        return result;
      }
    }

    return {
      ok: false,
      error: "code_server_launch_failed",
      message: errors.filter(Boolean).join(" ") || "Unable to start code-server."
    };
  }

  async stopTaskSession(taskId) {
    if (!taskId) return { ok: false, error: "task_required", message: "Task id is required." };

    const metadata = await this._readSessionMetadata(taskId);
    if (metadata?.mode === "local") {
      if (!metadata.pid || !isPidRunning(metadata.pid)) {
        await this._deleteSessionMetadata(taskId);
        return { ok: true, stopped: false };
      }

      const stopped = await terminateProcessTree(metadata.pid);
      if (!stopped.ok) {
        return {
          ok: false,
          error: "code_server_stop_failed",
          message: stopped.message || "Unable to stop code-server."
        };
      }

      await this._deleteSessionMetadata(taskId);
      return { ok: true, stopped: Boolean(stopped.stopped) };
    }

    const containerName = metadata?.containerName || this._containerName(taskId);
    const inspect = await this._inspectContainer(containerName);
    if (!inspect.ok) {
      await this._deleteSessionMetadata(taskId);
      return { ok: true, stopped: false };
    }

    const result = await this.runDocker(["rm", "-f", containerName]);
    if (!result.ok) {
      return {
        ok: false,
        error: "code_server_stop_failed",
        message: this._formatDockerError(result.stderr || "Unable to stop code-server.")
      };
    }

    await this._deleteSessionMetadata(taskId);
    return { ok: true, stopped: true };
  }

  _launchStrategies() {
    const mode = this.codeServerConfig.mode || "auto";
    if (mode === "local") {
      return [this._binaryLauncher(), this._npxLauncher()];
    }
    if (mode === "docker") {
      return [{ id: "docker", type: "docker" }];
    }

    if (this.runtimePlatform === "darwin") {
      return [this._binaryLauncher(), this._npxLauncher()];
    }

    return [{ id: "docker", type: "docker" }, this._binaryLauncher(), this._npxLauncher()];
  }

  _binaryLauncher() {
    return {
      id: "local-binary",
      type: "local",
      command: this._localBinaryCommand(),
      preArgs: []
    };
  }

  _npxLauncher() {
    return {
      id: "local-npx",
      type: "local",
      command: "npx",
      preArgs: ["--yes", this.codeServerConfig.npxPackage || "code-server@4.113.0"]
    };
  }

  _localBinaryCommand() {
    return String(this.codeServerConfig.command || "code-server").trim() || "code-server";
  }

  _isNpxCompatible() {
    const packageSpec = String(this.codeServerConfig.npxPackage || "code-server@4.113.0").trim();
    if (packageSpec === "code-server@4.113.0") {
      const major = Number.parseInt(String(this.runtimeNodeVersion || "").split(".")[0], 10);
      return major === 22;
    }
    return true;
  }

  async _launchLocalSession(task, requestOrigin, launcher) {
    const command = String(launcher.command || "").trim();
    if (!this.commandExists(command)) {
      return {
        ok: false,
        retryable: true,
        error: "code_server_local_unavailable",
        message: `Local launcher "${command}" is not available.`
      };
    }

    if (launcher.id === "local-npx" && !this._isNpxCompatible()) {
      return {
        ok: false,
        retryable: true,
        error: "code_server_local_unavailable",
        message: `The ${this.codeServerConfig.npxPackage || "code-server@4.113.0"} npx launcher requires Node 22, but Ender is running on Node ${this.runtimeNodeVersion}.`
      };
    }

    const workspacePath = path.resolve(String(task.workspace || ""));
    const bindHost = this.codeServerConfig.bindHost || "127.0.0.1";
    const port = await this.findAvailablePort(bindHost);
    const password = randomBytes(18).toString("base64url");
    const startedAt = new Date().toISOString();

    await this._ensureMetadataDir();
    const configDir = this._taskConfigDir(task.id);
    const dataDir = path.join(configDir, "data");
    const extensionsDir = path.join(configDir, "extensions");
    const logFile = path.join(configDir, "code-server.log");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(extensionsDir, { recursive: true });

    const args = [
      ...launcher.preArgs,
      "--bind-addr",
      `${bindHost}:${port}`,
      "--auth",
      "password",
      "--disable-telemetry",
      "--user-data-dir",
      dataDir,
      "--extensions-dir",
      extensionsDir,
      workspacePath
    ];

    const spawnResult = await this.spawnProcess(command, args, {
      cwd: workspacePath,
      env: {
        PASSWORD: password,
        PORT: String(port)
      },
      logFile
    });

    if (!spawnResult.ok || !spawnResult.pid) {
      return {
        ok: false,
        retryable: true,
        error: "code_server_launch_failed",
        message: spawnResult.message || `Unable to start code-server with ${command}.`
      };
    }

    const metadata = {
      taskId: task.id,
      mode: "local",
      workspace: task.workspace,
      pid: spawnResult.pid,
      bindHost,
      port,
      password,
      startedAt,
      launcherId: launcher.id,
      launcherCommand: command,
      launcherArgs: args,
      logFile
    };
    await this._writeSessionMetadata(task.id, metadata);

    const ready = await this.waitForPort({
      host: bindHost,
      port,
      pid: spawnResult.pid
    });

    if (!ready.ok) {
      await terminateProcessTree(spawnResult.pid);
      const detail = await this._tailLog(logFile);
      await this._deleteSessionMetadata(task.id);
      return {
        ok: false,
        retryable: true,
        error: "code_server_launch_failed",
        message: detail || ready.message || `code-server failed to start with ${command}.`
      };
    }

    const inspect = {
      ok: true,
      running: true,
      pid: spawnResult.pid,
      hostPort: port
    };

    return {
      ok: true,
      created: true,
      session: this._buildSessionSummary(task, metadata, inspect, requestOrigin)
    };
  }

  async _launchDockerSession(task, requestOrigin) {
    if (!this.codeServerConfig.image) {
      return {
        ok: false,
        retryable: false,
        error: "code_server_docker_unavailable",
        message: "CODE_SERVER_IMAGE is required for Docker-backed code-server launches."
      };
    }

    if (!this.commandExists("docker")) {
      return {
        ok: false,
        retryable: true,
        error: "code_server_docker_unavailable",
        message: "Docker is not available to launch code-server."
      };
    }

    const hostWorkspacePath = this._resolveHostWorkspacePath(task.workspace);
    const password = randomBytes(18).toString("base64url");
    const containerName = this._containerName(task.id);
    const startedAt = new Date().toISOString();

    await this._ensureMetadataDir();
    const configDir = this._taskConfigDir(task.id);
    await fs.mkdir(configDir, { recursive: true });

    const runResult = await this.runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--label",
      "ender.code-server=1",
      "--label",
      `ender.task-id=${task.id}`,
      "--label",
      `ender.workspace=${task.workspace}`,
      "-p",
      `${this.codeServerConfig.bindHost || "0.0.0.0"}::8080`,
      "-e",
      `PASSWORD=${password}`,
      "-v",
      `${configDir}:/config`,
      "-v",
      `${hostWorkspacePath}:/workspace`,
      this.codeServerConfig.image,
      "--bind-addr",
      "0.0.0.0:8080",
      "--auth",
      "password",
      "--disable-telemetry",
      "--user-data-dir",
      "/config/data",
      "--extensions-dir",
      "/config/extensions",
      "/workspace"
    ]);

    if (!runResult.ok) {
      return {
        ok: false,
        retryable: true,
        error: "code_server_launch_failed",
        message: this._formatDockerError(runResult.stderr || "Unable to start code-server.")
      };
    }

    const metadata = {
      taskId: task.id,
      mode: "docker",
      containerName,
      workspace: task.workspace,
      hostWorkspacePath,
      configDir,
      password,
      startedAt
    };
    await this._writeSessionMetadata(task.id, metadata);

    const inspect = await this._inspectContainer(containerName);
    if (!inspect.ok || !inspect.running) {
      await this._deleteSessionMetadata(task.id);
      return {
        ok: false,
        retryable: true,
        error: "code_server_launch_failed",
        message: inspect.message || "code-server container started but did not become ready."
      };
    }

    return {
      ok: true,
      created: true,
      session: this._buildSessionSummary(task, metadata, inspect, requestOrigin)
    };
  }

  _resolveHostWorkspacePath(workspacePath) {
    const target = path.resolve(String(workspacePath || ""));
    const hostWorkdir = this.codeServerConfig.hostWorkdir ? path.resolve(this.codeServerConfig.hostWorkdir) : null;
    if (!hostWorkdir) return target;

    const visibleWorkdir = path.resolve(this.config.workdir || process.cwd());
    const relative = path.relative(visibleWorkdir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Workspace is outside the configured code-server host workdir mapping.");
    }

    return path.resolve(hostWorkdir, relative || ".");
  }

  _containerName(taskId) {
    return `ender-code-server-${String(taskId).toLowerCase()}`;
  }

  async _inspectContainer(containerName) {
    const result = await this.runDocker(["inspect", containerName]);
    if (!result.ok) {
      return { ok: false, running: false, message: this._formatDockerError(result.stderr || "Container not found.") };
    }

    try {
      const parsed = JSON.parse(result.stdout);
      const data = Array.isArray(parsed) ? parsed[0] : parsed;
      const portEntry = data?.NetworkSettings?.Ports?.["8080/tcp"]?.[0] || null;
      return {
        ok: true,
        running: Boolean(data?.State?.Running),
        containerId: String(data?.Id || ""),
        hostPort: portEntry?.HostPort ? Number(portEntry.HostPort) : null
      };
    } catch (err) {
      return {
        ok: false,
        running: false,
        message: err.message || String(err)
      };
    }
  }

  async _inspectLocalSession(metadata) {
    const pid = Number(metadata?.pid);
    const port = Number(metadata?.port);
    if (!pid || !port || !isPidRunning(pid)) {
      return {
        ok: false,
        running: false,
        message: "code-server process is not running."
      };
    }

    const reachable = await canConnect(getHealthCheckHost(metadata.bindHost), port);
    if (!reachable) {
      return {
        ok: false,
        running: false,
        message: "code-server is not reachable on its assigned port."
      };
    }

    return {
      ok: true,
      running: true,
      pid,
      hostPort: port
    };
  }

  _buildSessionSummary(task, metadata, inspect, requestOrigin) {
    const url = this._buildPublicUrl(inspect.hostPort, requestOrigin);
    return {
      taskId: task.id,
      workspace: task.workspace,
      mode: metadata.mode || "docker",
      containerName: metadata.containerName || null,
      pid: metadata.pid || null,
      url,
      password: metadata.password,
      port: inspect.hostPort,
      startedAt: metadata.startedAt,
      bindHost: metadata.bindHost || this.codeServerConfig.bindHost || "127.0.0.1"
    };
  }

  _buildPublicUrl(port, requestOrigin) {
    const protocol = this.codeServerConfig.publicProtocol
      || requestOrigin?.protocol
      || "http";
    const hostname = this.codeServerConfig.publicHost
      || requestOrigin?.hostname
      || "localhost";

    return `${protocol}://${hostname}:${port}/`;
  }

  _formatDockerError(stderr) {
    const text = String(stderr || "").trim();
    if (!text) return "Docker command failed.";
    return text.split("\n").filter(Boolean).slice(-1)[0];
  }

  async _tailLog(logFile) {
    try {
      const raw = await fs.readFile(logFile, "utf8");
      const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
      return lines.slice(-5).join(" ");
    } catch {
      return "";
    }
  }

  async _ensureMetadataDir() {
    await fs.mkdir(this.codeServerConfig.stateDir, { recursive: true });
  }

  _metadataFile(taskId) {
    return path.join(this._taskConfigDir(taskId), "session.json");
  }

  _taskConfigDir(taskId) {
    return path.join(this.codeServerConfig.stateDir, String(taskId));
  }

  async _readSessionMetadata(taskId) {
    try {
      const raw = await fs.readFile(this._metadataFile(taskId), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async _writeSessionMetadata(taskId, metadata) {
    const file = this._metadataFile(taskId);
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(metadata, null, 2), "utf8");
    await fs.rename(temp, file);
  }

  async _deleteSessionMetadata(taskId) {
    try {
      await fs.rm(this._metadataFile(taskId), { force: true });
    } catch {
      // no-op
    }
  }
}

module.exports = { CodeServerManager };
