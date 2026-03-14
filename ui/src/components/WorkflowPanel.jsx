import { useEffect, useState } from "react";

function WorkflowList({ workflows, onStart }) {
  return (
    <div className="workflowList">
      {workflows.map((workflow) => (
        <button key={workflow.id} type="button" className="workflowCard" onClick={() => onStart?.(workflow.id)}>
          <div className="workflowName">{workflow.name}</div>
          <div className="workflowDesc">{workflow.description}</div>
        </button>
      ))}
      {!workflows.length ? <div className="emptyState">No workflows available</div> : null}
    </div>
  );
}

function normalizeOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions.map((option) => {
    if (option && typeof option === "object") {
      return {
        value: String(option.value ?? ""),
        label: String(option.label ?? option.value ?? ""),
        description: option.description ? String(option.description) : "",
        meta: option.meta && typeof option.meta === "object" ? option.meta : {}
      };
    }
    return {
      value: String(option ?? ""),
      label: String(option ?? ""),
      description: "",
      meta: {}
    };
  });
}

function normalizeFilters(step) {
  if (Array.isArray(step?.filters)) {
    return step.filters.map((filter) => ({
      id: String(filter.id),
      label: String(filter.label || filter.id),
      type: filter.type || "select",
      mode: filter.mode || (filter.serverDriven ? "server" : "client"),
      value: filter.value ?? "",
      applyAction: filter.applyAction || "filter",
      applyLabel: filter.applyLabel || "Apply",
      options: normalizeOptions(filter.options || [])
    }));
  }

  if (step?.filters && typeof step.filters === "object") {
    return Object.entries(step.filters).map(([id, filter]) => ({
      id,
      label: String(filter?.label || id),
      type: filter?.type || "select",
      mode: filter?.mode || (filter?.serverDriven ? "server" : "client"),
      value: filter?.value ?? "",
      applyAction: filter?.applyAction || "filter",
      applyLabel: filter?.applyLabel || "Apply",
      options: normalizeOptions(filter?.options || [])
    }));
  }

  return [];
}

function initialFieldValues(fields) {
  const next = {};
  for (const field of fields || []) {
    if (!field?.id) continue;
    if (field.defaultValue !== undefined) {
      next[field.id] = field.defaultValue;
      continue;
    }
    next[field.id] = field.type === "checkbox" ? false : "";
  }
  return next;
}

