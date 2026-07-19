const crypto = require("node:crypto");

const DEFAULT_POLL_TIMEOUT_MS = 25_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:3000";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "host"
]);

function parseBooleanEnv(value, defaultValue = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  throw new Error("Boolean env value must be one of true/false/1/0/yes/no/on/off when set");
}

function parsePositiveInteger(value, defaultValue) {
  const raw = String(value || "").trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.floor(n);
}

function normalizeBaseUrl(value, defaultProtocol = "https") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${defaultProtocol}://${raw}`;
  const u = new URL(withProtocol);
  return `${u.protocol}//${u.host}`;
}

function loadPillarClientConfig(env = process.env, defaults = {}) {
  const url = normalizeBaseUrl(env.PILLAR_URL);
  const enabled = parseBooleanEnv(env.PILLAR_ENABLED, Boolean(url));
  return {
    enabled,
    url,
    serverId: String(env.PILLAR_SERVER_ID || defaults.serverId || "").trim(),
    token: String(env.PILLAR_SERVER_TOKEN || "").trim(),
    localBaseUrl: normalizeBaseUrl(env.PILLAR_LOCAL_BASE_URL, "http") || defaults.localBaseUrl || DEFAULT_LOCAL_BASE_URL,
    instanceId: String(env.PILLAR_INSTANCE_ID || crypto.randomUUID()).trim(),
    pollTimeoutMs: parsePositiveInteger(env.PILLAR_POLL_TIMEOUT_MS, DEFAULT_POLL_TIMEOUT_MS),
    retryDelayMs: parsePositiveInteger(env.PILLAR_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS),
    capacity: parsePositiveInteger(env.PILLAR_CAPACITY, 4)
  };
}

function sanitizeHeaders(headers = {}) {
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    next[lower] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return next;
}

function bufferToBase64(value) {
  if (!value || !value.byteLength) return "";
  return Buffer.from(value).toString("base64");
}

function base64ToBuffer(value) {
  const raw = String(value || "");
  return raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

class PillarClient {
  constructor(config, options = {}) {
    this.config = config || {};
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.running = false;
    this.loopPromise = null;
    this.lastError = null;
    this.lastPollAt = null;
    this.lastRequestAt = null;
    this.lastResponseAt = null;
    this.abortController = null;
  }

  get enabled() {
    return Boolean(this.config.enabled);
  }

  status() {
    return {
      enabled: this.enabled,
      running: this.running,
      url: this.config.url || null,
      serverId: this.config.serverId || null,
      localBaseUrl: this.config.localBaseUrl || null,
      instanceId: this.config.instanceId || null,
      lastPollAt: this.lastPollAt,
      lastRequestAt: this.lastRequestAt,
      lastResponseAt: this.lastResponseAt,
      lastError: this.lastError
    };
  }

  start() {
    if (!this.enabled || this.running) return;
    this.validateConfig();
    this.abortController = new AbortController();
    this.running = true;
    this.loopPromise = this.loop();
  }

  stop() {
    this.running = false;
    this.abortController?.abort(new Error("Pillar client stopped"));
    return this.loopPromise;
  }

  validateConfig() {
    if (!this.fetchImpl) throw new Error("fetch is not available for Pillar client");
    if (!this.config.url) throw new Error("PILLAR_URL is required when Pillar is enabled");
    if (!this.config.serverId) throw new Error("PILLAR_SERVER_ID is required when Pillar is enabled");
    if (!this.config.token) throw new Error("PILLAR_SERVER_TOKEN is required when Pillar is enabled");
    if (!this.config.localBaseUrl) throw new Error("PILLAR_LOCAL_BASE_URL is required when Pillar is enabled");
  }

  async loop() {
    while (this.running) {
      try {
        const requests = await this.poll();
        await Promise.all(requests.map((request) => this.handleRequest(request)));
        this.lastError = null;
      } catch (err) {
        if (!this.running || this.abortController?.signal.aborted) break;
        this.lastError = err.message || String(err);
        await sleep(this.config.retryDelayMs || DEFAULT_RETRY_DELAY_MS);
      }
    }
  }

  async poll() {
    const url = new URL(`/_pillar/servers/${encodeURIComponent(this.config.serverId)}/poll`, this.config.url);
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        instanceId: this.config.instanceId,
        capacity: this.config.capacity || 1
      }),
      signal: this.abortController?.signal
    });
    this.lastPollAt = new Date().toISOString();

    if (!res.ok) {
      throw new Error(`Pillar poll failed (${res.status})`);
    }

    const data = await res.json();
    return Array.isArray(data.requests) ? data.requests : [];
  }

  async handleRequest(request) {
    this.lastRequestAt = new Date().toISOString();
    const response = await this.forwardToLocal(request);
    await this.sendResponse(request.id, response);
    this.lastResponseAt = new Date().toISOString();
  }

  async forwardToLocal(request) {
    const path = String(request.path || "/").startsWith("/") ? String(request.path || "/") : `/${request.path}`;
    const url = new URL(path, this.config.localBaseUrl);
    const body = base64ToBuffer(request.bodyBase64);
    const headers = sanitizeHeaders(request.headers || {});
    const method = String(request.method || "GET").toUpperCase();
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: this.abortController?.signal
    });
    const responseBody = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      headers: sanitizeHeaders(Object.fromEntries(res.headers.entries())),
      bodyBase64: bufferToBase64(responseBody)
    };
  }

  async sendResponse(requestId, response) {
    const url = new URL(
      `/_pillar/servers/${encodeURIComponent(this.config.serverId)}/responses/${encodeURIComponent(requestId)}`,
      this.config.url
    );
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(response),
      signal: this.abortController?.signal
    });

    if (!res.ok) {
      throw new Error(`Pillar response failed (${res.status})`);
    }
  }
}

module.exports = {
  PillarClient,
  loadPillarClientConfig,
  sanitizeHeaders,
  base64ToBuffer,
  bufferToBase64
};
