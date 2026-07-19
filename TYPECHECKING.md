# JavaScript Typechecking

Ender uses TypeScript as a static checker for selected JavaScript modules. Runtime code remains CommonJS JavaScript; typechecking must not require a transpilation step or change emitted behavior.

## Current policy

- `tsconfig.json` keeps `allowJs: true`, `checkJs: false`, `noEmit: true`, and `strict: false`.
- Every checked JavaScript file opts in with `// @ts-check` and is listed explicitly in `tsconfig.json`.
- New diagnostics are resolved with narrow runtime guards or local JSDoc types. Avoid broad casts that merely suppress a mismatch.
- `tests/typecheck-coverage.test.js` keeps the agreed core boundary explicit and prevents files from silently losing their opt-in.

This incremental policy is intentional. Enabling repository-wide `checkJs` currently pulls in provider and tool integrations with dependency-specific type gaps. Those modules should be added in coherent cohorts so each integration can be verified without weakening the useful checks already in place.

## Checked boundary

The current boundary covers 23 modules:

- API composition and contracts: access control, application wiring, code-server proxying, HTTP helpers, request schemas, and all five domain routers.
- Task runtime: lifecycle policy, task records, repository, approval coordinator, execution runner, manager, and shutdown coordination.
- Shared infrastructure: configuration, shared contract loaders, API contract helpers, JSON persistence helpers, abort handling, and workflow management.

The exact file list lives in `tsconfig.json` and is asserted by `tests/typecheck-coverage.test.js`.

## Expanding coverage

For each new cohort:

1. Add `// @ts-check` to the selected modules.
2. Add their paths to `tsconfig.json`.
3. Run `npm run typecheck` and resolve the diagnostics at the narrowest boundary.
4. Run focused behavioral tests for the touched subsystem, followed by `npm run verify`.
5. Extend the coverage assertion when a module becomes part of the permanent core boundary.

Good future cohorts are provider/model adapters, runtime tools, and connector clients. Each should include tests that exercise its external dependency boundary without requiring real credentials.