function StepForm({ step, onSubmit, busy }) {
  const fields = Array.isArray(step?.fields) ? step.fields : [];
  const [values, setValues] = useState(() => initialFieldValues(fields));

  useEffect(() => {
    setValues(initialFieldValues(fields));
  }, [step?.id]);

  const submit = (e) => {
    e?.preventDefault?.();
    const payload = step?.submitAction ? { action: step.submitAction, ...values } : values;
    onSubmit?.(payload);
  };

  const submitLabel = step?.submitLabel || "Continue";

  return (
    <form className="workflowStep" onSubmit={submit}>
      {fields.map((field) => (
        <label key={field.id} className="workflowField">
          <span className="workflowFieldLabel">{field.label}</span>
          {field.type === "select" ? (
            <select
              className="serverInput"
              value={values[field.id] || field.defaultValue || ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
              required={Boolean(field.required)}
            >
              <option value="">{field.placeholder || "Select..."}</option>
              {normalizeOptions(field.options || []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              className="serverInput"
              placeholder={field.placeholder || ""}
              value={values[field.id] || ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
              required={Boolean(field.required)}
              rows={field.rows || 4}
            />
          ) : field.type === "checkbox" ? (
            <input
              type="checkbox"
              checked={Boolean(values[field.id])}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.checked }))}
            />
          ) : (
            <input
              type={field.type === "number" ? "number" : "text"}
              className="serverInput"
              placeholder={field.placeholder || ""}
              value={values[field.id] || ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
              required={Boolean(field.required)}
            />
          )}
        </label>
      ))}
      <button className="actionButton workflowAction" disabled={busy} type="submit">
        {busy ? "Working..." : submitLabel}
      </button>
    </form>
  );
}

function StepSelect({ step, onSubmit, busy }) {
  const filters = normalizeFilters(step);
  const selectOptions = normalizeOptions(step?.options || []);
  const [filterValues, setFilterValues] = useState({});

  useEffect(() => {
    const next = {};
    for (const filter of filters) {
      next[filter.id] = filter.value ?? "";
    }
    setFilterValues(next);
  }, [step?.id]);

  const clientFilters = filters.filter((filter) => filter.mode !== "server");
  const serverFilters = filters.filter((filter) => filter.mode === "server");

  const visibleOptions = selectOptions.filter((option) => {
    for (const filter of clientFilters) {
      const selected = filterValues[filter.id] ?? "";
      if (!selected || selected === "all") continue;
      if (String(option.meta?.[filter.id] ?? "") !== String(selected)) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="workflowSelect">
      {filters.length ? (
        <div className="workflowFilter">
          {filters.map((filter) => (
            <label key={filter.id} className="workflowField">
              <span className="workflowFieldLabel">{filter.label}</span>
              <div className="workflowFilterRow">
                <select
                  className="serverInput"
                  value={filterValues[filter.id] ?? ""}
                  onChange={(e) => setFilterValues((prev) => ({ ...prev, [filter.id]: e.target.value }))}
                >
                  {filter.options.map((option) => (
                    <option key={`${filter.id}-${option.value}`} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {filter.mode === "server" ? (
                  <button
                    type="button"
                    className="miniButton workflowFilterButton"
                    disabled={busy}
                    onClick={() => onSubmit?.({ action: filter.applyAction || "filter", filters: filterValues })}
                  >
                    {filter.applyLabel || "Apply"}
                  </button>
                ) : null}
              </div>
            </label>
          ))}
          {serverFilters.length ? null : (
            <div className="emptyState">Filters update this list instantly.</div>
          )}
        </div>
      ) : null}

      <div className="workflowList">
      {visibleOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className="workflowCard"
          disabled={busy}
          onClick={() => onSubmit?.({ action: step?.selectAction || "select", value: option.value, filters: filterValues })}
        >
          <div className="workflowName">{option.label}</div>
          {option.description ? <div className="workflowDesc">{option.description}</div> : null}
        </button>
      ))}
      {!selectOptions.length ? <div className="emptyState">No options returned for this step</div> : null}
      {selectOptions.length && !visibleOptions.length ? <div className="emptyState">No options match the selected filters</div> : null}
      </div>
    </div>
  );
}

export default function WorkflowPanel({
  workflows,
  loading,
  error,
  session,
  busy,
  onStartWorkflow,
  onAdvance,
  onBack,
  onReset
}) {
  const step = session?.currentStep || null;
  const effectiveError = error || session?.bootstrapError || "";
  const debugEntries = Array.isArray(session?.debug) ? session.debug : [];

  return (
    <div className="workflowPanel">
      {!session ? (
        <>
          <div className="blankPanelTitle">Choose a workflow</div>
          <div className="blankPanelText">
            Workflows guide multi-step setup before Ender starts the task.
          </div>
          {loading ? <div className="emptyState">Loading workflows...</div> : <WorkflowList workflows={workflows} onStart={onStartWorkflow} />}
        </>
      ) : (
        <>
          <div className="blankPanelTitle">{step?.title || session.workflowName}</div>
          {step?.description ? <div className="blankPanelText">{step.description}</div> : null}
          {!session?.startedTaskId ? (
            <div className="workflowStepActions">
              <button type="button" className="miniButton" disabled={busy} onClick={() => onReset?.()}>
                Choose Workflow
              </button>
              {session?.canGoBack ? (
                <button type="button" className="miniButton" disabled={busy} onClick={() => onBack?.()}>
                  Back
                </button>
              ) : null}
            </div>
          ) : null}
          {step?.type === "form" ? <StepForm step={step} onSubmit={onAdvance} busy={busy} /> : null}
          {step?.type === "select" ? <StepSelect step={step} onSubmit={onAdvance} busy={busy} /> : null}
          {step?.type === "complete" ? (
            <div className="blankPanelText">Workflow complete.</div>
          ) : null}
        </>
      )}
      {effectiveError ? <div className="errorText">{effectiveError}</div> : null}
      {debugEntries.length ? (
        <details className="workflowDebug">
          <summary>Debug Info</summary>
          <pre className="workflowDebugPre">{JSON.stringify(debugEntries, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
