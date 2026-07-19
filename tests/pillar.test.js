const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createPillarApp } = require("../src/pillar/server");
const { PillarClient, loadPillarClientConfig } = require("../src/pillar/client");
const { getReadiness } = require("../src/health/readiness");
const {
  API_CONTRACT_HEADER,
  TASK_SSE_CONTRACT_HEADER
} = require("../src/shared/apiContracts");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function makeTempFile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ender-pillar-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return path.join(dir, "pillar.json");
}

function userHeaders(userId = "user-1") {
  return {
    "x-pillar-user-id": userId,
    "x-pillar-user-email": `${userId}@example.com`,
    "content-type": "application/json"
  };
}

async function readSseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const eventLine = raw.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
      if (eventLine && dataLine) {
        const event = eventLine.slice("event: ".length);
        const data = JSON.parse(dataLine.slice("data: ".length));
        events.push({ event, data });
        if (event === "complete" || event === "error") {
          return events;
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  return events;
}

test("Pillar relays client requests through an outbound Ender connector", async (t) => {
  const local = express();
  local.use(express.json());
  local.get("/health", (_req, res) => {
    res.setHeader(API_CONTRACT_HEADER, "1");
    res.json({ ok: true, source: "local-ender" });
  });
  local.post("/echo", (req, res) => {
    res.status(201).json({
      ok: true,
      body: req.body,
      header: req.get("x-test-header") || null
    });
  });

  const localServer = await listen(local);
  const pillarServer = await listen(createPillarApp({
    serverToken: "server-secret",
    clientToken: "client-secret",
    requestTimeoutMs: 2_000,
    pollTimeoutMs: 100,
    maxBodyBytes: "1mb"
  }));
  const pillarClient = new PillarClient({
    enabled: true,
    url: pillarServer.baseUrl,
    serverId: "home",
    token: "server-secret",
    localBaseUrl: localServer.baseUrl,
    instanceId: "test-instance",
    pollTimeoutMs: 100,
    retryDelayMs: 25,
    capacity: 2
  });

  t.after(async () => {
    await pillarClient.stop();
    await close(pillarServer.server);
    await close(localServer.server);
  });

  pillarClient.start();

  const healthRes = await fetch(`${pillarServer.baseUrl}/api/home/health`, {
    headers: { authorization: "Bearer client-secret" }
  });
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get(API_CONTRACT_HEADER), "1");
  assert.deepEqual(await healthRes.json(), { ok: true, source: "local-ender" });

  const echoRes = await fetch(`${pillarServer.baseUrl}/api/home/echo`, {
    method: "POST",
    headers: {
      authorization: "Bearer client-secret",
      "content-type": "application/json",
      "x-test-header": "passed"
    },
    body: JSON.stringify({ message: "hello pillar" })
  });
  assert.equal(echoRes.status, 201);
  assert.deepEqual(await echoRes.json(), {
    ok: true,
    body: { message: "hello pillar" },
    header: "passed"
  });

  const statusRes = await fetch(`${pillarServer.baseUrl}/servers`, {
    headers: { authorization: "Bearer client-secret" }
  });
  assert.equal(statusRes.status, 200);
  const status = await statusRes.json();
  assert.equal(status.items[0].id, "home");
  assert.equal(status.items[0].instanceId, "test-instance");
});

test("Pillar synthesizes task SSE streams over the outbound connector", async (t) => {
  const state = {
    status: "running",
    result: null,
    logs: [{ t: 1, level: "info", data: "started" }],
    logsReadCount: 0
  };
  const local = express();
  local.get("/tasks/task-1", (_req, res) => {
    res.json({
      id: "task-1",
      status: state.status,
      result: state.result,
      pendingApprovals: []
    });
  });
  local.get("/tasks/task-1/logs", (req, res) => {
    const from = Number(req.query.from || 0);
    state.logsReadCount += 1;
    if (state.logsReadCount === 1) {
      setTimeout(() => {
        state.logs.push({ t: 2, level: "info", data: "finished" });
        state.status = "done";
        state.result = "ok";
      }, 20);
    }
    const entries = state.logs.slice(from);
    res.json({ from, to: from + entries.length, entries });
  });

  const localServer = await listen(local);
  const pillarServer = await listen(createPillarApp({
    serverToken: "server-secret",
    clientToken: "client-secret",
    requestTimeoutMs: 2_000,
    pollTimeoutMs: 25,
    streamPollMs: 25,
    streamHeartbeatMs: 10_000,
    maxBodyBytes: "1mb"
  }));
  const pillarClient = new PillarClient({
    enabled: true,
    url: pillarServer.baseUrl,
    serverId: "home",
    token: "server-secret",
    localBaseUrl: localServer.baseUrl,
    instanceId: "test-instance",
    pollTimeoutMs: 25,
    retryDelayMs: 10,
    capacity: 4
  });

  t.after(async () => {
    await pillarClient.stop();
    await close(pillarServer.server);
    await close(localServer.server);
  });

  pillarClient.start();

  const res = await fetch(`${pillarServer.baseUrl}/api/home/tasks/task-1/stream`, {
    headers: { authorization: "Bearer client-secret" }
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get(API_CONTRACT_HEADER), "1");
  assert.equal(res.headers.get(TASK_SSE_CONTRACT_HEADER), "1");
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);

  const events = await readSseEvents(res);
  assert.deepEqual(events.map((entry) => entry.event), ["contract", "status", "log", "log", "status", "complete"]);
  assert.deepEqual(events[0].data, { version: 1, apiVersion: 1 });
  assert.equal(events[1].data.status, "running");
  assert.equal(events[2].data.data, "started");
  assert.equal(events[3].data.data, "finished");
  assert.equal(events[4].data.status, "done");
  assert.deepEqual(events[5].data, { status: "done", result: "ok" });
});

