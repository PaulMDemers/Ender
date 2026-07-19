# Architecture: Developer Addendum

Use [`docs/architecture/overview.md`](../docs/architecture/overview.md) for the maintained system overview. This file is the short code-navigation map.

## Boot and shutdown

`src/server.js` loads configuration, constructs projects, memories, tasks, workflows, schedules, the task ledger, code-server, Pillar/Beacon connectors, and self-update, then composes the Express app. `src/runtime/shutdown.js` coordinates bounded shutdown across HTTP intake, recurring work, connectors, active task runs, and editor sessions.

## API composition

`src/api/app.js` owns shared middleware, dependency composition, code-server proxy wiring, and terminal errors. Domain routers own public endpoints:

- `src/api/routes/systemRoutes.js`
- `src/api/routes/contextRoutes.js`
- `src/api/routes/automationRoutes.js`
- `src/api/routes/taskLedgerRoutes.js`
- `src/api/routes/taskRoutes.js`

`src/api/taskSchemas.js` owns primary task request validation. `src/api/http.js` owns consistent JSON error responses. `src/api/access.js` enforces direct API and WebSocket exposure policy.

## Task boundary

`TaskManager` remains the public lifecycle coordinator. It delegates to:

- `TaskExecutionRunner` for workspace/profile preparation and runtime invocation;
- `TaskApprovalCoordinator` for pending approval state and resolution;
- `JsonTaskRepository` for versioned task-record storage;
- `taskLifecycle.js` for transition policy and outcome mapping;
- `taskRecord.js` for record serialization and migration.

Do not move SSE ordering, subscriber cleanup, or terminal publication into a persistence or execution collaborator.

## Persisted state

Versioned local records cover tasks, projects, memories, schedules, task-ledger entries, interactive workflow sessions, editor sessions, checkpoints, and JSON-backed cloud-service fallback state. Scheduled workflow replays are ephemeral. See [`PERSISTENCE.md`](../PERSISTENCE.md).

## Frontend boundary

`ui/src/App.jsx` composes domain hooks and page-level transitions. Server connection, task collection, logs, workflows/schedules, task ledger, and editor lifecycle have separate hooks. UI ownership and response/retry contracts live in [`FRONTEND_ARCHITECTURE.md`](../FRONTEND_ARCHITECTURE.md).

## Compatibility boundaries

- Public REST and SSE metadata: [`API_CONTRACTS.md`](../API_CONTRACTS.md)
- Persisted record versions: [`PERSISTENCE.md`](../PERSISTENCE.md)
- Shared workflow/schedule schema: `shared/contracts.json` and `src/shared/contracts.js`
- Typechecked runtime slice: [`TYPECHECKING.md`](../TYPECHECKING.md)
