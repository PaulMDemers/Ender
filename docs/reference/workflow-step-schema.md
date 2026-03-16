# Workflow UI Step Schema

This document formalizes the server-to-UI contract used by [`WorkflowStepRenderer.jsx`](../../ui/src/components/WorkflowStepRenderer.jsx).

Workflow UI in Ender is generated from the object returned by:

- `workflow.getCurrentStep(session)`

## Supported step types

### `form`

Used for text entry, textareas, checkboxes, numeric input, and select dropdowns.

Shape:

```js
{
  id: "repo",
  type: "form",
  title: "Clone repository",
  description: "Provide the repository to clone before starting the task.",
  submitLabel: "Continue",
  submitAction: "save", // optional
  fields: [...]
}
```

### `select`

Used for card-based selection flows, optionally with client-side or server-side filters.

Shape:

```js
{
  id: "issue",
  type: "select",
  title: "Select Jira item",
  description: "Pick the issue you want to work on.",
  selectAction: "select", // optional
  filters: [...],         // optional
  options: [...]
}
```

### `complete`

Marks the flow as configured or finished.

Shape:

```js
{
  id: "complete",
  type: "complete",
  title: "Workflow complete",
  description: "Started task abc123"
}
```

## `form.fields`

Each field supports:

- `id` required
- `label` required
- `type` optional, defaults to text-like input behavior
- `required` optional
- `placeholder` optional
- `defaultValue` optional
- `rows` optional for `textarea`
- `description` optional for `checkbox`
- `options` optional for `select`

Supported `type` values in the renderer:

- `text`
- `number`
- `textarea`
- `checkbox`
- `select`

Notes:

- Field state resets whenever `step.id` changes.
- Checkbox fields default to `false`.
- Other fields default to `""` unless `defaultValue` is present.
- Unknown field types fall back to a text input.

## `select.options`

Options are normalized to:

```js
{
  value: "ABC-123",
  label: "ABC-123 - Fix login redirect",
  description: "In Progress",
  meta: {
    status: "In Progress"
  }
}
```

`meta` is not rendered directly, but it is used for client-side filtering.

## `select.filters`

Filters may be an array or an object keyed by filter id. The renderer normalizes both shapes.

Supported properties:

- `id`
- `label`
- `type` currently treated as `select`
- `mode`: `client` or `server`
- `value`
- `applyAction`
- `applyLabel`
- `options`

### Client-side filters

Client filters update the visible options immediately in the browser by comparing:

- `option.meta[filter.id]`

against the selected filter value.

### Server-side filters

Server filters render an explicit apply button. When clicked, the UI submits:

```js
{
  action: filter.applyAction || "filter",
  filters: {
    [filter.id]: selectedValue
  }
}
```

Your workflow `advance` method is responsible for reloading data and returning a new step.

## Submit payloads

### `form`

Default payload:

```js
{
  fieldA: "...",
  fieldB: "..."
}
```

If `submitAction` is set:

```js
{
  action: "save",
  fieldA: "...",
  fieldB: "..."
}
```

### `select`

Option click payload:

```js
{
  action: step.selectAction || "select",
  value: option.value,
  filters: currentFilterValues
}
```

## Session shape consumed by the UI

The workflow panel expects a serialized session like:

```js
{
  id,
  workflowId,
  workflowName,
  status,
  createdAt,
  updatedAt,
  startedTaskId,
  mode,
  canGoBack,
  bootstrapError,
  debug,
  currentStep
}
```

`WorkflowManager._serialize(...)` is the source of truth for this shape.

## Best practices

- Keep `step.id` stable for the duration of a step.
- Keep `state` JSON-serializable.
- Use `description` generously because the workflow panel surfaces it prominently.
- For long-running or remote-backed steps, append human-readable entries to `state.debug`.

