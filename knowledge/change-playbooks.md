# Change Playbooks

Purpose: repo-specific checklists for common change types so future threads can move quickly without breaking shared contracts, persistence, or restart behavior.

## How to use this file

Before editing, identify which playbook best matches the task:

- workflow change
- shared contract change
- schedule change
- task/runtime loop change
- approval flow change
- UI/API integration change
- self-update change
- persistence/state-shape change

Then follow the checklist for that area and run the smallest verification set that still covers the risk.

---

## 1. Safely change a workflow

Relevant files usually include:

- `src/workflows/*.js`
- `src/workflows/index.js`
- `src/workflows/workflowManager.js`
- `src/shared/contracts.js`
- `shared/contracts.json`
- `ui/src/components/WorkflowStepRenderer.jsx`
- `ui/src/components/WorkflowPanel.jsx`

### Typical safe changes

- add or reorder internal workflow stages
- change data loading logic for a step
- improve labels, descriptions, or validation
- add new fields to a `form` step if the renderer already supports them
- add new server-driven filters to a `select` step if the renderer already supports them

### Checklist

1. Confirm whether the change stays within existing step types:
   - `form`
   - `select`
   - `complete`
2. If yes, prefer keeping the UI generic and avoid UI changes.
3. If adding a new workflow, register it in `src/workflows/index.js`.
4. Ensure `getCurrentStep()` returns payloads that match shared schemas.
5. Ensure `advance()` preserves session state shape and history behavior.
6. If the workflow can start tasks, verify back navigation remains blocked after task start.
7. If the workflow supports scheduling, verify `schedule_config` and `scheduled_run` both behave correctly.
8. If the workflow clones repos or touches external systems, check mode-specific behavior carefully.

### High-risk points

- changing step payload shape without updating shared contracts
- introducing a new step type without UI support
- breaking `schedule_config` replay compatibility
- persisting fields that `scheduled_run` should not persist

### Minimum verification

- `npm test`
- `npm run typecheck`
- `npm run build`

Also inspect tests related to workflows and schedule replay.

---

## 2. Safely change shared contracts

Relevant files:

- `shared/contracts.json`
- `src/shared/contracts.js`
- any backend producer of contract-shaped payloads
- any UI consumer of those payloads

### Mental model

This is a backend/frontend compatibility boundary. A contract change can silently break workflow rendering, schedule creation, or API assumptions.

### Checklist

1. Identify every producer and consumer of the contract.
2. Prefer additive changes over breaking changes.
3. Update `shared/contracts.json` first.
4. Update Zod wrappers in `src/shared/contracts.js`.
5. Update backend serialization code to emit the new shape.
6. Update UI rendering and validation code to consume the new shape.
7. Search for string comparisons against enum values before renaming anything.
8. If persisted data may already exist in the old shape, decide whether backward compatibility or migration is needed.

### High-risk points

- renaming enum values like schedule target kinds or workflow step types
- changing required fields on persisted objects
- changing workflow step payloads without renderer support

### Minimum verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- optionally `npm run test:e2e` for UI-heavy changes

---

## 3. Safely change schedules

Relevant files:

- `src/runtime/scheduleManager.js`
- `src/api/app.js`
- `src/shared/contracts.js`
- `shared/contracts.json`
- `ui/src/components/SchedulePanel.jsx`

### Mental model

Schedules are persisted cron definitions that dispatch one of three target kinds:

- `prompt`
- `thread`
- `workflow`

A schedule change can affect persistence, cron activation, and replay behavior.

### Checklist

1. Confirm whether the change affects schedule storage shape, execution behavior, or UI only.
2. Preserve existing target kinds unless you are intentionally extending the contract.
3. If changing workflow schedules, verify `workflowManager.runScheduled()` still receives compatible inputs.
4. If changing thread schedules, verify continuation prompts still map correctly.
5. If changing prompt schedules, verify workspace handling remains explicit.
6. Ensure schedule load-on-boot still activates jobs correctly.
7. Ensure run-now behavior matches scheduled behavior as closely as possible.
8. If changing timestamps or metadata, verify serialization remains stable.

### High-risk points

- changing target payload shape
- changing cron activation semantics
- making run-now differ from actual scheduled execution in surprising ways

### Minimum verification

- `npm test`
- `npm run typecheck`
- inspect schedule-related tests

---

## 4. Safely change the task/runtime loop

Relevant files:

- `src/runtime/taskManager.js`
- `src/runtime/runTask.js`
- `src/runtime/runAgentLoop.js`
- `src/state/ledger.js`
- tool registration files in `src/tools/`

### Mental model

This is the core execution engine. Changes here affect task lifecycle, persistence, approvals, logs, and tool-calling behavior.

### Checklist

1. Decide whether the change affects task state, loop control, tool execution, or logging.
2. Preserve task status transitions unless intentionally changing them.
3. Keep persisted thread shape compatible if possible.
4. Preserve restart semantics: interrupted running tasks should still recover as `error` with a warning.
5. If changing tool-call handling, verify approval-gated tools still pause correctly.
6. If changing ledger behavior, ensure saved facts/todos remain concise and valid.
7. If changing child-thread behavior, verify parent/child linkage still persists correctly.
8. If changing SSE emission, verify the UI still receives expected events.

### High-risk points

- infinite loop or retry regressions
- broken approval pause/resume behavior
- broken persistence after tool calls
- changing event names or payloads without UI updates

