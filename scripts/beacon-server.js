#!/usr/bin/env node

require("dotenv").config();

const { createBeaconApp, loadBeaconConfig } = require("../src/beacon/server");

async function main() {
  const config = loadBeaconConfig(process.env);
  const app = await createBeaconApp(config);
  app.listen(config.port, () => {
    console.log(`Ender Beacon listening on http://localhost:${config.port}`);
    console.log(`publicUrl=${config.publicUrl || "n/a"} issuer=${config.issuer || "n/a"}`);
  });
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
