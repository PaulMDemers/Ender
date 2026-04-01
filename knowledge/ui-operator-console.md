# UI Operator Console

## Main entrypoints

- `ui/src/App.jsx`
- `ui/src/agentClient.js`
- `ui/src/hooks/useTaskLogs.js`

## What the UI does

The React app is the operator console for:

- starting direct tasks
- browsing and selecting threads
- viewing live logs and final results
- approving sensitive actions
- running guided workflows
- creating and editing schedules
- switching between saved server endpoints
- showing readiness/setup hints from `/health`

## App shell

`ui/src/App.jsx` is the main orchestrator.
It owns state for:

- tasks and selected task
- server URL and saved servers
- compose mode: new, thread, workflow, schedule
- workflow session state
- schedules
- health/readiness
- archived/pinned thread UI state
- reconnect notices and sidebar state

## Data flow

`agentClient.js` wraps all REST calls and SSE setup.
Important methods include:

- `listTasks`, `startTask`, `continueTask`, `terminateTask`, `rerunTask`
- `resolveApproval`
- `listWorkflows`, `createWorkflowSession`, `advanceWorkflowSession`, `retreatWorkflowSession`
- `listSchedules`, `createSchedule`, `updateSchedule`, `runScheduleNow`, `deleteSchedule`
- `getHealth`
- `streamLogs`

## Live transcript flow

When a thread is selected, `useTaskLogs` attaches to `/tasks/:id/stream` via `EventSource`.
The stream handles:

- `status`
- `log`
- `approval_required`
- `complete`
- `ping`

The UI merges streamed state with periodic polling of `/tasks`.

## Modes in the UI

### New Thread

Shows `NewTaskForm` and launches a direct task.

### Thread

Shows:

- `ApprovalPrompt` when approvals are pending
- `LogViewer` for transcript/logs
- `ThreadComposer` for follow-up prompts when the thread is idle

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
- supports prompt/thread/workflow targets
- embeds workflow configuration for schedulable workflows
- lists current schedules and last-run metadata

## Persistence in the browser

The UI stores some local state in `localStorage`, including:

- saved server endpoints
- selected API base
- per-server thread UI state like pinned/archived
- sidebar collapse state
- resumable workflow session ids per server

## Readiness UX

The UI polls `/health` every 15 seconds and surfaces:

- LLM readiness
- workflow readiness
- browser capture readiness
- GitHub token readiness
- self-update readiness
- stream attachment state

This is important because many features are conditionally usable based on env config.

## Important UI assumption

Workflow rendering is generic and contract-driven.
If a new workflow stays within the shared step schema, the UI usually does not need custom code.
