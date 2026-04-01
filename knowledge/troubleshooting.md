# Troubleshooting

Purpose: help future threads quickly diagnose common failures in this repo without re-learning the runtime from scratch.

## How to use this file

Start by identifying the symptom:

- server will not boot
- UI loads but cannot connect
- task is stuck or errors immediately
- approvals do not appear
- workflow session behaves strangely
- schedule does not run
- self-update is unavailable or fails
- browser capture or external integrations are unavailable

Then jump to the matching section.

---

## 1. Server will not boot

### Likely places to inspect

- `.env`
- `src/config.js`
- `src/server.js`
- startup logs in terminal

### Common causes

#### Invalid or missing environment configuration

Observation path:
- server exits during `loadConfig()` or early startup
- `/health` never becomes available

Check:
- required LLM env vars for the selected backend
- path-like env vars pointing to invalid locations
- malformed numeric env vars like timeouts or step limits

#### Syntax/runtime error in startup path

Check files loaded during boot:
- `src/server.js`
- `src/api/app.js`
- `src/runtime/taskManager.js`
- `src/workflows/workflowManager.js`
- `src/runtime/scheduleManager.js`
- self-update files if supervised mode is involved

### Fast verification

Run:
- `npm run check`
- `npm test`
- `npm run typecheck`

If the failure is only at runtime startup, inspect the terminal stack trace first.

---

## 2. UI loads but cannot connect to the API

### Likely places to inspect

- current API base in the UI
- `GET /health`
- CORS/app startup
- `ui/src/agentClient.js`

### Common causes

#### Wrong server URL selected in the UI

Observation:
- UI shell renders
- health badge shows offline
- task/workflow/schedule lists fail

Check:
- current server endpoint in the server modal
- whether the API is actually listening on that host/port

#### API is down or restarting

Observation:
- reconnect notice appears
- health polling flips from ready to offline

Check:
- backend terminal logs
- whether a self-update restart is in progress

#### Route shape drift between backend and UI client

Observation:
- some panels work, others fail consistently after a code change

Check:
- `src/api/app.js`
- `ui/src/agentClient.js`
- any changed response payload fields

### Fast verification

- open `/health` directly in browser or via HTTP tool
- run `npm run build` if UI code changed
- compare route names and payloads between backend and client

---

## 3. Task starts but errors immediately

### Likely places to inspect

- selected workspace
- `src/runtime/runTask.js`
- `src/runtime/runAgentLoop.js`
- tool initialization code
- task logs in `threads/<id>.json`

### Common causes

#### Invalid workspace

Observation:
- task creation fails with `invalid_workspace`
- or task starts but tools fail against missing paths

Check:
- workspace exists
- workspace is a directory
- workspace resolution logic in `TaskManager._resolveWorkspace()`

#### Model/backend configuration issue

Observation:
- task enters `error`
- logs mention model invocation failure or provider auth/config problems

Check:
- `.env`
- selected backend
- provider-specific credentials

#### Tool initialization/runtime failure

Observation:
- first tool call fails repeatedly
- logs show `tool_invocation_failed`

Check:
- relevant tool factory in `src/tools/`
- whether required integration credentials are configured

### Fast verification

- inspect task logs
- run `npm test`
- check `/health` readiness payload for missing integrations

---

## 4. Task seems stuck or loops

### Likely places to inspect

- task logs
- `src/runtime/runAgentLoop.js`
- tool result shapes
- ledger usage if the task is multi-step

### Common causes

#### Repeated tool-call cycle

Observation:
- similar tool calls/results repeat
- eventual stop reason may be `stall_detected`

Check:
- whether tool outputs are too vague or unchanged
- whether the model is receiving enough state to progress
- whether a tool is returning a shape the model cannot use effectively

#### Max step limit reached

Observation:
- final result says loop limit reached

Check:
- `AGENT_MAX_STEPS`
- whether the task is too broad for one run

#### Waiting on approval

Observation:
- task status is `awaiting_approval`
- no further logs appear

Check:
- pending approvals in task state
- UI approval prompt rendering

