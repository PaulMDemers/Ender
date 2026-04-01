# Self-Update

## Purpose

Ender can safely edit and restart its own repository only when running under the external supervisor.
This is intentionally separated from the normal server process.

## Main files

- `scripts/ender-supervisor.js`
- `src/selfUpdate/manager.js`
- `src/selfUpdate/runner.js`
- `src/selfUpdate/checkpoints.js`
- `src/tools/selfUpdateTools.js`

## Architecture

### External supervisor

`scripts/ender-supervisor.js`:

- launches the normal Ender server as a child process
- exposes a local control API
- stores checkpoints and operation records in `.ender-supervisor/`
- can restart the child server
- can roll back to a checkpoint if verification or restart health fails

It injects these env vars into the child:

- `AGENT_SELF_ROOT`
- `ENDER_SUPERVISOR_URL`
- `ENDER_SUPERVISOR_TOKEN`
- `AGENT_SELF_UPDATE_VERIFY`
- `AGENT_SELF_UPDATE_TIMEOUT_MS`

### Backend manager

`src/selfUpdate/manager.js` is a thin HTTP client to the supervisor.
It exposes:

- `status()`
- `listOperations()`
- `getOperation(id)`
- `createCheckpoint(label)`
- `applyUpdate(input)`

### Agent tools

`src/tools/selfUpdateTools.js` exposes four tools:

- `self_update_status`
- `self_update_checkpoint_create`
- `self_update_apply`
- `self_update_operations`

## Safety constraints

Self-update tools are only allowed when both are true:

1. supervisor is configured
2. current task workspace exactly matches the configured Ender repo root

If the task is running in any other workspace, self-update tools return `not_self_workspace`.

## Apply flow

Expected flow:

1. create checkpoint
2. edit Ender source
3. call `self_update_apply`
4. supervisor runs verify command
5. if verify passes, supervisor restarts child server
6. if health check passes, operation is `applied`
7. if verify or health fails, supervisor rolls back and restarts again

`self_update_apply` is approval-gated in the UI.

## Operation statuses

Observed statuses in code/tests include:

- `queued`
- `running`
- `applied`
- `verify_failed`
- `rolled_back`
- `rollback_failed`
- `failed`

## Verification and health

`src/selfUpdate/runner.js` handles:

- shelling out to the verify command
- waiting for `/health`
- rollback on unhealthy boot

Default verify command: `npm run verify`
Default timeout: `90000ms`

## Persistence

Supervisor state lives in `.ender-supervisor/`:

- `checkpoints/`
- `operations/`

This is separate from normal task/schedule persistence.

## Practical note for future threads

If a task is modifying Ender itself, prefer this sequence:

- confirm workspace is repo root
- create checkpoint before edits
- make changes
- run `self_update_apply`
- inspect `self_update_operations` after reconnect
