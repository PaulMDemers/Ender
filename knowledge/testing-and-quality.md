# Testing and Quality

## Package scripts

From root `package.json`:

- `npm run dev` — starts API and UI together
- `npm run start` — starts backend only
- `npm run start:supervised` — starts external supervisor + child backend
- `npm test` — backend regression tests via Node test runner
- `npm run typecheck` — TypeScript check
- `npm run check` — syntax checks for key backend files
- `npm run build` — UI build
- `npm run verify` — full verification: tests + typecheck + syntax + build + e2e
- `npm run test:e2e` — Playwright end-to-end tests

## Test suite layout

### `tests/group1-bugs.test.js`

Covers:

- rerun preserving original goal after follow-up prompts
- `schedule_config` repo step deferring clone
- `scheduled_run` repo step auto-renaming occupied directories
- interactive repo step collision errors
- GitHub auth header injection during clone

### `tests/group2-runtime.test.js`

Covers:

- workflow session persistence and reload
- non-persistence of `scheduled_run` sessions
- schedule last-run persistence
- task restart interruption behavior
- approval flow resuming task execution

### `tests/group3-contracts.test.js`

Covers:

- shared enum definitions
- workflow-backed schedule schema validation
- workflow session schema validation

### `tests/self-update.test.js`

Covers:

- checkpoint creation and rollback
- refusal to checkpoint dirty repos
- rollback on verify failure
- rollback on unhealthy restart after apply

## Quality expectations inferred from repo

- backend behavior is regression-tested for workflow/schedule/self-update edge cases
- shared contracts are treated as important compatibility boundaries between backend and UI
- `npm run verify` is the intended high-confidence gate before restart or release
- self-update flows assume verification before promotion

## Useful operational checks

When changing backend/runtime behavior, likely relevant checks are:

- `npm test`
- `npm run typecheck`
- `npm run check`

When changing UI or shared contracts, also run:

- `npm run build`
- possibly `npm run test:e2e`

When changing self-update behavior, inspect:

- `tests/self-update.test.js`
- `scripts/ender-supervisor.js`
- `src/selfUpdate/*`

## Known contract boundaries

Be careful when changing:

- `shared/contracts.json`
- `src/shared/contracts.js`
- workflow step payload shapes
- schedule target payload shapes
- task SSE event names used by the UI