### Fast verification

- inspect stop reason in logs/result
- inspect repeated tool outputs
- verify approval state before assuming a runtime bug

---

## 5. Approvals do not appear in the UI

### Likely places to inspect

- `TaskManager._requestApproval()`
- SSE stream `/tasks/:id/stream`
- `ui/src/hooks/useTaskLogs.js`
- approval UI components

### Common causes

#### Backend created approval but UI missed SSE event

Observation:
- task status becomes `awaiting_approval`
- UI shows no prompt

Check:
- SSE event name is still `approval_required`
- payload shape still includes expected fields
- selected thread is the same task that requested approval

#### Approval metadata not persisted or not attached to task

Observation:
- refresh loses the approval prompt unexpectedly

Check:
- task snapshot contains `pendingApprovals`
- serialization/hydration logic in `TaskManager`

#### UI hook drift

Observation:
- backend emits correctly but UI state never updates

Check:
- `useTaskLogs`
- any event parsing changes

### Fast verification

- inspect task JSON in `threads/`
- inspect SSE event names/payloads in code
- run a manual approval-path smoke test

---

## 6. Workflow session cannot advance or back up

### Likely places to inspect

- `src/workflows/workflowManager.js`
- specific workflow file
- current session JSON in `workflow-sessions/`
- shared contracts if step shapes changed

### Common causes

#### Invalid step input

Observation:
- `advance_failed`
- user-facing validation message returned

Check:
- workflow `advance()` validation logic
- exact input payload from UI

#### Step payload no longer matches UI renderer expectations

Observation:
- workflow loads but step rendering is broken or incomplete

Check:
- `getCurrentStep()` output
- `shared/contracts.json`
- `ui/src/components/WorkflowStepRenderer.jsx`

#### Back navigation blocked after task start

Observation:
- back button fails with `already_started`

This is expected once `startedTaskId` exists.

#### Persisted session shape drift

Observation:
- resumed sessions fail after code changes

Check:
- session loader/hydrator compatibility
- whether new required fields were introduced without defaults

### Fast verification

- inspect session JSON
- compare current step payload to contract
- run `npm test`, `npm run build`

---

## 7. Jira workflow clone step fails

### Likely places to inspect

- `src/workflows/jiraToRepoWorkflow.js`
- `src/tools/gitTools.js`
- target directory state under workdir

### Common causes

#### Target directory already exists and is not empty

Observation:
- interactive mode returns collision error

Expected behavior:
- `interactive` and `schedule_config` should not auto-rename
- `scheduled_run` may auto-rename occupied targets

#### Git auth or repo URL issue

Observation:
- clone result contains stderr from git

Check:
- repo URL correctness
- GitHub token if private repo access is needed
- local git availability

#### Wrong mode assumptions

Observation:
- clone expected during schedule configuration but did not happen

Expected behavior:
- `schedule_config` defers clone
- actual clone happens during `scheduled_run`

### Fast verification

- inspect workflow debug entries
- inspect clone target resolution logic
- verify mode-specific expectations before changing code

---

## 8. Schedule does not run or run-now fails

### Likely places to inspect

- `src/runtime/scheduleManager.js`
- persisted schedule JSON in `schedules/`
- workflow replay inputs if target kind is `workflow`

### Common causes

#### Invalid cron or target payload

Observation:
- schedule creation/update rejected

Check:
- `scheduleInputSchema`
- `shared/contracts.json`

#### Schedule loaded but disabled

Observation:
- exists in UI but never fires

Check:
- `enabled` flag
- whether `_activateAll()` ran on boot

#### Thread target points to missing or busy task

Observation:
- run-now returns error for thread continuation

Check:
- target thread still exists
- target thread is not currently `running` or `awaiting_approval`

#### Workflow target requires more input

Observation:
- `workflow_requires_more_input`

Check:
- stored workflow inputs array is complete for the workflow’s steps

### Fast verification

- inspect `lastRunStatus` and `lastRunMessage`
- run schedule manually with run-now
- inspect persisted schedule target shape

---

## 9. Self-update tools are unavailable

