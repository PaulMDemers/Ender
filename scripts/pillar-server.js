#!/usr/bin/env node

require("dotenv").config();

const { createPillarApp, loadPillarConfig } = require("../src/pillar/server");

async function main() {
  const config = loadPillarConfig(process.env);
  const app = createPillarApp(config);
  app.listen(config.port, () => {
    console.log(`Ender Pillar listening on http://localhost:${config.port}`);
    console.log(`requestTimeoutMs=${config.requestTimeoutMs} pollTimeoutMs=${config.pollTimeoutMs}`);
  });
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
