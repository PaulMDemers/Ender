# Quick Start for Development Threads

## What this repo is

Ender is a local-first agent runtime with an Express API, React/Electron operator console, versioned local persistence, guided workflows, schedules, a global task ledger, optional editor sessions, and optional Pillar/Beacon cloud connectors.

## Read first

1. [`docs/README.md`](../docs/README.md)
2. [`docs/architecture/overview.md`](../docs/architecture/overview.md)
3. [`ROADMAP.md`](../ROADMAP.md) for current modernization continuity
4. The matching compatibility record: [`API_CONTRACTS.md`](../API_CONTRACTS.md), [`PERSISTENCE.md`](../PERSISTENCE.md), or [`FRONTEND_ARCHITECTURE.md`](../FRONTEND_ARCHITECTURE.md)
5. The smallest owning code boundary from [the repository map](repo-map.md)

## Mental model

- `src/server.js` composes managers and lifecycle; `src/api/app.js` composes middleware and domain routers.
- `TaskManager` coordinates lifecycle but extracted collaborators own execution preparation, approvals, storage, and transition policy.
- `runTask()` assembles a run; `runAgentLoop()` iterates model/tool calls.
- Interactive workflows are persisted server-defined state machines. Schedules replay prompt/thread/workflow targets. The task ledger is a separate durable work queue.
- `App.jsx` composes page-level transitions; domain hooks own server, task, transcript, automation, ledger, and editor state.
- Direct API access defaults to local clients. Pillar is the authenticated remote path.

## Before changing code

Answer these questions:

- Which module owns the state and retry behavior?
- Does this alter REST/SSE metadata, a shared workflow/schedule schema, or persisted records?
- Does cancellation or shutdown need to propagate through the change?
- Is an optional capability being confused with core readiness?
- Which focused test proves the behavior before the full gate?

## Verification

Use [testing and quality](testing-and-quality.md) to select a focused suite. Run `npm run verify` before closing a broad milestone. Environment-specific evidence belongs in [`RELEASE_READINESS.md`](../RELEASE_READINESS.md), not in an assumption or a generic unit test result.
