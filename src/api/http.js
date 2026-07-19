// @ts-check

function formatValidationIssues(issues = []) {
  return issues.map((issue) => ({
    code: String(issue.code || "invalid_value"),
    path: Array.isArray(issue.path) ? issue.path.map((part) => String(part)).join(".") : "",
    message: String(issue.message || "Invalid value")
  }));
}

function sendApiError(res, status, error, message, details) {
  const body = {
    ok: false,
    error: String(error || "request_failed"),
    message: String(message || "The request could not be completed.")
  };

  if (details !== undefined && details !== null) {
    body.details = details;
  }

  return res.status(status).json(body);
}

function sendResultError(res, status, result, fallbackMessage) {
  const source = result && typeof result === "object" ? result : {};
  return res.status(status).json({
    ...source,
    ok: false,
    error: String(source.error || "operation_failed"),
    message: String(source.message || fallbackMessage || "The operation could not be completed.")
  });
}

function parseRequest(res, schema, value, options = {}) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  sendApiError(
    res,
    Number(options.status || 400),
    options.error || "invalid_request",
    options.message || "Request validation failed.",
    { issues: formatValidationIssues(parsed.error.issues) }
  );
  return null;
}

module.exports = {
  formatValidationIssues,
  parseRequest,
  sendApiError,
  sendResultError
};
