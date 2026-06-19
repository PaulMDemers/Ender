const path = require("node:path");
const express = require("express");
const cors = require("cors");
const { BeaconStore } = require("./store");
const { createUserAuth, getBearerToken } = require("./auth");
const { PushDispatcher, loadPushConfig } = require("./pushProviders");
const { CloudPostgresStore } = require("../cloud/postgresStore");

const DEFAULT_MAX_BODY_BYTES = "2mb";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const u = new URL(withProtocol);
  return `${u.protocol}//${u.host}`;
}

function loadBeaconConfig(env = process.env) {
  const issuer = normalizeBaseUrl(env.KEYCLOAK_ISSUER || env.BEACON_OIDC_ISSUER || "https://auth.ender.bot/realms/ender");
  return {
    port: Number(env.BEACON_PORT || env.PORT || 8090),
    publicUrl: normalizeBaseUrl(env.BEACON_PUBLIC_URL || "https://beacon.ender.bot"),
    authMode: String(env.BEACON_AUTH_MODE || "oidc").trim().toLowerCase(),
    issuer,
    audience: String(env.BEACON_OIDC_AUDIENCE || env.KEYCLOAK_AUDIENCE || "ender").trim(),
    jwksUri: normalizeBaseUrl(env.BEACON_OIDC_JWKS_URI || "")
      || (issuer ? `${issuer}/protocol/openid-connect/certs` : null),
    databaseUrl: String(env.BEACON_DATABASE_URL || env.CLOUD_DATABASE_URL || env.DATABASE_URL || "").trim() || null,
    dataFile: path.resolve(env.BEACON_DATA_FILE || path.resolve(process.cwd(), "beacon-data", "beacon.json")),
    maxBodyBytes: String(env.BEACON_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES).trim(),
    push: loadPushConfig(env)
  };
}

function createServerAuth(store) {
  return async (req, res, next) => {
    const server = await store.authenticateServer(req.params.serverId, getBearerToken(req));
    if (!server) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    req.beaconServer = server;
    return next();
  };
}

function sanitizeEvent(input = {}) {
  return {
    type: String(input.type || "event").trim(),
    title: String(input.title || "Ender notification").trim(),
    body: String(input.body || input.message || "").trim(),
    taskId: input.taskId ? String(input.taskId).trim() : null,
    threadId: input.threadId ? String(input.threadId).trim() : null,
    url: input.url ? String(input.url).trim() : null,
    data: input.data && typeof input.data === "object" ? input.data : {}
  };
}

async function createBeaconApp(config = loadBeaconConfig(), options = {}) {
  const store = options.store || (config.databaseUrl
    ? new CloudPostgresStore({ databaseUrl: config.databaseUrl, service: "beacon" })
    : new BeaconStore({ dataFile: config.dataFile }));
  await store.init();

  const app = express();
  const userAuth = createUserAuth(config, options);
  const serverAuth = createServerAuth(store);
  const pushDispatcher = options.pushDispatcher || new PushDispatcher(config.push || {}, options);

  app.locals.store = store;
  app.locals.pushDispatcher = pushDispatcher;
  app.use(cors());
  app.use(express.json({ limit: config.maxBodyBytes || DEFAULT_MAX_BODY_BYTES }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      app: {
        name: "Ender Beacon",
        role: "notifications"
      },
      publicUrl: config.publicUrl,
      auth: {
        mode: config.authMode,
        issuer: config.issuer,
        audience: config.audience
      },
      push: {
        fcmConfigured: Boolean(config.push?.fcm?.projectId && config.push?.fcm?.clientEmail && config.push?.fcm?.privateKey),
        apnsConfigured: Boolean(config.push?.apns?.teamId && config.push?.apns?.keyId && config.push?.apns?.privateKey && config.push?.apns?.bundleId)
      }
    });
  });

  app.get("/oidc", (_req, res) => {
    res.json({
      issuer: config.issuer,
      audience: config.audience,
      jwksUri: config.jwksUri
    });
  });

  app.get("/devices", userAuth, async (req, res) => {
    res.json({ items: await store.listDevices(req.user.id) });
  });

  app.post("/devices", userAuth, async (req, res) => {
    const result = await store.upsertDevice(req.user, req.body || {});
    if (!result.ok) return res.status(409).json(result);
    return res.status(201).json(result.device);
  });

  app.delete("/devices/:deviceId", userAuth, async (req, res) => {
    const result = await store.deleteDevice(req.user.id, req.params.deviceId);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.get("/servers", userAuth, async (req, res) => {
    res.json({ items: await store.listServers(req.user.id) });
  });

  app.post("/servers", userAuth, async (req, res) => {
    const result = await store.upsertServer(req.user, req.body || {});
    if (!result.ok) return res.status(409).json(result);
    return res.status(result.token ? 201 : 200).json(result);
  });

  app.post("/servers/:serverId/rotate-token", userAuth, async (req, res) => {
    const result = await store.rotateServerToken(req.user.id, req.params.serverId);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.delete("/servers/:serverId", userAuth, async (req, res) => {
    const result = await store.deleteServer(req.user.id, req.params.serverId);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.post("/servers/:serverId/events", serverAuth, async (req, res) => {
    const server = req.beaconServer;
    const devices = await store.listDevices(server.userId);
    const notification = await store.createNotification({
      userId: server.userId,
      serverId: server.id,
      event: sanitizeEvent(req.body || {}),
      deviceCount: devices.length,
      deliveries: devices.map((device) => ({
        deviceId: device.id,
        platform: device.platform,
        status: "queued",
        provider: null,
        updatedAt: new Date().toISOString()
      }))
    });
    const deliveries = await pushDispatcher.dispatch(notification, devices);
    const deliveryResult = await store.updateNotificationDeliveries(notification.id, deliveries);
    const deliveredNotification = deliveryResult.ok ? deliveryResult.notification : notification;
    return res.status(201).json({
      ok: true,
      notification: deliveredNotification,
      deviceCount: devices.length
    });
  });

  app.get("/notifications", userAuth, async (req, res) => {
    res.json({
      items: await store.listNotifications(req.user.id, {
        limit: req.query.limit ? Number(req.query.limit) : 100,
        unreadOnly: String(req.query.unreadOnly || "").toLowerCase() === "true"
      })
    });
  });

  app.post("/notifications/:notificationId/read", userAuth, async (req, res) => {
    const result = await store.markNotificationRead(req.user.id, req.params.notificationId);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  return app;
}

module.exports = {
  createBeaconApp,
  loadBeaconConfig,
  sanitizeEvent
};
