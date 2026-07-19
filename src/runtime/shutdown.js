// @ts-check

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

function createShutdownCoordinator({
  server,
  taskManager,
  scheduleManager,
  taskLedgerManager,
  codeServerManager,
  pillarClient,
  timeoutMs = 10_000,
  logger = console
}) {
  let shutdownPromise = null;

  return async function shutdown(reason = "requested") {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.log?.(`[shutdown] ${reason}: stopping Ender services`);
      scheduleManager?.stop?.();
      taskLedgerManager?.stop?.();

      const cleanup = Promise.allSettled([
        closeServer(server),
        Promise.resolve(pillarClient?.stop?.()),
        Promise.resolve(taskManager?.shutdown?.()),
        Promise.resolve(codeServerManager?.stopAllTaskSessions?.())
      ]);

      let timer = null;
      const timedOut = await Promise.race([
        cleanup.then(() => false),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(true), timeoutMs);
          timer.unref?.();
        })
      ]);
      if (timer) clearTimeout(timer);

      if (timedOut) {
        logger.warn?.(`[shutdown] cleanup exceeded ${timeoutMs}ms; closing remaining HTTP connections`);
        server?.closeAllConnections?.();
      } else {
        logger.log?.("[shutdown] Ender services stopped cleanly");
      }

      return { timedOut };
    })();

    return shutdownPromise;
  };
}

module.exports = { closeServer, createShutdownCoordinator };
