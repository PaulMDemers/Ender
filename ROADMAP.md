# Ender Modernization Roadmap

This file is the continuity artifact for the WNP Loop modernization effort. Code remains the source of truth; update this roadmap after each meaningful milestone.

## Objectives

1. Stabilize, secure, and simplify the server backend.
2. Deliver a more professional and intuitive operator interface without removing advanced capabilities.

## Milestones

### A. Backend correctness and safety net

Status: complete

- [x] Restore and test non-ACP model-backed task execution.
- [x] Standardize task API validation and error responses.
- [x] Define graceful shutdown and real task cancellation behavior.
- [x] Clarify local and remote API security configuration.
- [x] Expand runtime, persistence, restart, and malformed-input coverage.

### B. Backend boundaries and contracts

Status: complete

- [x] Split API routes by domain.
- [x] Separate task persistence.
- [x] Separate task execution.
- [x] Separate task approvals.
- [x] Centralize task-state transitions and event publication.
- [x] Version task records.
- [x] Version remaining persisted records.
- [x] Version shared API/SSE contracts.
- [x] Expand typechecking across the runtime.

### C. Frontend architecture and design system

Status: complete

- [x] Establish navigation and page-level information architecture.
- [x] Extract domain state from `App.jsx`.
  - [x] Server connection, health, profiles, and projects.
  - [x] Thread collection, selection, logs, and local UI metadata.
  - [x] Workflows, schedules, and task-ledger entries.
- [x] Introduce shared design tokens and accessible UI primitives.
- [x] Define responsive behavior and progressive disclosure for advanced controls.

### D. Primary operator experience

Status: complete

- [x] Clarify task launch, follow-up, and approval information hierarchy.
- [x] Improve thread navigation and transcript readability.
- [x] Improve loading, empty, offline, and failure states.
- [x] Redesign editor surfaces and responsive transitions.
- [x] Preserve model, memory, workspace, and project controls.

### E. Automation and administration experience

Status: complete

- [x] Redesign workflow and schedule administration.
- [x] Redesign task-ledger administration and execution outcomes.
- [x] Redesign server management, readiness, and version visibility.

### F. Consolidation and release readiness

Status: complete

- [x] Complete accessibility, responsive, performance, and visual-regression passes.
- [x] Verify browser, Electron, Docker, direct-local, and Pillar-connected operation.
- [x] Align architecture, operator, and troubleshooting documentation.

## Completed milestones

### A1. Restore non-ACP model execution

Completed: 2026-07-18

- `runTask` now constructs the configured chat model before entering the standard LangChain loop.
- The model factory is injectable for deterministic runtime tests.
- A regression test exercises model creation, tool binding, and finalization without a provider call.

Verification:

- `node --test tests/tool-runtime-regressions.test.js`
- `npm run typecheck`
- `npm run check`

All three checks passed.

### A2. Standardize the task API boundary

Completed: 2026-07-18

- Added reusable JSON error and Zod request-parsing helpers.
- Added strict schemas for task creation, continuation content, approval decisions, deletion options, and log cursors.
- Migrated primary task and code-server errors to a consistent `{ ok, error, message, details? }` envelope while retaining existing error codes and status behavior.
- Updated the frontend client to expose server error messages, codes, statuses, and validation details.
- Added focused task API integration tests for valid, malformed, and manager-error paths.
- Isolated the Playwright API launcher from the developer `.env` port and refreshed stale UI baselines and selectors.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 67 backend tests, targeted typechecking, syntax checks, UI production build, and 5 Playwright tests.

### A3. Make lifecycle and direct API exposure explicit

Completed: 2026-07-18

- Task termination now aborts active model calls, LangChain tools, ACP sessions, and shell subprocess groups instead of only changing persisted/UI state.
- Graceful `SIGINT`/`SIGTERM` handling stops HTTP intake, schedules, ledger polling, Pillar long-polls, active task runs, and thread-scoped code-server sessions within a bounded cleanup window.
- Interrupted tasks retain their existing restart semantics: user termination stays terminal, while server-shutdown interruption is recovered according to the configured auto-restart policy.
- Direct API and WebSocket access defaults to loopback clients through `ENDER_API_ACCESS_MODE=local`; `open` is an explicit deployment choice.
- Browser origins are constrained by access mode and `ENDER_CORS_ORIGINS`. Pillar remains the authenticated remote-access path.
- Docker Compose explicitly opts into direct open access because host-forwarded traffic is not loopback inside the API container, and documents the deployment-boundary requirement.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 73 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B1. Split the API into domain routers

Completed: 2026-07-18

- Reduced `src/api/app.js` to shared middleware, dependency composition, proxy wiring, and terminal error handling.
- Extracted system/runtime, projects/memory, automation, task-ledger, and task/editor route modules.
- Kept all existing public paths, methods, response/status behavior, SSE handling, and code-server HTTP/WebSocket proxy wiring.
- Added a complete 46-route REST/SSE inventory assertion plus cross-domain behavior tests for late-bound connector status, projects/memory, workflow/schedule, ledger conflicts, editor lifecycle, proxy errors, and task streams.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 77 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B2. Centralize task lifecycle transitions and event publication

Completed: 2026-07-18

- Added a single task-status policy defining active and terminal states, allowed transitions, continuation paths, and runtime-outcome mapping.
- Routed execution, approval, termination, deletion, continuation, and restart recovery through `TaskManager._transitionTask` instead of assigning statuses ad hoc.
- Centralized approval-required and terminal event publication, including task notifications and subscriber cleanup.
- Standardized terminal ordering as status publication, persistence, `complete` SSE, waiter resolution, notification, and subscriber close.
- Preserved compatibility for unknown legacy source statuses when resuming them into a known state, while rejecting unknown target states and invalid known-state transitions.
- Added focused transition-table and event-order tests for completion, approval, termination, continuation, and restart behavior.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 82 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B3. Extract and version task persistence

Completed: 2026-07-18

- Added an injectable JSON task repository responsible for directory setup, sorted record loading, serialized writes, atomic temp-file replacement, deletion, and queue flushing.
- Removed direct thread-file reads, writes, deletes, and persistence queue ownership from `TaskManager`.
- Added `recordVersion: 1` to persisted task records and a sequential migration mechanism that upgrades legacy unversioned records during load.
- Preserved the existing restart and auto-resume behavior while rewriting valid legacy records in the current format.
- Future-version, malformed, unsafe-ID, and filename/record-ID-mismatched records are skipped with warnings rather than overwritten.
- Added repository tests for round trips, concurrent queued writes, atomic temp cleanup, queue recovery after failure, deletion, malformed files, migration, injected storage, and restart integration.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 89 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B4. Extract task execution orchestration

Completed: 2026-07-18

- Added an injectable `TaskExecutionRunner` responsible for project-workspace preparation, LLM-profile configuration resolution, and invoking the task runtime with its required dependencies.
- Kept task lifecycle transitions, persistence, logs, approval publication, terminal event ordering, and subscriber management in `TaskManager`.
- Added active-run identity guards so a superseded runner cannot publish stale logs, request approvals, replace the workspace, or overwrite the newer run's result or error.
- Preserved cancellation checks before and after asynchronous workspace preparation and immediately before runtime execution.
- Added focused runner tests for successful, blocked, needs-input, error, cancellation, and project-preparation paths, plus TaskManager tests for outcome mapping and superseded-run races.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 95 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B5. Extract task approval coordination

