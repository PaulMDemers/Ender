# Self-Update Architecture

> Sources: Ender knowledge/self-update.md, 2026-05-14
> Raw: [2026-05-14-self-update.md](../../raw/self-update/2026-05-14-self-update.md)

## Overview

Ender can safely edit and restart its own repository only when running under an external supervisor process. This is intentionally separated from the normal server so that self-modification remains supervised and rollback-safe.

## Architecture

### External Supervisor

`scripts/ender-supervisor.js`:
- Launches the normal Ender server as a child process
- Exposes a local control API
- Stores checkpoints and operation records in `.ender-supervisor/`
- Can restart the child server
- Can roll back to a checkpoint if verification or restart health fails

Injects env vars into the child: `AGENT_SELF_ROOT`, `ENDER_SUPERVISOR_URL`, `ENDER_SUPERVISOR_TOKEN`, `AGENT_SELF_UPDATE_VERIFY`, `AGENT_SELF_UPDATE_TIMEOUT_MS`

### Backend Manager

`src/selfUpdate/manager.js` is a thin HTTP client to the supervisor. Exposes: `status()`, `listOperations()`, `getOperation(id)`, `createCheckpoint(label)`, `applyUpdate(input)`.

### Agent Tools

`src/tools/selfUpdateTools.js` exposes four tools: `self_update_status`, `self_update_checkpoint_create`, `self_update_apply`, `self_update_operations`.

## Safety Constraints

Self-update tools are only allowed when both are true:
1. supervisor is configured
2. current task workspace exactly matches the configured Ender repo root (`AGENT_SELF_ROOT`)

If the task runs in any other workspace, tools return `not_self_workspace`.

## Apply Flow

1. Create checkpoint
2. Edit Ender source
3. Call `self_update_apply`
4. Supervisor runs `npm run verify` (configurable via `AGENT_SELF_UPDATE_VERIFY`)
5. If verify passes, supervisor restarts child server
6. If health check passes, operation status is `applied`
7. If verify or health fails, supervisor rolls back and restarts

`self_update_apply` is approval-gated in the UI.

## Operation Statuses

`queued` → `running` → `applied`
`verify_failed` | `rolled_back` | `rollback_failed` | `failed`

## Persistence

Supervisor state lives in `.ender-supervisor/`: `checkpoints/` and `operations/`. This is separate from normal task/schedule persistence.

## Verification

`src/selfUpdate/runner.js` handles shelling out to the verify command, waiting for `/health`, and rollback on unhealthy boot. Default verify command: `npm run verify`. Default timeout: `90000ms`.

## See Also

[Ender Overview](../project/ender-overview.md)
[Runtime Loop Details](../runtime/runtime-loop.md)