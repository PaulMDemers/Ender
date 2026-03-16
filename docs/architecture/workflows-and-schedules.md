# Workflows and Schedules

Workflows and schedules are the two structured orchestration layers above the raw task runtime.

## Workflow architecture

Workflows are server-defined state machines that emit UI steps.

```mermaid
flowchart TD
    UI["Workflow Panel"] --> API["Workflow REST API"]
    API --> WM["WorkflowManager"]
    WM --> Def["Workflow definition"]
    Def --> State["session.state"]
    State --> Step["getCurrentStep(session)"]
    Step --> UI
    UI --> API2["advance / back"]
    API2 --> WM
    WM --> Def
```

## Workflow session lifecycle

1. UI requests a new session
2. `WorkflowManager.createSession(...)` calls `createInitialState(...)`
3. The workflow definition returns the first logical state
4. `getCurrentStep(session)` derives the current UI step
5. UI submits structured input
6. `advance(session, input, context)` mutates state
7. If the workflow starts a task, it returns `startedTaskId`

## UI generation model

The frontend does not know specific workflows ahead of time. It renders generic step shapes:

- `form`
- `select`
- `complete`

That means new workflows can usually be added without changing the UI, as long as they stay within the supported step schema.

See:

- [Workflow UI step schema](../reference/workflow-step-schema.md)

## Schedule architecture

Schedules are cron-backed launchers persisted to JSON.

```mermaid
flowchart LR
    UI["Schedule Panel"] --> API["Schedule REST API"]
    API --> SM["ScheduleManager"]
    SM --> Disk["schedules/*.json"]
    SM --> Cron["node-cron jobs"]
    Cron --> Exec["Schedule execution"]
    Exec --> Prompt["taskManager.start(...)"]
    Exec --> Thread["taskManager.continueTask(...)"]
    Exec --> Workflow["workflowManager.runScheduled(...)"]
```

## Workflow schedules

Workflow schedules add one extra layer:

```mermaid
sequenceDiagram
    participant UI as Schedule UI
    participant WM as WorkflowManager
    participant SM as ScheduleManager
    participant WF as Workflow Definition
    participant TM as TaskManager

    UI->>WM: createSession(mode=schedule_config)
    UI->>WM: advance saved inputs
    UI->>SM: save schedule with target.inputs
    Note over SM: Later, on cron tick
    SM->>WM: runScheduled(workflowId, inputs)
    WM->>WF: replay inputs
    WF->>TM: start task if workflow completes
```

This is why schedulable workflows need to behave well in both modes:

- `interactive`
- `schedule_config`

## Current limitations

- Workflow sessions are in-memory only
- Built-in workflows are registered statically in `src/workflows/index.js`
- The workflow renderer supports a narrow, intentionally simple UI schema