Completed: 2026-07-18

- Added an injectable `TaskApprovalCoordinator` responsible for approval creation, decision settlement, listing, hydration, and rejecting all pending decisions.
- Kept approval lifecycle transitions, logs, persistence scheduling, SSE publication, and notifications in `TaskManager`.
- Routed task summaries, task detail responses, SSE replay, persistence serialization, and restart hydration through the coordinator boundary.
- Superseding a run now rejects and removes approvals owned by the old run before the replacement begins, preventing unresolved decisions and stale continuation.
- Termination, deletion, shutdown, and interrupted-task recovery consistently reject and clear outstanding approvals.
- Added deterministic tests for multiple approvals, approval and denial, missing decisions, hydration, termination, shutdown, interrupted restart, and superseded-run behavior.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 100 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B6. Version the remaining JSON persistence contracts

Completed: 2026-07-18

- Inventoried every application-owned JSON persistence family and documented ownership, locations, exclusions, and the format-change policy in `PERSISTENCE.md`.
- Added a shared version registry and sequential migration mechanism for workflow sessions, schedules, task-ledger entries, projects, memories, Beacon state, Pillar state, code-server sessions, and self-update checkpoints.
- All current disk records now use `recordVersion: 1`; legacy unversioned records migrate and rewrite on successful load.
- Future-version and malformed records are rejected without being downgraded or overwritten.
- Kept disk-only version metadata out of REST responses, runtime summaries, connector state objects, code-server summaries, and checkpoint results.
- Classified LLM profiles and bundled shared contracts as operator/static configuration rather than mutable persistence, and kept PostgreSQL-backed connector storage under its SQL schema boundary.
- Hardened the schedule visual assertion with a narrowly bounded pixel tolerance for reproducible native-select antialiasing differences.
- Added parameterized contract tests plus restart/round-trip integration coverage across all nine newly versioned record families.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 113 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B7. Version shared REST and task-SSE contracts

Completed: 2026-07-18

- Added shared REST and task-SSE contract definitions to `shared/contracts.json`, with server helpers for consistent headers and event formatting.
- Every direct API response now advertises `X-Ender-API-Version: 1`; CORS exposes the header to browser clients without changing response bodies.
- Direct task streams advertise `X-Ender-SSE-Version: 1` and begin with an additive `contract` event before status, replayed logs and approvals, live events, or completion.
- Pillar preserves the direct API version header on relayed responses and emits the same contract metadata on synthesized task streams.
- Added a frontend contract tracker that accepts missing legacy metadata, recognizes supported versions, and reports newer versions without blocking requests or streams.
- Documented REST/SSE payloads, compatibility behavior, and version-change policy in `API_CONTRACTS.md`.
- Added shared, direct API, replay/live SSE, Pillar relay/synthesis, CORS, and frontend legacy/current/newer compatibility tests.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 116 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### B8. Expand JavaScript typechecking across the core backend

Completed: 2026-07-18

- Expanded the explicit `// @ts-check` boundary from 3 to 23 JavaScript modules without adding a runtime compilation step.
- Covered API composition, all domain routers, request and response helpers, task lifecycle, execution, approval, persistence, shutdown, shared contracts, configuration, workflow management, and abort handling.
- Moved the API contract import to the normal module dependency boundary and made abort helpers safely narrow unknown errors and optional signals.
- Added a coverage guard that keeps the core file list and per-file opt-ins synchronized with `tsconfig.json`.
- Documented the incremental checking policy and future cohort workflow in `TYPECHECKING.md`.
- Kept repository-wide `checkJs` deferred: provider and tool integrations need dependency-specific declarations and focused behavioral coverage before joining the checked boundary.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 117 backend tests, typechecking, syntax checks, UI production build, and 5 Playwright tests.

### C1. Establish frontend information architecture and application shell

Completed: 2026-07-18

- Added a single ordered navigation model for new threads, workflows, schedules, and the task ledger.
- Replaced the collapsed launch-mode disclosure with a persistent, compact workspace navigation that reports the current destination.
- Extracted the outer responsive frame into `ApplicationShell` while intentionally leaving server, thread, workflow, schedule, ledger, and editor state in `App.jsx`.
- Added stable navigation and main-content landmarks, a skip link, an accessible mobile trigger, a proper scrim control, and Escape dismissal.
- Preserved the offline-first server picker, standalone ledger view, thread selection, editor surfaces, API calls, polling, and local-storage behavior.
- Documented frontend boundaries and the state-extraction sequence in `FRONTEND_ARCHITECTURE.md`.
- Added focused browser coverage for navigation state, keyboard focus, and mobile dismissal while retaining connected-empty and offline states.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 117 backend tests, typechecking, syntax checks, UI production build, and 7 Playwright tests.

### C2. Extract server connection and runtime-catalog state

Completed: 2026-07-18

- Added `useServerConnection` as the owner of active and saved endpoints, connection readiness, errors, loading, health, profiles, projects, and reconnect notices.
- Moved the existing 15-second health and runtime-catalog polls behind the hook without changing API client behavior or local-storage keys.
- Kept task data in `App.jsx` and reduced the cross-domain contract to task-list success, failure, initial-load completion, and a reconnect refresh callback.
- Centralized connect, favorite, remove, and project-refresh operations while preserving the connected-once gate and server-switch resets.
- Added reconnect timer cleanup and retained the latest refresh callback without restarting server polls when `App.jsx` renders.
- Added deterministic browser coverage for unreachable saved servers, returning to idle, server switching, catalog replacement and refresh, disconnect detection, and reconnect-driven task refresh.
- Updated `FRONTEND_ARCHITECTURE.md` with the extracted boundary and remaining state ownership.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 117 backend tests, typechecking, syntax checks, UI production build, and 10 Playwright tests.

### C3. Extract thread collection and selection state

Completed: 2026-07-18

- Added `useTaskThreads` as the owner of collection polling, refresh, selection, server-scoped UI metadata, pagination, and active/archive/pin projections.
- Preserved the 3-second polling cadence, connected-once reachability signals, newest-thread fallback rules, and `ender_task_ui_state` storage contract.
- Replaced direct collection setters in `App.jsx` with explicit reset, select, append, update, remove-state, pin, archive, scope-toggle, load-more, and refresh operations.
- Kept launch, continuation, rerun, termination, deletion, workflow and ledger handoffs, transcript streaming, approvals, and editor behavior in their existing ownership boundaries.
- Connected server recovery to the latest collection refresh through a ref, avoiding circular hook ownership or poll restarts.
- Added deterministic browser coverage for pagination, pinned ordering, archiving, persistence, cross-server isolation, selection preservation, poll failures, and recovery fallback.
- Updated `FRONTEND_ARCHITECTURE.md` with the collection boundary and remaining state groups.

Verification:

- `npm run verify`

The complete gate passed: version synchronization, 117 backend tests, typechecking, syntax checks, UI production build, and 13 Playwright tests.

### C4. Extract workflow and schedule state

Completed: 2026-07-18

