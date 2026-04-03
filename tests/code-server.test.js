const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CodeServerManager } = require("../src/runtime/codeServerManager");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ender-code-server-"));
}

test("launchTaskSession prefers a local npx launcher on macOS auto mode", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const workspace = path.join(root, "project");
  const stateDir = path.join(root, "state");
  await fs.mkdir(workspace, { recursive: true });

  let spawnCall = null;
  const manager = new CodeServerManager(
    {
      workdir: root,
      codeServer: {
        enabled: true,
        mode: "auto",
        bindHost: "127.0.0.1",
        publicHost: "ender.local",
        publicProtocol: "https",
        stateDir,
        command: "code-server",
        npxPackage: "code-server@4.113.0"
      }
    },
    {
      runtimePlatform: "darwin",
      runtimeNodeVersion: "22.11.0",
      commandExists: (command) => command === "npx",
      findAvailablePort: async () => 13337,
      spawnProcess: async (command, args, options) => {
        spawnCall = { command, args, options };
        return { ok: true, pid: 43210 };
      },
      waitForPort: async () => ({ ok: true })
    }
  );

  await manager.init();
  const result = await manager.launchTaskSession(
    {
      id: "task-local-1",
      workspace
    },
    { protocol: "https", hostname: "ignored.example" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.session.mode, "local");
  assert.equal(result.session.url, "https://ender.local:13337/");
  assert.equal(spawnCall.command, "npx");
  assert.deepEqual(spawnCall.args.slice(0, 2), ["--yes", "code-server@4.113.0"]);
  assert.ok(spawnCall.args.includes(workspace));
  assert.equal(spawnCall.options.cwd, workspace);
  assert.equal(spawnCall.options.env.PORT, "13337");

  const metadata = JSON.parse(await fs.readFile(path.join(stateDir, "task-local-1", "session.json"), "utf8"));
  assert.equal(metadata.mode, "local");
  assert.equal(metadata.pid, 43210);
  assert.equal(metadata.port, 13337);
  assert.equal(metadata.launcherCommand, "npx");
});

test("launchTaskSession does not fall back to docker in macOS auto mode", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const workspace = path.join(root, "project");
  const stateDir = path.join(root, "state");
  await fs.mkdir(workspace, { recursive: true });

  let dockerAttempted = false;
  const manager = new CodeServerManager(
    {
      workdir: root,
      codeServer: {
        enabled: true,
        mode: "auto",
        bindHost: "127.0.0.1",
        stateDir,
        command: "code-server",
        npxPackage: "code-server@4.113.0",
        image: "codercom/code-server:latest"
      }
    },
    {
      runtimePlatform: "darwin",
      runtimeNodeVersion: "24.11.1",
      commandExists: (command) => command === "npx" || command === "docker",
      runDocker: async () => {
        dockerAttempted = true;
        return { ok: false, stderr: "docker should not be used in darwin auto mode" };
      }
    }
  );

  await manager.init();
  const result = await manager.launchTaskSession({
    id: "task-local-3",
    workspace
  });

  assert.equal(result.ok, false);
  assert.equal(dockerAttempted, false);
  assert.match(result.message, /Local launcher "code-server" is not available/);
  assert.match(result.message, /requires Node 22/);
});

test("launchTaskSession keeps docker workspace mapping available in docker mode", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const visibleWorkdir = path.join(root, "container-workspace");
  const hostWorkdir = path.join(root, "host-workspace");
  const stateDir = path.join(root, "state");
  await fs.mkdir(path.join(visibleWorkdir, "project"), { recursive: true });

  let launched = false;
  let runArgs = null;
  const manager = new CodeServerManager(
    {
      workdir: visibleWorkdir,
      codeServer: {
        enabled: true,
        mode: "docker",
        image: "codercom/code-server:latest",
        bindHost: "0.0.0.0",
        publicHost: "ender.local",
        publicProtocol: "https",
        hostWorkdir,
        stateDir
      }
    },
    {
      commandExists: (command) => command === "docker",
      runDocker: async (args) => {
        if (args[0] === "inspect") {
          if (!launched) {
            return { ok: false, stderr: "Error: No such object: missing" };
          }
          return {
            ok: true,
            stdout: JSON.stringify([{
              Id: "abc123",
              State: { Running: true },
              NetworkSettings: {
                Ports: {
                  "8080/tcp": [{ HostPort: "14444" }]
                }
              }
            }])
          };
        }

        if (args[0] === "run") {
          launched = true;
          runArgs = args;
          return { ok: true, stdout: "abc123\n" };
        }

        throw new Error(`Unexpected docker args: ${args.join(" ")}`);
      }
    }
  );

  await manager.init();
  const result = await manager.launchTaskSession(
    {
      id: "task-docker-1",
      workspace: path.join(visibleWorkdir, "project")
    },
    { protocol: "https", hostname: "ignored.example" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.session.mode, "docker");
  assert.equal(result.session.url, "https://ender.local:14444/");
  assert.ok(runArgs.includes(`${path.join(stateDir, "task-docker-1")}:/config`));
  assert.ok(runArgs.includes(`${path.join(hostWorkdir, "project")}:/workspace`));
});

test("getTaskSession clears stale local metadata when the process is gone", async (t) => {
  const root = await makeTempDir();
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const stateDir = path.join(root, "state");
  const manager = new CodeServerManager(
    {
      workdir: path.join(root, "workspace"),
      codeServer: {
        enabled: true,
        mode: "local",
        bindHost: "127.0.0.1",
        stateDir
      }
    },
    {
      commandExists: () => true
    }
  );

  await manager.init();
  await fs.mkdir(path.join(stateDir, "task-local-2"), { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "task-local-2", "session.json"),
    JSON.stringify({ mode: "local", password: "secret", pid: 999999, port: 15555 }),
    "utf8"
  );

  const result = await manager.getTaskSession({ id: "task-local-2", workspace: path.join(root, "workspace") });
  assert.equal(result.ok, true);
  assert.equal(result.session, null);

  await assert.rejects(
    fs.readFile(path.join(stateDir, "task-local-2", "session.json"), "utf8"),
    /ENOENT/
  );
});
