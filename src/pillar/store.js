const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createServerToken() {
  return `plr_${crypto.randomBytes(32).toString("base64url")}`;
}

function normalizeServer(input = {}) {
  return {
    displayName: String(input.displayName || input.name || "").trim() || null,
    beaconServerId: input.beaconServerId ? String(input.beaconServerId).trim() : null
  };
}

class PillarStore {
  constructor({ dataFile } = {}) {
    this.dataFile = dataFile || path.resolve(process.cwd(), "pillar-data", "pillar.json");
    this.data = {
      servers: {}
    };
    this.init();
  }

  init() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    try {
      const raw = fs.readFileSync(this.dataFile, "utf8");
      const parsed = JSON.parse(raw);
      this.data = {
        servers: parsed.servers && typeof parsed.servers === "object" ? parsed.servers : {}
      };
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      this.persist();
    }
  }

  persist() {
    const tmp = `${this.dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.dataFile);
  }

  listServers(userId) {
    return Object.values(this.data.servers)
      .filter((server) => server.userId === userId && !server.deletedAt)
      .map(({ tokenHash, ...server }) => server)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getServerForUser(userId, serverId) {
    const server = this.data.servers[serverId];
    if (!server || server.deletedAt || server.userId !== userId) return null;
    const { tokenHash, ...publicServer } = server;
    return publicServer;
  }

  upsertServer(user, input = {}) {
    const requestedId = String(input.serverId || "").trim();
    if (!requestedId) return { ok: false, error: "server_id_required" };
    const existing = this.data.servers[requestedId];
    if (existing && existing.userId !== user.id) {
      return { ok: false, error: "server_id_in_use" };
    }

    const at = nowIso();
    const token = existing ? null : createServerToken();
    const server = {
      id: requestedId,
      userId: user.id,
      createdAt: existing?.createdAt || at,
      updatedAt: at,
      deletedAt: null,
      tokenHash: existing?.tokenHash || hashToken(token),
      ...normalizeServer(input)
    };
    this.data.servers[requestedId] = server;
    this.persist();
    const { tokenHash, ...publicServer } = server;
    return { ok: true, server: publicServer, token };
  }

  rotateServerToken(userId, serverId) {
    const server = this.data.servers[serverId];
    if (!server || server.userId !== userId || server.deletedAt) {
      return { ok: false, error: "not_found" };
    }

    const token = createServerToken();
    server.tokenHash = hashToken(token);
    server.updatedAt = nowIso();
    this.persist();
    const { tokenHash, ...publicServer } = server;
    return { ok: true, server: publicServer, token };
  }

  deleteServer(userId, serverId) {
    const server = this.data.servers[serverId];
    if (!server || server.userId !== userId || server.deletedAt) {
      return { ok: false, error: "not_found" };
    }
    server.deletedAt = nowIso();
    server.updatedAt = server.deletedAt;
    this.persist();
    const { tokenHash, ...publicServer } = server;
    return { ok: true, server: publicServer };
  }

  authenticateServer(serverId, token) {
    const server = this.data.servers[serverId];
    if (!server || server.deletedAt) return null;
    if (!token || hashToken(token) !== server.tokenHash) return null;
    return server;
  }
}

module.exports = {
  PillarStore,
  createServerToken,
  hashToken
};
