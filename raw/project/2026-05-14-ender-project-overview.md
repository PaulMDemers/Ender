# Ender Project Overview

> Source: /home/markus/Projects/Ender/README.md and knowledge files
> Collected: 2026-05-14
> Published: Unknown

## What Ender Is

Ender is a local-first agent runtime with a React/Electron control surface, guided workflows, recurring schedules, and a tool-calling execution loop built on LangChain.

It is designed for operator-driven work: launch a task against a workspace, watch the live transcript, approve sensitive actions, and keep thread history on disk.

## Core Functionality

- Runs an iterative tool-calling loop until the task is completed, stalled, canceled, or reaches a configured step cap.
- Exposes a local API for threads, live logs, approvals, workflows, schedules, health, and workspace browsing.
- Adds a persisted global task ledger that can queue work, auto-dispatch tasks, and track which thread completed each item.
- Ships a React UI and an Electron desktop app built from the same frontend.
- Persists threads, schedules, and workflow sessions to JSON on disk so they survive server restarts.
- Supports guided workflows that gather structured inputs before starting work.
- Supports recurring automation for three targets: start a new prompt, continue an existing thread, or run a workflow on a cron cadence.
- Works with multiple LLM backends: OpenAI, AWS Bedrock, Azure OpenAI, and Ollama.
- Includes tools for files, shell execution, git, GitHub, GitLab, Jira, Confluence, Google Drive, email, browser capture, schedules, and child threads.

## Project Layout

```
ender/
├── src/        # API server, runtime loop, managers, tools, workflows
├── ui/         # React UI + Electron packaging
├── docs/       # Tutorials, references, architecture notes
├── knowledge/  # Fast onboarding docs for future threads
├── threads/    # Persisted task snapshots
├── schedules/  # Persisted cron schedules
├── task-ledger/ # Persisted global task ledger entries
├── workflow-sessions/ # Persisted interactive workflow sessions
└── workspace/  # Default working directory for cloned/generated work
```

## Backend Structure

### src/ subdirectories

- `agents/` — agent definitions
- `api/` — Express REST endpoints
- `health/` — readiness checks
- `llm/` — LLM backend wrappers, profile manager
- `runtime/` — task execution, scheduling, task ledger, code server, project manager, memory manager
- `selfUpdate/` — supervised self-edit/verify/restart/rollback
- `startup/` — boot sequence utilities
- `state/` — in-memory structures (ledger)
- `tools/` — all tool implementations
- `utils/` — shared utilities
- `workflows/` — workflow definitions and manager

### Key runtime files

- `src/runtime/taskManager.js` — task lifecycle, SSE, approvals, persistence, reruns
- `src/runtime/runTask.js` — assembles model + tools + ledger for a task
- `src/runtime/runAgentLoop.js` — iterative model/tool loop with stall detection
- `src/runtime/scheduleManager.js` — cron-backed schedule persistence and execution
- `src/runtime/taskLedgerManager.js` — global task ledger
- `src/runtime/projectManager.js` — project context management
- `src/runtime/memoryManager.js` — memory/persistence layer
- `src/runtime/codeServerManager.js` — embedded code server lifecycle

### Key tool files

- `src/tools/fileTools.js` — workspace file operations
- `src/tools/execTool.js` — shell command execution with approval gating
- `src/tools/gitTools.js` — git clone/fetch/status/add/commit/pull/push
- `src/tools/githubTools.js` — GitHub repo/PR operations
- `src/tools/gitlabTools.js` — GitLab repo/MR operations
- `src/tools/jiraTools.js` — Jira issue lookup, board listing, transitions
- `src/tools/confluenceTools.js` — Confluence search/read/create/update
- `src/tools/googleDriveTools.js` — Google Drive search/read/export/upload
- `src/tools/emailTools.js` — IMAP email listing/reading, SMTP sending
- `src/tools/cronTools.js` — schedule create/list/delete
- `src/tools/threadTools.js` — child thread spawn/status/await
- `src/tools/ledgerTools.js` — task ledger facts/todos/progress
- `src/tools/selfUpdateTools.js` — self-update checkpoint/apply/operations
- `src/tools/webTools.js` — HTTP fetch, web search, page extraction
- `src/tools/taskLedgerRuntimeTools.js` — ledger runtime tools for agent

## UI Structure

### ui/ key files

- `ui/src/App.jsx` — main shell, mode switching, task selection, health polling
- `ui/src/agentClient.js` — REST/SSE client
- `ui/src/components/WorkflowPanel.jsx` — guided workflow UX
- `ui/src/components/SchedulePanel.jsx` — schedule creation/editing
- `ui/src/components/WorkflowStepRenderer.jsx` — generic renderer for workflow step schema
- `ui/src/hooks/useTaskLogs.js` — live transcript stream handling
- `ui/electron/` — Electron packaging

## Workflow Architecture

Workflows are server-defined state machines. A workflow definition provides `id`, `name`, `createInitialState()`, `getCurrentStep(session)`, and `advance(session, input, context)`.

Built-in workflow: `jira_to_repo_task` — walks through Jira project/board/issue selection, repository clone, commit/push policy, Jira outcome policy, then starts a task.

Workflow modes:
- `interactive` — full session with back navigation
- `schedule_config` — configure a workflow for scheduling (clone deferred)
- `scheduled_run` — replay saved step inputs (ephemeral, not persisted)

## Schedule Architecture

Schedule targets: `prompt` (new task), `thread` (continue existing), `workflow` (replay stored inputs).

`ScheduleManager` uses `node-cron` for cron activation and persists schedules to `schedules/*.json`.

## LLM Backends

Supported: OpenAI, AWS Bedrock, Azure OpenAI, Ollama. Configuration via environment variables.

## Self-Update Architecture

Only available when Ender runs under `scripts/ender-supervisor.js` (external supervisor). Enables safe self-edit/verify/restart/rollback of the Ender repo itself.

## Versioning

Version stored in `VERSION` and mirrored into server package, UI package, lockfiles, and UI runtime version module. Update via `npm run version:set`.

## Docker

`docker compose up --build` starts API (Dockerfile.api) and UI containers with bind mounts for threads, workspace, schedules, workflow-sessions.

## Quality Gates

- `npm test` — backend regression suite
- `npm run typecheck` — targeted TypeScript check
- `npm run verify` — tests + typecheck + syntax checks + UI production build