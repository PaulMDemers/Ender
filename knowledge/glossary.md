# Glossary

Purpose: give future threads a single source for repo-specific terms and the exact meanings that matter during implementation.

## Agent task / task

A persisted execution unit managed by `TaskManager`.

In practice a task includes:

- `goal`
- `status`
- `logs`
- `thread` conversation history
- `pendingApprovals`
- `workspace`
- parent/child task links

Persisted in `threads/<id>.json`.

Important distinction:
- a task is not just one prompt/response pair
- a task can be continued later with `POST /tasks/:id/messages`

## Thread

In the UI and API, “thread” is mostly the operator-facing name for a persisted task.

Useful mental model:
- backend class name: `TaskManager`
- persisted object: task snapshot
- UI label: thread

So “continue a thread” means “continue an existing persisted task.”

## Task thread history

The simplified conversation array stored on each task as `thread`.

It contains recent `user` and `assistant` messages and is trimmed before each run by `_getRunThread()` in `src/runtime/taskManager.js`.

This is separate from:
- the full log stream in `logs`
- the internal LangChain message list built during a single run

## Log entry

A persisted, SSE-streamed event stored in `task.logs`.

Logs may contain:
- plain strings
- structured chat entries like `{ kind: "chat", role, content }`
- tool and runtime status messages

Logs are what the UI transcript primarily renders.

## SSE stream

Server-Sent Events stream exposed at `GET /tasks/:id/stream`.

Main event types emitted by `TaskManager`:
- `status`
- `log`
- `approval_required`
- `complete`
- `ping`

This is the main live bridge from backend runtime to UI transcript/approval state.

## Approval

A persisted pause point created when a tool or operation requires human confirmation.

Approval flow:
- runtime calls `requestApproval`
- `TaskApprovalCoordinator` stores approval metadata and resolvers while `TaskManager` owns lifecycle publication
- task status becomes `awaiting_approval`
- SSE emits `approval_required`
- UI resolves via `POST /tasks/:id/approvals/:approvalId`

Important property:
- approvals survive process persistence only as metadata
- after restart, interrupted approval-waiting tasks are converted to `error`

## Awaiting approval

A task status meaning execution is paused pending operator input.

This is not terminal. If approval is granted and no other approvals remain, the task status returns to `running`.

## Terminal task status

Statuses treated as finished by the policy in `src/runtime/taskLifecycle.js`:
- `done`
- `error`
- `canceled`
- `terminated`

These statuses stop waiting logic and close SSE subscribers.

## Rerun

Starting a brand-new task using the original task goal.

This is not the same as continuing a thread.

- rerun: `POST /tasks/:id/rerun` -> new task id
- continue: `POST /tasks/:id/messages` -> same task id

## Continue task / continue thread

Appending a new user prompt to an existing idle task and running it again.

Implemented by `TaskManager.continueTask()`.

Constraints:
- task must exist
- task cannot already be `running` or `awaiting_approval`
- prompt must be non-empty

## Workspace

The filesystem directory a task runs against.

Sources:
- explicit workspace chosen by the operator
- inherited parent workspace for child tasks
- default `config.workdir`

Important distinction:
- `workspace` is the resolved absolute path used by tools
- `workspaceLabel` preserves the operator-facing input label when available

## Workspace root / workdir

The configured default working root, usually `./workspace`.

Used for:
- default task workspace
- workflow clone targets
- child workspace deletion safety checks

Do not confuse this with:
- `workspaceBase` used by the picker
- self-update root used for Ender self-editing

## Workspace base

The root directory used by workspace listing/picking, configured as `AGENT_WORKSPACE_BASE`.

This affects discovery in the UI, not necessarily where tasks execute by default.

## Child task

A task started from another task via thread tools.

Relationships are persisted as:
- `parentTaskId`
- `childTaskIds`

Child tasks can inherit the parent workspace unless another workspace is provided.

## Ledger

The lightweight internal state object used during a run for facts, todos, and progress.

Created fresh in `runTask()` via `createLedger()`.

Important limitation:
- ledger state is for the current run, not the long-term persisted thread object
- future runs only retain what was written into task logs/thread/result, not the in-memory ledger itself

## Fact

A concise verified statement saved into the ledger via `save_fact`.

Per developer policy, facts should be directly supported by prompt content or tool output.

## Todo

A concise next actionable step saved into the ledger via `add_todo`.

Used mainly for multi-step or stateful tasks.

## Agent loop

The iterative model/tool execution loop in `src/runtime/runAgentLoop.js`.

Cycle:
- invoke model with current messages
- inspect tool calls
- invoke tools
- append tool results
- repeat until completion or stop condition

Stop reasons include:
- `done`
- `no_tool_calls`
- `max_steps`
- `stall_detected`

## Stall detection

Protection against repeated identical tool-call cycles.

`runAgentLoop()` fingerprints each iteration’s tool calls/results and stops with `stall_detected` after repeated identical iterations beyond the configured limit.

## Workflow

A server-defined guided setup flow that gathers structured inputs before optionally starting a task.

