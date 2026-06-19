#!/usr/bin/env node

import crypto from "node:crypto";
import process from "node:process";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { CloudPostgresStore } from "../src/cloud/postgresStore.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.CLOUD_DATABASE_URL || "";

if (!databaseUrl) {
  console.log("Skipping cloud Postgres smoke: set TEST_DATABASE_URL or CLOUD_DATABASE_URL to run it.");
  process.exit(0);
}

const schema = `ender_smoke_${crypto.randomUUID().replace(/-/g, "")}`;
const quotedSchema = `"${schema}"`;
const adminPool = new Pool({ connectionString: databaseUrl });
const smokePool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schema}`
});

try {
  await adminPool.query(`create schema ${quotedSchema}`);

  const user = { id: "user-smoke", email: "smoke@example.com" };
  const pillarStore = new CloudPostgresStore({ service: "pillar", pool: smokePool });
  const beaconStore = new CloudPostgresStore({ service: "beacon", pool: smokePool });
  await pillarStore.init();
  await beaconStore.init();

  const pillarRegistered = await pillarStore.upsertServer(user, {
    serverId: "home",
    displayName: "Home Ender",
    beaconServerId: "home"
  });
  assert.equal(pillarRegistered.ok, true);
  assert.match(pillarRegistered.token, /^plr_/);

  const beaconRegistered = await beaconStore.upsertServer(user, {
    serverId: "home",
    displayName: "Home Ender",
    publicBaseUrl: "https://pillar.ender.bot/api/home"
  });
  assert.equal(beaconRegistered.ok, true);
  assert.match(beaconRegistered.token, /^bcn_/);

  const pillarAuth = await pillarStore.authenticateServer("home", pillarRegistered.token);
  const beaconAuth = await beaconStore.authenticateServer("home", beaconRegistered.token);
  assert.equal(pillarAuth.id, "home");
  assert.equal(beaconAuth.id, "home");

  const servers = await beaconStore.listServers(user.id);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].id, "home");
  assert.equal(servers[0].publicBaseUrl, "https://pillar.ender.bot/api/home");

  const deviceResult = await beaconStore.upsertDevice(user, {
    deviceId: "phone-1",
    platform: "ios",
    pushToken: "push-token",
    label: "Smoke phone"
  });
  assert.equal(deviceResult.ok, true);

  const notification = await beaconStore.createNotification({
    userId: user.id,
    serverId: "home",
    event: {
      type: "approval_required",
      title: "Approval required",
      body: "Smoke notification",
      taskId: "task-1",
      data: { smoke: true }
    },
    deviceCount: 1,
    deliveries: []
  });
  assert.equal(notification.type, "approval_required");
  assert.equal(notification.data.smoke, true);

  const deliveryResult = await beaconStore.updateNotificationDeliveries(notification.id, [{
    deviceId: "phone-1",
    platform: "ios",
    provider: "apns",
    status: "sent",
    providerMessageId: "apns-smoke",
    updatedAt: new Date().toISOString()
  }]);
  assert.equal(deliveryResult.ok, true);
  assert.equal(deliveryResult.notification.deliveries[0].status, "sent");

  const readResult = await beaconStore.markNotificationRead(user.id, notification.id);
  assert.equal(readResult.ok, true);
  assert.ok(readResult.notification.readAt);

  console.log(`Cloud Postgres smoke passed in schema ${schema}.`);
} finally {
  await smokePool.end().catch(() => {});
  await adminPool.query(`drop schema if exists ${quotedSchema} cascade`).catch(() => {});
  await adminPool.end().catch(() => {});
}
