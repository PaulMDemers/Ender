# Workflows and Schedules

> Sources: Ender knowledge/workflows-and-schedules.md, 2026-05-14
> Raw: [2026-05-14-workflows-and-schedules.md](../../raw/workflows/2026-05-14-workflows-and-schedules.md)

> **Historical snapshot.** Use the maintained [workflows and schedules architecture](../../docs/architecture/workflows-and-schedules.md) for current behavior.

## Overview

Ender supports guided workflows (server-defined state machines) and cron-backed schedules. Workflows gather structured inputs before starting work; schedules automate recurring execution against prompt, thread, or workflow targets.

## Shared Contracts

Shared enums live in `shared/contracts.json` and are wrapped by Zod schemas in `src/shared/contracts.js`. Important enums:
- schedule target kinds: `prompt`, `thread`, `workflow`
- workflow modes: `interactive`, `schedule_config`, `scheduled_run`
- workflow step types: `form`, `select`, `complete`

## Workflow Architecture

Workflows are server-defined state machines registered in `src/workflows/index.js`. Each provides:
- `id`, `name`, `description`, `supportsScheduling`
- `createInitialState()`
- `getCurrentStep(session)`
- `advance(session, input, context)`

### Session Lifecycle

`WorkflowManager` creates a session with: workflow id, mode, status, history stack (for back navigation), mutable `state`.

Advancing: clones previous state into history, calls `advance()`, persists updated session (unless `scheduled_run`), returns serialized session plus optional `startedTaskId`.

Back navigation is blocked once a workflow has started a task.

### Modes

- **interactive**: full session with back navigation, persisted
- **schedule_config**: configure for scheduling (clone deferred), persisted
- **scheduled_run**: replay saved inputs, ephemeral (not persisted)

## Built-in Workflow: jira_to_repo_task

File: `src/workflows/jiraToRepoWorkflow.js`

Stages: project → board → issue → repo → delivery → jira_outcome → complete

The workflow:
1. Loads Jira projects, boards for selected project, project statuses for issue filtering
2. Loads issues for selected board, full issue details and transitions
3. Clones or plans a repository target
4. Captures commit/push policy and final Jira transition policy
5. Builds a task prompt and starts a task

Helper functions: `loadProjects()`, `loadBoards()`, `loadProjectStatuses()`, `loadBoardIssues()`, `loadIssueTransitions()`, `resolveCloneTarget()`, `buildTaskPrompt()`

### Clone Behavior by Mode

| Mode | Clone behavior |
|------|----------------|
| interactive | Immediate clone; collision error if target dir exists and is non-empty |
| schedule_config | Deferred; stores repo URL, directory, preview path only |
| scheduled_run | Clone at execution time; auto-renames occupied dirs with timestamp suffix |

## Schedule Architecture

`ScheduleManager` persists schedules to `schedules/*.json` and activates cron jobs with `node-cron`.

Schedule contains: id, name, cron, timezone, enabled, target, timestamps, last-run metadata.

### Target Shapes

- **prompt**: starts new task with optional `prompt` and `workspace`
- **thread**: continues existing thread with `threadId` and `prompt`
- **workflow**: replays workflow with `workflowId` and `inputs[]`

### Workflow Schedule Replay

UI runs the workflow in `schedule_config` mode to collect step inputs, which are stored. At cron time, `ScheduleManager` calls `workflowManager.runScheduled(workflowId, inputs)`, creating a `scheduled_run` session that replays the saved inputs until the workflow completes or starts a task.

## UI Rendering

`WorkflowStepRenderer.jsx` renders generic step payloads (`form`, `select`, `complete`). `select` steps can include server-driven filters that submit an action back to the workflow — this is how the Jira issue step supports status filtering.

## See Also

[Ender Overview](../project/ender-overview.md)
[Runtime Loop Details](../runtime/runtime-loop.md)
