class SelfUpdateManager {
  constructor(config) {
    this.config = config;
  }

  isConfigured() {
    return Boolean(
      this.config?.selfUpdate?.supervisorUrl
      && this.config?.selfUpdate?.supervisorToken
      && this.config?.selfUpdate?.rootDir
    );
  }

  async _request(path, init = {}) {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: "self_update_not_configured",
        message: "Start Ender under the external supervisor to enable self-update controls."
      };
    }

    try {
      const res = await fetch(`${this.config.selfUpdate.supervisorUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-ender-supervisor-token": this.config.selfUpdate.supervisorToken,
          ...(init.headers || {})
        }
      });

      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { ok: false, error: "invalid_json", message: text };
      }

      return res.ok ? body : {
        ok: false,
        error: body?.error || "request_failed",
        message: body?.message || `${init.method || "GET"} ${path} failed (${res.status})`,
        status: res.status,
        body
      };
    } catch (err) {
      return {
        ok: false,
        error: "request_failed",
        message: err.message || String(err)
      };
    }
  }

  status() {
    return this._request("/health");
  }

  listOperations() {
    return this._request("/operations");
  }

  getOperation(id) {
    return this._request(`/operations/${encodeURIComponent(String(id))}`);
  }

  createCheckpoint(label) {
    return this._request("/checkpoints", {
      method: "POST",
      body: JSON.stringify({ label })
    });
  }

  applyUpdate(input) {
    return this._request("/apply", {
      method: "POST",
      body: JSON.stringify(input || {})
    });
  }
}

module.exports = { SelfUpdateManager };
