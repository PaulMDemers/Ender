import { useEffect, useState } from "react";

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

function StepForm({ step, onSubmit, busy, submitLabel }) {
  const fields = Array.isArray(step?.fields) ? step.fields : [];
  const [values, setValues] = useState(() => initialFieldValues(fields));

  useEffect(() => {
    setValues(initialFieldValues(fields));
  }, [step?.id]);

  const submit = (event) => {
    event?.preventDefault?.();
    const payload = step?.submitAction ? { action: step.submitAction, ...values } : values;
    onSubmit?.(payload);
  };

  return (
    <form className="workflowStep" onSubmit={submit}>
      {fields.map((field) => (
        <label key={field.id} className="workflowField">
          <span className="workflowFieldLabel">{field.label}</span>
          {field.type === "select" ? (
            <select
              className="consoleInput"
              value={values[field.id] || field.defaultValue || ""}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
              required={Boolean(field.required)}
            >
              <option value="">{field.placeholder || "Select..."}</option>
              {normalizeOptions(field.options || []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              className="consoleTextarea compact"
              placeholder={field.placeholder || ""}
              value={values[field.id] || ""}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
              required={Boolean(field.required)}
              rows={field.rows || 4}
            />
          ) : field.type === "checkbox" ? (
            <label className="toggleField">
              <input
                type="checkbox"
                checked={Boolean(values[field.id])}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.checked }))}
              />
              <span>{field.description || "Enabled"}</span>
            </label>
          ) : (
            <input
              type={field.type === "number" ? "number" : "text"}
              className="consoleInput"
              placeholder={field.placeholder || ""}
              value={values[field.id] || ""}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
              required={Boolean(field.required)}
            />
          )}
        </label>
      ))}
      <div className="workflowActionBar">
        <button className="primaryButton workflowAction" disabled={busy} type="submit">
          {busy ? "Processing..." : submitLabel || step?.submitLabel || "Continue"}
        </button>
      </div>
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
        <div className="workflowFilters">
          {filters.map((filter) => (
            <label key={filter.id} className="workflowField">
              <span className="workflowFieldLabel">{filter.label}</span>
              <div className="workflowFilterRow">
                <select
                  className="consoleInput"
                  value={filterValues[filter.id] ?? ""}
                  onChange={(event) => setFilterValues((prev) => ({ ...prev, [filter.id]: event.target.value }))}
                >
                  {filter.options.map((option) => (
                    <option key={`${filter.id}-${option.value}`} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {filter.mode === "server" ? (
                  <button
                    type="button"
                    className="secondaryButton"
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
            <div className="panelNote">Client-side filters update these workflow options immediately.</div>
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
        {selectOptions.length && !visibleOptions.length ? <div className="emptyState">No options match the current filters</div> : null}
      </div>
    </div>
  );
}

export default function WorkflowStepRenderer({ step, onSubmit, busy, submitLabel }) {
  if (step?.type === "form") {
    return <StepForm step={step} onSubmit={onSubmit} busy={busy} submitLabel={submitLabel} />;
  }

  if (step?.type === "select") {
    return <StepSelect step={step} onSubmit={onSubmit} busy={busy} />;
  }

  if (step?.type === "complete") {
    return <div className="emptyState">Workflow configuration complete.</div>;
  }

  return null;
}
