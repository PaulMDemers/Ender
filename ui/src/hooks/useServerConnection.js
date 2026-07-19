import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getApiBase,
  getContractStatus,
  getHealth,
  listLlmProfiles,
  listProjects,
  setApiBase,
  subscribeContractStatus
} from "../agentClient";
import { startVisibilityAwarePolling } from "./visiblePolling";

const SAVED_SERVERS_KEY = "ender_saved_servers";
const ACTIVE_SERVER_KEY = "ender_api_base";
const HAS_CONFIGURED_DEFAULT_API = Boolean(import.meta.env.VITE_ENDER_API);

function loadSavedServers() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_SERVERS_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => ({
        name: String(item?.name || item?.endpoint || ""),
        endpoint: String(item?.endpoint || "").trim(),
        favorite: Boolean(item?.favorite),
        lastUsedAt: Number(item?.lastUsedAt || 0)
      }))
      .filter((item) => item.endpoint);
  } catch {
    return [];
  }
}

function saveServers(items) {
  localStorage.setItem(SAVED_SERVERS_KEY, JSON.stringify(items));
}

function getConnectionError(error) {
  return error?.message || "Unable to reach server";
}

export function useServerConnection({ onReconnect } = {}) {
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [savedServers, setSavedServers] = useState([]);
  const [connectionRequested, setConnectionRequested] = useState(HAS_CONFIGURED_DEFAULT_API);
  const [connectedOnce, setConnectedOnce] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [health, setHealth] = useState(null);
  const [lastHealth, setLastHealth] = useState(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [healthCheckedAt, setHealthCheckedAt] = useState(null);
  const [contractStatus, setContractStatus] = useState(() => getContractStatus());
  const [llmProfiles, setLlmProfiles] = useState([]);
  const [defaultLlmProfileId, setDefaultLlmProfileId] = useState("");
  const [projects, setProjects] = useState([]);
  const [reconnectNotice, setReconnectNotice] = useState("");
  const wasOnlineRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const onReconnectRef = useRef(onReconnect);
  const healthRequestRef = useRef(0);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => subscribeContractStatus(setContractStatus), []);

  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_SERVER_KEY);
    setSavedServers(loadSavedServers());
    if (saved) {
      const normalized = setApiBase(saved);
      setServerUrl(normalized);
      setConnectionRequested(true);
      setLoading(true);
      return;
    }

    setServerUrl(getApiBase());
    setConnectionRequested(HAS_CONFIGURED_DEFAULT_API);
    setLoading(HAS_CONFIGURED_DEFAULT_API);
  }, []);

  const refreshHealth = useCallback(async () => {
    if (!connectionRequested) return null;
    const requestId = healthRequestRef.current + 1;
    healthRequestRef.current = requestId;
    setHealthChecking(true);
    try {
      const data = await getHealth();
      if (requestId !== healthRequestRef.current) return null;
      setHealth(data);
      setLastHealth(data);
      setHealthError(data?.ok ? "" : "Server reported that it is not ready");
      setHealthCheckedAt(Date.now());
      return data;
    } catch (error) {
      if (requestId !== healthRequestRef.current) return null;
      setHealth(null);
      setHealthError(getConnectionError(error));
      setHealthCheckedAt(Date.now());
      return null;
    } finally {
      if (requestId === healthRequestRef.current) setHealthChecking(false);
    }
  }, [connectionRequested, serverUrl]);

  useEffect(() => {
    if (!connectionRequested) {
      healthRequestRef.current += 1;
      setHealth(null);
      setLastHealth(null);
      setHealthChecking(false);
      setHealthError("");
      setHealthCheckedAt(null);
      wasOnlineRef.current = null;
      setReconnectNotice("");
      return undefined;
    }
    return startVisibilityAwarePolling(refreshHealth, 15000);
  }, [connectionRequested, refreshHealth, serverUrl]);

  useEffect(() => {
    if (!connectionRequested) {
      setLlmProfiles([]);
      setDefaultLlmProfileId("");
      setProjects([]);
      return undefined;
    }
    let live = true;

    const loadRuntimeCatalogs = async () => {
      try {
        const [profilesData, projectsData] = await Promise.all([
          listLlmProfiles(),
          listProjects()
        ]);
        if (!live) return;
        setLlmProfiles(profilesData.items || []);
        setDefaultLlmProfileId(profilesData.defaultProfileId || profilesData.items?.[0]?.id || "");
        setProjects(projectsData.items || []);
      } catch {
        if (!live) return;
        setLlmProfiles([]);
        setDefaultLlmProfileId("");
        setProjects([]);
      }
    };

    const stopPolling = startVisibilityAwarePolling(loadRuntimeCatalogs, 15000);
    return () => {
      live = false;
      stopPolling();
    };
  }, [serverUrl, connectionRequested]);

  const connectionState = useMemo(() => {
    if (!connectionRequested) return "idle";
    if (health?.ok && connectedOnce) return "connected";
    if (loadError || healthError || health?.ok === false) return "offline";
    return "checking";
  }, [connectedOnce, connectionRequested, health?.ok, healthError, loadError]);

  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    if (connectionState === "idle" || connectionState === "checking") return;
    if (connectionState === "offline") {
      if (wasOnline === true) {
        wasOnlineRef.current = false;
        setReconnectNotice("Server disconnected. Waiting to reconnect...");
      }
      return;
    }

    wasOnlineRef.current = true;

    if (wasOnline === null) return;
    if (!wasOnline) {
      setReconnectNotice("Reconnected. Refreshing...");
      Promise.resolve(onReconnectRef.current?.()).finally(() => {
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => setReconnectNotice(""), 1500);
      });
    }
  }, [connectionState]);

  useEffect(() => () => {
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
  }, []);

  const reportTaskListSuccess = useCallback(() => {
    setLoadError("");
    setConnectedOnce(true);
  }, []);

  const reportTaskListFailure = useCallback((error) => {
    setLoadError(getConnectionError(error));
  }, []);

  const completeTaskListLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const connectServer = useCallback((server) => {
    try {
      const normalized = setApiBase(server.endpoint);
      setSavedServers((current) => {
        const existing = current.find((item) => item.endpoint === normalized);
        const nextServer = {
          name: server.name?.trim() || existing?.name || normalized,
          endpoint: normalized,
          favorite: existing?.favorite || false,
          lastUsedAt: Date.now()
        };
        const next = [nextServer, ...current.filter((item) => item.endpoint !== normalized)];
        saveServers(next);
        return next;
      });
      localStorage.setItem(ACTIVE_SERVER_KEY, normalized);
      setServerUrl(normalized);
      setConnectionRequested(true);
      setConnectedOnce(false);
      setLoading(true);
      setHealth(null);
      setLastHealth(null);
      setHealthChecking(false);
      setHealthError("");
      setHealthCheckedAt(null);
      wasOnlineRef.current = null;
      setLlmProfiles([]);
      setDefaultLlmProfileId("");
      setProjects([]);
      setLoadError("");
      setReconnectNotice("");
      return normalized;
    } catch (error) {
      setLoadError(error?.message || "Invalid server URL");
      return null;
    }
  }, []);

  const toggleFavoriteServer = useCallback((endpoint) => {
    setSavedServers((current) => {
      const next = current.map((server) => (
        server.endpoint === endpoint ? { ...server, favorite: !server.favorite } : server
      ));
      saveServers(next);
      return next;
    });
  }, []);

  const removeServer = useCallback((endpoint) => {
    setSavedServers((current) => {
      const next = current.filter((server) => server.endpoint !== endpoint);
      saveServers(next);
      return next;
    });
    if (endpoint === serverUrl) {
      localStorage.removeItem(ACTIVE_SERVER_KEY);
      if (!connectedOnce) {
        setConnectionRequested(false);
        setLoadError("");
      }
    }
  }, [connectedOnce, serverUrl]);

  const refreshProjects = useCallback(async () => {
    const data = await listProjects();
    const items = data.items || [];
    setProjects(items);
    return items;
  }, [serverUrl]);

  const currentServer = useMemo(
    () => savedServers.find((server) => server.endpoint === serverUrl) || null,
    [savedServers, serverUrl]
  );

  return {
    serverUrl,
    savedServers,
    connectionRequested,
    connectedOnce,
    showConnectionShell: !connectedOnce,
    loading,
    loadError,
    health,
    lastHealth,
    healthChecking,
    healthError,
    healthCheckedAt,
    connectionState,
    contractStatus,
    llmProfiles,
    defaultLlmProfileId,
    projects,
    reconnectNotice,
    currentServer,
    connectServer,
    toggleFavoriteServer,
    removeServer,
    refreshHealth,
    refreshProjects,
    reportTaskListSuccess,
    reportTaskListFailure,
    completeTaskListLoad
  };
}
