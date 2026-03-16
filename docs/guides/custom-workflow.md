# Create a Custom Workflow

Custom workflows are server-defined state machines that drive the guided workflow UI.

Ender currently loads workflow definitions from [`src/workflows/index.js`](../../src/workflows/index.js).

## Workflow contract

Every workflow exports an object with:

- `id`
- `name`
- `description`
- `supportsScheduling` optional
- `createInitialState(input, context)`
- `getCurrentStep(session)`
- `advance(session, input, context)`

The template lives at:

- [`src/workflows/workflowTemplate.js`](../../src/workflows/workflowTemplate.js)

## Fastest way to add one

1. Copy the template to a new file in `src/workflows/`
2. Rename the exported workflow object
3. Register it in [`src/workflows/index.js`](../../src/workflows/index.js)
4. Restart the server

## Mental model

A workflow session contains:

- immutable metadata like `id` and `workflowId`
- a mutable `state` object
- an in-memory `history` stack for back navigation

Your workflow owns `state`. The UI only sees the derived `currentStep`.

## Recommended state pattern

Most workflows should keep a simple stage marker:

```js
{
  stage: "project",
  values: {},
  debug: []
}
```

Then `getCurrentStep(session)` can switch on `session.state.stage`.

## Returning UI

`getCurrentStep(session)` should return one of these step types:

- `form`
- `select`
- `complete`

See the full renderer contract in [Workflow UI step schema](../reference/workflow-step-schema.md).

## Starting a task

A workflow usually gathers structured inputs and then hands off to the normal task runtime:

```js
const started = taskManager.start(goal, workspace);
if (!started.ok) {
  return { ok: false, error: started.message || started.error || "Unable to start task" };
}

session.state.startedTaskId = started.id;
session.state.stage = "complete";
session.status = "completed";
return { ok: true, startedTaskId: started.id };
```

## Supporting back navigation

You do not need to implement history yourself. `WorkflowManager` snapshots the previous state before each successful `advance`.

To make back navigation usable:

- keep `state` JSON-serializable
- avoid storing functions or class instances in `state`
- avoid mutating nested structures in surprising ways between steps

## Supporting schedules

If a workflow should be schedulable, set:

```js
supportsScheduling: true
```

Then account for schedule configuration mode inside `advance`:

```js
if (session.mode === "schedule_config") {
  session.state.stage = "complete";
  session.status = "completed";
  return { ok: true };
}
```

In schedule mode, your workflow should:

- collect the same inputs
- avoid starting a task during configuration time
- optionally store a preview in state for debugging

At execution time, `ScheduleManager` replays the stored `inputs` through a fresh workflow session.

## Debugging

Follow the Jira workflow pattern and write a small debug trace into `session.state.debug`:

```js
session.state.debug = session.state.debug || [];
session.state.debug.push({
  t: new Date().toISOString(),
  step: "loadThings",
  total: items.length
});
```

The workflow panel renders this in a collapsible debug section.

## Bootstrap errors

If `createInitialState` cannot finish setup, return state with:

```js
{
  stage: "start",
  bootstrapError: "Explain what failed",
  debug: []
}
```

The session still opens and the UI shows the bootstrap error.

## Reference implementation

The best example in the repo today is:

- [`src/workflows/jiraToRepoWorkflow.js`](../../src/workflows/jiraToRepoWorkflow.js)

It demonstrates:

- async bootstrap
- server-side filtering
- external API calls
- repo cloning
- schedule mode
- task handoff

