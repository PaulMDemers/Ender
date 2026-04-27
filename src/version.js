const fs = require("node:fs");
const path = require("node:path");

function readVersion() {
  try {
    return fs.readFileSync(path.resolve(__dirname, "..", "VERSION"), "utf8").trim();
  } catch {
    return require("../package.json").version;
  }
}

const APP_NAME = "Ender";
const APP_VERSION = readVersion();

module.exports = { APP_NAME, APP_VERSION };
