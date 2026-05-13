# Ender Project Overview

> Sources: Ender README.md, 2026-05-14; Knowledge base files, 2026-05-14
> Raw: [ender-project-overview.md](../../raw/project/2026-05-14-ender-project-overview.md)

## Overview

Ender is a local-first agent runtime with a React/Electron control surface, guided workflows, recurring schedules, and a tool-calling execution loop built on LangChain. It is designed for operator-driven work: launch a task against a workspace, watch the live transcript, approve sensitive actions, and keep thread history on disk.

## Architecture

Ender has three main surfaces:
1. **Backend API/runtime** in `src/` — Express API, managers, task runtime, tool implementations
2. **Operator UI** in `ui/` — React frontend with Electron desktop packaging
3. **Persisted JSON state** on disk — threads, schedules, workflow sessions, task ledger

### Boot sequence (`src/server.js`)

1. Load env config via `loadConfig()`
2. Create `TaskManager`, `LlmProfileManager`, `ProjectManager`, `MemoryManager`
3. Initialize persisted tasks from disk
4. Create `WorkflowManager`, initialize persisted workflow sessions
5. Create `ScheduleManager` and activate cron jobs
6. Create `SelfUpdateManager`, `CodeServerManager`, `TaskLedgerManager`
7. Wire managers together and start Express app

## Project Layout

```
ender/
├── src/         # API server, runtime loop, managers, tools, workflows
├── ui/          # React UI + Electron packaging
├── docs/         # Tutorials, references, architecture notes
├── knowledge/    # Fast onboarding docs for future threads
├── threads/      # Persisted task snapshots
├── schedules/    # Persisted cron schedules
├── task-ledger/  # Persisted global task ledger entries
├── workflow-sessions/  # Persisted interactive workflow sessions
└── workspace/   # Default working directory for cloned/generated work
```

## Backend Structure

### Runtime managers

| Manager | File | Responsibility |
|---------|------|----------------|
| TaskManager | `src/runtime/taskManager.js` | Task lifecycle, SSE, approvals, persistence, reruns, parent/child tasks |
| RunTask | `src/runtime/runTask.js` | Assembles model + tools + ledger + workspace for a task |
| RunAgentLoop | `src/runtime/runAgentLoop.js` | Iterative model/tool loop with stall detection |
| ScheduleManager | `src/runtime/scheduleManager.js` | Cron-backed schedule persistence and execution |
| WorkflowManager | `src/workflows/workflowManager.js` | Workflow session lifecycle and persistence |
| TaskLedgerManager | `src/runtime/taskLedgerManager.js` | Global task ledger for queue/dispatch |
| SelfUpdateManager | `src/selfUpdate/manager.js` | Client to external supervisor for self-edit |
| CodeServerManager | `src/runtime/codeServerManager.js` | Embedded code server lifecycle |
| ProjectManager | `src/runtime/projectManager.js` | Project context management |
| MemoryManager | `src/runtime/memoryManager.js` | Memory/persistence layer |

### Tool modules (`src/tools/`)

- `fileTools.js` — workspace file read/write/list/exists
- `execTool.js` — shell execution with approval gating
- `gitTools.js` — git operations
- `githubTools.js` — GitHub repo/PR operations
- `gitlabTools.js` — GitLab repo/MR operations
- `jiraTools.js` — Jira issue lookup, board listing, transitions
- `confluenceTools.js` — Confluence search/read/create/update
- `googleDriveTools.js` — Google Drive search/read/export/upload
- `emailTools.js` — IMAP/SMTP email
- `cronTools.js` — schedule create/list/delete
- `threadTools.js` — child thread spawn/status/await
- `ledgerTools.js` — in-memory plan/todo/fact/progress
- `selfUpdateTools.js` — checkpoint/apply/operations (workspace-gated)
- `webTools.js` — HTTP fetch, web search, page extraction
- `taskLedgerRuntimeTools.js` — ledger runtime tools for agent

### Key source files

- `src/server.js` — entry point
- `src/config.js` — env parsing, system prompt wiring
- `src/api/app.js` — all REST endpoints
- `src/health/readiness.js` — readiness reporting for `/health`
- `src/shared/contracts.js` + `shared/contracts.json` — shared enums/schemas

## UI Structure (`ui/`)

