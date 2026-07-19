# Ender Release Candidate Review

This artifact packages the accumulated modernization work for review without staging, committing, pushing, or publishing it. It records the worktree observed on 2026-07-18; rerun the inventory before acting if the tree changes.

## Candidate snapshot

- Branch: `dev`
- Base: `e1d27ac` (`origin/dev`, `Added pillar server`)
- Tracked files modified: 79
- Untracked candidate files: 68
- Total candidate paths: 147
- Deleted paths: 0
- Tracked text delta: 6,304 insertions and 10,321 deletions, excluding untracked files and binary snapshot size changes
- Visual baselines: 6 modified PNGs and 2 new PNGs

The size reflects an integrated A–F modernization rather than one isolated feature. Review it by subsystem in the order below.

## Review inventory

| Review slice | Modified | New | Total | Primary purpose |
| --- | ---: | ---: | ---: | --- |
| Configuration and shared contracts | 4 | 0 | 4 | API exposure, Docker behavior, versioned contracts, and typecheck coverage |
| Dependencies and lockfiles | 4 | 0 | 4 | Patched backend/frontend dependencies, exact Electron pin, and synchronized locks |
| Backend source | 21 | 17 | 38 | Lifecycle safety, domain routers, execution/approval/persistence boundaries, migrations, contracts, shutdown, and connector compatibility |
| Backend tests | 3 | 10 | 13 | API, lifecycle, approval, persistence, security, contract, and typecheck regression coverage |
| Frontend source | 18 | 19 | 37 | Navigation, domain hooks, design system, operator flows, diagnostics, editor, and responsive/accessibility behavior |
| Browser tests and snapshots | 11 | 10 | 21 | Operator, automation, ledger, connection, editor, responsive, focus, polling, and visual coverage |
| Release and validation tooling | 0 | 4 | 4 | Isolated test API, local release smoke, Electron smoke, and documentation validation |
| Documentation and continuity | 18 | 8 | 26 | Architecture/contracts, release evidence, operator guidance, troubleshooting, and WNP continuity |
| **Total** | **79** | **68** | **147** | |

No candidate path was left unexplained by these slices. That is a scope-coherence finding, not proof of authorship: because all work is uncommitted against one base, Git cannot distinguish edits made by different people or sessions. Review the actual diff before publication.

## Milestone mapping

- A: task execution correctness, validation/errors, cancellation/shutdown, API exposure, and regression safety.
- B: route, execution, approval, lifecycle, persistence, contract-version, migration, and typecheck boundaries.
- C: frontend navigation, domain-state extraction, design tokens/primitives, responsive rules, and progressive disclosure.
- D: launch, transcript, approval, recovery, thread navigation, and editor experience.
- E: workflow, schedule, task-ledger, and server-diagnostics administration.
- F: accessibility/polling/visual consolidation, environment smokes, dependency remediation, and documentation consolidation.

[`ROADMAP.md`](ROADMAP.md) contains the detailed completed-milestone evidence. [`RELEASE_READINESS.md`](RELEASE_READINESS.md) separates local evidence from target-owner checks.

## Highest-risk review areas

1. Task lifecycle and terminal ordering: `src/runtime/taskManager.js`, `taskLifecycle.js`, `taskExecutionRunner.js`, `taskApprovalCoordinator.js`, `jsonTaskRepository.js`, and their focused tests.
2. Compatibility boundaries: `src/api/routes/`, `src/api/taskSchemas.js`, `src/shared/apiContracts.js`, `shared/contracts.json`, `API_CONTRACTS.md`, and frontend contract tracking.
3. Record migration and non-overwrite guarantees: `src/persistence/jsonRecord.js`, all migrated managers/stores, `PERSISTENCE.md`, and persistence tests.
4. Frontend ownership and retry behavior: `ui/src/App.jsx`, `ui/src/hooks/`, automation/ledger/editor components, and `FRONTEND_ARCHITECTURE.md`.
5. Dependency and packaging graph: root/UI manifests and lockfiles, Electron main process, renderer CSP, Docker boundaries, and smoke scripts.
6. Intentional visual changes: inspect all 8 changed/new PNG baselines alongside the matching Playwright assertions.

## Excluded local state

The following ignored paths were observed and must not be staged:

- `.env`: local configuration and possible credentials;
- `ui/dist/`: Vite/Electron build and packaged-app output;
- `playwright-report/` and `test-results/`: generated browser-test output.

Runtime persistence directories, supervisor state, dependencies, and other build/report directories are already ignored by `.gitignore`; continue excluding them even if they appear later.

The candidate scan found no high-confidence API key/private-key patterns outside ignored environment files and no certificate/key-store filenames. This is a narrow automated check, not a replacement for reviewing staged content before commit.

## Publication recommendation

Prefer one atomic integration commit for the current candidate. The backend contracts, frontend client, root scripts, dependency locks, release smokes, documentation gate, and consolidated docs were developed and verified as one integrated state. Splitting the existing dirty tree ad hoc would create intermediate states that have not been tested and would require fragile partial staging of `package.json` and lockfile changes.

Suggested commit subject:

```text
Modernize Ender runtime and operator console
```

Review the single candidate in these passes before staging:

1. configuration, dependencies, and shared contracts;
2. backend source and backend tests;
3. frontend source, browser tests, and visual baselines;
4. release tooling and environment boundaries;
5. documentation and continuity records.

If curated history is mandatory, reconstruct it on a temporary branch into backend/contracts, frontend/operator experience, release/dependency hardening, and documentation commits. Run the full gate after every reconstructed commit; do not assume the conceptual slices above are independently green.

## Required pre-publication checks

Before any commit or push:

- inspect `git diff` and every untracked candidate path;
- confirm the 8 visual baselines are intentional;
- confirm `.env` and generated/ignored output remain unstaged;
- run `git diff --check` and `npm run verify`;
- run both npm audits and the locally supported release smoke;
- record any target-owner evidence completed since [`RELEASE_READINESS.md`](RELEASE_READINESS.md) was last updated.

## G1 verification evidence

The candidate was revalidated after this review artifact was added:

- `npm audit --omit=dev`: 0 vulnerabilities;
- `npm audit`: 0 vulnerabilities across the complete dependency graph;
- `npm run smoke:release:local`: direct API, built UI assets, real local legacy Pillar relay, contract metadata, isolated shutdown, and temporary-state cleanup passed;
- `npm run verify`: version synchronization, documentation checks across 54 Markdown files, 118 backend tests, targeted typechecking, syntax checks, production UI build, and 41 Playwright tests passed.

G1 performed no Git mutation. Under the product owner's subsequent explicit G2 authorization, the reviewed candidate was placed on `codex/modernization-release-candidate`, staged exactly, revalidated, and recorded in one local atomic commit. It has not been pushed, tagged, opened as a PR, merged, or published.
