const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const { createUserAuth } = require("../beacon/auth");
const { PillarStore } = require("./store");
const { CloudPostgresStore } = require("../cloud/postgresStore");
const {
  TASK_SSE_CONTRACT_EVENT,
  createTaskSseContractPayload,
  setTaskSseContractHeaders,
  writeTaskSseEvent
} = require("../shared/apiContracts");

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BODY_BYTES = "12mb";
const DEFAULT_STREAM_POLL_MS = 1_000;
const DEFAULT_STREAM_HEARTBEAT_MS = 15_000;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length"
]);

function parsePositiveInteger(value, defaultValue) {
  const raw = String(value || "").trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.floor(n);
}

function loadPillarConfig(env = process.env) {
  const issuer = normalizeBaseUrl(env.KEYCLOAK_ISSUER || env.PILLAR_OIDC_ISSUER || "https://auth.ender.bot/realms/ender");
  return {
    port: Number(env.PILLAR_PORT || env.PORT || 8080),
    serverToken: String(env.PILLAR_SERVER_TOKEN || "").trim(),
    clientToken: String(env.PILLAR_CLIENT_TOKEN || env.PILLAR_SERVER_TOKEN || "").trim(),
    authMode: String(env.PILLAR_AUTH_MODE || "legacy").trim().toLowerCase(),
    issuer,
    audience: String(env.PILLAR_OIDC_AUDIENCE || env.KEYCLOAK_AUDIENCE || "ender").trim(),
    jwksUri: normalizeBaseUrl(env.PILLAR_OIDC_JWKS_URI || "")
      || (issuer ? `${issuer}/protocol/openid-connect/certs` : null),
    databaseUrl: String(env.PILLAR_DATABASE_URL || env.CLOUD_DATABASE_URL || env.DATABASE_URL || "").trim() || null,
    dataFile: path.resolve(env.PILLAR_DATA_FILE || path.resolve(process.cwd(), "pillar-data", "pillar.json")),
    requestTimeoutMs: parsePositiveInteger(env.PILLAR_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    pollTimeoutMs: parsePositiveInteger(env.PILLAR_POLL_TIMEOUT_MS, DEFAULT_POLL_TIMEOUT_MS),
    streamPollMs: parsePositiveInteger(env.PILLAR_STREAM_POLL_MS, DEFAULT_STREAM_POLL_MS),
    streamHeartbeatMs: parsePositiveInteger(env.PILLAR_STREAM_HEARTBEAT_MS, DEFAULT_STREAM_HEARTBEAT_MS),
    maxBodyBytes: String(env.PILLAR_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES).trim()
  };
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const u = new URL(withProtocol);
  return `${u.protocol}//${u.host}`;
}

function getBearerToken(req) {
  const raw = String(req.get("authorization") || "").trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireBearer(expectedToken, label) {
  return (req, res, next) => {
    if (!expectedToken) {
      return res.status(503).json({
        ok: false,
        error: `${label}_token_not_configured`,
        message: `Pillar ${label} token is not configured.`
      });
    }

    if (getBearerToken(req) !== expectedToken) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    return next();
  };
}

function addRelayStatus(server, relay) {
  const relayStatus = relay.listServers().find((item) => item.id === server.id) || null;
  return {
    ...server,
    connected: Boolean(relayStatus?.connected),
    lastPollAt: relayStatus?.lastPollAt || null,
    lastResponseAt: relayStatus?.lastResponseAt || null,
    instanceId: relayStatus?.instanceId || null,
    pending: relayStatus?.pending || 0,
    inflight: relayStatus?.inflight || 0
  };
}

function createPillarAuth({ config, store, relay, userAuth }) {
  if (config.authMode === "legacy") {
    return {
      userRoute: requireBearer(config.clientToken, "client"),
      clientRoute: requireBearer(config.clientToken, "client"),
      serverRoute: requireBearer(config.serverToken, "server"),
      canUseRegistry: false
    };
  }

  return {
    userRoute: userAuth,
    clientRoute: [
      userAuth,
      async (req, res, next) => {
        const server = await store.getServerForUser(req.user.id, req.params.serverId);
        if (!server) return res.status(403).json({ ok: false, error: "server_not_allowed" });
        req.pillarServer = addRelayStatus(server, relay);
        return next();
      }
    ],
    serverRoute: async (req, res, next) => {
      const server = await store.authenticateServer(req.params.serverId, getBearerToken(req));
      if (!server) return res.status(401).json({ ok: false, error: "unauthorized" });
      req.pillarServer = server;
      return next();
    },
    canUseRegistry: true
  };
}

function useHandlers(...handlers) {
  return handlers.flat().filter(Boolean);
}

function sanitizeHeaders(headers = {}) {
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "host") continue;
    next[lower] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return next;
}

function bufferToBase64(value) {
  if (!value || !value.length) return "";
  return Buffer.from(value).toString("base64");
}

function base64ToBuffer(value) {
  const raw = String(value || "");
  return raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
}

class PendingRequest {
  constructor({ method, path, headers, body }) {
    this.id = crypto.randomUUID();
    this.createdAt = new Date().toISOString();
    this.method = method;
    this.path = path;
    this.headers = sanitizeHeaders(headers);
    this.bodyBase64 = bufferToBase64(body);
    this.deliveredAt = null;
    this.resolve = null;
    this.reject = null;
    this.timeout = null;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  toWire() {
    return {
      id: this.id,
      method: this.method,
      path: this.path,
      headers: this.headers,
      bodyBase64: this.bodyBase64
    };
  }
}

class PillarRelay {
  constructor({ requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS } = {}) {
    this.requestTimeoutMs = requestTimeoutMs;
    this.pollTimeoutMs = pollTimeoutMs;
    this.servers = new Map();
  }

  getServer(serverId) {
    const id = String(serverId || "").trim();
    if (!id) return null;
    let server = this.servers.get(id);
    if (!server) {
      server = {
        id,
        connected: false,
        lastPollAt: null,
        lastResponseAt: null,
        instanceId: null,
        pending: [],
        inflight: new Map(),
        waiters: []
      };
      this.servers.set(id, server);
    }
    return server;
  }

  listServers() {
    return [...this.servers.values()].map((server) => ({
      id: server.id,
      connected: server.connected,
      lastPollAt: server.lastPollAt,
      lastResponseAt: server.lastResponseAt,
      instanceId: server.instanceId,
      pending: server.pending.length,
      inflight: server.inflight.size
    }));
  }

  enqueue(serverId, input) {
    const server = this.getServer(serverId);
    if (!server) {
      return Promise.reject(new Error("server_id_required"));
    }

    const request = new PendingRequest(input);
    request.timeout = setTimeout(() => {
      server.inflight.delete(request.id);
      server.pending = server.pending.filter((entry) => entry.id !== request.id);
      request.reject(new Error("pillar_request_timeout"));
    }, this.requestTimeoutMs);
    request.timeout.unref?.();

    server.pending.push(request);
    this.flushWaiters(server);
    return request.promise;
  }

  poll(serverId, { instanceId = null, capacity = 1 } = {}) {
    const server = this.getServer(serverId);
    if (!server) {
      return Promise.resolve({ requests: [] });
    }

    server.connected = true;
    server.instanceId = instanceId || server.instanceId;
    server.lastPollAt = new Date().toISOString();

    const requests = this.takeRequests(server, capacity);
    if (requests.length) {
      return Promise.resolve({ requests });
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        server.waiters = server.waiters.filter((waiter) => waiter.resolve !== resolve);
        resolve({ requests: [] });
      }, this.pollTimeoutMs);
      timeout.unref?.();
      server.waiters.push({ resolve, timeout, capacity });
    });
  }

  complete(serverId, requestId, response) {
    const server = this.getServer(serverId);
    const request = server?.inflight.get(requestId);
    if (!request) {
      return { ok: false, error: "request_not_found" };
    }

    clearTimeout(request.timeout);
    server.inflight.delete(request.id);
    server.lastResponseAt = new Date().toISOString();
    request.resolve({
      status: Number(response.status || 502),
      headers: sanitizeHeaders(response.headers || {}),
      body: base64ToBuffer(response.bodyBase64)
    });
    return { ok: true };
  }

  takeRequests(server, capacity = 1) {
    const count = Math.max(1, Math.min(10, Number(capacity) || 1));
    const requests = server.pending.splice(0, count);
    for (const request of requests) {
      request.deliveredAt = new Date().toISOString();
      server.inflight.set(request.id, request);
    }
    return requests.map((request) => request.toWire());
  }

  flushWaiters(server) {
    while (server.pending.length && server.waiters.length) {
      const waiter = server.waiters.shift();
      clearTimeout(waiter.timeout);
      waiter.resolve({ requests: this.takeRequests(server, waiter.capacity) });
    }
  }
}

