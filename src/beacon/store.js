const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { migratePersistedRecord, versionPersistedRecord } = require("../persistence/jsonRecord");

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createServerToken() {
  return `bcn_${crypto.randomBytes(32).toString("base64url")}`;
}

function normalizeDevice(input = {}) {
  return {
    platform: String(input.platform || "unknown").trim().toLowerCase(),
    label: String(input.label || "").trim() || null,
    pushToken: input.pushToken ? String(input.pushToken).trim() : null,
    endpoint: input.endpoint ? String(input.endpoint).trim() : null,
    keys: input.keys && typeof input.keys === "object" ? input.keys : null,
    appVersion: input.appVersion ? String(input.appVersion).trim() : null
  };
}

function normalizeServer(input = {}) {
  return {
    displayName: String(input.displayName || input.name || "").trim() || null,
    publicBaseUrl: input.publicBaseUrl ? String(input.publicBaseUrl).trim() : null
  };
}

class BeaconStore {
  constructor({ dataFile } = {}) {
    this.dataFile = dataFile || path.resolve(process.cwd(), "beacon-data", "beacon.json");
    this.data = {
      devices: {},
      servers: {},
      notifications: {}
    };
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    try {
      const raw = await fs.readFile(this.dataFile, "utf8");
      const migrated = migratePersistedRecord(JSON.parse(raw), "beaconStore");
      const parsed = migrated.record;
      this.data = {
        devices: parsed.devices && typeof parsed.devices === "object" ? parsed.devices : {},
        servers: parsed.servers && typeof parsed.servers === "object" ? parsed.servers : {},
        notifications: parsed.notifications && typeof parsed.notifications === "object" ? parsed.notifications : {}
      };
      if (migrated.migrated) await this.persist();
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      await this.persist();
    }
  }

  persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.dataFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(versionPersistedRecord("beaconStore", this.data), null, 2));
      await fs.rename(tmp, this.dataFile);
    });
    return this.writeQueue;
  }

  listDevices(userId) {
    return Object.values(this.data.devices)
      .filter((device) => device.userId === userId && !device.deletedAt)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async upsertDevice(user, input = {}) {
    const requestedId = input.deviceId ? String(input.deviceId).trim() : "";
    const id = requestedId || makeId("dev");
    const existing = this.data.devices[id];
    if (existing && existing.userId !== user.id) {
      return { ok: false, error: "device_id_in_use" };
    }

    const at = nowIso();
    const device = {
      id,
      userId: user.id,
      createdAt: existing?.createdAt || at,
      updatedAt: at,
      deletedAt: null,
      ...normalizeDevice(input)
    };
    this.data.devices[id] = device;
    await this.persist();
    return { ok: true, device };
  }

  async deleteDevice(userId, deviceId) {
    const device = this.data.devices[deviceId];
    if (!device || device.userId !== userId || device.deletedAt) {
      return { ok: false, error: "not_found" };
    }
    device.deletedAt = nowIso();
    device.updatedAt = device.deletedAt;
    await this.persist();
    return { ok: true, device };
  }

  listServers(userId) {
    return Object.values(this.data.servers)
      .filter((server) => server.userId === userId && !server.deletedAt)
      .map(({ tokenHash, ...server }) => server)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async upsertServer(user, input = {}) {
    const requestedId = String(input.serverId || "").trim();
    const id = requestedId || makeId("srv");
    const existing = this.data.servers[id];
    if (existing && existing.userId !== user.id) {
      return { ok: false, error: "server_id_in_use" };
    }

    const at = nowIso();
    const token = existing ? null : createServerToken();
    const server = {
      id,
      userId: user.id,
      createdAt: existing?.createdAt || at,
      updatedAt: at,
      deletedAt: null,
      tokenHash: existing?.tokenHash || hashToken(token),
      ...normalizeServer(input)
    };
    this.data.servers[id] = server;
    await this.persist();
    const { tokenHash, ...publicServer } = server;
    return { ok: true, server: publicServer, token };
  }

  async rotateServerToken(userId, serverId) {
    const server = this.data.servers[serverId];
    if (!server || server.userId !== userId || server.deletedAt) {
      return { ok: false, error: "not_found" };
    }

    const token = createServerToken();
    server.tokenHash = hashToken(token);
    server.updatedAt = nowIso();
    await this.persist();
    const { tokenHash, ...publicServer } = server;
    return { ok: true, server: publicServer, token };
  }

  async deleteServer(userId, serverId) {
    const server = this.data.servers[serverId];
    if (!server || server.userId !== userId || server.deletedAt) {
      return { ok: false, error: "not_found" };
    }
    server.deletedAt = nowIso();
    server.updatedAt = server.deletedAt;
    await this.persist();
    const { tokenHash, ...publicServer } = server;
    return { ok: true, server: publicServer };
  }

  authenticateServer(serverId, token) {
    const server = this.data.servers[serverId];
    if (!server || server.deletedAt) return null;
    if (!token || hashToken(token) !== server.tokenHash) return null;
    return server;
  }

  listNotifications(userId, { limit = 100, unreadOnly = false } = {}) {
    return Object.values(this.data.notifications)
      .filter((item) => item.userId === userId && !item.deletedAt)
      .filter((item) => !unreadOnly || !item.readAt)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  async createNotification({ userId, serverId, event = {}, deviceCount = 0, deliveries = [] }) {
    const at = nowIso();
    const id = makeId("ntf");
    const notification = {
      id,
      userId,
      serverId,
      type: String(event.type || "event").trim(),
      title: String(event.title || "Ender notification").trim(),
      body: String(event.body || event.message || "").trim() || null,
      taskId: event.taskId ? String(event.taskId).trim() : null,
      threadId: event.threadId ? String(event.threadId).trim() : null,
      url: event.url ? String(event.url).trim() : null,
      data: event.data && typeof event.data === "object" ? event.data : {},
      readAt: null,
      deletedAt: null,
      createdAt: at,
      deviceCount,
      deliveries
    };
    this.data.notifications[id] = notification;
    await this.persist();
    return notification;
  }

  async updateNotificationDeliveries(notificationId, deliveries = []) {
    const notification = this.data.notifications[notificationId];
    if (!notification || notification.deletedAt) {
      return { ok: false, error: "not_found" };
    }
    notification.deliveries = deliveries;
    notification.deviceCount = deliveries.length;
    notification.deliveryUpdatedAt = nowIso();
    await this.persist();
    return { ok: true, notification };
  }

  async markNotificationRead(userId, notificationId) {
    const notification = this.data.notifications[notificationId];
    if (!notification || notification.userId !== userId || notification.deletedAt) {
      return { ok: false, error: "not_found" };
    }
    notification.readAt = notification.readAt || nowIso();
    await this.persist();
    return { ok: true, notification };
  }
}

module.exports = {
  BeaconStore,
  createServerToken,
  hashToken
};
