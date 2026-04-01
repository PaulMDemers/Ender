# Architecture

## System shape

Ender has three main surfaces:

1. backend API/runtime in `src/`
2. operator UI in `ui/`
3. persisted JSON state on disk

High-level flow:

- operator uses React/Electron UI
- UI calls Express API
- API delegates to managers
- task runtime invokes LLM + tools
- managers persist threads, schedules, and workflow sessions to disk

## Boot sequence

`src/server.js` does the following in order:

1. loads env config via `loadConfig()`
2. creates `TaskManager`
3. initializes persisted tasks from disk
4. creates `WorkflowManager`
5. initializes persisted workflow sessions from disk
6. creates `ScheduleManager`
7. creates `SelfUpdateManager`
8. initializes schedules from disk and activates cron jobs
9. wires managers together
10. starts Express app on configured port

## Core managers

### TaskManager

File: `src/runtime/taskManager.js`

Owns:

- task creation and continuation
- reruns
- termination and deletion
- SSE subscribers
- approval requests and resolution
- thread persistence in `threads/*.json`
- workspace listing and directory browsing
- parent/child task relationships

Important behavior:

- running tasks interrupted by server restart are reloaded as `error`
- pending approvals are in memory during runtime, but approval metadata is also serialized
- deleting a task can optionally delete its workspace, but only for eligible child workspaces under the configured workdir

### WorkflowManager

File: `src/workflows/workflowManager.js`

Owns:

- workflow definition registry
- session creation
- step advancement and back navigation
- serialization for UI consumption
- persistence of interactive and schedule-config sessions
- ephemeral scheduled-run replay

Key modes:

- `interactive`
- `schedule_config`
- `scheduled_run`

Only `scheduled_run` is intentionally not persisted.

### ScheduleManager

File: `src/runtime/scheduleManager.js`

Owns:

- schedule CRUD
- cron activation via `node-cron`
- run-now execution
- persistence in `schedules/*.json`
- dispatch to prompt/thread/workflow targets

### SelfUpdateManager

File: `src/selfUpdate/manager.js`

Acts as a client to the external supervisor control API. It is only useful when Ender is launched under `scripts/ender-supervisor.js`.

## API surface

File: `src/api/app.js`

Main route groups:

- `/health`
- `/workspaces`
- `/filesystem/directories`
- `/tasks*`
- `/workflows*`
- `/workflow-sessions*`
- `/schedules*`
- `/self-update*`

The API is thin. Most real behavior lives in the managers.

## Persistence model

Persisted to disk:

- tasks in `threads/`
- schedules in `schedules/`
- workflow sessions in `workflow-sessions/`
- self-update supervisor state in `.ender-supervisor/`

In-memory only:

- active SSE connections
- live approval resolvers
- active cron job objects

## Configuration model

File: `src/config.js`

Config is parsed with Zod and normalized into a single object containing:

- runtime paths
- LLM backend selection
- provider credentials
- integration credentials
- self-update settings
- generated system prompt
- runtime OS description

Notable defaults:

- API port `3000`
- workdir `./workspace`
- workspace picker base `..`
- threads dir `./threads`
- schedules dir `./schedules`
- workflow sessions dir `./workflow-sessions`
- self-update verify command `npm run verify`
- self-update timeout `90000ms`

## Readiness reporting

File: `src/health/readiness.js`

`GET /health` reports readiness for:

- selected LLM backend
- Jira
- GitHub
- Confluence
- Google Drive
- browser capture / Playwright Chromium
- email
- self-update supervisor
- workflow-level readiness for `jira_to_repo_task`

The UI uses this to show setup hints and status chips.
