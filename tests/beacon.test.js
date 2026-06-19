const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createBeaconApp } = require("../src/beacon/server");
const { BeaconClient, loadBeaconClientConfig } = require("../src/beacon/client");
const { FcmProvider, PushDispatcher } = require("../src/beacon/pushProviders");
const { getReadiness } = require("../src/health/readiness");

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ender-beacon-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return path.join(dir, "beacon.json");
}

function userHeaders(userId = "user-1") {
  return {
    "x-beacon-user-id": userId,
    "x-beacon-user-email": `${userId}@example.com`,
    "content-type": "application/json"
  };
}

test("Beacon registers devices, servers, and server-posted notifications for a Keycloak user", async (t) => {
  const dataFile = await makeTempFile(t);
  const app = await createBeaconApp({
    authMode: "dev",
    issuer: "https://auth.ender.bot/realms/ender",
    audience: "ender",
    jwksUri: "https://auth.ender.bot/realms/ender/protocol/openid-connect/certs",
    publicUrl: "https://beacon.ender.bot",
    dataFile,
    maxBodyBytes: "1mb"
  }, {
    pushDispatcher: {
      dispatch: async (_notification, devices) => devices.map((device) => ({
        deviceId: device.id,
        platform: device.platform,
        status: "sent",
        provider: device.platform === "ios" ? "apns" : "fcm",
        providerMessageId: "mock-message",
        updatedAt: new Date().toISOString()
      }))
    }
  });
  const beacon = await listen(app);
  t.after(async () => {
    await close(beacon.server);
  });

  const deviceRes = await fetch(`${beacon.baseUrl}/devices`, {
    method: "POST",
    headers: userHeaders(),
    body: JSON.stringify({
      deviceId: "phone-1",
      platform: "ios",
      pushToken: "push-token-1",
      label: "Paul's iPhone"
    })
  });
  assert.equal(deviceRes.status, 201);
  const device = await deviceRes.json();
  assert.equal(device.userId, "user-1");
  assert.equal(device.platform, "ios");

  const serverRes = await fetch(`${beacon.baseUrl}/servers`, {
    method: "POST",
    headers: userHeaders(),
    body: JSON.stringify({
      serverId: "home",
      displayName: "Home Ender"
    })
  });
  assert.equal(serverRes.status, 201);
  const registered = await serverRes.json();
  assert.equal(registered.server.id, "home");
  assert.match(registered.token, /^bcn_/);

  const eventRes = await fetch(`${beacon.baseUrl}/servers/home/events`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${registered.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      type: "approval_required",
      title: "Approval required",
      body: "Ender needs approval to push commits.",
      taskId: "task-1"
    })
  });
  assert.equal(eventRes.status, 201);
  const event = await eventRes.json();
  assert.equal(event.ok, true);
  assert.equal(event.deviceCount, 1);
  assert.equal(event.notification.userId, "user-1");
  assert.equal(event.notification.serverId, "home");
  assert.equal(event.notification.deliveries[0].status, "sent");
  assert.equal(event.notification.deliveries[0].provider, "apns");

  const listRes = await fetch(`${beacon.baseUrl}/notifications`, {
    headers: userHeaders()
  });
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].type, "approval_required");

  const readRes = await fetch(`${beacon.baseUrl}/notifications/${list.items[0].id}/read`, {
    method: "POST",
    headers: userHeaders(),
    body: "{}"
  });
  assert.equal(readRes.status, 200);
  const read = await readRes.json();
  assert.equal(read.ok, true);
  assert.ok(read.notification.readAt);
});

test("Beacon rejects server events with the wrong server token", async (t) => {
  const dataFile = await makeTempFile(t);
  const app = await createBeaconApp({
    authMode: "dev",
    issuer: "https://auth.ender.bot/realms/ender",
    audience: "ender",
    jwksUri: "https://auth.ender.bot/realms/ender/protocol/openid-connect/certs",
    publicUrl: "https://beacon.ender.bot",
    dataFile,
    maxBodyBytes: "1mb"
  });
  const beacon = await listen(app);
  t.after(async () => {
    await close(beacon.server);
  });

  await fetch(`${beacon.baseUrl}/servers`, {
    method: "POST",
    headers: userHeaders(),
    body: JSON.stringify({ serverId: "home" })
  });

  const res = await fetch(`${beacon.baseUrl}/servers/home/events`, {
    method: "POST",
    headers: {
      authorization: "Bearer wrong",
      "content-type": "application/json"
    },
    body: JSON.stringify({ type: "task_completed", title: "Done" })
  });
  assert.equal(res.status, 401);
});