- Added `useAutomations` as the owner of workflow discovery, interactive session state, saved-session recovery, step advance/back/reset, schedule discovery, and schedule mutations.
- Preserved the server-keyed `ender_workflow_sessions` storage contract and fixed initial null state so it no longer erases a recoverable session before the workflow view opens.
- Kept task launch and run-now handoffs explicit: the hook returns mutation results and `App.jsx` refreshes and selects through the thread collection boundary.
- Removed workflow and schedule API calls, polling effects, persistence helpers, and domain setters from `App.jsx`.
- Added focused browser coverage for saved interactive-session recovery while retaining the workflow and schedule visual and interaction suites.

Verification:

- `npm run test:e2e -- e2e/tests/workflows.spec.js e2e/tests/schedules.spec.js e2e/tests/automation-state.spec.js`
- `npm --workspace ui run build`

Both checks passed.

### C5. Extract task-ledger state

Completed: 2026-07-18

- Added `useTaskLedger` as the owner of entry state, visible-ledger polling, errors, busy state, and create, run, delete, refresh, and reset operations.
- Preserved the 3-second polling cadence in both the main console and standalone ledger view.
- Guarded polling responses against committing after their owning effect has been cleaned up.
- Kept task collection refresh and selected-thread handoff in `App.jsx` as explicit cross-domain operations.
- Added deterministic browser coverage for creation, collection refresh, and the advanced-control disclosure.

Verification:

- `npm run test:e2e -- e2e/tests/task-ledger-state.spec.js`
- `npm --workspace ui run build`

Both checks passed.

### C6. Introduce shared design tokens and accessible primitives

Completed: 2026-07-18

- Moved the shared palette, surfaces, radii, shadows, spacing, focus, control, and motion values into `design-tokens.css` without changing the established visual theme.
- Added reusable disclosure and status primitives and adopted them across server state, application headers, the offline picker, and thread-entry details.
- Standardized visible keyboard focus, polite connection-state announcements, disclosure state, controlled-content relationships, reduced motion, and coarse-pointer targets.
- Retained the existing intentional desktop visual baseline.

Verification:

- `npm run test:e2e -- e2e/tests/app-shell.spec.js`
- `npm --workspace ui run build`

Both checks passed.

### C7. Define responsive behavior and progressive disclosure

Completed: 2026-07-18

- Documented the 980-pixel navigation/workspace collapse and 720-pixel stacked-control behavior as the frontend responsive contract.
- Kept advanced task-ledger inputs available behind an explicit, tested disclosure rather than removing them from smaller or simpler views.
- Added a 390-pixel viewport assertion that guards document-level horizontal overflow while preserving access to primary content and mobile navigation.
- Documented editor split, modal, and stacked behavior as an intentionally retained capability for the Phase D thread redesign.

Verification:

- `npm run test:e2e -- e2e/tests/app-shell.spec.js e2e/tests/task-ledger-state.spec.js`
- `npm run verify`

The focused checks passed. The complete repository gate passed after all Phase C changes.

### D1. Clarify launch, follow-up, and approval hierarchy

Completed: 2026-07-18

- Kept the mission goal, project, and workspace as the primary task-launch path while moving backend and memory tuning into a concise run-settings disclosure.
- Added an always-visible summary of the selected backend and memory behavior so collapsed settings remain inspectable rather than hidden state.
- Applied the same pattern to follow-up messages, preserving profile, memory, attachment, keyboard-submit, and multimodal behavior in a smaller composer footprint.
- Removed the duplicated approval banner and full approval card in favor of one sticky, assertive, labelled decision surface.
- Added semantic transcript labelling and polite live progress/empty announcements.
- Added interaction coverage proving collapsed launch and follow-up settings survive submission, approvals render once and block follow-ups, and server catalog changes remain visible through the disclosure.
- Refreshed the intentional launch and transcript visual baselines after direct inspection.

Verification:

- `npm run test:e2e -- e2e/tests/operator-launch.spec.js e2e/tests/app-shell.spec.js e2e/tests/thread-view.spec.js e2e/tests/server-connection.spec.js`
- `npm run verify`

The focused checks and complete repository gate passed.

### D2. Improve thread navigation and transcript readability

Completed: 2026-07-18

- Added server-scoped thread search across goals, IDs, statuses, workspaces, projects, and profiles before pagination, with result counts and an explicit clear action.
- Strengthened selected-thread presentation with a semantic current marker, a visible selection rail, approval attention badges, and a labelled Details disclosure.
- Added a Conversation transcript view that prioritizes user/assistant messages, tool groups, approvals, warnings, errors, successful state changes, and final responses.
- Kept every runtime event available through All activity and added a visible count plus direct Show all action whenever routine events are suppressed.
- Preserved collapsible tool groups, raw markdown/payload views, run details, timestamp ordering, and automatic scroll behavior.
- Limited prose line length, hardened wrapping for unbroken content, and verified a long assistant response at a 390-pixel viewport.
- Added deterministic coverage for search-before-pagination, selected-thread semantics, filter reversibility, responsive containment, and single-surface approvals.
- Refreshed and inspected the intentional Conversation transcript visual baseline.

Verification:

- `npm run test:e2e -- e2e/tests/thread-view.spec.js e2e/tests/thread-collection.spec.js`
- `npm --workspace ui run build`
- `npm run verify`

The focused checks and complete repository gate passed.

### D3. Standardize primary-path state and recovery feedback

Completed: 2026-07-18

- Added a shared accessible state-notice primitive with neutral, warning, success, and danger tones, polite/assertive announcements, compact presentation, and optional recovery actions.
- Replaced passive connection, reconnect, thread-sync, launch, follow-up, empty-transcript, and editor-unavailable messages with consistent titles and diagnostic detail.
- Corrected health transition tracking so the first successful health check is not announced as a reconnection, while genuine disconnect/recovery cycles remain visible.
- Failed task launches retain the mission and selected context, explain configuration failures, and expose an explicit Try again action.
- Failed follow-ups now remain in the composer with attachments and run settings intact, announce the server error, and retry in place instead of escaping as an unhandled event.
- Thread-list synchronization failures retain the server error and expose immediate retry through the thread collection boundary.
- Expected missing editor-session status no longer pollutes the action-error channel; genuinely unavailable editor capability is explained before the operator tries to launch it.
- Empty transcripts distinguish waiting for first activity from a filtered conversation with only routine events.
- Added deterministic browser coverage for failed launch recovery, failed follow-up recovery, connection loss/restoration, sync retry, empty transcript state, and unavailable editor guidance.
- Refreshed and inspected the intentional connected-shell status baseline.

Verification:

- `npm run test:e2e -- e2e/tests/operator-launch.spec.js e2e/tests/thread-view.spec.js e2e/tests/server-connection.spec.js e2e/tests/thread-collection.spec.js e2e/tests/app-shell.spec.js`
- `npm --workspace ui run build`
- `npm run verify`

The focused checks and complete repository gate passed.

### D4. Redesign the workspace editor lifecycle and surfaces

Completed: 2026-07-18