A workflow definition provides:
- `createInitialState`
- `getCurrentStep`
- `advance`

Registered in `src/workflows/index.js` and managed by `WorkflowManager`.

## Workflow session

A persisted instance of a workflow in progress.

Stored in `workflow-sessions/<id>.json` unless `shouldPersist` is false.

A session includes:
- `workflowId`
- `mode`
- `status`
- `history`
- `state`

Important correction versus older docs:
- workflow sessions are persisted to disk by current code
- they are not memory-only anymore

## Workflow mode

Contract enum from `shared/contracts.json`:
- `interactive`
- `schedule_config`
- `scheduled_run`

Meaning:
- `interactive`: operator is stepping through now and may start a task immediately
- `schedule_config`: collect replayable inputs for a future schedule without doing side effects like cloning now
- `scheduled_run`: replay workflow automatically during schedule execution, allowing mode-specific behavior

## Workflow step

The current UI-renderable payload returned by `workflow.getCurrentStep(session)`.

Current contract step types:
- `form`
- `select`
- `complete`

The UI is intentionally generic and renders these server-provided step payloads.

## Workflow history

The stack of prior workflow states stored in `session.history`.

Used to support back navigation.

Important rule:
- once a workflow has started a task, back navigation is blocked

## Started task id

`session.state.startedTaskId` indicates the workflow has already launched a task.

This is a key boundary because it changes UI behavior and disables retreat.

## Built-in Jira workflow

The main built-in workflow: `jira_to_repo_task`.

Stages:
- `project`
- `board`
- `issue`
- `repo`
- `delivery`
- `jira_outcome`
- `complete`

It gathers Jira context, clones a repo, chooses delivery/Jira behavior, then starts a task.

## Schedule

A persisted cron job managed by `ScheduleManager` and stored in `schedules/<id>.json`.

A schedule includes:
- `name`
- `cron`
- `timezone`
- `enabled`
- `target`
- run metadata like `lastRunAt`, `lastRunStatus`, `lastRunMessage`

## Schedule target kind

Contract enum for what a schedule executes:
- `prompt`
- `thread`
- `workflow`

Meaning:
- `prompt`: start a new task from a prompt
- `thread`: continue an existing task/thread with a prompt
- `workflow`: replay a workflow with stored step inputs

## Run now

Manual immediate execution of a saved schedule via `POST /schedules/:id/run`.

Important expectation:
- it should behave as closely as possible to actual cron-triggered execution

## Shared contracts

The backend/UI compatibility definitions in:
- `shared/contracts.json`
- `src/shared/contracts.js`

These define enums and schemas for workflow modes, workflow step types, and schedule target kinds.

High-risk rule:
- changing these can break both backend and UI, plus persisted data compatibility

## Self-update

The special supervised flow that lets Ender modify and restart its own repo safely.

This is not ordinary repo editing.

It requires:
- supervisor mode (`npm run start:supervised`)
- configured supervisor URL/token
- active task workspace equal to the Ender repo root

## Self workspace

The exact repo root path allowed for self-update operations.

Enforced in `createSelfUpdateTools()` by comparing:
- configured self-update root
- active task workdir

If they do not match exactly, self-update tools return `not_self_workspace`.

## Supervisor

The external process started by `scripts/ender-supervisor.js` that launches Ender, handles restart, and supports rollback-aware self-update.

The backend talks to it through `SelfUpdateManager` over HTTP.

## Checkpoint

A rollback snapshot created before editing Ender’s own source.

Created through `self_update_checkpoint_create` and used later by `self_update_apply` if verification or restart health fails.

## Apply operation

A self-update attempt that:
- runs a verify command
- restarts the child server
- waits for health
- rolls back and restarts again if health fails

Core logic lives in `src/selfUpdate/runner.js`.

## Health / readiness

The structured readiness payload returned by `GET /health`.

Used by the UI to show:
- API/server availability
- LLM readiness
- workflow readiness
- browser capture readiness
- GitHub readiness
- self-update readiness

## Operator console

The React UI in `ui/` used by a human operator to:
- start tasks
- watch logs
- approve actions
- run workflows
- manage schedules
- switch servers

## Direct task

A task started from the main composer without going through a guided workflow.

## Guided workflow

A workflow-driven launch path where the backend controls the step sequence and validation before task start.

## Schedule configuration

The UI/workflow process of defining a replayable schedule payload rather than executing the workflow immediately.

In the Jira workflow this means clone is deferred and only preview/state is stored.

## Scheduled run

Execution path when a workflow is replayed by a schedule.

In the Jira workflow this has special behavior:
- clone happens at execution time
- occupied target directories may be auto-renamed

## Contract boundary

Any backend/UI or persisted-data interface where shape compatibility matters.

In this repo the most important boundaries are:
- shared contracts
- workflow step payloads
- schedule target payloads
- SSE event names/payloads
- self-update supervisor protocol

## Persistence boundary

Any JSON shape written to disk and later reloaded.

Main persisted stores:
- `threads/`
- `schedules/`
- `workflow-sessions/`
- `.ender-supervisor/`

Additive changes are safer than renames/removals.
