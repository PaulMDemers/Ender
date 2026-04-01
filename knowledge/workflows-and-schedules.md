# Workflows and Schedules

## Shared contract model

Shared enums live in `shared/contracts.json` and are wrapped by Zod schemas in `src/shared/contracts.js`.

Important enums:

- schedule target kinds: `prompt`, `thread`, `workflow`
- workflow modes: `interactive`, `schedule_config`, `scheduled_run`
- workflow step types: `form`, `select`, `complete`

The UI depends on these shared contracts, so backend and frontend stay aligned.

## Workflow architecture

Workflows are server-defined state machines.
A workflow definition provides:

- `id`
- `name`
- `description`
- `supportsScheduling`
- `createInitialState()`
- `getCurrentStep(session)`
- `advance(session, input, context)`

Definitions are statically registered in `src/workflows/index.js`.

## Workflow session lifecycle

`WorkflowManager` creates a session with:

- workflow id
- mode
- status
- history stack for back navigation
- mutable `state`

Advancing a session:

- clones previous state into history
- calls workflow `advance()`
- persists the updated session unless it is `scheduled_run`
- returns serialized session plus optional `startedTaskId`

Back navigation is blocked once a workflow has already started a task.

## Built-in workflow: jira_to_repo_task

File: `src/workflows/jiraToRepoWorkflow.js`

Stages:

1. `project`
2. `board`
3. `issue`
4. `repo`
5. `delivery`
6. `jira_outcome`
7. `complete`

What it does:

- loads Jira projects
- loads boards for the selected project
- loads project statuses for issue filtering
- loads issues for the selected board
- loads full issue details and transitions
- clones or plans a repository target
- captures commit/push policy
- captures final Jira transition policy
- builds a task prompt and starts a task

## Jira workflow implementation notes

Useful helpers inside the workflow:

- `loadProjects()`
- `loadBoards()`
- `loadProjectStatuses()`
- `loadBoardIssues()`
- `loadIssueTransitions()`
- `resolveCloneTarget()`
- `buildTaskPrompt()`

The workflow also stores a bounded debug trace in `session.state.debug`, which the UI exposes in a collapsible debug panel.

## Clone behavior by mode

Repo step behavior differs by workflow mode:

### interactive

- clone happens immediately
- if target directory exists and is non-empty, workflow returns a clear collision error

### schedule_config

- clone is deferred
- workflow stores repo URL, directory, and preview path only
- no repository is cloned during configuration

### scheduled_run

- clone happens during execution
- if target directory is occupied, workflow auto-renames the directory with a timestamp-derived suffix

This behavior is covered by tests in `tests/group1-bugs.test.js`.

## Schedule architecture

`ScheduleManager` persists schedules and activates cron jobs with `node-cron`.

A schedule contains:

- `id`
- `name`
- `cron`
- `timezone`
- `enabled`
- `target`
- timestamps and last-run metadata

Target shapes:

### prompt

Starts a new task:

- `prompt`
- optional `workspace`

### thread

Continues an existing thread:

- `threadId`
- `prompt`

### workflow

Replays a workflow with stored step inputs:

- `workflowId`
- `inputs[]`

## Scheduled workflow replay

For workflow schedules, the UI first runs the workflow in `schedule_config` mode and stores the sequence of step inputs.
Later, `ScheduleManager` calls `workflowManager.runScheduled(workflowId, inputs)`.
That creates a `scheduled_run` session and replays the saved inputs until the workflow completes or starts a task.

## UI rendering model

The frontend does not hardcode workflow-specific screens.
`WorkflowStepRenderer.jsx` renders generic step payloads:

- `form`
- `select`
- `complete`

`select` steps can include filters, including server-driven filters that submit an action back to the workflow.
This is how the Jira issue step supports status filtering.