- `ui/src/App.jsx` — main shell, mode switching, task selection, health polling
- `ui/src/agentClient.js` — REST/SSE client
- `ui/src/components/WorkflowPanel.jsx` — guided workflow UX
- `ui/src/components/SchedulePanel.jsx` — schedule creation/editing
- `ui/src/components/WorkflowStepRenderer.jsx` — generic renderer for workflow step schema (form/select/complete)
- `ui/src/hooks/useTaskLogs.js` — live transcript stream handling
- `ui/electron/` — Electron packaging

## Runtime Loop

Normal task flow:
1. UI posts `POST /tasks`
2. `TaskManager.start()` creates task record, persists, starts `_runThread()`
3. `runTask()` assembles model + tools + ledger + workspace
4. `runAgentLoop()` iterates: model call → tool execution → `ToolMessage` append → repeat
5. Stop conditions: `DONE:` marker, `no_tool_calls`, `max_steps`, `stall_detected`
6. Final result stored on task, SSE emits completion event

Stall detection: fingerprints each iteration (tool name + sanitized args + summarized result). Repeated fingerprints beyond `AGENT_STALL_LIMIT` halt the loop.

Approval flow: approval-gated tools call `TaskManager._requestApproval()`, creating an approval id. Status changes to `awaiting_approval`, SSE emits `approval_required`. UI resolves via `POST /tasks/:id/approvals/:approvalId`.

Persistence: tasks serialized to `threads/<id>.json`. On restart, `running`/`awaiting_approval` tasks are reloaded as `error` with interruption warning (unless auto-restart is configured).

## Workflows

Workflows are server-defined state machines registered in `src/workflows/index.js`. Each provides `id`, `name`, `createInitialState()`, `getCurrentStep(session)`, `advance(session, input, context)`.

Built-in: `jira_to_repo_task` — stages: project → board → issue → repo → delivery → jira_outcome → complete. Handles Jira issue selection, repo clone, commit/push policy, Jira transition policy, then starts a task.

Modes:
- `interactive` — full session with back navigation, persisted
- `schedule_config` — configure for scheduling (clone deferred), persisted
- `scheduled_run` — replay saved inputs, ephemeral (not persisted)

## Schedules

`ScheduleManager` uses `node-cron` for cron activation. Targets:
- `prompt` — starts new task with optional workspace
- `thread` — continues existing thread with prompt
- `workflow` — replays workflow with stored step inputs

Workflow schedule flow: UI runs workflow in `schedule_config` mode to collect step inputs → stored → `ScheduleManager` calls `workflowManager.runScheduled()` at cron time.

## Task Ledger

Persisted global queue. `TaskLedgerManager` polls for finished linked threads and can auto-dispatch tasks up to `AGENT_TASK_LEDGER_MAX_AUTO_AGENTS` concurrent agents.

## Self-Update

Only available when Ender runs under `scripts/ender-supervisor.js` (external supervisor process). Enables safe self-edit/verify/restart/rollback of Ender's own repo.

Flow: create checkpoint → edit source → `self_update_apply` → supervisor runs `npm run verify` → restart on success / roll back on failure.

Tools are workspace-gated: only allowed when task workspace matches configured Ender repo root.

## LLM Backends

Supported: OpenAI, AWS Bedrock, Azure OpenAI, Ollama, ACP (Agent Client Protocol). Configuration via environment variables (`LLM_BACKEND`, matching credentials).

### ACP Backend

The ACP backend (`LLM_BACKEND=acp`) spawns an external ACP-compliant agent as a subprocess and mediates its tool access. When the agent requests permissions (file read/write, shell commands), Ender routes them through its own tool layer and approval system.

Configuration:
- `ACP_COMMAND` — the agent binary to spawn (e.g. `claude-code`)
- `ACP_ARGS` — CLI args passed to the agent (default: `acp`)

The ACP runner (`src/llm/acpAgentRunner.js`) uses `@agentclientprotocol/sdk` over stdio NDJSON. Permission requests are mapped to Ender's existing tools, preserving the operator approval flow.

## Quality Gates

- `npm test` — backend regression suite
- `npm run typecheck` — TypeScript check
- `npm run check` — backend syntax checks
- `npm run verify` — tests + typecheck + check + UI production build + e2e

## See Also

[Runtime Loop Details](runtime-loop.md)
[Workflow Architecture](workflows-and-schedules.md)
[Self-Update Architecture](../self-update/self-update.md)