test("Pillar rejects unauthenticated cloud client requests", async (t) => {
  const pillarServer = await listen(createPillarApp({
    serverToken: "server-secret",
    clientToken: "client-secret",
    requestTimeoutMs: 100,
    pollTimeoutMs: 50,
    maxBodyBytes: "1mb"
  }));
  t.after(async () => {
    await close(pillarServer.server);
  });

  const res = await fetch(`${pillarServer.baseUrl}/api/home/health`);
  assert.equal(res.status, 401);
});

test("Pillar registry mode ties remote access and connector tokens to a Keycloak user", async (t) => {
  const dataFile = await makeTempFile(t);
  const local = express();
  local.get("/health", (_req, res) => {
    res.json({ ok: true, source: "registered-local-ender" });
  });

  const localServer = await listen(local);
  const pillarServer = await listen(createPillarApp({
    authMode: "dev",
    issuer: "https://auth.ender.bot/realms/ender",
    audience: "ender",
    jwksUri: "https://auth.ender.bot/realms/ender/protocol/openid-connect/certs",
    dataFile,
    requestTimeoutMs: 2_000,
    pollTimeoutMs: 25,
    maxBodyBytes: "1mb"
  }));
  let pillarClient = null;
  t.after(async () => {
    if (pillarClient) await pillarClient.stop();
    await close(pillarServer.server);
    await close(localServer.server);
  });

  const registerRes = await fetch(`${pillarServer.baseUrl}/servers`, {
    method: "POST",
    headers: userHeaders("owner"),
    body: JSON.stringify({
      serverId: "home",
      displayName: "Home Ender"
    })
  });
  assert.equal(registerRes.status, 201);
  const registered = await registerRes.json();
  assert.equal(registered.server.id, "home");
  assert.match(registered.token, /^plr_/);

  pillarClient = new PillarClient({
    enabled: true,
    url: pillarServer.baseUrl,
    serverId: "home",
    token: registered.token,
    localBaseUrl: localServer.baseUrl,
    instanceId: "registered-instance",
    pollTimeoutMs: 25,
    retryDelayMs: 10,
    capacity: 2
  });
  pillarClient.start();

  const deniedRes = await fetch(`${pillarServer.baseUrl}/api/home/health`, {
    headers: userHeaders("other-user")
  });
  assert.equal(deniedRes.status, 403);

  const healthRes = await fetch(`${pillarServer.baseUrl}/api/home/health`, {
    headers: userHeaders("owner")
  });
  assert.equal(healthRes.status, 200);
  assert.deepEqual(await healthRes.json(), { ok: true, source: "registered-local-ender" });

  const serversRes = await fetch(`${pillarServer.baseUrl}/servers`, {
    headers: userHeaders("owner")
  });
  assert.equal(serversRes.status, 200);
  const servers = await serversRes.json();
  assert.equal(servers.items[0].id, "home");
  assert.equal(servers.items[0].connected, true);
  assert.equal(servers.items[0].instanceId, "registered-instance");

  const rotatedRes = await fetch(`${pillarServer.baseUrl}/servers/home/rotate-token`, {
    method: "POST",
    headers: userHeaders("owner"),
    body: "{}"
  });
  assert.equal(rotatedRes.status, 200);
  const rotated = await rotatedRes.json();
  assert.match(rotated.token, /^plr_/);
  assert.notEqual(rotated.token, registered.token);
});

test("loadPillarClientConfig enables connector when PILLAR_URL is set", () => {
  const config = loadPillarClientConfig({
    PILLAR_URL: "https://pillar.example.com",
    PILLAR_SERVER_ID: "home",
    PILLAR_SERVER_TOKEN: "secret",
    PILLAR_LOCAL_BASE_URL: "127.0.0.1:3000"
  });

  assert.equal(config.enabled, true);
  assert.equal(config.url, "https://pillar.example.com");
  assert.equal(config.serverId, "home");
  assert.equal(config.localBaseUrl, "http://127.0.0.1:3000");
});

test("readiness includes Pillar setup state", () => {
  const readiness = getReadiness({
    backend: "openai",
    openai: { apiKey: "test" },
    jira: {},
    github: {},
    confluence: {},
    googleDrive: {},
    email: { smtp: {}, imap: {} },
    selfUpdate: {},
    codeServer: { enabled: false },
    pillar: {
      enabled: true,
      url: "https://pillar.example.com",
      serverId: "home",
      token: "secret"
    }
  });

  assert.equal(readiness.services.pillar.ready, true);
  assert.equal(readiness.services.pillar.serverId, "home");
});