### Minimum verification

- `npm test`
- `npm run typecheck`
- targeted manual task run if feasible

---

## 5. Safely change approval flow

Relevant files:

- `src/runtime/taskManager.js`
- approval-gated tool definitions in `src/tools/`
- `src/api/app.js`
- `ui/src/App.jsx`
- `ui/src/hooks/useTaskLogs.js`
- approval UI components if present

### Mental model

Approval flow bridges runtime and operator UI. The backend pauses execution, persists approval metadata, emits SSE, and waits for resolution through the API.

### Checklist

1. Identify whether the change is in approval creation, serialization, SSE emission, API resolution, or UI rendering.
2. Preserve `awaiting_approval` semantics unless intentionally redesigning them.
3. Ensure approval metadata is serializable and persisted with the task.
4. Ensure SSE still emits the event the UI expects.
5. Ensure approval resolution resumes or rejects execution correctly.
6. If adding a new approval type, verify the UI can render enough context for a human decision.

### High-risk points

- approval requests that are not persisted
- UI never seeing the approval event
- task stuck forever after approval resolution

### Minimum verification

- `npm test`
- `npm run build`
- manual approval-path smoke test if feasible

---

## 6. Safely change UI/API integration

Relevant files:

- `src/api/app.js`
- `ui/src/agentClient.js`
- `ui/src/App.jsx`
- relevant UI components and hooks

### Mental model

The API is intentionally thin, but the UI depends on stable route shapes and SSE behavior.

### Checklist

1. If changing an API response, find all UI consumers first.
2. Prefer additive response fields over renaming/removing existing ones.
3. Keep route semantics aligned with existing operator flows.
4. If changing SSE payloads, update the UI hook and any event-specific handlers.
5. If changing workflow/session endpoints, verify schedule configuration still works.
6. If changing readiness output, verify the UI status chips and hints still render sensibly.

### High-risk points

- route shape drift between backend and `agentClient`
- SSE event drift
- readiness payload changes that break setup UX

### Minimum verification

- `npm run build`
- `npm test`
- optionally `npm run test:e2e`

---

## 7. Safely modify self-update

Relevant files:

- `scripts/ender-supervisor.js`
- `src/selfUpdate/manager.js`
- `src/selfUpdate/runner.js`
- `src/selfUpdate/checkpoints.js`
- `src/tools/selfUpdateTools.js`
- `tests/self-update.test.js`

### Mental model

Self-update is not normal app logic. It is a supervisor protocol with rollback guarantees. Small mistakes can strand the app in a broken state.

### Checklist

1. Confirm the task is actually about Ender self-update behavior, not just normal repo editing.
2. Preserve the rule that self-update tools only work in the Ender repo root under supervisor control.
3. If changing supervisor API payloads, update both supervisor and backend client.
4. If changing operation statuses, update tests and any UI/status consumers.
5. If changing verify or health behavior, preserve rollback on failure.
6. If editing Ender’s own repo under supervisor control, create a checkpoint before changes.
7. Prefer `self_update_apply` over ad hoc restart logic.

### High-risk points

- breaking rollback behavior
- breaking health-check wait logic
- allowing self-update outside the self workspace
- protocol mismatch between supervisor and backend manager

### Minimum verification

- inspect `tests/self-update.test.js`
- `npm test`
- `npm run typecheck`

If working on Ender itself under supervision, use the self-update flow rather than raw restart commands.

---

## 8. Safely change persisted state shape

Relevant files vary, but usually include:

- `src/runtime/taskManager.js`
- `src/runtime/scheduleManager.js`
- `src/workflows/workflowManager.js`
- any serializer/deserializer helpers

### Mental model

Persisted JSON lives on disk and may outlast the current code version. Breaking shape changes can make reload fail or silently corrupt behavior.

### Checklist

1. Identify whether the object is stored in:
   - `threads/`
   - `schedules/`
   - `workflow-sessions/`
   - `.ender-supervisor/`
2. Prefer additive fields with defaults.
3. If removing or renaming fields, add backward-compatible load logic or a migration path.
4. Verify boot-time loading still succeeds with older files if they may exist.
5. Keep serialization deterministic and JSON-safe.
6. If changing task state, verify restart recovery behavior still works.

### High-risk points

- required-field additions without defaults
- enum renames in persisted objects
- load-time crashes on older JSON files

### Minimum verification

- `npm test`
- targeted boot/reload smoke test if feasible

---

## 9. Fast decision tree

Use this when triaging a task quickly.

### If the task says “add a workflow step”

- start with workflow playbook
- check whether existing step types are enough
- only touch UI if the generic renderer cannot support it

### If the task says “change schedule behavior”

- start with schedule playbook
- inspect target kind shape and replay behavior

### If the task says “new field in workflow/session/schedule payload”

- start with shared contract playbook
- then inspect persistence implications

### If the task says “approval UI is broken”

- inspect approval flow and SSE event path first

### If the task says “Ender should update itself differently”

- use self-update playbook
- treat as high risk by default

---

## 10. Recommended verification bundles

### Low-risk UI-only copy/layout change

- `npm run build`

### Backend logic change without contract changes

- `npm test`
- `npm run typecheck`

### Workflow or contract change

- `npm test`
- `npm run typecheck`
- `npm run build`

### Self-update or restart-sensitive change

- `npm test`
- `npm run typecheck`
- inspect self-update tests specifically