- Extracted session discovery, launch/stop mutations, iframe reachability, automatic reload, responsive transitions, credential copying, dock resizing, and surface state from `App.jsx` into `useThreadEditor`.
- Extracted docked, modal, and stacked presentation into shared editor components with one toolbar, connection-details surface, action-error treatment, and embedded-frame lifecycle.
- Distinguished starting a session, connecting the iframe, a connected editor, closing only the current view, and stopping the underlying session.
- Added explicit connection retry and new-tab escape actions while the iframe is waiting, without interrupting automatic reachability probes and reloads.
- Made connection details consistent across surfaces: workspace, mode, port, direct URL, and copyable password remain available through progressive disclosure.
- Preserved the resizable desktop dock, modal presentation, narrow transcript/editor tabs, Escape dismissal, direct-tab access, password copying, and responsive dock/modal/stacked transitions.
- Added stop-session access to every embedded surface rather than limiting it to the modal.
- Added deterministic browser coverage for launch failure recovery, successful launch and stop, close-versus-stop semantics, connection waiting and retry, iframe readiness, dock/modal/stacked transitions, Escape dismissal, credentials, and narrow-viewport containment.
- Added and visually inspected the intentional docked-editor baseline.

Verification:

- `npm run test:e2e -- e2e/tests/editor-lifecycle.spec.js e2e/tests/thread-view.spec.js e2e/tests/app-shell.spec.js`
- `npm --workspace ui run build`
- `npm run verify`

The focused checks and complete repository gate passed.

### E1. Redesign workflow and schedule administration

Completed: 2026-07-18

- Added workflow availability summaries and server-readiness states, keeping workflows with missing prerequisites visible and explaining the exact configuration they need.
- Reworked guided workflow sessions around explicit awaiting-input, processing, restored-session, completion, and recoverable failure states.
- Failed workflow discovery, start, advance, and back operations now retain their context and expose operation-specific retry actions.
- Added a recurring-operations overview with total, enabled, failed-latest-run, and never-run counts.
- Added client-side schedule validation for required labels and prompts, cron field shape, thread selection, workflow completion, and IANA timezone names before contacting the server.
- Fixed failed create/update behavior so the full schedule form remains intact and can retry in place instead of clearing operator input.
- Added operation-specific schedule loading, success, failure, and retry feedback for create, edit, run, enable/disable, delete, and collection reload.
- Fixed failed Run now behavior to refresh the schedule collection after the server persists an error, making the latest failure outcome visible immediately.
- Added quick enable/disable controls, progressively disclosed target details, and stronger latest-run outcome treatment while preserving workflow configuration, timezone, cron, and target controls.
- Added deterministic coverage for workflow catalog recovery and readiness, workflow-step retry, schedule validation and create retention, edit/run/delete recovery, persisted outcome refresh, quick disable, and narrow layouts.
- Refreshed and inspected the workflow list/step and schedule overview/workspace visual baselines.

Verification:

- `npm run test:e2e -- e2e/tests/workflows.spec.js e2e/tests/schedules.spec.js e2e/tests/automation-state.spec.js e2e/tests/automation-admin.spec.js`
- `npm --workspace ui run build`
- `npm run verify`

The focused checks and complete repository gate passed.

### E2. Redesign task-ledger administration and execution outcomes

Completed: 2026-07-18

- Added queue-health summaries for waiting, running, attention-required, and completed work, plus the server's auto-agent capacity and dispatch cadence.
- Reframed the default queue as operationally unresolved work, keeping failed, blocked, and input-required entries visible until an operator resolves or removes them.
- Added search plus status and task-type filters across titles, prompts, sources, workspaces, lifecycle stages, errors, and outcomes.
- Added scan-level lifecycle progress, latest-outcome treatment, attempt/source/workspace context, and progressively disclosed plans, criteria, verification evidence, and stage history.
- Preserved generic task creation and every advanced input while adding client validation, operation-specific progress, input retention, and exact create retry after failures.
- Separated background refresh from mutation identity so polling no longer flickers or disables the ledger interface.
- Fixed failed Run now behavior to refresh the ledger after the server persists a failed attempt, then restore the actionable mutation error and retry path.
- Added explicit create/run/delete result handling in `App.jsx`, including reliable thread handoff after a successful dispatch and a non-mutating delete-cancellation result.
- Rebuilt the isolated ledger around the same queue vocabulary, capacity, search, status filtering, outcome context, retained create retry, and linked-thread handoff.
- Added deterministic browser coverage for structured create retention, persisted dispatch failures, retry-to-thread handoff, source/outcome filtering, delete recovery, isolated-view handoff, and 390-pixel containment.
- Performed desktop and 390-pixel in-app visual QA; the isolated queue retained its hierarchy and had no document-level horizontal overflow.

Verification:

- `npm run test:e2e -- e2e/tests/task-ledger-state.spec.js e2e/tests/task-ledger-admin.spec.js`
- `npm run typecheck`
- `npm run build`
- `npm run verify`

The focused checks and complete repository gate passed. A transient Playwright web-server bootstrap timeout was cleared by retrying the browser matrix, which then passed without test failures.

### E3. Redesign server management, readiness, and version visibility

Completed: 2026-07-18

- Replaced binary online/offline presentation with explicit idle, checking, connected, and unavailable connection states across the shell, rail, header, modal, and saved endpoint rows.
- Preserved the last successful health snapshot during outages, added health-check timestamps and manual refresh, and kept runtime diagnostics visible with a clear stale-snapshot label.
- Added a shared diagnostics surface for UI/server versions, REST and task-stream contract compatibility, API exposure mode, workspace root, runtime backend, and eight core/optional capabilities.
- Surfaced warnings for server contracts newer than the UI and for direct remote API exposure, while keeping legacy or not-yet-observed contracts non-blocking.
- Made contract tracking reactive and reset observations when switching endpoints so version state cannot leak across servers.
- Added in-place HTTP/HTTPS endpoint validation, form retention, retry of the last failed target, saved/favorite counts, and connected/checking/unavailable saved-row states.
- Exposed connection and synchronization errors inside the server modal instead of only after it closes.
- Replaced generic header metadata with server version, runtime backend, and API-access mode, and aligned the rail version with the actual UI build.
- Corrected ACP health readiness so ACP servers report `ACP_COMMAND` requirements instead of falling through to false Azure credential warnings.
- Added deterministic coverage for initial retry/removal, endpoint switching, health polling and recovery, URL retention, newer-contract and open-exposure warnings, stale diagnostics, manual recovery, and 390-pixel modal containment.
- Refreshed and inspected the intentional application-shell baseline and performed desktop plus 390-pixel in-app visual QA of server diagnostics.

Verification:

- `node --test tests/lifecycle-security.test.js tests/api-contracts.test.js`
- `npm run test:e2e -- e2e/tests/server-connection.spec.js e2e/tests/app-shell.spec.js`
- `npm run typecheck`
- `npm run build`
- `npm run verify`

The focused checks and complete repository gate passed: version synchronization, 118 backend tests, typechecking, syntax checks, the production UI build, and 39 Playwright tests.

### F1. Consolidate accessibility, responsive behavior, performance, and visual-regression coverage

Completed: 2026-07-18

