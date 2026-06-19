const crypto = require("node:crypto");
const { Pool } = require("pg");

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createServerToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
}

function rowToServer(row = {}) {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name || null,
    publicBaseUrl: row.public_base_url || null,
    beaconServerId: row.beacon_server_id || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    deletedAt: row.deleted_at instanceof Date ? row.deleted_at.toISOString() : row.deleted_at || null
  };
}

function rowToDevice(row = {}) {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    label: row.label || null,
    pushToken: row.push_token || null,
    endpoint: row.endpoint || null,
    keys: row.keys || null,
    appVersion: row.app_version || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    deletedAt: row.deleted_at instanceof Date ? row.deleted_at.toISOString() : row.deleted_at || null
  };
}

function rowToNotification(row = {}) {
  return {
    id: row.id,
    userId: row.user_id,
    serverId: row.server_id,
    type: row.type,
    title: row.title,
    body: row.body || null,
    taskId: row.task_id || null,
    threadId: row.thread_id || null,
    url: row.url || null,
    data: row.data || {},
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at || null,
    deletedAt: row.deleted_at instanceof Date ? row.deleted_at.toISOString() : row.deleted_at || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    deviceCount: Number(row.device_count || 0),
    deliveries: row.deliveries || [],
    deliveryUpdatedAt: row.delivery_updated_at instanceof Date
      ? row.delivery_updated_at.toISOString()
      : row.delivery_updated_at || null
  };
}

