import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTaskLedgerEntry,
  deleteTaskLedgerEntry,
  listTaskLedger,
  runTaskLedgerEntryNow
} from "../agentClient";
import { startVisibilityAwarePolling } from "./visiblePolling";

const EMPTY_METADATA = Object.freeze({ maxAutoAgents: 0, pollIntervalMs: 0 });

export function useTaskLedger({ serverUrl, connectionRequested, composeMode, standaloneView }) {
  const [entries, setEntries] = useState([]);
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const collectionSignatureRef = useRef("");

  const applyCollection = useCallback((data) => {
    const items = data?.items || [];
    const signature = JSON.stringify(items);
    if (signature !== collectionSignatureRef.current) {
      collectionSignatureRef.current = signature;
      setEntries(items);
    }
    const nextMetadata = {
      maxAutoAgents: Number.isFinite(data?.maxAutoAgents) ? data.maxAutoAgents : 0,
      pollIntervalMs: Number.isFinite(data?.pollIntervalMs) ? data.pollIntervalMs : 0
    };
    setMetadata((current) => (
      current.maxAutoAgents === nextMetadata.maxAutoAgents && current.pollIntervalMs === nextMetadata.pollIntervalMs
        ? current
        : nextMetadata
    ));
    return items;
  }, []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await listTaskLedger();
      const items = applyCollection(data);
      setError("");
      return items;
    } catch (loadError) {
      setError(loadError.message || "Unable to load task ledger");
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyCollection, serverUrl]);

  const reset = useCallback(() => {
    setEntries([]);
    collectionSignatureRef.current = "";
    setMetadata(EMPTY_METADATA);
    setLoading(false);
    setOperation(null);
    setError("");
    setResult(null);
  }, []);

  useEffect(() => {
    if (!connectionRequested) {
      reset();
      return undefined;
    }
    if (composeMode !== "ledger" && standaloneView !== "ledger") return undefined;
    let live = true;

    const load = async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const data = await listTaskLedger();
        if (!live) return;
        applyCollection(data);
        setError("");
      } catch (loadError) {
        if (live) setError(loadError.message || "Unable to load task ledger");
      } finally {
        if (live && !silent) setLoading(false);
      }
    };

    load();
    const stopPolling = startVisibilityAwarePolling(() => load({ silent: true }), 3000, { immediate: false });
    return () => {
      live = false;
      stopPolling();
    };
  }, [applyCollection, composeMode, serverUrl, standaloneView, connectionRequested, reset]);

  const mutate = useCallback(async (type, id, request, fallbackMessage) => {
    setOperation({ type, id: id || null });
    setError("");
    setResult(null);
    try {
      const response = await request();
      await refresh({ silent: true });
      setResult({ type, id: id || response?.id || response?.entry?.id || null, response: response || null });
      return response;
    } catch (mutationError) {
      setError(mutationError.message || fallbackMessage);
      if (type === "run") {
        await refresh({ silent: true });
        setError(mutationError.message || fallbackMessage);
      }
      return null;
    } finally {
      setOperation(null);
    }
  }, [refresh]);

  return {
    entries,
    metadata,
    loading,
    busy: Boolean(operation),
    operation,
    error,
    result,
    reset,
    refresh,
    clearFeedback: () => {
      setError("");
      setResult(null);
    },
    createEntry: (payload) => mutate(
      "create",
      null,
      () => createTaskLedgerEntry(payload),
      "Unable to create task ledger entry"
    ),
    runEntryNow: (id) => mutate(
      "run",
      id,
      () => runTaskLedgerEntryNow(id),
      "Unable to run task ledger entry"
    ),
    deleteEntry: (id) => mutate(
      "delete",
      id,
      () => deleteTaskLedgerEntry(id),
      "Unable to delete task ledger entry"
    )
  };
}
