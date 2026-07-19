// @ts-check

/**
 * @param {unknown} [reason]
 * @returns {Error & { code?: string }}
 */
function createAbortError(reason = "Operation aborted") {
  if (reason instanceof Error && reason.name === "AbortError") return reason;

  const message = reason instanceof Error
    ? reason.message
    : String(reason || "Operation aborted");
  const error = /** @type {Error & { code?: string }} */ (new Error(message));
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  if (reason instanceof Error) error.cause = reason;
  return error;
}

/** @param {unknown} error */
function isAbortError(error) {
  return Boolean(
    error
    && typeof error === "object"
    && (
      ("name" in error && error.name === "AbortError")
      || ("code" in error && error.code === "ABORT_ERR")
    )
  );
}

/** @param {AbortSignal | null | undefined} signal */
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError(signal.reason);
  }
}

module.exports = { createAbortError, isAbortError, throwIfAborted };
