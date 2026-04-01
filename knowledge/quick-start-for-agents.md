# Quick Start for Agents

Purpose: give future threads the minimum high-value context needed to work effectively in this repo fast.

## 1. What this repo is

Ender is a local-first agent runtime with:

- Express backend in `src/`
- React/Electron operator UI in `ui/`
- persisted task threads in `threads/`
- persisted schedules in `schedules/`
- persisted workflow sessions in `workflow-sessions/`
- optional supervised self-update via `scripts/ender-supervisor.js`

Main backend entrypoint: `src/server.js`
Main UI entrypoint: `ui/src/App.jsx`

## 2. Read these first

If you only have a few minutes, read in this order:

1. `README.md`
2. `src/server.js`
3. `src/api/app.js`
4. `src/runtime/taskManager.js`
5. `src/runtime/runTask.js`
6. `src/runtime/runAgentLoop.js`
7. `src/workflows/workflowManager.js`
8. `src/runtime/scheduleManager.js`
9. `ui/src/App.jsx`
10. `knowledge/*.md`

## 3. Core architecture in one screen

Boot flow:

- `loadConfig()` parses env
- `TaskManager` loads persisted threads
- `WorkflowManager` loads persisted workflow sessions
- `ScheduleManager` loads persisted schedules and activates cron jobs
- `SelfUpdateManager` connects to supervisor if configured
- Express app exposes REST endpoints

Runtime flow:

- UI starts or continues a task
- `TaskManager` creates/updates task state
- `runTask()` assembles model + tools + ledger
- `runAgentLoop()` runs iterative tool-calling
- logs stream over SSE
- approvals pause execution when needed
- final result is persisted back to the thread

## 4. Files that matter most by concern

### Backend/API

- `src/server.js`
- `src/api/app.js`
- `src/config.js`
- `src/health/readiness.js`

### Runtime

- `src/runtime/taskManager.js`
- `src/runtime/runTask.js`
- `src/runtime/runAgentLoop.js`
- `src/state/ledger.js`

### Workflows/schedules

- `src/workflows/workflowManager.js`
- `src/workflows/jiraToRepoWorkflow.js`
- `src/runtime/scheduleManager.js`
- `src/shared/contracts.js`
- `shared/contracts.json`

### UI

- `ui/src/App.jsx`
- `ui/src/agentClient.js`
- `ui/src/hooks/useTaskLogs.js`
- `ui/src/components/WorkflowPanel.jsx`
- `ui/src/components/SchedulePanel.jsx`
- `ui/src/components/WorkflowStepRenderer.jsx`

### Self-update

- `scripts/ender-supervisor.js`
- `src/selfUpdate/manager.js`
- `src/selfUpdate/runner.js`
- `src/tools/selfUpdateTools.js`

## 5. Important mental models

### Tasks are persisted threads

Each task is a long-lived thread record with:

- goal
- status
- logs
- simplified conversation thread
- pending approvals
- workspace
- parent/child task links

Persisted in `threads/<id>.json`.

### Workflows are server-defined state machines

The UI renders generic workflow steps from backend-provided step payloads.
If a new workflow stays within the shared step schema, UI changes may be minimal or unnecessary.

### Schedules are cron wrappers around three target kinds

A schedule can:

- start a new prompt
- continue a thread
- replay a workflow with stored inputs

### Self-update is special-case and supervisor-only

Do not treat self-update like normal repo editing. It only works safely when:

- Ender is launched with `npm run start:supervised`
- the active task workspace is the Ender repo root

## 6. High-risk boundaries

Be careful when changing:

- `shared/contracts.json`
- `src/shared/contracts.js`
- workflow step payload shapes
- schedule target payload shapes
- SSE event names from `TaskManager.sse()`
- self-update protocol between backend and supervisor

These affect backend/UI compatibility or restart safety.

## 7. Existing built-in workflow

`jira_to_repo_task` is the main built-in guided workflow.
Stages:

1. project
2. board
3. issue
4. repo
5. delivery
6. jira_outcome
7. complete

Special behavior:

- `interactive`: clone immediately, fail on occupied target dir
- `schedule_config`: defer clone, store preview only
- `scheduled_run`: clone during execution and auto-rename occupied target dirs

## 8. How approvals work

Approval-gated tools call back into `TaskManager._requestApproval()`.
That:

- stores approval metadata
- sets task status to `awaiting_approval`
- emits `approval_required` over SSE

The UI resolves approval via `POST /tasks/:id/approvals/:approvalId`.

## 9. How restart behavior works

On server restart:

- persisted tasks reload from disk
- any task that was `running` or `awaiting_approval` is converted to `error`
- a warning log is appended saying it was interrupted by restart

This is intentional and tested.

## 10. Fast verification guidance

For most backend/runtime changes:

- `npm test`
- `npm run typecheck`
- `npm run check`

For UI or contract changes:

- `npm run build`
- optionally `npm run test:e2e`

For self-update changes:

- inspect `tests/self-update.test.js`
- likely run at least `npm test`

## 11. Best next step for a future thread

Before coding, quickly answer:

- Is this backend, UI, workflow, schedule, or self-update work?
- Does it touch shared contracts?
- Does it affect persisted state shape?
- Does it affect SSE events or approval flow?
- What is the smallest relevant test/verification set?

## 12. Knowledge file index

- `knowledge/repo-map.md`
- `knowledge/architecture.md`
- `knowledge/runtime-loop.md`
- `knowledge/workflows-and-schedules.md`
- `knowledge/ui-operator-console.md`
- `knowledge/self-update.md`
- `knowledge/testing-and-quality.md`
