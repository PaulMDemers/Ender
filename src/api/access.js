// @ts-check

const { API_CONTRACT_HEADER } = require("../shared/apiContracts");

function isLoopbackAddress(value) {
  const address = String(value || "").trim().toLowerCase().split("%")[0];
  return address === "::1"
    || address === "localhost"
    || address.startsWith("127.")
    || address.startsWith("::ffff:127.");
}

function isLoopbackOrigin(value) {
  if (value === "null") return true;
  try {
    return isLoopbackAddress(new URL(value).hostname);
  } catch {
    return false;
  }
}

function createCorsOptions(apiAccess = {}) {
  const allowed = new Set(apiAccess.corsOrigins || []);
  const openWithoutAllowlist = apiAccess.mode === "open" && allowed.size === 0;

  return {
    exposedHeaders: [API_CONTRACT_HEADER],
    origin(origin, callback) {
      const permitted = !origin
        || allowed.has(origin)
        || openWithoutAllowlist
        || (apiAccess.mode === "local" && isLoopbackOrigin(origin));
      callback(null, permitted);
    }
  };
}

function createApiAccessMiddleware(apiAccess = {}) {
  return (req, res, next) => {
    if (isApiAccessAllowed(apiAccess, req.socket?.remoteAddress)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      error: "remote_access_disabled",
      message: "Direct Ender API access is limited to this machine. Use Pillar for remote access or explicitly set ENDER_API_ACCESS_MODE=open."
    });
  };
}

function isApiAccessAllowed(apiAccess = {}, remoteAddress = "") {
  return apiAccess.mode === "open" || isLoopbackAddress(remoteAddress);
}

module.exports = {
  createApiAccessMiddleware,
  createCorsOptions,
  isApiAccessAllowed,
  isLoopbackAddress,
  isLoopbackOrigin
};
