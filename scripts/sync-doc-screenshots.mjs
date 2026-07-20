import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = path.join(rootDir, "docs", "website", "screenshots");

const mappings = [
  ["e2e/tests/app-shell.spec.js-snapshots/app-shell-chromium-darwin.png", "console-overview.png"],
  ["e2e/tests/thread-view.spec.js-snapshots/thread-transcript-chromium-darwin.png", "hero-thread-view.png"],
  ["e2e/tests/app-shell.spec.js-snapshots/app-shell-chromium-darwin.png", "new-task-full.png"],
  ["e2e/tests/thread-view.spec.js-snapshots/approval-card-chromium-darwin.png", "approval-thread-view.png"],
  ["e2e/tests/workflows.spec.js-snapshots/workflow-list-chromium-darwin.png", "workflow-list.png"],
  ["e2e/tests/workflows.spec.js-snapshots/workflow-form-state-chromium-darwin.png", "workflow-step-view.png"],
  ["e2e/tests/schedules.spec.js-snapshots/schedule-editor-open-chromium-darwin.png", "schedule-manager-view.png"],
  ["e2e/tests/schedules.spec.js-snapshots/schedule-panel-chromium-darwin.png", "schedule-ledger-detail.png"]
];

fs.mkdirSync(screenshotDir, { recursive: true });

for (const [sourceRelative, destinationName] of mappings) {
  const source = path.join(rootDir, sourceRelative);
  const destination = path.join(screenshotDir, destinationName);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing visual baseline: ${sourceRelative}`);
  }
  fs.copyFileSync(source, destination);
  console.log(`${sourceRelative} -> docs/website/screenshots/${destinationName}`);
}
