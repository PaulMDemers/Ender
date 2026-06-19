const crypto = require("node:crypto");

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function makeJwt({ header, payload, privateKey, algorithm = "RSA-SHA256", dsaEncoding } = {}) {
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = crypto.createSign(algorithm);
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({
    key: normalizePrivateKey(privateKey),
    ...(dsaEncoding ? { dsaEncoding } : {})
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

function loadPushConfig(env = process.env) {
  return {
    fcm: {
      projectId: String(env.BEACON_FCM_PROJECT_ID || "").trim(),
      clientEmail: String(env.BEACON_FCM_CLIENT_EMAIL || "").trim(),
      privateKey: normalizePrivateKey(env.BEACON_FCM_PRIVATE_KEY)
    },
    apns: {
      teamId: String(env.BEACON_APNS_TEAM_ID || "").trim(),
      keyId: String(env.BEACON_APNS_KEY_ID || "").trim(),
      privateKey: normalizePrivateKey(env.BEACON_APNS_PRIVATE_KEY),
      bundleId: String(env.BEACON_APNS_BUNDLE_ID || "").trim(),
      environment: String(env.BEACON_APNS_ENV || "production").trim().toLowerCase()
    }
  };
}

function notificationPayload(notification) {
  return {
    title: notification.title,
    body: notification.body || "",
    data: {
      notificationId: notification.id,
      type: notification.type,
      serverId: notification.serverId,
      taskId: notification.taskId || "",
      threadId: notification.threadId || "",
      url: notification.url || "",
      ...Object.fromEntries(Object.entries(notification.data || {}).map(([key, value]) => [key, String(value ?? "")]))
    }
  };
}

class FcmProvider {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  get configured() {
    return Boolean(this.config.projectId && this.config.clientEmail && this.config.privateKey);
  }

  async getAccessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const now = Math.floor(Date.now() / 1000);
    const assertion = makeJwt({
      header: { alg: "RS256", typ: "JWT" },
      payload: {
        iss: this.config.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600
      },
      privateKey: this.config.privateKey
    });

    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || `fcm_token_failed_${res.status}`);
    }
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (Number(data.expires_in || 3600) * 1000);
    return this.token;
  }

  async send(device, notification) {
    if (!this.configured) {
      return { ok: false, status: "provider_not_configured", provider: "fcm" };
    }
    if (!device.pushToken) {
      return { ok: false, status: "no_push_target", provider: "fcm" };
    }

    const token = await this.getAccessToken();
    const payload = notificationPayload(notification);
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          message: {
            token: device.pushToken,
            notification: {
              title: payload.title,
              body: payload.body
            },
            data: payload.data
          }
        })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: "failed",
        provider: "fcm",
        providerStatus: res.status,
        error: data.error?.message || data.error || `fcm_send_failed_${res.status}`
      };
    }
    return {
      ok: true,
      status: "sent",
      provider: "fcm",
      providerMessageId: data.name || null
    };
  }
}

class ApnsProvider {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.token = null;
    this.tokenIssuedAt = 0;
  }

  get configured() {
    return Boolean(this.config.teamId && this.config.keyId && this.config.privateKey && this.config.bundleId);
  }

  get host() {
    return this.config.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  }

  getProviderToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && now - this.tokenIssuedAt < 50 * 60) return this.token;
    this.token = makeJwt({
      header: { alg: "ES256", kid: this.config.keyId },
      payload: { iss: this.config.teamId, iat: now },
      privateKey: this.config.privateKey,
      algorithm: "sha256",
      dsaEncoding: "ieee-p1363"
    });
    this.tokenIssuedAt = now;
    return this.token;
  }

  async send(device, notification) {
    if (!this.configured) {
      return { ok: false, status: "provider_not_configured", provider: "apns" };
    }
    if (!device.pushToken) {
      return { ok: false, status: "no_push_target", provider: "apns" };
    }

    const payload = notificationPayload(notification);
    const res = await this.fetchImpl(`${this.host}/3/device/${encodeURIComponent(device.pushToken)}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${this.getProviderToken()}`,
        "apns-topic": this.config.bundleId,
        "apns-push-type": "alert",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        aps: {
          alert: {
            title: payload.title,
            body: payload.body
          },
          sound: "default"
        },
        ender: payload.data
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: "failed",
        provider: "apns",
        providerStatus: res.status,
        error: data.reason || `apns_send_failed_${res.status}`
      };
    }
    return {
      ok: true,
      status: "sent",
      provider: "apns",
      providerMessageId: res.headers.get("apns-id") || null
    };
  }
}

class PushDispatcher {
  constructor(config = {}, options = {}) {
    this.fcm = options.fcm || new FcmProvider(config.fcm, options);
    this.apns = options.apns || new ApnsProvider(config.apns, options);
  }

  providerFor(device) {
    const platform = String(device.platform || "").toLowerCase();
    if (platform === "ios" || platform === "ipados") return this.apns;
    if (platform === "android") return this.fcm;
    return null;
  }

  async dispatch(notification, devices) {
    const deliveries = [];
    for (const device of devices) {
      const provider = this.providerFor(device);
      if (!provider) {
        deliveries.push({
          deviceId: device.id,
          platform: device.platform,
          status: device.endpoint ? "unsupported_web_push" : "unsupported_platform",
          provider: device.endpoint ? "web-push" : "none",
          updatedAt: new Date().toISOString()
        });
        continue;
      }

      try {
        const result = await provider.send(device, notification);
        deliveries.push({
          deviceId: device.id,
          platform: device.platform,
          status: result.status,
          provider: result.provider,
          providerStatus: result.providerStatus || null,
          providerMessageId: result.providerMessageId || null,
          error: result.error || null,
          updatedAt: new Date().toISOString()
        });
      } catch (err) {
        deliveries.push({
          deviceId: device.id,
          platform: device.platform,
          status: "failed",
          provider: provider instanceof ApnsProvider ? "apns" : "fcm",
          error: err.message || String(err),
          updatedAt: new Date().toISOString()
        });
      }
    }
    return deliveries;
  }
}

module.exports = {
  ApnsProvider,
  FcmProvider,
  PushDispatcher,
  loadPushConfig,
  makeJwt,
  notificationPayload
};
