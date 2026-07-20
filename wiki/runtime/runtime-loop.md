# Runtime Loop

> Sources: Ender knowledge/runtime-loop.md, 2026-05-14
> Raw: [2026-05-14-runtime-loop.md](../../raw/runtime/2026-05-14-runtime-loop.md)

> **Historical snapshot.** Use the maintained [runtime-loop architecture](../../docs/architecture/runtime-loop.md) for the current provider-neutral activity and transcript contracts.

## Overview

The runtime loop is the core of Ender's agent execution. It runs an iterative tool-calling loop until the task completes, stalls, is canceled, or reaches a configured step cap. All task execution flows through `runAgentLoop.js` and its orchestration chain.

## Task Lifecycle

Normal task flow:
1. UI posts `POST /tasks`
2. `TaskManager.start()` creates task record
3. task is persisted to `threads/<id>.json` and `_runThread()` begins
4. `runTask()` assembles model, tools, ledger, and workspace
5. `runAgentLoop()` iterates model/tool calls
6. final result stored on task; status becomes `done` or `error`
7. SSE subscribers receive status/log/complete events

Follow-up prompts (`POST /tasks/:id/messages`) reuse the same task/thread record.

## Conversation Model

`TaskManager` stores a simplified thread array of `{ role, content }` entries. Before a run, `_getRunThread()` trims context to the last 12 user/assistant messages. `runAgentLoop()` converts these into LangChain messages and prepends the system prompt.

## Tool Assembly

`runTask()` builds the tool list from many modules:
- file, web, git, GitHub, GitLab, Jira, Confluence, Google Drive, email tools
- cron tools (when `ScheduleManager` exists)
- child-thread tools (when `TaskManager` exists)
- self-update tools (when `SelfUpdateManager` exists)
- shell exec tool, ledger tools

## Loop Behavior

`runAgentLoop()`:
1. binds tools to the model
2. invokes the model
3. reads tool calls from the AI response
4. executes each tool
5. appends tool results as `ToolMessage`
6. repeats until a stop condition

Stop conditions: `done` (tool returned `DONE:`), `no_tool_calls`, `max_steps`, `stall_detected`.

## Stall Detection

The loop fingerprints each iteration (tool name + sanitized args + summarized result). Repeated fingerprints increment a counter. When it reaches `AGENT_STALL_LIMIT`, the run stops with `stall_detected`.

## Finalization

`runTask()` expects final text to start with `DONE:`. If the loop stops without that prefix and the ledger is not marked done, it creates a fallback result: `DONE:` followed by saved facts or the raw final text.

## Logging

`TaskManager` normalizes logs into objects with `t` (timestamp), `level`, and `data`. Logs are stored on the task, streamed over SSE, and capped at `maxLogs = 5000`.

## Approval Flow

Approval-gated tools call `TaskManager._requestApproval()`:
1. creates an approval id
2. stores resolver in `pendingApprovals`
3. changes task status to `awaiting_approval`
4. emits `approval_required` over SSE

UI resolves via `POST /tasks/:id/approvals/:approvalId`. When last pending approval resolves, status returns to `running`.

## Persistence and Restart

Tasks are serialized to `threads/<id>.json`. On startup, `TaskManager.init()` reloads them. Tasks that were `running` or `awaiting_approval` are converted to `error` with an interruption warning log.

## Parent/Child Tasks

`TaskManager.startChildTask()` creates child tasks linked to a parent via `parentTaskId`/`childTaskIds`. Used by thread tools for delegated work.

## See Also

[Ender Overview](../project/ender-overview.md)
[Workflow Architecture](../workflows/workflows-and-schedules.md)
