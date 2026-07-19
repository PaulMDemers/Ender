# Developer Troubleshooting Addendum

Operators should use [`docs/guides/troubleshooting.md`](../docs/guides/troubleshooting.md). This addendum maps symptoms to current code and focused tests.

## Server boot or shutdown

Inspect `src/config.js`, `src/server.js`, `src/runtime/shutdown.js`, and the first terminal stack. Use `npm run check` for syntax and `tests/lifecycle-security.test.js` for access, cancellation, and shutdown behavior.

## API behavior or response drift

Start at the owning router under `src/api/routes/`, not only `src/api/app.js`. Shared response helpers live in `src/api/http.js`; primary task validation lives in `src/api/taskSchemas.js`; exposure policy lives in `src/api/access.js`. Compare `ui/src/agentClient.js` and [`API_CONTRACTS.md`](../API_CONTRACTS.md).

Focused suites: `tests/task-api.test.js`, `tests/api-router-boundaries.test.js`, and `tests/api-contracts.test.js`.

## Task lifecycle, approval, or termination

Inspect `src/runtime/taskManager.js`, `taskLifecycle.js`, `taskExecutionRunner.js`, `taskApprovalCoordinator.js`, and `jsonTaskRepository.js` according to ownership. Check transition legality and terminal publication order before changing a status assignment.

Focused suites: `tests/task-lifecycle.test.js`, `tests/task-execution-runner.test.js`, `tests/task-approval-coordinator.test.js`, `tests/task-repository.test.js`, and `tests/lifecycle-security.test.js`.

## Model or tool execution

Inspect `src/runtime/runTask.js`, `runAgentLoop.js`, the selected backend in `src/llm/`, and the exact tool module. A repeated call/result fingerprint ends as `stall_detected`; termination should propagate through the run's abort signal.

Focused suite: `tests/tool-runtime-regressions.test.js`.

## Persisted record fails after restart

Check the warning emitted while loading, the manager-specific serializer, and `src/persistence/jsonRecord.js`. Never “repair” an unsupported future-version record by overwriting it. Add legacy, current, malformed, future-version, and round-trip coverage as applicable. See [`PERSISTENCE.md`](../PERSISTENCE.md).

Focused suites: `tests/persistence-contracts.test.js` and `tests/task-repository.test.js`.

## Workflow, schedule, or ledger behavior

- Workflows: `src/workflows/workflowManager.js`, the definition, `shared/contracts.json`, and `ui/src/hooks/useAutomations.js`
- Schedules: `src/runtime/scheduleManager.js` and `ui/src/hooks/useAutomations.js`
- Task ledger: `src/runtime/taskLedgerManager.js`, `src/api/routes/taskLedgerRoutes.js`, and `ui/src/hooks/useTaskLedger.js`

Use the matching Node tests plus `e2e/tests/workflows.spec.js`, `schedules.spec.js`, `automation-*.spec.js`, or `task-ledger-*.spec.js`.

## UI state or retry drift

Use [`FRONTEND_ARCHITECTURE.md`](../FRONTEND_ARCHITECTURE.md) to find the owning hook. Check whether the operation retains inputs, records the exact failed action, exposes a retry, and refreshes through the owning collection boundary. For polling issues, inspect `ui/src/hooks/visiblePolling.js` and verify hidden/foreground behavior.

Run the smallest matching Playwright file and inspect any visual difference before updating snapshots.

## Editor behavior

Backend ownership is `src/runtime/codeServerManager.js` plus `src/api/codeServerProxy.js`; frontend ownership is `ui/src/hooks/useThreadEditor.js` and `ui/src/components/ThreadEditor.jsx`. Separate “no active session” from an unavailable capability. Docker-mode failures also require checking host-workspace mapping and Docker socket policy.

Focused browser suite: `e2e/tests/editor-lifecycle.spec.js`.

## Pillar, Beacon, or cloud persistence

Inspect the service/client/store under `src/pillar/` or `src/beacon/` and shared Postgres logic under `src/cloud/`. Keep legacy local smoke evidence separate from production OIDC/TLS/Postgres claims. See [`RELEASE_READINESS.md`](../RELEASE_READINESS.md).

## Self-update

Confirm supervised startup, exact self-root workspace, clean checkpoint constraints, verification command, bounded restart health, and rollback result. Inspect `scripts/ender-supervisor.js`, `src/selfUpdate/`, and `tests/self-update.test.js`.

## Final gate

After the focused suite passes, run:

```bash
npm run docs:check
npm run verify
```