- Audited shell landmarks, skip navigation, live status/error regions, shared focus styling, reduced-motion behavior, coarse-pointer targets, completed-surface narrow-layout checks, and intentional visual baselines.
- Added one focus-containment contract for modal surfaces and the mobile navigation drawer, including deterministic initial focus, Tab/Shift+Tab wrapping, Escape dismissal, and focus restoration to the invoking control.
- Applied the shared contract to server management, the modal workspace editor, and off-canvas primary navigation while leaving docked and stacked editor behavior unchanged.
- Replaced independent recurring timers with a visibility-aware poller across health, runtime catalogs, threads, task-ledger entries, editor-session discovery, and editor reachability probes.
- Hidden documents now stop recurring timers and make no new polling requests; returning to a visible document refreshes immediately and restarts the existing cadence.
- Poll callbacks cannot overlap, and thread selection no longer restarts the task-collection timer solely because the selection changed.
- Added deterministic browser coverage for mobile-drawer focus, modal containment/restoration, editor-modal restoration, hidden polling suspension, immediate foreground refresh, and the existing 390-pixel containment contracts.
- Kept all visual baselines unchanged because the consolidation changes keyboard and background behavior without changing stable rendered states.

Verification:

- `npm run test:e2e -- e2e/tests/app-shell.spec.js e2e/tests/server-connection.spec.js e2e/tests/editor-lifecycle.spec.js`
- `npm run typecheck`
- `npm run verify`

The focused browser matrix and complete repository gate passed.

### F2. Verify the supported environment matrix

Completed: 2026-07-18

- Added an isolated production-entry smoke that launches the real direct-local API, fetches built browser assets, starts a real legacy-mode Pillar relay plus outbound Ender connector, verifies relayed contract metadata, shuts every child down, and deletes temporary state.
- Added self-terminating Electron smoke support for both the installed development runtime and the packaged application, verifying the renderer root and sandboxed preload bridge with temporary user data.
- Added a renderer Content Security Policy after the Electron smoke exposed the missing-policy security warning; the subsequent unpackaged and packaged smokes passed without that warning.
- Pinned Electron `41.2.1`, synchronized the workspace and standalone UI lockfiles, and repaired Docker's previously stale `npm ci` boundary.
- Built an unsigned macOS arm64 application with electron-builder `26.15.3` and successfully launched the packaged bundle; signing/notarization remains a release-owner check.
- Validated Docker Compose, built Linux arm64 API/UI images, confirmed zero-advisory clean installs in both image builds, served API health plus nginx UI assets on loopback-only ports, and auto-removed the temporary containers.
- Moved `concurrently` out of the production API graph and advanced Express, LangChain, IMAP, Nodemailer, and affected transitive packages to compatible patched releases.
- Reduced the npm audit result from 13 production advisories, including two critical findings, to zero production and zero complete-graph advisories; all 118 backend and 41 browser tests passed on the updated graph.
- Added `RELEASE_READINESS.md` with exact repeatable commands, isolation guarantees, local evidence, platform/credential boundaries, and release-owner checks.
- Recorded remaining target-environment work: signed/notarized installers, Windows/Linux native packages, Docker browser capture/code-server execution, deployed OIDC/Postgres Pillar, and provider-backed task smokes.

Verification:

- `npm run smoke:release:local`
- `npm run smoke:electron`
- `npm run electron:pack`
- `npm run smoke:electron:packaged`
- `docker compose config --quiet`
- `docker compose build`
- isolated `ender-api:latest` and `ender-ui:latest` container health/static-asset smokes
- `npm audit --omit=dev`
- `npm audit`
- `npm run verify`

The locally runnable browser, direct-local, Pillar, Electron, packaging, Docker, audit, and complete repository gates passed. Credential-, signing-, cloud-, and foreign-platform checks remain explicitly outside the local evidence boundary.

### F3. Consolidate the release-ready knowledge path

Completed: 2026-07-18

- Rebuilt `docs/README.md` as the maintained audience-based entry point for operators, extension work, architecture, deployment, troubleshooting, and release evidence.
- Added an operator troubleshooting guide that maps visible connection, readiness, launch, automation, ledger, editor, Docker, Pillar, Electron, and persistence symptoms to current UI diagnostics and commands.
- Reconciled the architecture overview, runtime persistence note, API/functionality inventory, first-task, Jira, schedule, desktop, Docker, and root API guidance with the extracted backend boundaries and redesigned frontend.
- Reduced duplicated and stale developer notes into a code-navigation addendum that points back to the canonical operator and release records.
- Explicitly labelled website copy, the UI backlog, and older planning notes as historical/non-authoritative when they conflict with code, tests, contracts, or release evidence.
- Added `npm run docs:check` to validate local links and referenced root npm scripts across maintained root, `docs/`, and `knowledge/` Markdown, and made it part of `npm run verify`.
- Proved the documentation gate's failure behavior with a temporary broken-link fixture, removed the fixture, and reran the clean gate.

Verification:

- `npm run docs:check`
- intentional broken-link fixture: failed with the expected missing-target diagnostic
- `npm run check`
- `git diff --check`
- `npm run verify`

The complete gate passed: synchronized version metadata, documentation validation across 53 Markdown files, 118 backend tests, targeted typechecking, syntax checks, the production UI build, and 41 Playwright tests.

### G1. Prepare a reviewable release candidate

Completed: 2026-07-18

- Inventoried the complete dirty worktree against `dev`/`e1d27ac`: 79 modified tracked files plus 68 untracked candidate files after adding the review artifact, with no deleted paths.
- Categorized all 147 candidate paths across configuration/contracts, dependencies, backend, backend tests, frontend, browser tests/snapshots, release tooling, and documentation; no path remained unexplained by milestones A–F.
- Identified ignored local `.env`, Vite/Electron build output, and Playwright report/result directories as explicit staging exclusions without reading or deleting them.
- Ran a narrow high-confidence API/private-key and sensitive-certificate filename scan outside ignored environment/build output; no candidate leak was found.
- Added `RELEASE_CANDIDATE_REVIEW.md` with review order, risk hotspots, milestone mapping, target exclusions, pre-publication checks, and an explicit no-Git-mutation boundary.
- Recommended one atomic integration commit because the cross-stack contracts, package scripts/locks, release tooling, and documentation gate have only been verified as one integrated state. Curated history would require reconstruction and a full gate after every intermediate commit.

Verification:

- `npm audit --omit=dev`
- `npm audit`
- `npm run smoke:release:local`
- `npm run verify`

Both dependency graphs reported zero vulnerabilities. The isolated direct API/UI/Pillar smoke passed, and the complete gate passed with documentation checks across 54 Markdown files, 118 backend tests, targeted typechecking, syntax checks, a production UI build, and 41 Playwright tests.

### G2. Create a guarded local release-candidate commit

Completed: 2026-07-18

- Reconfirmed `dev` at `e1d27ac` with exactly 79 modified and 68 untracked reviewed candidate paths before Git mutation.
- Created `codex/modernization-release-candidate` from that base and staged all 147 reviewed paths while leaving `.env`, `ui/dist/`, Playwright reports/results, dependencies, and runtime state ignored.
- Confirmed the index contains 147 paths, 15,310 insertions, 10,321 deletions, no deleted files, no unstaged changes, and no remaining non-ignored untracked files.
- Ran staged whitespace, high-confidence API/private-key, and sensitive certificate/environment filename checks. All were clean; `.env.example` was the only environment-shaped staged filename and contains the reviewed public template.
- Re-ran the complete verification gate against the exact staged candidate.
- Recorded the integrated candidate in this atomic local commit with subject `Modernize Ender runtime and operator console`.
- Did not push, tag, open a PR, merge, or publish a release.

