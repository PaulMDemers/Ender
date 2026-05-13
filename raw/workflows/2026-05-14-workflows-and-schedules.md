# Workflows and Schedules

> Source: /home/markus/Projects/Ender/knowledge/workflows-and-schedules.md
> Collected: 2026-05-14
> Published: Unknown

## Shared contract model

Shared enums live in `shared/contracts.json` and are wrapped by Zod schemas in `src/shared/contracts.js`.

Important enums:
- schedule target kinds: `prompt`, `thread`, `workflow`
- workflow modes: `interactive`, `schedule_config`, `scheduled_run`
- workflow step types: `form`, `select`, `complete`

## Workflow architecture

Workflows are server-defined state machines. A workflow definition provides `id`, `name`, `description`, `supportsScheduling`, `createInitialState()`, `getCurrentStep(session)`, and `advance(session, input, context)`.

Definitions are statically registered in `src/workflows/index.js`.

## Workflow session lifecycle

`WorkflowManager` creates a session with workflow id, mode, status, history stack for back navigation, and mutable `state`.

Advancing a session: clones previous state into history, calls workflow `advance()`, persists the updated session unless it is `scheduled_run`, returns serialized session plus optional `startedTaskId`.

Back navigation is blocked once a workflow has already started a task.

## Built-in workflow: jira_to_repo_task

File: `src/workflows/jiraToRepoWorkflow.js`

Stages: project → board → issue → repo → delivery → jira_outcome → complete

What it does:
- loads Jira projects, boards for selected project, project statuses for issue filtering, issues for selected board
- loads full issue details and transitions
- clones or plans a repository target
- captures commit/push policy
- captures final Jira transition policy
- builds a task prompt and starts a task

## Clone behavior by mode

- **interactive**: clone happens immediately; if target directory exists and is non-empty, workflow returns a clear collision error
- **schedule_config**: clone deferred; workflow stores repo URL, directory, and preview path only
- **scheduled_run**: clone happens during execution; if target directory is occupied, workflow auto-renames with timestamp-derived suffix

## Schedule architecture

`ScheduleManager` persists schedules and activates cron jobs with `node-cron`.

Schedule contains: id, name, cron, timezone, enabled, target, timestamps and last-run metadata.

Target shapes:
- **prompt**: starts new task with optional `prompt` and `workspace`
- **thread**: continues existing thread with `threadId` and `prompt`
- **workflow**: replays workflow with `workflowId` and `inputs[]`

## UI rendering model

`WorkflowStepRenderer.jsx` renders generic step payloads: `form`, `select`, `complete`. `select` steps can include server-driven filters that submit an action back to the workflow.