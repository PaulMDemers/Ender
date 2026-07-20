# UI Operator Console

> Sources: Ender knowledge/ui-operator-console.md, 2026-05-14
> Raw: [2026-05-14-ui-operator-console.md](../../raw/ui/2026-05-14-ui-operator-console.md)

> **Historical snapshot.** Use the maintained [frontend architecture](../../FRONTEND_ARCHITECTURE.md) and [operator documentation](../../docs/README.md) for the current interface.

## Overview

The React app is the operator console for Ender. It provides direct task launching, thread browsing and live log viewing, approval resolution, guided workflow execution, schedule management, and server endpoint switching.

## Main Entrypoints

- `ui/src/App.jsx` — main shell, mode switching, task selection, health polling
- `ui/src/agentClient.js` — REST/SSE client wrapping all API calls
- `ui/src/hooks/useTaskLogs.js` — live transcript stream handling via `EventSource`

## App Shell

`ui/src/App.jsx` is the main orchestrator. It owns state for:
- tasks and selected task
- server URL and saved servers
- compose mode: `new`, `thread`, `workflow`, `schedule`
- workflow session state
- schedules
- health/readiness
- archived/pinned thread UI state
- reconnect notices and sidebar state

## Data Flow

`agentClient.js` wraps all REST calls and SSE setup. Key methods:

| Category | Methods |
|----------|---------|
| Tasks | `listTasks`, `startTask`, `continueTask`, `terminateTask`, `rerunTask` |
| Approvals | `resolveApproval` |
| Workflows | `listWorkflows`, `createWorkflowSession`, `advanceWorkflowSession`, `retreatWorkflowSession` |
| Schedules | `listSchedules`, `createSchedule`, `updateSchedule`, `runScheduleNow`, `deleteSchedule` |
| Health | `getHealth`, `streamLogs` |

## Live Transcript Flow

When a thread is selected, `useTaskLogs` attaches to `/tasks/:id/stream` via `EventSource`. The stream delivers events: `status`, `log`, `approval_required`, `complete`, `ping`. The UI merges streamed state with periodic polling of `/tasks`.

## UI Modes

### New task
Shows `NewTaskForm` and launches a direct task.

### Thread
Shows `ApprovalPrompt` when approvals are pending, `LogViewer` for transcript/logs, `ThreadComposer` for follow-up prompts when thread is idle.

### Workflow
Shows `WorkflowPanel`, which:
- lists available workflows
- starts a workflow session
- renders current step through `WorkflowStepRenderer`
- supports back navigation
- shows workflow debug trace
- transitions to thread view when a workflow starts a task

### Schedule
Shows `SchedulePanel`, which:
- creates/edits schedules
- supports `prompt`/`thread`/`workflow` targets
- embeds workflow configuration for schedulable workflows
- lists current schedules and last-run metadata

## Browser Persistence

UI stores local state in `localStorage`:
- saved server endpoints
- selected API base
- per-server thread UI state (pinned/archived)
- sidebar collapse state
- resumable workflow session ids per server

## Readiness UX

UI polls `/health` every 15 seconds and surfaces readiness for: LLM, workflow, browser capture, GitHub token, self-update supervisor, stream attachment state.

## Key Assumption

Workflow rendering is generic and contract-driven (`form`/`select`/`complete` steps). New workflows within the shared step schema typically require no custom UI code.

## See Also

[Ender Overview](../project/ender-overview.md)
