const crypto = require("node:crypto");

function base64UrlDecode(value) {
  const raw = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("invalid_token");
  return {
    header: JSON.parse(base64UrlDecode(parts[0]).toString("utf8")),
    payload: JSON.parse(base64UrlDecode(parts[1]).toString("utf8")),
    signature: base64UrlDecode(parts[2]),
    signingInput: `${parts[0]}.${parts[1]}`
  };
}

function jwkToKeyObject(jwk) {
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

class JwksCache {
  constructor({ jwksUri, fetchImpl = globalThis.fetch, ttlMs = 300_000 } = {}) {
    this.jwksUri = jwksUri;
    this.fetchImpl = fetchImpl;
    this.ttlMs = ttlMs;
    this.cachedAt = 0;
    this.keys = [];
  }

  async getKeys() {
    if (!this.jwksUri) throw new Error("jwks_uri_not_configured");
    if (this.keys.length && Date.now() - this.cachedAt < this.ttlMs) return this.keys;

    const res = await this.fetchImpl(this.jwksUri);
    if (!res.ok) throw new Error(`jwks_fetch_failed_${res.status}`);
    const data = await res.json();
    this.keys = Array.isArray(data.keys) ? data.keys : [];
    this.cachedAt = Date.now();
    return this.keys;
  }

  async getKey(kid) {
    const keys = await this.getKeys();
    return keys.find((key) => key.kid === kid) || null;
  }
}

function getBearerToken(req) {
  const raw = String(req.get("authorization") || "").trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function validateClaims(payload, { issuer, audience } = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (!payload?.sub) throw new Error("token_subject_required");
  if (payload.exp && Number(payload.exp) <= now) throw new Error("token_expired");
  if (payload.nbf && Number(payload.nbf) > now) throw new Error("token_not_yet_valid");
  if (issuer && payload.iss !== issuer) throw new Error("token_issuer_mismatch");

  if (audience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    const azp = payload.azp ? [payload.azp] : [];
    if (![...aud, ...azp].includes(audience)) {
      throw new Error("token_audience_mismatch");
    }
  }
}

async function verifyOidcToken(token, config, jwksCache) {
  const parsed = parseJwt(token);
  if (parsed.header.alg !== "RS256") throw new Error("unsupported_token_alg");
  const jwk = await jwksCache.getKey(parsed.header.kid);
  if (!jwk) throw new Error("token_key_not_found");
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(parsed.signingInput);
  verifier.end();
  const verified = verifier.verify(jwkToKeyObject(jwk), parsed.signature);
  if (!verified) throw new Error("token_signature_invalid");
  validateClaims(parsed.payload, config);
  return parsed.payload;
}

function createUserAuth(config = {}, options = {}) {
  const jwksCache = options.jwksCache || new JwksCache({
    jwksUri: config.jwksUri,
    fetchImpl: options.fetchImpl
  });

  return async function userAuth(req, res, next) {
    try {
      if (config.authMode === "dev") {
        const userId = String(req.get("x-beacon-user-id") || req.get("x-pillar-user-id") || "").trim();
        if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });
        req.user = {
          id: userId,
          email: String(req.get("x-beacon-user-email") || req.get("x-pillar-user-email") || "").trim() || null,
          name: String(req.get("x-beacon-user-name") || req.get("x-pillar-user-name") || "").trim() || null,
          claims: { sub: userId }
        };
        return next();
      }

      const token = getBearerToken(req);
      if (!token) return res.status(401).json({ ok: false, error: "unauthorized" });
      const claims = await verifyOidcToken(token, config, jwksCache);
      req.user = {
        id: String(claims.sub),
        email: claims.email ? String(claims.email) : null,
        name: claims.name || claims.preferred_username || claims.email || claims.sub,
        claims
      };
      return next();
    } catch (err) {
      return res.status(401).json({
        ok: false,
        error: "invalid_token",
        message: err.message || String(err)
      });
    }
  };
}

module.exports = {
  JwksCache,
  createUserAuth,
  getBearerToken,
  parseJwt,
  verifyOidcToken,
  validateClaims
};
