# UI Operator Console: Developer Addendum

The maintained UI ownership map is [`FRONTEND_ARCHITECTURE.md`](../FRONTEND_ARCHITECTURE.md); operator instructions start at [`docs/README.md`](../docs/README.md).

## Information architecture

Primary destinations are **New thread**, **Workflows**, **Schedules**, and **Task ledger**. Selecting a task opens its live transcript. Server management is a modal with endpoint state, versions, REST/SSE compatibility, exposure mode, and runtime capabilities. The editor can be docked, modal, or stacked depending on viewport and operator choice.

## State ownership

- `useServerConnection`: endpoints, health, catalogs, compatibility, and connection history
- `useTaskThreads`: task collection, selection support, collection mutations, and local thread metadata
- `useTaskLogs`: selected-task SSE/log/approval state
- `useAutomations`: workflows, schedules, session recovery, and automation mutations
- `useTaskLedger`: ledger collection, polling, mutations, capacity, and outcomes
- `useThreadEditor`: discovery, launch/stop, reachability, retry, credentials, and responsive presentation
- `App.jsx`: page-level composition, navigation transitions, and explicit cross-domain handoffs

Do not duplicate domain collections in `App.jsx`. A mutation should return its result; the composing layer explicitly refreshes/selects through the owning collection hook.

## Interaction contracts

- Advanced launch, follow-up, ledger, and credential controls remain available behind labelled disclosures.
- Initial health is **Checking**, not **Unavailable**. A reconnect message requires a prior success, failure, then recovery.
- Failed launch/follow-up/editor/automation operations retain the operator's inputs and expose a matching retry.
- Modal and mobile-navigation surfaces trap focus, dismiss with Escape, and restore focus.
- Recurring polls pause while the document is hidden, refresh on foreground, and never overlap.
- The same React build powers the browser and sandboxed Electron renderer.

## Verification

Use the matching Playwright file under `e2e/tests/`, then run `npm run verify`. Inspect visual output before accepting or updating a snapshot.
