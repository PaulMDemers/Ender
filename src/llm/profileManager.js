const crypto = require("node:crypto");

const BACKEND_VALUES = new Set(["openai", "bedrock", "azure", "ollama", "acp"]);

function slugify(value, fallback) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null));
}

function parseProfilesJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("LLM_PROFILES_JSON must be a JSON array when set");
  }
  return parsed;
}

function normalizeProfile(input, baseConfig, index = 0) {
  const item = input && typeof input === "object" ? input : {};
  const backend = BACKEND_VALUES.has(String(item.backend || "").trim())
    ? String(item.backend).trim()
    : baseConfig.backend;
  const id = slugify(item.id || item.label || `${backend}-${index + 1}`, `profile-${index + 1}`);
  const label = String(item.label || item.name || id).trim() || id;
  const model = item.model ? String(item.model).trim() : null;

  return {
    id,
    label,
    backend,
    description: item.description ? String(item.description).trim() : "",
    openai: compactObject({
      apiKey: item.apiKey || item.openai?.apiKey || baseConfig.openai?.apiKey,
      model: model || item.openai?.model || baseConfig.openai?.model
    }),
    bedrock: compactObject({
      region: item.region || item.bedrock?.region || baseConfig.bedrock?.region,
      model: model || item.modelId || item.bedrock?.model || baseConfig.bedrock?.model
    }),
    azure: compactObject({
      apiKey: item.apiKey || item.azure?.apiKey || baseConfig.azure?.apiKey,
      instanceName: item.instanceName || item.azure?.instanceName || baseConfig.azure?.instanceName,
      deploymentName: item.deploymentName || item.azure?.deploymentName || baseConfig.azure?.deploymentName,
      apiVersion: item.apiVersion || item.azure?.apiVersion || baseConfig.azure?.apiVersion,
      basePath: item.basePath || item.azure?.basePath || baseConfig.azure?.basePath
    }),
    ollama: compactObject({
      baseUrl: item.baseUrl || item.ollama?.baseUrl || baseConfig.ollama?.baseUrl,
      model: model || item.ollama?.model || baseConfig.ollama?.model
    }),
    acp: compactObject({
      command: item.acp?.command || item.command || baseConfig.acp?.command || null,
      args: item.acp?.args || item.args || baseConfig.acp?.args || ["acp"]
    })
  };
}

function createDefaultProfile(config) {
  const backend = config.backend || "openai";
  return normalizeProfile({
    id: backend,
    label: `${backend[0].toUpperCase()}${backend.slice(1)} default`,
    backend
  }, config, 0);
}

function createProfiles(config) {
  const explicit = parseProfilesJson(config.llmProfilesJson);
  const source = explicit.length ? explicit : [createDefaultProfile(config)];
  const profiles = [];
  const seen = new Set();

  for (const [index, item] of source.entries()) {
    const profile = normalizeProfile(item, config, index);
    let id = profile.id;
    while (seen.has(id)) {
      id = `${profile.id}-${crypto.randomUUID().slice(0, 8)}`;
    }
    profile.id = id;
    seen.add(id);
    profiles.push(profile);
  }

  if (!profiles.length) profiles.push(createDefaultProfile(config));
  return profiles;
}

function publicProfile(profile, defaultProfileId) {
  const activeConfig = profile[profile.backend] || {};
  return {
    id: profile.id,
    label: profile.label,
    backend: profile.backend,
    model: activeConfig.model || activeConfig.deploymentName || null,
    description: profile.description || "",
    isDefault: profile.id === defaultProfileId
  };
}

class LlmProfileManager {
  constructor(config) {
    this.config = config || {};
    this.profiles = createProfiles(this.config);
    const requestedDefault = String(this.config.defaultLlmProfileId || "").trim();
    this.defaultProfileId = this.profiles.some((profile) => profile.id === requestedDefault)
      ? requestedDefault
      : this.profiles[0].id;
  }

  list() {
    return this.profiles.map((profile) => publicProfile(profile, this.defaultProfileId));
  }

  get(id) {
    const requested = String(id || "").trim();
    return this.profiles.find((profile) => profile.id === requested)
      || this.profiles.find((profile) => profile.id === this.defaultProfileId)
      || this.profiles[0];
  }

  getPublic(id) {
    const profile = this.get(id);
    return profile ? publicProfile(profile, this.defaultProfileId) : null;
  }

  buildRunConfig(id) {
    const profile = this.get(id);
    return {
      ...this.config,
      backend: profile.backend,
      activeLlmProfileId: profile.id,
      activeLlmProfileLabel: profile.label,
      openai: { ...(this.config.openai || {}), ...(profile.openai || {}) },
      bedrock: { ...(this.config.bedrock || {}), ...(profile.bedrock || {}) },
      azure: { ...(this.config.azure || {}), ...(profile.azure || {}) },
      ollama: { ...(this.config.ollama || {}), ...(profile.ollama || {}) },
      acp: { ...(this.config.acp || {}), ...(profile.acp || {}) }
    };
  }
}

module.exports = {
  LlmProfileManager,
  createProfiles,
  normalizeProfile,
  parseProfilesJson
};