function normalizeServer(input = {}) {
  return {
    displayName: String(input.displayName || input.name || "").trim() || null,
    publicBaseUrl: input.publicBaseUrl ? String(input.publicBaseUrl).trim() : null,
    beaconServerId: input.beaconServerId ? String(input.beaconServerId).trim() : null
  };
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

class CloudPostgresStore {
  constructor({ databaseUrl, service = "beacon", pool = null } = {}) {
    if (!databaseUrl && !pool) throw new Error("database_url_required");
    this.service = service;
    this.pool = pool || new Pool({ connectionString: databaseUrl });
    this.initialized = false;
    this.initPromise = null;
  }

  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    await this.initPromise;
    this.initialized = true;
  }

  async _init() {
    await this.pool.query(`
      create table if not exists ender_cloud_servers (
        id text primary key,
        user_id text not null,
        display_name text,
        public_base_url text,
        beacon_server_id text,
        pillar_token_hash text,
        beacon_token_hash text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      );

      create index if not exists idx_ender_cloud_servers_user_id
        on ender_cloud_servers(user_id)
        where deleted_at is null;

      create table if not exists ender_cloud_devices (
        id text primary key,
        user_id text not null,
        platform text not null,
        label text,
        push_token text,
        endpoint text,
        keys jsonb,
        app_version text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      );

      create index if not exists idx_ender_cloud_devices_user_id
        on ender_cloud_devices(user_id)
        where deleted_at is null;

      create table if not exists ender_cloud_notifications (
        id text primary key,
        user_id text not null,
        server_id text not null,
        type text not null,
        title text not null,
        body text,
        task_id text,
        thread_id text,
        url text,
        data jsonb not null default '{}'::jsonb,
        read_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz not null default now(),
        device_count integer not null default 0,
        deliveries jsonb not null default '[]'::jsonb,
        delivery_updated_at timestamptz
      );

      create index if not exists idx_ender_cloud_notifications_user_created
        on ender_cloud_notifications(user_id, created_at desc)
        where deleted_at is null;
    `);
  }

  async ensureInit() {
    await this.init();
  }

  tokenColumn() {
    return this.service === "pillar" ? "pillar_token_hash" : "beacon_token_hash";
  }

  tokenPrefix() {
    return this.service === "pillar" ? "plr" : "bcn";
  }

  async listServers(userId) {
    await this.ensureInit();
    const result = await this.pool.query(
      `select * from ender_cloud_servers
       where user_id = $1 and deleted_at is null
       order by updated_at desc`,
      [userId]
    );
    return result.rows.map(rowToServer);
  }

  async getServerForUser(userId, serverId) {
    await this.ensureInit();
    const result = await this.pool.query(
      `select * from ender_cloud_servers
       where id = $1 and user_id = $2 and deleted_at is null`,
      [serverId, userId]
    );
    return result.rows[0] ? rowToServer(result.rows[0]) : null;
  }

  async upsertServer(user, input = {}) {
    await this.ensureInit();
    const requestedId = String(input.serverId || "").trim();
    if (!requestedId) return { ok: false, error: "server_id_required" };
    const normalized = normalizeServer(input);
    const tokenColumn = this.tokenColumn();

    const existingResult = await this.pool.query("select * from ender_cloud_servers where id = $1", [requestedId]);
    const existing = existingResult.rows[0] || null;
    if (existing && existing.user_id !== user.id) {
      return { ok: false, error: "server_id_in_use" };
    }

    const token = existing && existing[tokenColumn] ? null : createServerToken(this.tokenPrefix());
    const tokenHash = token ? hashToken(token) : existing?.[tokenColumn];
    const result = await this.pool.query(
      `insert into ender_cloud_servers (
         id, user_id, display_name, public_base_url, beacon_server_id,
         ${tokenColumn}, created_at, updated_at, deleted_at
       )
       values ($1, $2, $3, $4, $5, $6, now(), now(), null)
       on conflict (id) do update set
         display_name = excluded.display_name,
         public_base_url = coalesce(excluded.public_base_url, ender_cloud_servers.public_base_url),
         beacon_server_id = coalesce(excluded.beacon_server_id, ender_cloud_servers.beacon_server_id),
         ${tokenColumn} = coalesce(excluded.${tokenColumn}, ender_cloud_servers.${tokenColumn}),
         updated_at = now(),
         deleted_at = null
       returning *`,
      [
        requestedId,
        user.id,
        normalized.displayName,
        normalized.publicBaseUrl,
        normalized.beaconServerId,
        tokenHash
      ]
    );
    return { ok: true, server: rowToServer(result.rows[0]), token };
  }

  async rotateServerToken(userId, serverId) {
    await this.ensureInit();
    const token = createServerToken(this.tokenPrefix());
    const result = await this.pool.query(
      `update ender_cloud_servers
       set ${this.tokenColumn()} = $1, updated_at = now()
       where id = $2 and user_id = $3 and deleted_at is null
       returning *`,
      [hashToken(token), serverId, userId]
    );
    if (!result.rows[0]) return { ok: false, error: "not_found" };
    return { ok: true, server: rowToServer(result.rows[0]), token };
  }

  async deleteServer(userId, serverId) {
    await this.ensureInit();
    const result = await this.pool.query(
      `update ender_cloud_servers
       set deleted_at = now(), updated_at = now()
       where id = $1 and user_id = $2 and deleted_at is null
       returning *`,
      [serverId, userId]
    );
    if (!result.rows[0]) return { ok: false, error: "not_found" };
    return { ok: true, server: rowToServer(result.rows[0]) };
  }

  async authenticateServer(serverId, token) {
    await this.ensureInit();
    const result = await this.pool.query(
      `select * from ender_cloud_servers
       where id = $1 and deleted_at is null`,
      [serverId]
    );
    const server = result.rows[0];
    if (!server) return null;
    const expected = server[this.tokenColumn()];
    if (!token || !expected || hashToken(token) !== expected) return null;
    return rowToServer(server);
  }

  async listDevices(userId) {
    await this.ensureInit();
    const result = await this.pool.query(
      `select * from ender_cloud_devices
       where user_id = $1 and deleted_at is null
       order by updated_at desc`,
      [userId]
    );
    return result.rows.map(rowToDevice);
  }

  async upsertDevice(user, input = {}) {
    await this.ensureInit();
    const requestedId = input.deviceId ? String(input.deviceId).trim() : "";
    const id = requestedId || `dev_${crypto.randomUUID()}`;
    const existing = await this.pool.query("select user_id from ender_cloud_devices where id = $1", [id]);
    if (existing.rows[0] && existing.rows[0].user_id !== user.id) {
      return { ok: false, error: "device_id_in_use" };
    }

    const device = normalizeDevice(input);
    const result = await this.pool.query(
      `insert into ender_cloud_devices (
         id, user_id, platform, label, push_token, endpoint, keys, app_version,
         created_at, updated_at, deleted_at
       )
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now(), now(), null)
       on conflict (id) do update set
         platform = excluded.platform,
         label = excluded.label,
         push_token = excluded.push_token,
         endpoint = excluded.endpoint,
         keys = excluded.keys,
         app_version = excluded.app_version,
         updated_at = now(),
         deleted_at = null
       returning *`,
      [
        id,
        user.id,
        device.platform,
        device.label,
        device.pushToken,
        device.endpoint,
        JSON.stringify(device.keys),
        device.appVersion
      ]
    );
    return { ok: true, device: rowToDevice(result.rows[0]) };
  }

  async deleteDevice(userId, deviceId) {
    await this.ensureInit();
    const result = await this.pool.query(
      `update ender_cloud_devices
       set deleted_at = now(), updated_at = now()
       where id = $1 and user_id = $2 and deleted_at is null
       returning *`,
      [deviceId, userId]
    );
    if (!result.rows[0]) return { ok: false, error: "not_found" };
    return { ok: true, device: rowToDevice(result.rows[0]) };
  }

  async listNotifications(userId, { limit = 100, unreadOnly = false } = {}) {
    await this.ensureInit();
    const cappedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const result = await this.pool.query(
      `select * from ender_cloud_notifications
       where user_id = $1 and deleted_at is null
         and ($2::boolean = false or read_at is null)
       order by created_at desc
       limit $3`,
      [userId, Boolean(unreadOnly), cappedLimit]
    );
    return result.rows.map(rowToNotification);
  }

  async createNotification({ userId, serverId, event = {}, deviceCount = 0, deliveries = [] }) {
    await this.ensureInit();
    const id = `ntf_${crypto.randomUUID()}`;
    const result = await this.pool.query(
      `insert into ender_cloud_notifications (
         id, user_id, server_id, type, title, body, task_id, thread_id, url,
         data, created_at, device_count, deliveries
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(), $11, $12::jsonb)
       returning *`,
      [
        id,
        userId,
        serverId,
        String(event.type || "event").trim(),
        String(event.title || "Ender notification").trim(),
        String(event.body || event.message || "").trim() || null,
        event.taskId ? String(event.taskId).trim() : null,
        event.threadId ? String(event.threadId).trim() : null,
        event.url ? String(event.url).trim() : null,
        JSON.stringify(event.data && typeof event.data === "object" ? event.data : {}),
        Number(deviceCount) || 0,
        JSON.stringify(deliveries)
      ]
    );
    return rowToNotification(result.rows[0]);
  }

  async updateNotificationDeliveries(notificationId, deliveries = []) {
    await this.ensureInit();
    const result = await this.pool.query(
      `update ender_cloud_notifications
       set deliveries = $1::jsonb,
           device_count = $2,
           delivery_updated_at = now()
       where id = $3 and deleted_at is null
       returning *`,
      [JSON.stringify(deliveries), deliveries.length, notificationId]
    );
    if (!result.rows[0]) return { ok: false, error: "not_found" };
    return { ok: true, notification: rowToNotification(result.rows[0]) };
  }

  async markNotificationRead(userId, notificationId) {
    await this.ensureInit();
    const result = await this.pool.query(
      `update ender_cloud_notifications
       set read_at = coalesce(read_at, now())
       where id = $1 and user_id = $2 and deleted_at is null
       returning *`,
      [notificationId, userId]
    );
    if (!result.rows[0]) return { ok: false, error: "not_found" };
    return { ok: true, notification: rowToNotification(result.rows[0]) };
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = {
  CloudPostgresStore,
  createServerToken,
  hashToken
};
