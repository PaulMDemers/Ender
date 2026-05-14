# Self-Update Architecture

> Source: /home/markus/Projects/Ender/knowledge/self-update.md
> Collected: 2026-05-14
> Published: Unknown

## Purpose

Ender can safely edit and restart its own repository only when running under the external supervisor. This is intentionally separated from the normal server process.

## Main files

- `scripts/ender-supervisor.js` — external supervisor process
- `src/selfUpdate/manager.js` — backend client for supervisor API
- `src/selfUpdate/runner.js` — verify/restart/rollback flow
- `src/selfUpdate/checkpoints.js` — checkpoint management
- `src/tools/selfUpdateTools.js` — tools exposed to the agent

## Architecture

### External supervisor

`scripts/ender-supervisor.js`:
- launches the normal Ender server as a child process
- exposes a local control API
- stores checkpoints and operation records in `.ender-supervisor/`
- can restart the child server
- can roll back to a checkpoint if verification or restart health fails

Injects env vars: `AGENT_SELF_ROOT`, `ENDER_SUPERVISOR_URL`, `ENDER_SUPERVISOR_TOKEN`, `AGENT_SELF_UPDATE_VERIFY`, `AGENT_SELF_UPDATE_TIMEOUT_MS`

### Backend manager

`src/selfUpdate/manager.js` is a thin HTTP client to the supervisor. Exposes: `status()`, `listOperations()`, `getOperation(id)`, `createCheckpoint(label)`, `applyUpdate(input)`.

### Agent tools

`src/tools/selfUpdateTools.js` exposes: `self_update_status`, `self_update_checkpoint_create`, `self_update_apply`, `self_update_operations`

## Safety constraints

Self-update tools are only allowed when both are true:
1. supervisor is configured
2. current task workspace exactly matches the configured Ender repo root

If the task is running in any other workspace, self-update tools return `not_self_workspace`.

## Apply flow

1. create checkpoint
2. edit Ender source
3. call `self_update_apply`
4. supervisor runs verify command
5. if verify passes, supervisor restarts child server
6. if health check passes, operation is `applied`
7. if verify or health fails, supervisor rolls back and restarts again

`self_update_apply` is approval-gated in the UI.

## Operation statuses

- `queued`, `running`, `applied`, `verify_failed`, `rolled_back`, `rollback_failed`, `failed`

## Persistence

Supervisor state lives in `.ender-supervisor/`: `checkpoints/` and `operations/`. This is separate from normal task/schedule persistence.