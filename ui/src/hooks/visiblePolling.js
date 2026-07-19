function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function startVisibilityAwarePolling(callback, intervalMs, { immediate = true } = {}) {
  let intervalId = null;
  let stopped = false;
  let running = false;

  const run = async () => {
    if (stopped || running || !isDocumentVisible()) return;
    running = true;
    try {
      await callback();
    } finally {
      running = false;
    }
  };

  const stopTimer = () => {
    if (intervalId === null) return;
    window.clearInterval(intervalId);
    intervalId = null;
  };

  const startTimer = () => {
    if (stopped || intervalId !== null || !isDocumentVisible()) return;
    intervalId = window.setInterval(run, intervalMs);
  };

  const onVisibilityChange = () => {
    if (!isDocumentVisible()) {
      stopTimer();
      return;
    }
    void run();
    startTimer();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  if (isDocumentVisible()) {
    if (immediate) void run();
    startTimer();
  }

  return () => {
    stopped = true;
    stopTimer();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
