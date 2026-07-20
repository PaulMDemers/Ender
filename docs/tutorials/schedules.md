# Create a Recurring Schedule

Schedules let Ender run work automatically on a cron cadence.

Schedule data is persisted in `schedules/` and reloaded on server start.

Choose **Schedules** in the primary navigation to create, inspect, run, enable/disable, edit, or delete schedules.

## Supported schedule targets

Ender supports three schedule target kinds:

1. `prompt`
2. `thread`
3. `workflow`

## Create a prompt schedule

Use this when you want Ender to start a new task on a cadence.

Example:

- name: `Daily repo scan`
- cron: `0 9 * * 1-5`
- timezone: `America/New_York`
- target type: `Start new prompt`
- prompt: `Review the repo, identify build failures, and summarize anything that needs attention.`

Result:

- each run starts a new task with `taskManager.start(...)`

## Create a thread continuation schedule

Use this when you want to resume the same thread repeatedly.

Example:

- name: `Weekly follow-up`
- target type: `Continue existing thread`
- thread: select an existing thread
- prompt: `Continue from the previous state and prepare the next action list.`

Result:

- each run calls `taskManager.continueTask(...)`

## Create a workflow schedule

Use this when you want to preconfigure a guided workflow once and let the schedule replay its saved inputs later.

Flow:

1. Choose `Run workflow`
2. Pick a workflow
3. Complete the workflow steps inside the schedule panel
4. Save the schedule

Under the hood, the UI:

- creates a workflow session with `mode: "schedule_config"`
- stores each submitted step input
- saves those inputs into `target.inputs`

When the schedule runs, `ScheduleManager` replays those saved inputs through the workflow.

## Example cron expressions

- Every weekday at 9:00 AM: `0 9 * * 1-5`
- Every day at midnight: `0 0 * * *`
- Every 30 minutes: `*/30 * * * *`

Ender uses `node-cron`, so standard five-field cron expressions apply.

## Running a schedule immediately

The UI supports a manual run action, which calls:

- `POST /schedules/:id/run`

This is useful for testing before waiting for the next cron tick.

## Failure behavior

Each schedule records:

- `lastRunAt`
- `lastRunStatus`
- `lastRunMessage`

If a run fails, Ender persists the error message to the schedule record.

## Things to know

- Disabled schedules stay on disk but do not register cron jobs.
- Schedule deletion is approval-gated when triggered through the cron tool inside a running task.
- Workflow schedules only work well when the workflow can complete from replayed saved inputs without extra interactive choices.

Use **Task ledger** instead when the work is a durable queue item that needs attempts, dispatch policy, execution outcomes, and a linked task record rather than a fixed cron cadence.

For failed runs, stale state, timezone problems, and task-ledger dispatch diagnosis, see [Troubleshoot Ender](../guides/troubleshooting.md).
