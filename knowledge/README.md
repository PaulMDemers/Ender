# Ender Knowledge Base

Purpose: fast onboarding for future threads working in this repository.

## Files

- [quick-start-for-agents.md](quick-start-for-agents.md) — fastest high-signal orientation for future coding threads
- [change-playbooks.md](change-playbooks.md) — repo-specific safe-change checklists for workflows, contracts, schedules, runtime, approvals, UI/API, self-update, and persistence
- [glossary.md](glossary.md) — repo-specific terms and exact meanings for tasks, threads, workflows, schedules, approvals, self-update, and persistence boundaries
- [troubleshooting.md](troubleshooting.md) — common failure modes, where to inspect first, and fast diagnosis paths
- [repo-map.md](repo-map.md) — top-level structure and where to look first
- [architecture.md](architecture.md) — backend, UI, persistence, and request flow
- [runtime-loop.md](runtime-loop.md) — task lifecycle, tool loop, approvals, and persistence
- [workflows-and-schedules.md](workflows-and-schedules.md) — workflow model, built-in Jira workflow, and cron scheduling
- [ui-operator-console.md](ui-operator-console.md) — React app structure and operator flows
- [self-update.md](self-update.md) — supervised self-update architecture and constraints
- [testing-and-quality.md](testing-and-quality.md) — scripts, test coverage, and verification expectations

## Recommended read order

1. `knowledge/quick-start-for-agents.md`
2. `knowledge/change-playbooks.md`
3. `knowledge/glossary.md`
4. `knowledge/troubleshooting.md`
5. `README.md`
6. `src/server.js`
7. `src/api/app.js`
8. `src/runtime/taskManager.js`
9. `src/runtime/runTask.js`
10. `src/runtime/runAgentLoop.js`
11. `src/workflows/workflowManager.js`
12. `src/workflows/jiraToRepoWorkflow.js`
13. `src/runtime/scheduleManager.js`
14. `ui/src/App.jsx`

## Quick orientation

Ender is a local-first agent runtime with:

- Express API in `src/`
- React/Electron operator UI in `ui/`
- persisted threads in `threads/`
- persisted schedules in `schedules/`
- persisted workflow sessions in `workflow-sessions/`

The main backend entrypoint is `src/server.js`.
The main UI entrypoint is `ui/src/App.jsx`.

## First files to read

1. `knowledge/quick-start-for-agents.md`
2. `knowledge/change-playbooks.md`
3. `knowledge/glossary.md`
4. `knowledge/troubleshooting.md`
5. `README.md`
6. `src/server.js`
7. `src/api/app.js`
8. `src/runtime/taskManager.js`
9. `src/runtime/runTask.js`
10. `src/runtime/runAgentLoop.js`
11. `src/workflows/workflowManager.js`
12. `src/workflows/jiraToRepoWorkflow.js`
13. `src/runtime/scheduleManager.js`
14. `ui/src/App.jsx`
