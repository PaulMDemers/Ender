# Runtime Loop

## Main files

- `src/runtime/runTask.js`
- `src/runtime/runAgentLoop.js`
- `src/runtime/taskManager.js`
- `src/state/ledger.js`

## Task lifecycle

A normal task flow is:

1. UI posts `POST /tasks`
2. `TaskManager.start()` creates a task record
3. task is persisted and `_runThread()` begins
4. `runTask()` assembles model, tools, ledger, and workspace
5. `runAgentLoop()` iterates model/tool calls
6. final result is stored on the task
7. task status becomes `done` or `error`
8. SSE subscribers receive status/log/complete events

Follow-up prompts use `POST /tasks/:id/messages` and reuse the same task/thread record.

## Conversation model

`TaskManager` stores a simplified thread array of `{ role, content }` entries.
Before a run, `_getRunThread()` trims context to the last 12 user/assistant messages.

`runAgentLoop()` converts those entries into LangChain messages and prepends the system prompt.

## Tool assembly

`runTask()` builds the tool list from many modules:

- file tools
- web tools
- git tools
- GitLab tools
- GitHub tools
- Jira tools
- Confluence tools
- Google Drive tools
- email tools
- cron tools when `ScheduleManager` exists
- child-thread tools when `TaskManager` exists
- self-update tools when `SelfUpdateManager` exists
- shell exec tool
- ledger tools

This means most capability wiring happens in one place.

## Loop behavior

`runAgentLoop()`:

1. binds tools to the model
2. invokes the model
3. reads tool calls from the AI response
4. executes each tool
5. appends tool results as `ToolMessage`
6. repeats until a stop condition is hit

Stop reasons include:

- `done` — a tool returned `DONE:`
- `no_tool_calls` — model stopped calling tools
- `max_steps` — configured cap reached
- `stall_detected` — repeated tool/result cycles exceeded threshold

## Stall detection

The loop fingerprints each iteration using:

- tool name
- sanitized args
- summarized result content

If the same fingerprint repeats, a repeat counter increments.
When it reaches `AGENT_STALL_LIMIT`, the run stops with `stall_detected`.

## Finalization behavior

`runTask()` expects the final text to start with `DONE:`.
If the loop stops without that prefix and the ledger is not marked done, it creates a fallback result:

- `DONE:`
- followed by saved facts if any exist
- otherwise the raw final text

## Logging

`TaskManager` normalizes logs into objects with:

- timestamp `t`
- `level`
- `data`

Logs are:

- stored on the task
- streamed over SSE
- capped at `maxLogs = 5000`

## Approval flow

Approval-gated tools call back into `TaskManager._requestApproval()`.
That:

- creates an approval id
- stores resolver metadata in `pendingApprovals`
- changes task status to `awaiting_approval`
- emits `approval_required` over SSE

The UI resolves approval through `POST /tasks/:id/approvals/:approvalId`.
When the last pending approval is resolved, status returns to `running`.

## Persistence and restart behavior

Tasks are serialized to `threads/<id>.json`.
On startup, `TaskManager.init()` reloads them.
If a task was persisted as `running` or `awaiting_approval`, it is converted to `error` with a restart-interruption warning log.

## Parent/child tasks

`TaskManager.startChildTask()` creates child tasks linked to a parent task id.
The task summary includes `parentTaskId` and `childTaskIds`.
This is used by thread tools for delegated work.
