# Knowledge Base Index

> **Historical snapshot (2026-05-14).** These compiled articles preserve earlier implementation context and are not current operator or release guidance. Start with the maintained [Ender documentation](../docs/README.md), then use the current architecture and release-readiness records linked there.

## project

Articles about the Ender project as a whole.

| Article | Summary | Updated |
|---------|---------|---------|
| [Ender Overview](project/ender-overview.md) | Local-first agent runtime with LangChain, React/Electron UI, guided workflows, schedules, task ledger, multi-backend LLM support incl. ACP | 2026-05-14 |

## runtime

Articles about the Ender runtime loop and task execution.

| Article | Summary | Updated |
|---------|---------|---------|
| [Runtime Loop](runtime/runtime-loop.md) | Iterative model/tool loop, stall detection, approvals, SSE logging, task lifecycle, parent/child tasks, persistence and restart | 2026-05-14 |

## workflows

Articles about Ender workflows and schedules.

| Article | Summary | Updated |
|---------|---------|---------|
| [Workflows and Schedules](workflows/workflows-and-schedules.md) | Server-defined state machines, jira_to_repo_task built-in workflow, workflow modes (interactive/schedule_config/scheduled_run), schedule targets (prompt/thread/workflow), UI rendering | 2026-05-14 |

## self-update

Articles about Ender's supervised self-update system.

| Article | Summary | Updated |
|---------|---------|---------|
| [Self-Update Architecture](self-update/self-update.md) | External supervisor process, checkpoint/verify/restart/rollback flow, workspace-gated self-update tools, operation statuses | 2026-05-14 |

## ui

Articles about the Ender operator console UI.

| Article | Summary | Updated |
|---------|---------|---------|
| [UI Operator Console](ui/ui-operator-console.md) | React operator console for task launching, live logs, approvals, workflows, schedules; App.jsx shell; agentClient REST/SSE; localStorage persistence | 2026-05-14 |
