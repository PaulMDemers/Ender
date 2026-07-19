# Testing and Quality

## Core gates

- `npm test`: Node backend and boundary suite
- `npm run typecheck`: maintained targeted TypeScript boundary
- `npm run check`: syntax checks for production and smoke entrypoints
- `npm run docs:check`: maintained Markdown link and root-script references
- `npm run build`: production UI build
- `npm run test:e2e`: Playwright operator-flow and visual suite
- `npm run verify`: version, docs, backend, typecheck, syntax, build, and browser gates in one command

## Focused test selection

- API/router changes: `tests/task-api.test.js`, `tests/api-router-boundaries.test.js`, `tests/api-contracts.test.js`
- Task lifecycle/execution/approval: `tests/task-lifecycle.test.js`, `tests/task-execution-runner.test.js`, `tests/task-approval-coordinator.test.js`, `tests/lifecycle-security.test.js`
- Persistence: `tests/task-repository.test.js`, `tests/persistence-contracts.test.js`
- Runtime/tools: `tests/tool-runtime-regressions.test.js`
- Pillar/Beacon: `tests/pillar.test.js`, related contract tests
- UI state/flows: the matching file under `e2e/tests/`
- Frontend ownership rules and suite map: [`FRONTEND_ARCHITECTURE.md`](../FRONTEND_ARCHITECTURE.md)

## Release/environment gates

- `npm run smoke:release:local`: direct API, built browser assets, and real local legacy Pillar relay
- `npm run smoke:electron`: installed Electron renderer/preload boundary
- `npm run electron:pack` plus `npm run smoke:electron:packaged`: current-platform unpacked app
- Docker and target-owner commands: [`RELEASE_READINESS.md`](../RELEASE_READINESS.md)

## Change expectations

Run the smallest focused test while iterating, then `npm run verify` before closing a broad milestone. Update a visual baseline only after inspecting the rendered change. When a contract or persisted shape changes, add current, legacy, malformed, and unsupported-future coverage as applicable.
