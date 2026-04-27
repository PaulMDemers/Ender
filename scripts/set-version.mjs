import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const files = {
  version: path.join(rootDir, "VERSION"),
  rootPackage: path.join(rootDir, "package.json"),
  rootLock: path.join(rootDir, "package-lock.json"),
  uiPackage: path.join(rootDir, "ui", "package.json"),
  uiLock: path.join(rootDir, "ui", "package-lock.json"),
  uiVersionModule: path.join(rootDir, "ui", "src", "version.js")
};

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readSourceVersion() {
  return (await fs.readFile(files.version, "utf8")).trim();
}

function assertVersion(value) {
  if (!versionPattern.test(value)) {
    throw new Error(`Expected a semantic version like 0.1.1, received: ${value}`);
  }
}

async function collectVersions() {
  const rootPackage = await readJson(files.rootPackage);
  const rootLock = await readJson(files.rootLock);
  const uiPackage = await readJson(files.uiPackage);
  const uiLock = await readJson(files.uiLock);
  const uiVersionModule = await fs.readFile(files.uiVersionModule, "utf8").catch(() => "");

  return {
    VERSION: await readSourceVersion(),
    "package.json": rootPackage.version,
    "package-lock.json": rootLock.version,
    "package-lock.json packages.\"\"": rootLock.packages?.[""]?.version,
    "ui/package.json": uiPackage.version,
    "ui/package-lock.json": uiLock.version,
    "ui/package-lock.json packages.\"\"": uiLock.packages?.[""]?.version,
    "ui/src/version.js": uiVersionModule.match(/APP_VERSION = "([^"]+)"/)?.[1] || ""
  };
}

async function checkVersions() {
  const versions = await collectVersions();
  const expected = versions.VERSION;
  assertVersion(expected);
  const mismatches = Object.entries(versions).filter(([, value]) => value !== expected);
  if (mismatches.length) {
    const details = mismatches.map(([name, value]) => `${name}: ${value || "(missing)"}`).join("\n");
    throw new Error(`Version files are out of sync with VERSION=${expected}:\n${details}`);
  }
  console.log(`All components are on version ${expected}`);
}

async function setVersion(version) {
  assertVersion(version);

  const rootPackage = await readJson(files.rootPackage);
  const rootLock = await readJson(files.rootLock);
  const uiPackage = await readJson(files.uiPackage);
  const uiLock = await readJson(files.uiLock);

  rootPackage.version = version;
  rootLock.version = version;
  if (rootLock.packages?.[""]) rootLock.packages[""].version = version;
  uiPackage.version = version;
  uiLock.version = version;
  if (uiLock.packages?.[""]) uiLock.packages[""].version = version;

  await fs.writeFile(files.version, `${version}\n`, "utf8");
  await writeJson(files.rootPackage, rootPackage);
  await writeJson(files.rootLock, rootLock);
  await writeJson(files.uiPackage, uiPackage);
  await writeJson(files.uiLock, uiLock);
  await fs.writeFile(
    files.uiVersionModule,
    `export const APP_NAME = "Ender";\nexport const APP_VERSION = "${version}";\n`,
    "utf8"
  );

  await checkVersions();
}

const [, , arg] = process.argv;

try {
  if (arg === "--check") {
    await checkVersions();
  } else if (arg) {
    await setVersion(arg);
  } else {
    console.error("Usage: node scripts/set-version.mjs <version> | --check");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message || String(err));
  process.exitCode = 1;
}
