# Repository Map

## Top level

- `src/`: API, runtime, persistence, tools, workflows, Pillar, Beacon, and self-update
- `ui/`: React operator console and Electron packaging
- `tests/`: Node backend, lifecycle, contract, persistence, and boundary tests
- `e2e/`: Playwright operator-flow and visual coverage
- `scripts/`: launchers, versioning, environment smokes, and documentation validation
- `shared/`: workflow/schedule contracts shared by backend and UI
- `docs/`: maintained operator, deployment, reference, and architecture documentation
- `knowledge/`: developer continuity addendum
- `threads/`, `projects/`, `memories/`, `schedules/`, `task-ledger/`, `workflow-sessions/`: default local state

## Backend hotspots

- Composition: `src/server.js`, `src/api/app.js`
- API routers: `src/api/routes/`
- Validation and HTTP errors: `src/api/taskSchemas.js`, `src/api/http.js`
- Access policy: `src/api/access.js`
- Lifecycle coordinator: `src/runtime/taskManager.js`
- Extracted task boundaries: `taskExecutionRunner.js`, `taskApprovalCoordinator.js`, `jsonTaskRepository.js`, `taskLifecycle.js`, `taskRecord.js`
- Model/tool execution: `src/runtime/runTask.js`, `src/runtime/runAgentLoop.js`
- Automation: `src/workflows/`, `src/runtime/scheduleManager.js`, `src/runtime/taskLedgerManager.js`
- Record envelopes/migrations: `src/persistence/jsonRecord.js`
- Shutdown: `src/runtime/shutdown.js`
- Readiness: `src/health/readiness.js`

## Frontend hotspots

- Composition and navigation: `ui/src/App.jsx`, `ui/src/navigation.js`
- API/SSE client: `ui/src/agentClient.js`
- Domain state: `ui/src/hooks/`
- Page/surface components: `ui/src/components/`
- Shared UI primitives: `ui/src/components/ui/`
- Tokens and layout: `ui/src/design-tokens.css`, `ui/src/styles.css`
- Electron boundary: `ui/electron/main.cjs`, `ui/electron/preload.cjs`

## Verification hotspots

- Backend suite: `tests/*.test.js`
- Browser suite: `e2e/tests/*.spec.js`
- Visual baselines: adjacent `*-snapshots/` directories
- Release smokes: `scripts/release-environment-smoke.mjs`, `scripts/electron-smoke.mjs`
- Docs gate: `scripts/check-docs.mjs`

For public behavior, start with [`docs/README.md`](../docs/README.md) rather than inferring it from this map.