Verification:

- staged inventory and ignored-state inspection
- `git diff --cached --check`
- staged high-confidence secret and sensitive-filename scans
- `npm run verify`

The exact staged candidate passed documentation checks across 54 Markdown files, all 118 backend tests, targeted typechecking, syntax checks, the production UI build, and all 41 Playwright tests.

### G3. Merge and publish the modernization baseline

Completed: 2026-07-18

- Confirmed the release-candidate worktree was clean and the local commit was exactly one commit ahead of `dev`.
- Fetched `origin/dev` and confirmed it remained at `e1d27ac`, identical to local `dev` and an ancestor of `7dcf67f`.
- Fast-forwarded local `dev` to the verified modernization commit without a conflict, merge commit, force update, or history rewrite.
- Used direct Git transport because the optional GitHub CLI/PR workflow is unavailable on this host and the product owner explicitly requested a direct merge and push rather than a pull request.
- The initial push attempt was blocked because the host had no available GitHub credential; the product owner subsequently pushed the prepared branch.
- Confirmed local `dev` and `origin/dev` now resolve to `5c3d355` with no divergence.
- Created no PR, tag, release artifact, merge action, or deployment beyond the requested branch update.

Verification:

- clean worktree and branch-topology inspection
- `git fetch origin dev`
- `git merge-base --is-ancestor origin/dev codex/modernization-release-candidate`
- fast-forward-only merge
- local/remote equality at `5c3d355`

### H1. Audit the current UI and define the simplification direction

Completed: 2026-07-18

- Audited the supplied connected launch-screen capture, current shell/navigation/launch implementation, design tokens, responsive rules, and deterministic visual baselines for the shell, transcript, workflows, schedules, and editor.
- Identified hierarchy rather than capability as the primary issue: repeated server state, duplicate launch framing, permanently expanded low-frequency configuration, an oversized navigation rail, and card/pill styling that gives routine metadata excessive prominence.
- Defined a work-first information hierarchy that keeps the current destination, active work, primary action, failures, approvals, and degraded readiness visible while moving healthy diagnostics and configuration behind contextual disclosure.
- Specified a compact 272- to 288-pixel rail, 56- to 64-pixel command bar, single-source server state, streamlined mission-first launch path, and on-demand run context.
- Defined a more mature charcoal-and-purple visual foundation with neutral body copy, restrained accent use, smaller radii, fewer pills/gradients/shadows, denser spacing, and a more neutral operational type treatment.
- Preserved multi-server, project/workspace, runtime/memory, readiness, self-update, workflows, schedules, ledger, editor, archive, responsive, keyboard, and accessibility capabilities as explicit redesign guardrails.
- Added `UI_AUDIT.md` with surface-by-surface recommendations, a proposed layout, measurable H2 acceptance criteria, and follow-on H3-H5 phases.
- Made no UI or runtime implementation changes in this audit milestone.

Verification:

- supplied screenshot inspection
- current source and deterministic browser-baseline inspection
- `npm run docs:check`
- `git diff --check`

### H2. Implement the work-first shell, launch path, and foundation tokens

Completed: 2026-07-18

- Reduced the expanded desktop rail from 360 to 280 pixels and its collapsed state from 44 to 48 pixels, replaced the 2-by-2 navigation cards with a compact vertical list, removed marketing copy and permanent server diagnostics, and moved archive scope into the thread collection toolbar.
- Replaced the expanded multi-row header with a 56-pixel command bar that presents one page/thread title and a single server target control; the target opens the existing full server manager and diagnostics in one interaction.
- Kept connection-loss and thread-synchronization notices exceptional and contextual instead of reserving permanent shell space for healthy state.
- Rebuilt the launch surface around the mission field, compact project/workspace and profile/memory summaries, progressive run-context and settings disclosures, the existing Enter/Shift+Enter behavior, and the primary Start action.
- Removed the duplicate launch hero, four-card diagnostic strip, and permanent Connected target panel while retaining project creation, workspace browsing, profiles, memory modes, readiness warnings, and unchanged launch payloads.
- Applied the mature charcoal-and-purple foundation: neutral system typography, neutral body copy, darker surface steps, restrained purple, smaller radii, fewer gradients, lower panel elevation, denser controls, and tighter working spacing.
- Fixed responsive transition and editor-toolbar overflow exposed during the redesign so long transcripts and stacked editors remain contained at 390 pixels.
- Added explicit browser contracts for the 1440-by-900 work-first geometry, hidden-by-default run context, project/workspace payload preservation, updated server-target interaction, and existing mobile containment.
- Refreshed and inspected the intentional shell, transcript, workflow, schedule, and editor baselines.
- Performed in-app visual QA against a disposable local API with isolated workspace/persistence directories and connectors, schedules, automatic ledger agents, and editor launching disabled; inspected the default desktop launch and collapsed/expanded 390-pixel launch states.

Verification:

- `npm run typecheck`
- `npm run build`
- focused shell, launch, server, thread-collection, transcript, and editor browser checks
- desktop and 390-pixel in-app visual QA
- complete `npm run test:e2e`: 43 tests passed
- `npm run verify`

### H3. Turn the thread and editor surfaces into a focused workstation

Completed: 2026-07-18

- Removed repeated thread ID, status, and workspace metadata from the transcript and follow-up composer; the command bar remains the single source for thread identity and scope.
- Replaced the transcript's nested card treatment with a quieter full-height work surface, consolidated event filtering into one compact toolbar, and kept routine events plus run metadata available on demand.
- Reduced the default follow-up composer to a concise settings summary, 58-pixel message field, horizontal attachment/send actions, and a single-line narrow layout while preserving profile, memory, attachments, retry behavior, and keyboard submission.
- Rebuilt approvals as a compact sticky decision surface with persistent Approve/Deny actions and a disclosure for request IDs, timestamps, and raw payloads; the blocked composer is now a thin paused-state bar.
- Made the editor viewport primary by moving passwords and connection metadata entirely behind the Connection disclosure, tightening dock/modal spacing, simplifying headings, and correcting the dock stacking order over the thread header.
- Added browser contracts for composer height, removal of repeated metadata, hidden approval payloads, hidden-by-default editor credentials, and narrow containment.
- Added and inspected explicit desktop composer, narrow composer, approval, transcript, and editor-dock visual baselines.
- Performed connected in-app QA against a disposable local API and an actual isolated failed ACP thread at the default desktop viewport and 390 by 844 pixels; the normal Ender workspace and persistence directories were not used.

Verification:

- `npm run typecheck`
- focused thread-view and editor-lifecycle browser checks
- desktop and 390-pixel connected in-app visual QA
- intentional visual-baseline refresh and inspection
- `npm run build`
- `npm run verify`

The complete gate passed: synchronized version metadata, documentation validation across 55 Markdown files, all 118 backend tests, typechecking, syntax checks, the production UI build, and all 43 Playwright tests.

### H4. Consolidate workflows, schedules, and the task ledger

Completed: 2026-07-19