function getProxyPath(req) {
  const originalUrl = String(req.originalUrl || req.url || "/");
  const match = originalUrl.match(/^\/api\/[^/?#]+(\/[^?#]*)?(\?[^#]*)?/);
  if (!match) return "/";
  return `${match[1] || "/"}${match[2] || ""}`;
}

function sendRelayedResponse(res, response) {
  const status = Number(response.status || 502);
  for (const [key, value] of Object.entries(sanitizeHeaders(response.headers || {}))) {
    if (key.toLowerCase() === "content-encoding") continue;
    res.setHeader(key, value);
  }
  return res.status(status).send(response.body || Buffer.alloc(0));
}

function isTerminalStatus(status) {
  return status === "done"
    || status === "error"
    || status === "canceled"
    || status === "terminated"
    || status === "blocked"
    || status === "needs_input";
}

function parseRelayedJson(response) {
  if (!response || response.status < 200 || response.status >= 300) {
    const err = new Error(`relayed_request_failed_${response?.status || 502}`);
    err.status = response?.status || 502;
    throw err;
  }

  const text = Buffer.isBuffer(response.body) ? response.body.toString("utf8") : String(response.body || "");
  return text ? JSON.parse(text) : null;
}

async function relayJson(relay, serverId, path) {
  const response = await relay.enqueue(serverId, {
    method: "GET",
    path,
    headers: { accept: "application/json" },
    body: Buffer.alloc(0)
  });
  return parseRelayedJson(response);
}

function createTaskStreamHandler(relay, config) {
  const pollMs = config.streamPollMs || DEFAULT_STREAM_POLL_MS;
  const heartbeatMs = config.streamHeartbeatMs || DEFAULT_STREAM_HEARTBEAT_MS;

  return async function handleTaskStream(req, res) {
    const serverId = req.params.serverId;
    const taskId = req.params.taskId;
    let closed = false;
    let logCursor = 0;
    let lastStatus = null;
    let sentInitialStatus = false;
    const seenApprovalIds = new Set();

    const close = () => {
      closed = true;
    };
    req.on("aborted", close);
    res.on("close", close);
    res.on("finish", close);

    setTaskSseContractHeaders(res);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    writeTaskSseEvent(res, TASK_SSE_CONTRACT_EVENT, createTaskSseContractPayload());

    const heartbeat = setInterval(() => {
      if (!closed) writeTaskSseEvent(res, "ping", Date.now());
    }, heartbeatMs);
    heartbeat.unref?.();

    async function tick() {
      const [task, logs] = await Promise.all([
        relayJson(relay, serverId, `/tasks/${encodeURIComponent(taskId)}`),
        relayJson(relay, serverId, `/tasks/${encodeURIComponent(taskId)}/logs?from=${logCursor}`)
      ]);

      if (closed) return false;

      const statusChanged = Boolean(task?.status && task.status !== lastStatus);
      if (statusChanged && !sentInitialStatus) {
        lastStatus = task.status;
        sentInitialStatus = true;
        writeTaskSseEvent(res, "status", { t: Date.now(), status: task.status });
      }

      if (Array.isArray(logs?.entries)) {
        for (const log of logs.entries) {
          writeTaskSseEvent(res, "log", log);
        }
        if (Number.isFinite(Number(logs.to))) {
          logCursor = Number(logs.to);
        } else {
          logCursor += logs.entries.length;
        }
      }

      if (statusChanged && sentInitialStatus && task.status !== lastStatus) {
        lastStatus = task.status;
        writeTaskSseEvent(res, "status", { t: Date.now(), status: task.status });
      }

      if (Array.isArray(task?.pendingApprovals)) {
        for (const approval of task.pendingApprovals) {
          if (!approval?.id || seenApprovalIds.has(approval.id)) continue;
          seenApprovalIds.add(approval.id);
          writeTaskSseEvent(res, "approval_required", approval);
        }
      }

      if (isTerminalStatus(task?.status)) {
        writeTaskSseEvent(res, "complete", { status: task.status, result: task.result || null });
        return false;
      }

      return true;
    }

    try {
      while (!closed) {
        const shouldContinue = await tick();
        if (!shouldContinue) break;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          timer.unref?.();
        });
      }
    } catch (err) {
      if (!closed) {
        writeTaskSseEvent(res, "error", {
          t: Date.now(),
          level: "error",
          data: err.message || String(err)
        });
      }
    } finally {
      clearInterval(heartbeat);
      if (!closed) res.end();
    }
  };
}

