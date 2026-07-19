import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiRoot = path.join(repoRoot, "ui");
const requireFromUi = createRequire(path.join(uiRoot, "package.json"));

async function resolveRuntime() {
  if (!process.argv.includes("--packaged")) {
    return { executable: requireFromUi("electron"), args: [uiRoot] };
  }

  const candidates = process.platform === "darwin"
    ? [path.join(uiRoot, "dist", "mac-arm64", "Ender UI.app", "Contents", "MacOS", "Ender UI")]
    : process.platform === "win32"
      ? [path.join(uiRoot, "dist", "win-unpacked", "Ender UI.exe")]
      : [
        path.join(uiRoot, "dist", "linux-unpacked", "ender-ui"),
        path.join(uiRoot, "dist", "linux-unpacked", "Ender UI")
      ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return { executable: candidate, args: [] };
    } catch {
      // Try the next platform-specific electron-builder output name.
    }
  }
  throw new Error(`Packaged Electron executable not found. Checked: ${candidates.join(", ")}`);
}

async function main() {
  await fs.access(path.join(uiRoot, "dist", "index.html"));
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ender-electron-smoke-"));
  try {
    const runtime = await resolveRuntime();
    const child = spawn(runtime.executable, [...runtime.args, `--user-data-dir=${dataRoot}`], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ENDER_ELECTRON_SMOKE: "1",
        ELECTRON_ENABLE_LOGGING: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });

    const result = await Promise.race([
      new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
      new Promise((resolve) => setTimeout(() => resolve(null), 20_000))
    ]);
    if (!result) {
      child.kill("SIGKILL");
      throw new Error(`Electron smoke timed out\n${output}`);
    }
    assert.equal(result.code, 0, `Electron exited with ${result.code ?? result.signal}\n${output}`);
    assert.match(output, /ENDER_ELECTRON_SMOKE_OK/, `Electron did not report renderer readiness\n${output}`);
    console.log(output.trim());
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
