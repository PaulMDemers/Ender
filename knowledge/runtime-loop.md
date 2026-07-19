# Runtime Loop: Developer Addendum

The maintained lifecycle overview is [`docs/architecture/runtime-loop.md`](../docs/architecture/runtime-loop.md).

## Ownership

`TaskManager` coordinates public lifecycle transitions, logs/SSE subscribers, persistence, approvals, execution, and terminal publication. It delegates storage to `JsonTaskRepository`, approval resolution to `TaskApprovalCoordinator`, and runtime invocation to `TaskExecutionRunner`.

`TaskExecutionRunner` prepares project workspaces and profile configuration before calling `runTask()`. `runTask()` assembles model, memory context, system prompt, tools, and abort signal. `runAgentLoop()` binds tools and iterates model/tool messages.

## Stop and cancellation paths

Runs stop on normal completion, no further tool calls, configured max steps, repeated-iteration stall detection, user termination, or server shutdown. Abort signals propagate through model calls, LangChain tools, ACP sessions, and shell subprocess groups.

Terminal publication order is deliberate: status transition, persistence, `complete` SSE, waiter resolution, notification, and subscriber close. Keep ordering assertions when changing this path.

## Approval path

Approval-gated tools call the injected approval callback. `TaskApprovalCoordinator` stores pending metadata and resolvers; `TaskManager` transitions to `awaiting_approval` and publishes `approval_required`. Resolution uses `POST /tasks/:id/approvals/:approvalId`; the final resolved approval returns the task to `running` if execution remains active.

## Persistence and restart

Task records use `recordVersion: 1` and are atomically replaced. Legacy unversioned records migrate sequentially; malformed and future-version records are skipped rather than overwritten. Interrupted tasks recover according to the configured auto-restart policy, with Ender self-root tasks retaining their explicit self-update continuity behavior.

See [`PERSISTENCE.md`](../PERSISTENCE.md) and [`API_CONTRACTS.md`](../API_CONTRACTS.md) before changing records or SSE behavior.
