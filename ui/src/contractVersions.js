function parseContractVersion(value) {
  if (value === null || value === undefined || value === "") return null;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
}

export function createContractTracker(supported = {}) {
  const supportedVersions = {
    api: parseContractVersion(supported.api),
    taskSse: parseContractVersion(supported.taskSse)
  };
  const observedVersions = {
    api: null,
    taskSse: null
  };
  const listeners = new Set();

  function describe(kind) {
    const supportedVersion = supportedVersions[kind];
    const observedVersion = observedVersions[kind];
    const compatible = observedVersion === null
      || supportedVersion === null
      || observedVersion <= supportedVersion;
    return {
      supportedVersion,
      observedVersion,
      compatible,
      mode: observedVersion === null ? "legacy" : compatible ? "compatible" : "newer"
    };
  }

  function getStatus() {
    return {
      api: describe("api"),
      taskSse: describe("taskSse")
    };
  }

  function observe(kind, value) {
    if (!Object.prototype.hasOwnProperty.call(observedVersions, kind)) {
      throw new Error(`Unknown contract kind: ${kind}`);
    }
    const version = parseContractVersion(value);
    if (version !== null) observedVersions[kind] = version;
    const status = getStatus();
    listeners.forEach((listener) => listener(status));
    return status;
  }

  return {
    getStatus,
    observeApiHeader(value) {
      return observe("api", value);
    },
    observeTaskSse(payload) {
      return observe("taskSse", payload?.version);
    },
    reset() {
      observedVersions.api = null;
      observedVersions.taskSse = null;
      const status = getStatus();
      listeners.forEach((listener) => listener(status));
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export { parseContractVersion };
