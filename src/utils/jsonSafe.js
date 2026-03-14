function sanitizeString(value) {
  return String(value)
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

function sanitizeJsonValue(value) {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitizeJsonValue(entry)])
  );
}

module.exports = { sanitizeString, sanitizeJsonValue };
