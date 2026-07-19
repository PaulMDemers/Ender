// @ts-check

const http = require("node:http");

function getTaskIdFromProxyUrl(url) {
  const match = String(url || "").match(/^\/tasks\/([^/]+)\/code-server\/proxy(?:\/|$)/);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function getProxyBasePath(taskId) {
  return `/tasks/${encodeURIComponent(String(taskId || ""))}/code-server/proxy`;
}

function getForwardPath(url, taskId) {
  const rawUrl = String(url || "/");
  const queryIndex = rawUrl.indexOf("?");
  const pathname = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
  const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : "";
  const basePath = getProxyBasePath(taskId);
  const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  return `${rest.startsWith("/") ? rest : `/${rest}`}${query}`;
}

function copyProxyHeaders(headers, target) {
  const next = { ...headers };
  next.host = `${target.host}:${target.port}`;
  next["x-forwarded-host"] = headers.host || next.host;
  next["x-forwarded-proto"] = headers["x-forwarded-proto"] || "http";
  next["x-forwarded-port"] = String(target.port);
  return next;
}

function rewriteLocationHeader(location, taskId) {
  if (!location || !String(location).startsWith("/")) return location;
  if (String(location).startsWith(getProxyBasePath(taskId))) return location;
  return `${getProxyBasePath(taskId)}${location}`;
}

function rewriteResponseHeaders(headers, taskId) {
  const next = { ...headers };
  if (next.location) {
    next.location = rewriteLocationHeader(next.location, taskId);
  }
  return next;
}

function sendProxyError(res, statusCode, message) {
  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(statusCode).json({
    ok: false,
    error: "code_server_proxy_failed",
    message
  });
}

function createCodeServerProxy({ taskManager, codeServerManager }) {
  async function getProxyTarget(taskId) {
    if (!codeServerManager) {
      return {
        ok: false,
        statusCode: 503,
        message: "code-server support is not configured on this server."
      };
    }

    const task = taskManager.get(taskId);
    if (!task) {
      return {
        ok: false,
        statusCode: 404,
        message: "Thread not found."
      };
    }

    const result = await codeServerManager.getTaskProxyTarget(task);
    if (!result.ok) {
      return {
        ok: false,
        statusCode: result.error === "code_server_disabled" ? 503 : 400,
        message: result.message || "Unable to resolve code-server session."
      };
    }

    if (!result.session || !result.target) {
      return {
        ok: false,
        statusCode: 404,
        message: "No running code-server session is available for this thread."
      };
    }

    return {
      ok: true,
      target: result.target
    };
  }

  async function handleHttp(req, res) {
    const taskId = getTaskIdFromProxyUrl(req.originalUrl || req.url);
    if (!taskId) {
      return sendProxyError(res, 404, "Invalid code-server proxy URL.");
    }

    let resolved;
    try {
      resolved = await getProxyTarget(taskId);
    } catch (err) {
      return sendProxyError(res, 500, err.message || String(err));
    }

    if (!resolved.ok) {
      return sendProxyError(res, resolved.statusCode || 502, resolved.message);
    }

    const target = resolved.target;
    const proxyReq = http.request({
      protocol: target.protocol || "http:",
      hostname: target.host,
      port: target.port,
      method: req.method,
      path: getForwardPath(req.originalUrl || req.url, taskId),
      headers: copyProxyHeaders(req.headers, target)
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, rewriteResponseHeaders(proxyRes.headers, taskId));
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      sendProxyError(res, 502, err.message || "Unable to reach code-server.");
    });

    req.pipe(proxyReq);
  }

  async function handleUpgrade(req, socket, head) {
    const taskId = getTaskIdFromProxyUrl(req.url);
    if (!taskId) return false;

    let resolved;
    try {
      resolved = await getProxyTarget(taskId);
    } catch (err) {
      socket.write(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${err.message || "Proxy failed."}`);
      socket.destroy();
      return true;
    }

    if (!resolved.ok) {
      socket.write(`HTTP/1.1 ${resolved.statusCode || 502} Bad Gateway\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${resolved.message || "Proxy failed."}`);
      socket.destroy();
      return true;
    }

    const target = resolved.target;
    const proxyReq = http.request({
      protocol: target.protocol || "http:",
      hostname: target.host,
      port: target.port,
      method: req.method,
      path: getForwardPath(req.url, taskId),
      headers: copyProxyHeaders(req.headers, target)
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        `HTTP/${req.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`
        + Object.entries(rewriteResponseHeaders(proxyRes.headers, taskId))
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
          .join("\r\n")
        + "\r\n\r\n"
      );
      if (proxyHead?.length) socket.write(proxyHead);
      if (head?.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on("error", (err) => {
      socket.write(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${err.message || "Unable to reach code-server."}`);
      socket.destroy();
    });

    proxyReq.end();
    return true;
  }

  return {
    handleHttp,
    handleUpgrade
  };
}

module.exports = { createCodeServerProxy, getTaskIdFromProxyUrl };