### Likely places to inspect

- startup mode
- `/health` self-update readiness
- `src/tools/selfUpdateTools.js`
- `src/selfUpdate/manager.js`

### Common causes

#### Ender not started under supervisor

Observation:
- self-update status says not configured

Expected requirement:
- start with `npm run start:supervised`

#### Active workspace is not the Ender repo root

Observation:
- tool returns `not_self_workspace`

Expected requirement:
- task workspace must exactly equal configured self root

#### Missing supervisor URL/token

Observation:
- self-update readiness false even in intended mode

Check:
- injected env vars from supervisor
- config wiring

### Fast verification

- inspect `/health`
- inspect active task workspace
- confirm supervised startup path

---

## 10. Self-update apply fails or rolls back

### Likely places to inspect

- `tests/self-update.test.js`
- supervisor operation records
- verify command output
- health wait behavior

### Common causes

#### Verify command failed

Observation:
- operation status `verify_failed`
- rollback occurs immediately

Check:
- `npm run verify` or configured verify command
- repo cleanliness and test/build failures

#### Restart succeeded but health never returned

Observation:
- operation status `rolled_back`

Check:
- server boot logs after restart
- `/health` readiness and startup timing
- timeout configuration

#### Rollback itself failed

Observation:
- operation status `rollback_failed`

Check:
- checkpoint integrity
- repo state assumptions
- supervisor logs

### Fast verification

- inspect self-update operations endpoint
- run `npm test`, `npm run typecheck`, `npm run build`
- compare behavior to `tests/self-update.test.js`

---

## 11. Browser capture is unavailable

### Likely places to inspect

- `/health`
- Playwright installation
- runtime environment

### Common causes

#### Playwright/Chromium missing

Observation:
- health says browser capture not ready

Expected fix:
- install Playwright with Chromium in the runtime environment

#### Environment mismatch

Observation:
- works locally in one environment but not another

Check:
- whether browser binaries exist in the environment actually running the API

### Fast verification

- inspect `/health`
- run relevant browser setup/install steps

---

## 12. GitHub, GitLab, Jira, Confluence, Drive, or email tools fail

### Likely places to inspect

- `/health`
- `.env`
- corresponding tool file in `src/tools/`

### Common causes

#### Missing credentials

Observation:
- readiness payload lists missing env vars
- tool returns auth/config errors

#### Wrong base URL or token scope

Observation:
- credentials exist but API calls still fail

Check:
- custom base URL values
- token permissions/scopes
- account/project access

### Fast verification

- inspect `/health`
- inspect exact tool error message in task logs
- verify env var names match README expectations

---

## 13. Persisted data causes strange behavior after code changes

### Likely places to inspect

- `threads/`
- `schedules/`
- `workflow-sessions/`
- serializer/hydrator code

### Common causes

#### Breaking persisted shape change

Observation:
- old tasks/schedules/sessions fail to load or behave oddly after a refactor

Check:
- whether fields were renamed or made required
- whether load logic handles older JSON gracefully

#### Old running/approval tasks reloaded as error

Observation:
- after restart, previously active tasks show `error`

This is expected behavior, not a bug.

### Fast verification

- inspect persisted JSON directly
- compare serializer and hydrator logic
- prefer additive compatibility fixes

---

## 14. Quick triage checklist

Before changing code, answer these:

1. Is the failure in backend, UI, workflow, schedule, or self-update?
2. Is there a direct error message already in logs or API output?
3. Does `/health` already explain missing prerequisites?
4. Is the issue actually expected behavior by mode or restart semantics?
5. Does persisted JSON reveal a shape mismatch?
6. What is the smallest verification bundle that covers the suspected fix?

## 15. Recommended verification bundles

### Suspected backend/runtime bug

- `npm test`
- `npm run typecheck`
- `npm run check`

### Suspected UI/API drift

- `npm run build`
- `npm test`

### Suspected workflow/schedule issue

- `npm test`
- `npm run build`

### Suspected self-update issue

- inspect `tests/self-update.test.js`
- `npm test`
- `npm run typecheck`