- Added a shared collection header pattern that keeps the page purpose, attention-oriented counts, policy context, and primary actions in one compact operational bar instead of separate hero and metric cards.
- Reworked the workflow catalog into a full-width dense list, removed the permanently visible session-status side panel, and moved recoverable session metadata plus debug history into compact contextual surfaces.
- Made the schedule collection the default workspace and moved creation/editing behind New schedule and Edit actions; successful saves close the editor and return operators to the updated collection.
- Consolidated schedule status and run/edit/pause/delete controls into each row header while retaining target details and outcomes as contextual row content.
- Made the task-ledger queue the default surface, moved its structured entry composer behind New entry, and retained all source, workspace, criteria, constraint, verification, and auto-run controls within that contextual editor.
- Reduced default ledger-row density by moving the lifecycle rail, identifiers, workspace, feasibility, and verification metadata into Execution details; meaningful failure/running/completion outcomes remain prominent.
- Suppressed server-generated ledger request previews when they repeat the visible title verbatim and tightened the narrow filter layout so status and type remain side by side without horizontal overflow.
- Added browser contracts for hidden-by-default schedule and ledger editors, collection-first navigation, session-title continuity, lifecycle disclosure, retained failed form input, responsive containment, and updated action naming.
- Added and inspected collection, open-editor, workflow-step, and task-ledger visual baselines.
- Performed connected in-app QA against a disposable isolated API: inspected the real workflow catalog, created a real schedule and ledger entry through the UI, and verified the resulting desktop and 390-pixel collection/editor layouts without using the normal Ender persistence directories.

Verification:

- `npm run typecheck`
- 20 focused shell, workflow, schedule, automation, and task-ledger browser tests
- desktop and 390-pixel connected in-app visual QA
- intentional visual-baseline refresh and inspection
- `npm run build`
- `npm run verify`

The complete gate passed: synchronized version metadata, documentation validation across 55 Markdown files, all 118 backend tests, typechecking, syntax checks, the production UI build, and all 43 Playwright tests.

### H5. Complete cohesion, accessibility, and release validation

Completed: 2026-07-19

- Aligned command-bar page titles with the primary navigation names so destination identity stays concise and consistent at desktop, narrow, and zoomed layouts.
- Raised quiet metadata contrast above the 4.5-to-1 text threshold and deepened the operational purple used for primary actions so light button text also clears the threshold without losing Ender's color identity.
- Preserved the shared visible focus treatment across links, buttons, fields, summaries, and programmatic controls; confirmed the skip link, main-content target, mobile navigation trap, modal containment, and focus restoration behavior.
- Completed the mobile Transcript/Editor switcher as an accessible tab interface with controlled panels, roving tab stops, Arrow/Home/End keyboard navigation, and selected-panel focus continuity.
- Made busy notices expose `aria-busy`, retained polite/assertive live-region behavior for routine and error feedback, and verified the redesigned empty, loading, degraded, failure, retry, approval, and recovery states through the existing browser suite.
- Preserved 44-pixel control targets for coarse pointers and eliminated meaningful transitions and animations when reduced motion is requested.
- Added a 640-pixel layout contract as the working equivalent of a 1280-pixel viewport at 200-percent zoom, alongside the existing 390-pixel containment checks.
- Reflowed narrow empty-state actions beneath their explanatory copy and prevented the mobile Menu control from yielding width to longer page or thread titles.
- Added dedicated contrast, focus, reduced-motion, coarse-pointer, zoom-equivalent, and narrow empty-state browser contracts, and expanded editor lifecycle coverage for keyboard tab semantics.
- Performed connected in-app QA against a disposable isolated API at the default desktop viewport, 640 by 900 pixels, and 390 by 844 pixels across launch, workflows, schedules, and task-ledger surfaces; no normal Ender persistence directories were used.
- Refreshed the intentional visual baselines after the final accessible purple and responsive-state adjustments.

Verification:

- `npm run typecheck`
- 8 focused accessibility and editor-lifecycle browser checks
- desktop, 640-pixel zoom-equivalent, and 390-pixel connected in-app visual QA
- intentional visual-baseline refresh
- complete 48-test Playwright suite
- `npm run verify`

The complete gate passed: synchronized version metadata, documentation validation across 55 Markdown files, all 118 backend tests, typechecking, syntax checks, the production UI build, and all 48 Playwright tests.

### H6. Consolidate the redesign into a review-ready delivery

Completed: 2026-07-19

- Reviewed the complete H1-through-H5 diff and confirmed its scope is limited to the operator interface, browser contracts, intentional visual baselines, and continuity documentation; backend and shared API behavior remain unchanged.
- Audited every untracked artifact and confirmed that each source file, document, and PNG baseline is referenced by the delivered UI or its browser tests.
- Removed pre-redesign copy fields that no longer render and deleted unreferenced CSS for the former server summary card, expanded header metrics, navigation cards and footer, launch side panel, compact editor-password treatment, workflow/ledger side panels, and superseded transcript-tool rows.
- Cross-checked stylesheet class selectors against the current UI source, retaining only the external Google Fonts hostname and the six dynamically generated transcript-heading levels as expected static-analysis exceptions.
- Reduced the production CSS bundle from 64.69 to 57.62 kilobytes and its gzip size from 12.82 to 11.64 kilobytes; the production JavaScript bundle also reduced from 348.17 to 347.59 kilobytes after dead copy removal.
- Updated the original audit status to point to the completed implementation and added `UI_RELEASE_NOTES.md` with the operator-facing changes, preserved capabilities, compatibility boundary, accessibility behavior, and verification evidence.
- Re-ran all 48 browser tests without updating their visual baselines after cleanup; every baseline remained unchanged, proving the removed selectors had no live visual consumer.

Verification:

- complete diff, untracked-artifact, and selector-consumer review
- `git diff --check`
- `npm run typecheck`
- `npm run build`
- complete 48-test Playwright suite with unchanged baselines
- `npm run verify`

The complete gate passed: synchronized version metadata, documentation validation across 56 Markdown files, all 118 backend tests, typechecking, syntax checks, the production UI build, and all 48 Playwright tests.

### I1. Restore and prove maintained Codex ACP execution

Completed: 2026-07-19

- Traced the reported launch failure to the configured deprecated `@zed-industries/codex-acp` 0.16 runtime; Ender's OpenAI model setting was not selecting the ACP model shown in the failure because Codex owns that selection inside the ACP subprocess.
- Migrated the active local configuration and public examples to `@agentclientprotocol/codex-acp`, whose maintained package carries a compatible Codex runtime, while documenting the `CODEX_PATH` override boundary.
- Increased the default ACP initialize/new-session allowance from 10 to 30 seconds so a cold npx adapter launch has a practical startup window without weakening task-level completion behavior.
- Added an actionable runtime diagnostic for the deprecated package, unsupported `max` reasoning cache, and newer-Codex-required signals; the original ACP error and subprocess output remain attached for investigation.
- Rebuilt the server-thread smoke as an opt-in, credential-backed check that starts the actual `src/server.js` entry point on loopback, isolates every persistence/workspace directory, creates and polls a task through HTTP, verifies a deterministic model response, shuts down cleanly, and removes its temporary state.
- Added the smoke to package scripts, syntax validation, README setup, operator troubleshooting, and the release-readiness matrix without placing a paid/network-dependent provider call inside the deterministic `verify` gate.

Verification:

