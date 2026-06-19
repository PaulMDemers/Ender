function parseBooleanEnv(value, defaultValue = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  throw new Error("Boolean env value must be one of true/false/1/0/yes/no/on/off when set");
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const u = new URL(withProtocol);
  return `${u.protocol}//${u.host}`;
}

function loadBeaconClientConfig(env = process.env) {
  const url = normalizeBaseUrl(env.BEACON_URL);
  const enabled = parseBooleanEnv(env.BEACON_ENABLED, Boolean(url));
  return {
    enabled,
    url,
    serverId: String(env.BEACON_SERVER_ID || "").trim(),
    token: String(env.BEACON_SERVER_TOKEN || "").trim()
  };
}

class BeaconClient {
  constructor(config, options = {}) {
    this.config = config || {};
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.lastEventAt = null;
    this.lastError = null;
  }

  get enabled() {
    return Boolean(this.config.enabled);
  }

  status() {
    return {
      enabled: this.enabled,
      url: this.config.url || null,
      serverId: this.config.serverId || null,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError
    };
  }

  validateConfig() {
    if (!this.fetchImpl) throw new Error("fetch is not available for Beacon client");
    if (!this.config.url) throw new Error("BEACON_URL is required when Beacon is enabled");
    if (!this.config.serverId) throw new Error("BEACON_SERVER_ID is required when Beacon is enabled");
    if (!this.config.token) throw new Error("BEACON_SERVER_TOKEN is required when Beacon is enabled");
  }

  async sendEvent(event) {
    if (!this.enabled) return { ok: true, skipped: true };
    this.validateConfig();
    const url = new URL(`/servers/${encodeURIComponent(this.config.serverId)}/events`, this.config.url);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(event || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message || body.error || `Beacon event failed (${res.status})`);
      }
      this.lastEventAt = new Date().toISOString();
      this.lastError = null;
      return body;
    } catch (err) {
      this.lastError = err.message || String(err);
      return { ok: false, error: "beacon_event_failed", message: this.lastError };
    }
  }

  notifyTaskEvent(task, type, input = {}) {
    const taskId = String(task?.id || input.taskId || "").trim() || null;
    const goal = String(task?.goal || input.goal || "").trim();
    const status = String(task?.status || input.status || "").trim();
    const title = input.title || (
      type === "approval_required" ? "Ender approval required"
        : type === "task_completed" ? "Ender task completed"
          : type === "task_failed" ? "Ender task failed"
            : "Ender task update"
    );
    const body = input.body || goal || status || "Ender has an update.";

    return this.sendEvent({
      type,
      title,
      body,
      taskId,
      threadId: taskId,
      data: {
        status: status || null,
        approvalId: input.approvalId || null,
        approvalType: input.approvalType || null
      }
    });
  }
}

module.exports = {
  BeaconClient,
  loadBeaconClientConfig
};
