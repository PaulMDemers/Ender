const BACKEND_ORDER = ["openai", "bedrock", "azure", "ollama", "acp"];
const BACKEND_VALUES = new Set(BACKEND_ORDER);
const BACKEND_LABELS = {
  openai: "OpenAI",
  bedrock: "Amazon Bedrock",
  azure: "Azure OpenAI",
  ollama: "Ollama",
  acp: "ACP default"
};

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

function createDefaultProfile(config, backend = config.backend || "openai") {
  const activeConfig = config?.[backend] || {};
  const model = activeConfig.model || activeConfig.deploymentName || null;
  return normalizeProfile({
    id: backend,
    label: model ? `${BACKEND_LABELS[backend] || backend} · ${model}` : BACKEND_LABELS[backend] || backend,
    backend,
    ...(backend === "azure" ? { deploymentName: model } : { model })
  }, config, 0);
}

function isBackendConfigured(config, backend) {
  const provider = config?.[backend] || {};
  if (typeof provider.configured === "boolean") return provider.configured;

  if (backend === "openai") return Boolean(provider.apiKey);
  if (backend === "bedrock") return Boolean(provider.region);
  if (backend === "azure") {
    return Boolean(provider.apiKey && provider.deploymentName && (provider.instanceName || provider.basePath));
  }
  if (backend === "ollama") return Boolean(provider.baseUrl && provider.model);
  if (backend === "acp") return Boolean(provider.command);
  return false;
}

function getProfileReadiness(profile) {
  const missing = [];
  if (profile.backend === "openai" && !profile.openai?.apiKey) missing.push("OPENAI_API_KEY");
  if (profile.backend === "bedrock" && !profile.bedrock?.region) missing.push("AWS_REGION");
  if (profile.backend === "azure") {
    if (!profile.azure?.apiKey) missing.push("AZURE_OPENAI_API_KEY");
    if (!profile.azure?.deploymentName) missing.push("AZURE_OPENAI_API_DEPLOYMENT_NAME");
    if (!profile.azure?.instanceName && !profile.azure?.basePath) {
      missing.push("AZURE_OPENAI_API_INSTANCE_NAME|AZURE_OPENAI_BASE_PATH");
    }
  }
  if (profile.backend === "ollama") {
    if (!profile.ollama?.baseUrl) missing.push("OLLAMA_BASE_URL");
    if (!profile.ollama?.model) missing.push("OLLAMA_MODEL");
  }
  if (profile.backend === "acp" && !profile.acp?.command) missing.push("ACP_COMMAND");
  return { ready: missing.length === 0, missing };
}

function createDiscoveredProfiles(config) {
  const selectedBackend = BACKEND_VALUES.has(String(config.backend || "")) ? config.backend : "openai";
  const orderedBackends = [selectedBackend, ...BACKEND_ORDER.filter((backend) => backend !== selectedBackend)];
  return orderedBackends
    .filter((backend) => backend === selectedBackend || isBackendConfigured(config, backend))
    .flatMap((backend) => {
      const provider = config?.[backend] || {};
      const variants = backend === "azure"
        ? provider.deploymentNames || [provider.deploymentName].filter(Boolean)
        : backend === "acp"
          ? [null]
          : provider.models || [provider.model].filter(Boolean);
      const configuredVariants = variants.length ? [...new Set(variants)] : [null];

      return configuredVariants.map((variant, index) => normalizeProfile({
        id: index === 0 ? backend : `${backend}-${slugify(variant, `model-${index + 1}`)}`,
        label: variant
          ? `${BACKEND_LABELS[backend] || backend} · ${variant}`
          : BACKEND_LABELS[backend] || backend,
        backend,
        ...(backend === "azure" ? { deploymentName: variant } : { model: variant })
      }, config, index));
    });
}

function createProfiles(config) {
  const explicit = parseProfilesJson(config.llmProfilesJson);
  const source = explicit.length ? explicit : createDiscoveredProfiles(config);
  const profiles = [];
  const seen = new Set();

  for (const [index, item] of source.entries()) {
    const profile = normalizeProfile(item, config, index);
    let id = profile.id;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${profile.id}-${suffix}`;
      suffix += 1;
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
  const readiness = getProfileReadiness(profile);
  return {
    id: profile.id,
    label: profile.label,
    backend: profile.backend,
    model: activeConfig.model || activeConfig.deploymentName || null,
    description: profile.description || "",
    isDefault: profile.id === defaultProfileId,
    ready: readiness.ready,
    missing: readiness.missing
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
  getProfileReadiness,
  isBackendConfigured,
  normalizeProfile,
  parseProfilesJson
};