- `node --test tests/acp-agent-runner.test.js`
- `npm run docs:check`
- `npm run check`
- `npm run smoke:acp-server`
- `npm run verify`

The real ACP smoke completed a fresh Ender task as `done` with the expected `ENDER_ACP_SMOKE_OK` marker in 12.2 seconds. The complete gate then passed with synchronized version metadata, documentation validation across 56 Markdown files, all 119 backend tests, typechecking, syntax checks, the production UI build, and all 48 Playwright tests.

### I2. Run multiple configured model backends concurrently

Completed: 2026-07-19

- Reframed `LLM_BACKEND` as the default provider instead of the server's exclusive provider, preserving the existing value and `DEFAULT_LLM_PROFILE_ID` behavior.
- Added automatic profile discovery for the selected backend plus each other provider whose required environment values are configured; the current environment publishes ACP, OpenAI, and Bedrock from one server process.
- Kept `LLM_PROFILES_JSON` authoritative when present so named model variants and controlled profile allowlists retain their prior behavior without duplicate automatic profiles.
- Added profile readiness and missing-variable metadata to the public catalog without exposing credentials, and kept incomplete profiles visibly unavailable in both launch and follow-up selectors.
- Preserved per-task and per-follow-up `llmProfileId` routing through the existing execution boundary, and made the pickers recover to the current server default if a saved profile disappears after a server switch or configuration change.
- Generalized the isolated provider smoke so one real `src/server.js` process can validate multiple requested profiles sequentially through the HTTP task API; added `npm run smoke:configured-backends` for ACP plus OpenAI.
- Removed the fixed-interval task-ledger flicker by making three-second background polling visually silent and deduplicating unchanged collection and metadata responses before they reach React state.
- Added browser coverage proving backend selection reaches the task payload and background ledger refreshes preserve an expanded row without showing transient syncing copy.
- Retained correct ACP and OpenAI product capitalization after inspecting the three copy-only visual diffs and refreshing only those intentional baselines.

Verification:

- focused profile-manager and ACP runner tests
- 9 focused backend-picker and task-ledger Playwright tests
- `npm run smoke:configured-backends`
- `npm run verify`

The same isolated server completed ACP and OpenAI tasks as `done` with their expected markers in 7.0 and 2.3 seconds respectively. The complete repository gate passed with synchronized version metadata, documentation validation across 56 Markdown files, all 121 backend tests, typechecking, syntax checks, the production UI build, and all 50 Playwright tests.

### I3. Support multiple models per configured provider

Completed: 2026-07-19

- Confirmed against AWS's current Bedrock lifecycle and model catalog that the former Claude 3.5 Sonnet default is end-of-life and replaced it with the active US Claude Sonnet 5 inference profile.
- Added comma-separated `OPENAI_MODELS`, `BEDROCK_MODEL_IDS`, `AZURE_OPENAI_API_DEPLOYMENT_NAMES`, and `OLLAMA_MODELS` configuration while retaining every singular variable as that provider's backward-compatible default.
- Expanded automatic discovery to publish one profile per configured model or Azure deployment. Primary provider IDs remain stable (`openai`, `bedrock`, `azure`, and `ollama`); additional profiles use deterministic provider/model IDs, including deterministic collision suffixes.
- Kept `LLM_PROFILES_JSON` authoritative for custom labels, credentials, and allowlists, and kept ACP as one profile because its spawned adapter owns model selection.
- Made launch and follow-up profile labels model-aware without repeating provider/model details in native selectors, and added browser coverage proving a secondary same-provider model reaches the task payload.
- Removed the Bedrock-wide `temperature` override after the real Sonnet 5 smoke proved that current Bedrock models reject that deprecated parameter; other provider defaults remain unchanged.
- Added a dedicated credential-backed Bedrock server smoke and documented provider/model configuration, lifecycle troubleshooting, runtime routing, and release evidence.

Verification:

- focused profile-manager and model-factory tests
- focused 4-test launch-flow Playwright suite
- real isolated `src/server.js` task through `bedrock` using `us.anthropic.claude-sonnet-5`
- real isolated `src/server.js` task through generated `bedrock-us-anthropic-claude-sonnet-4-6`
- `npm run verify`

Both active Bedrock profiles completed deterministic-marker tasks as `done` in approximately 2.4 seconds each. The complete repository gate passed with synchronized version metadata, documentation validation across 56 Markdown files, all 123 backend tests, typechecking, syntax checks, the production UI build, and all 50 Playwright tests without visual baseline changes.

### I4. Unify provider feedback and the conversation model

Completed: 2026-07-20

- Added one provider-neutral activity contract for direct model backends and ACP, separating internal run phases, model-authored progress, plans, tool lifecycles, approvals, and chat responses.
- Replaced repeated “invoking model” rows with one compact work summary per user turn in Conversation while preserving model requests, paired tool calls/results, diagnostics, and timing in All activity.
- Normalized missing and partial tool states so legacy ACP logs remain readable without `undefined` statuses, duplicated fragments, or progress text concatenated into the final response.
- Kept tool detail recoverable from the summary and kept approvals and actionable failures prominent.
- Added regression coverage for active structured progress, clean final responses, legacy ACP normalization, direct-provider iteration reconciliation, and provider/model launch selection.

Verification:

- focused ACP runner and tool-runtime tests
- focused thread-view and launch-flow Playwright tests
- `npm run verify`

### I5. Refresh maintained documentation and product screenshots

Completed: 2026-07-20

- Corrected current navigation, launch-action, transcript, provider-discovery, model-profile, ACP adapter, and handshake-timeout descriptions across the maintained operator, architecture, and continuity records.
- Classified the May wiki and raw corpus as historical context, repaired its local links, and expanded the documentation gate to protect link integrity across both maintained and historical Markdown without treating historical commands as release guidance.
- Replaced eight pre-redesign JPEGs with exact PNG copies of current deterministic Playwright baselines and added a repeatable screenshot synchronization command and source manifest.
- Visually inspected all eight documentation images after synchronization.

Verification:

- `npm run docs:screenshots:sync`
- `npm run docs:check`
- `git diff --check`
- `npm run verify`

The complete gate passed with synchronized version metadata, documentation validation across 68 Markdown files, all 128 backend tests, typechecking, syntax checks, the production UI build, and all 58 Chromium Playwright tests.

## Next milestone

Milestone I6: complete live provider-parity validation.

Planned scope:

- Run representative live tasks through Azure OpenAI, Ollama, and at least one non-Codex ACP adapter where credentials/runtime access are available.
- Compare Conversation summaries, All activity detail, approvals, failures, and final responses against the proven OpenAI, Bedrock, and Codex ACP behavior.
- Add provider-specific adapters only where live evidence reveals a real contract mismatch; keep the shared event vocabulary stable.

Planned verification:

- credential-backed provider smokes
- focused contracts for any discovered normalization defect
- `npm run verify`

Needs:

- Azure credentials/deployment, an available Ollama model, and a non-Codex ACP agent/runtime as applicable.

## Working assumptions

- Existing REST and SSE behavior remains compatible unless a migration is explicitly documented.
- JSON persistence remains the default local storage mechanism during early milestones.
- Advanced operator capabilities remain available through clearer information architecture and progressive disclosure.
- Research cadence defaults to major or uncertain milestones until the product owner selects another preference.