function createPillarApp(config = loadPillarConfig(), options = {}) {
  config = { authMode: "legacy", ...config };
  const relay = new PillarRelay(config);
  const app = express();
  const store = options.store || (config.authMode !== "legacy"
    ? (config.databaseUrl
      ? new CloudPostgresStore({ databaseUrl: config.databaseUrl, service: "pillar" })
      : new PillarStore({ dataFile: config.dataFile }))
    : null);
  const userAuth = createUserAuth(config, options);
  const auth = createPillarAuth({ config, store, relay, userAuth });
  const jsonParser = express.json({ limit: config.maxBodyBytes || DEFAULT_MAX_BODY_BYTES });
  const rawParser = express.raw({ type: "*/*", limit: config.maxBodyBytes || DEFAULT_MAX_BODY_BYTES });

  app.locals.relay = relay;
  app.locals.store = store;
  app.use(cors());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      app: {
        name: "Ender Pillar",
        role: "lighthouse"
      },
      auth: {
        mode: config.authMode,
        issuer: config.authMode === "legacy" ? null : config.issuer,
        audience: config.authMode === "legacy" ? null : config.audience
      },
      servers: relay.listServers()
    });
  });

  app.get("/servers", ...useHandlers(auth.userRoute), async (req, res) => {
    if (auth.canUseRegistry) {
      return res.json({
        items: (await store.listServers(req.user.id)).map((server) => addRelayStatus(server, relay))
      });
    }
    res.json({ items: relay.listServers() });
  });

  if (auth.canUseRegistry) {
    app.post("/servers", ...useHandlers(auth.userRoute), jsonParser, async (req, res) => {
      const result = await store.upsertServer(req.user, req.body || {});
      if (!result.ok) return res.status(409).json(result);
      return res.status(result.token ? 201 : 200).json(result);
    });

    app.post("/servers/:serverId/rotate-token", ...useHandlers(auth.userRoute), async (req, res) => {
      const result = await store.rotateServerToken(req.user.id, req.params.serverId);
      return res.status(result.ok ? 200 : 404).json(result);
    });

    app.delete("/servers/:serverId", ...useHandlers(auth.userRoute), async (req, res) => {
      const result = await store.deleteServer(req.user.id, req.params.serverId);
      return res.status(result.ok ? 200 : 404).json(result);
    });
  }

  app.post("/_pillar/servers/:serverId/poll", ...useHandlers(auth.serverRoute), jsonParser, async (req, res) => {
    const result = await relay.poll(req.params.serverId, {
      instanceId: req.body?.instanceId || null,
      capacity: req.body?.capacity || 1
    });
    return res.json(result);
  });

  app.post("/_pillar/servers/:serverId/responses/:requestId", ...useHandlers(auth.serverRoute), jsonParser, (req, res) => {
    const result = relay.complete(req.params.serverId, req.params.requestId, req.body || {});
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.get("/api/:serverId/tasks/:taskId/stream", ...useHandlers(auth.clientRoute), createTaskStreamHandler(relay, config));

  app.use("/api/:serverId", ...useHandlers(auth.clientRoute), rawParser, async (req, res) => {
    try {
      const response = await relay.enqueue(req.params.serverId, {
        method: req.method,
        path: getProxyPath(req),
        headers: req.headers,
        body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      });
      return sendRelayedResponse(res, response);
    } catch (err) {
      const message = err.message || String(err);
      return res.status(message === "pillar_request_timeout" ? 504 : 502).json({
        ok: false,
        error: message === "pillar_request_timeout" ? "pillar_request_timeout" : "pillar_proxy_failed",
        message
      });
    }
  });

  return app;
}

module.exports = {
  PillarRelay,
  createPillarApp,
  loadPillarConfig,
  sanitizeHeaders,
  base64ToBuffer,
  bufferToBase64
};
