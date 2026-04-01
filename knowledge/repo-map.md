# Repository Map

## Top-level layout

- `src/` — backend server, runtime loop, managers, tools, workflows, self-update
- `ui/` — React UI and Electron packaging
- `docs/` — user-facing docs, tutorials, architecture notes
- `tests/` — backend regression tests
- `scripts/` — dev launcher and external supervisor
- `shared/` — JSON contracts shared by backend and UI
- `threads/` — persisted task snapshots
- `schedules/` — persisted cron schedules
- `workflow-sessions/` — persisted interactive workflow sessions
- `workspace/` — default working directory for generated/cloned work

## Backend hotspots

### Server and API

- `src/server.js` — bootstraps config, managers, and Express app
- `src/api/app.js` — all REST endpoints
- `src/config.js` — env parsing, defaults, runtime OS description, system prompt wiring
- `src/health/readiness.js` — readiness payload for LLM/integrations/self-update

### Runtime

- `src/runtime/taskManager.js` — task lifecycle, SSE, approvals, persistence, reruns, follow-ups
- `src/runtime/runTask.js` — assembles model + tools + ledger for a task
- `src/runtime/runAgentLoop.js` — iterative model/tool loop with stall detection
- `src/state/ledger.js` — in-memory plan/todo/fact/progress structure

### Workflows and schedules

- `src/workflows/workflowManager.js` — workflow session lifecycle and persistence
- `src/workflows/index.js` — static workflow registry
- `src/workflows/jiraToRepoWorkflow.js` — built-in guided workflow
- `src/runtime/scheduleManager.js` — cron-backed schedule persistence and execution
- `src/shared/contracts.js` + `shared/contracts.json` — shared enums and schemas

### Self-update

- `scripts/ender-supervisor.js` — external supervisor process and control API
- `src/selfUpdate/manager.js` — backend client for supervisor API
- `src/selfUpdate/runner.js` — verify/restart/rollback flow
- `src/tools/selfUpdateTools.js` — tools exposed to the agent

### Tools

Tool modules live in `src/tools/`.
Important ones:

- `fileTools.js`
- `execTool.js`
- `gitTools.js`
- `githubTools.js`
- `gitlabTools.js`
- `jiraTools.js`
- `confluenceTools.js`
- `googleDriveTools.js`
- `emailTools.js`
- `cronTools.js`
- `threadTools.js`
- `ledgerTools.js`
- `selfUpdateTools.js`
- `webTools.js`

## UI hotspots

- `ui/src/App.jsx` — main shell, mode switching, task selection, health polling
- `ui/src/agentClient.js` — REST/SSE client
- `ui/src/components/WorkflowPanel.jsx` — guided workflow UX
- `ui/src/components/SchedulePanel.jsx` — schedule creation/editing UX
- `ui/src/components/WorkflowStepRenderer.jsx` — generic renderer for workflow step schema
- `ui/src/hooks/useTaskLogs.js` — live transcript stream handling

## Tests

- `tests/group1-bugs.test.js` — workflow/repo edge cases and clone behavior
- `tests/group2-runtime.test.js` — workflow persistence, schedule persistence, restart behavior, approvals
- `tests/group3-contracts.test.js` — shared contract validation
- `tests/self-update.test.js` — checkpoint and rollback behavior

## Docs worth cross-checking

- `docs/architecture/overview.md`
- `docs/architecture/runtime-loop.md`
- `docs/architecture/workflows-and-schedules.md`
- `docs/guides/custom-workflow.md`
- `docs/reference/workflow-step-schema.md`
