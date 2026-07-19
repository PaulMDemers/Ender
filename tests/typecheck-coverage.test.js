const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const REQUIRED_TYPECHECK_FILES = [
  "src/api/access.js",
  "src/api/app.js",
  "src/api/codeServerProxy.js",
  "src/api/http.js",
  "src/api/routes/automationRoutes.js",
  "src/api/routes/contextRoutes.js",
  "src/api/routes/systemRoutes.js",
  "src/api/routes/taskLedgerRoutes.js",
  "src/api/routes/taskRoutes.js",
  "src/api/taskSchemas.js",
  "src/config.js",
  "src/persistence/jsonRecord.js",
  "src/runtime/jsonTaskRepository.js",
  "src/runtime/shutdown.js",
  "src/runtime/taskApprovalCoordinator.js",
  "src/runtime/taskExecutionRunner.js",
  "src/runtime/taskLifecycle.js",
  "src/runtime/taskManager.js",
  "src/runtime/taskRecord.js",
  "src/shared/apiContracts.js",
  "src/shared/contracts.js",
  "src/utils/abort.js",
  "src/workflows/workflowManager.js"
];

test("core runtime and API modules remain in the JavaScript typecheck boundary", async () => {
  const root = path.resolve(__dirname, "..");
  const tsconfig = JSON.parse(await fs.readFile(path.join(root, "tsconfig.json"), "utf8"));
  const included = new Set(tsconfig.include || []);

  assert.equal(included.size, tsconfig.include.length, "tsconfig include entries should be unique");
  assert.deepEqual(
    REQUIRED_TYPECHECK_FILES.filter((file) => !included.has(file)),
    [],
    "required typechecked modules must remain included"
  );

  for (const file of REQUIRED_TYPECHECK_FILES) {
    const source = await fs.readFile(path.join(root, file), "utf8");
    assert.match(source, /^\/\/ @ts-check\s/, `${file} must opt into JavaScript checking`);
  }
});
