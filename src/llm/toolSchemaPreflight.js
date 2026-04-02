const { zodFunction } = require("openai/helpers/zod");

const STRICT_BACKENDS = new Set(["openai", "azure"]);
const UNSUPPORTED_FORMATS = new Set(["uri"]);

function traverseSchema(node, visit, path = []) {
  if (!node || typeof node !== "object") {
    return;
  }

  visit(node, path);

  if (Array.isArray(node)) {
    node.forEach((value, index) => traverseSchema(value, visit, [...path, index]));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    traverseSchema(value, visit, [...path, key]);
  }
}

function compileToolSchema(toolDef) {
  const warnings = [];
  const originalWarn = console.warn;

  console.warn = (...args) => {
    warnings.push(args.map((item) => String(item)).join(" "));
  };

  try {
    return {
      compiled: zodFunction({
        name: toolDef.name,
        parameters: toolDef.schema
      }),
      warnings
    };
  } finally {
    console.warn = originalWarn;
  }
}

function collectSchemaProblems(name, compiled, warnings) {
  const jsonSchema = compiled?.function?.parameters || compiled?.parameters || null;
  const problems = [];

  for (const warning of warnings) {
    if (warning) {
      problems.push(warning.trim());
    }
  }

  traverseSchema(jsonSchema, (node, path) => {
    if (Object.prototype.hasOwnProperty.call(node, "not") && typeof node.type !== "string") {
      problems.push(`${name}: schema node at ${path.join(".") || "<root>"} has 'not' without a string type`);
    }

    if (typeof node.format === "string" && UNSUPPORTED_FORMATS.has(node.format)) {
      problems.push(`${name}: schema node at ${path.join(".") || "<root>"} uses unsupported format '${node.format}'`);
    }
  });

  return { jsonSchema, problems };
}

function validateToolSchemasForBackend(backend, tools, { onLog } = {}) {
  if (!STRICT_BACKENDS.has(String(backend || ""))) {
    return { ok: true, count: Array.isArray(tools) ? tools.length : 0 };
  }

  const allProblems = [];
  const validated = [];

  for (const toolDef of tools || []) {
    if (!toolDef?.name || !toolDef?.schema) {
      continue;
    }

    const { compiled, warnings } = compileToolSchema(toolDef);
    const { problems } = collectSchemaProblems(toolDef.name, compiled, warnings);
    if (problems.length) {
      allProblems.push(...problems);
    } else {
      validated.push(toolDef.name);
    }
  }

  if (allProblems.length) {
    const error = new Error(`Tool schema preflight failed:\n- ${allProblems.join("\n- ")}`);
    error.code = "tool_schema_preflight_failed";
    throw error;
  }

  onLog?.({ level: "info", data: `validated ${validated.length} tool schemas for ${backend}` });
  return { ok: true, count: validated.length };
}

module.exports = { validateToolSchemasForBackend };