test("BeaconClient posts task events to Beacon", async (t) => {
  const dataFile = await makeTempFile(t);
  const app = await createBeaconApp({
    authMode: "dev",
    issuer: "https://auth.ender.bot/realms/ender",
    audience: "ender",
    jwksUri: "https://auth.ender.bot/realms/ender/protocol/openid-connect/certs",
    publicUrl: "https://beacon.ender.bot",
    dataFile,
    maxBodyBytes: "1mb"
  });
  const beacon = await listen(app);
  t.after(async () => {
    await close(beacon.server);
  });

  const serverRes = await fetch(`${beacon.baseUrl}/servers`, {
    method: "POST",
    headers: userHeaders("owner"),
    body: JSON.stringify({ serverId: "lab" })
  });
  const registered = await serverRes.json();
  const client = new BeaconClient({
    enabled: true,
    url: beacon.baseUrl,
    serverId: "lab",
    token: registered.token
  });

  const sent = await client.notifyTaskEvent({ id: "task-2", goal: "Ship notifications", status: "done" }, "task_completed");
  assert.equal(sent.ok, true);
  assert.equal(sent.notification.type, "task_completed");
  assert.equal(client.status().lastError, null);
  assert.ok(client.status().lastEventAt);
});

test("PushDispatcher maps native devices to APNs and FCM providers", async () => {
  const dispatcher = new PushDispatcher({}, {
    apns: {
      send: async (device) => ({
        ok: true,
        status: "sent",
        provider: "apns",
        providerMessageId: `apns-${device.id}`
      })
    },
    fcm: {
      send: async (device) => ({
        ok: true,
        status: "sent",
        provider: "fcm",
        providerMessageId: `fcm-${device.id}`
      })
    }
  });

  const deliveries = await dispatcher.dispatch({
    id: "notification-1",
    title: "Title",
    body: "Body",
    data: {}
  }, [
    { id: "ios-1", platform: "ios", pushToken: "ios-token" },
    { id: "android-1", platform: "android", pushToken: "android-token" },
    { id: "web-1", platform: "web", endpoint: "https://push.example.com" }
  ]);

  assert.equal(deliveries[0].provider, "apns");
  assert.equal(deliveries[0].status, "sent");
  assert.equal(deliveries[1].provider, "fcm");
  assert.equal(deliveries[1].status, "sent");
  assert.equal(deliveries[2].provider, "web-push");
  assert.equal(deliveries[2].status, "unsupported_web_push");
});

test("FcmProvider exchanges a service-account JWT and posts an FCM message", async () => {
  const calls = [];
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const provider = new FcmProvider({
    projectId: "ender-project",
    clientEmail: "firebase-adminsdk@example.iam.gserviceaccount.com",
    privateKey
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ name: "projects/ender/messages/1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await provider.send({ id: "android", platform: "android", pushToken: "token" }, {
    id: "notification-1",
    type: "task_completed",
    serverId: "home",
    title: "Done",
    body: "Task complete",
    data: {}
  });

  assert.equal(result.status, "sent");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/);
  assert.match(calls[1].url, /fcm\.googleapis\.com/);
  assert.equal(calls[1].init.headers.authorization, "Bearer access-token");
});

test("loadBeaconClientConfig enables connector when BEACON_URL is set", () => {
  const config = loadBeaconClientConfig({
    BEACON_URL: "beacon.ender.bot",
    BEACON_SERVER_ID: "home",
    BEACON_SERVER_TOKEN: "secret"
  });

  assert.equal(config.enabled, true);
  assert.equal(config.url, "https://beacon.ender.bot");
  assert.equal(config.serverId, "home");
});

test("readiness includes Beacon setup state", () => {
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
    pillar: { enabled: false },
    beacon: {
      enabled: true,
      url: "https://beacon.ender.bot",
      serverId: "home",
      token: "secret"
    }
  });

  assert.equal(readiness.services.beacon.ready, true);
  assert.equal(readiness.services.beacon.serverId, "home");
});
