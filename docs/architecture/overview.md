# Architecture Overview

Ender is split into three major surfaces:

- the API/runtime server in `src/`
- the React/Electron operator UI in `ui/`
- persisted task and schedule state on disk

## High-level component map

```mermaid
flowchart LR
    User["Operator"] --> UI["React UI / Electron Shell"]
    UI --> API["Express API"]
    API --> TM["TaskManager"]
    API --> WM["WorkflowManager"]
    API --> SM["ScheduleManager"]
    TM --> Loop["runTask / runAgentLoop"]
    Loop --> LLM["LLM Backend"]
    Loop --> Tools["Tool Modules"]
    TM --> Threads["threads/*.json"]
    SM --> Schedules["schedules/*.json"]
    Loop --> Workspace["workspace/ or selected workspace"]
```

## Core responsibilities

### API layer

[`src/api/app.js`](../../src/api/app.js) exposes REST endpoints for:

- threads
- approvals
- workflow sessions
- schedules
- readiness and workspace browsing

### Task runtime

[`src/runtime/taskManager.js`](../../src/runtime/taskManager.js) owns:

- thread lifecycle
- log fanout and SSE
- approval resolution
- persistence to disk
- reruns and follow-up prompts

### Workflow layer

[`src/workflows/workflowManager.js`](../../src/workflows/workflowManager.js) owns:

- workflow definitions
- in-memory workflow sessions
- step serialization for the UI
- back navigation
- scheduled workflow replay

### Schedule layer

[`src/runtime/scheduleManager.js`](../../src/runtime/scheduleManager.js) owns:

- cron registration through `node-cron`
- schedule persistence
- run-now execution
- dispatch to prompt, thread, or workflow targets

### UI layer

The React app in `ui/src/` acts as the operator console for:

- thread launch
- transcript viewing
- approvals
- workflow interaction
- schedule creation

## State persistence model

Persisted:

- threads
- schedules
- workflow sessions

In-memory only:

- live SSE subscribers
- active approval resolvers

## Where to read next

- [Runtime loop and execution lifecycle](runtime-loop.md)
- [Workflows and schedules](workflows-and-schedules.md)
