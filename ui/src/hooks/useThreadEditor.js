import { useEffect, useRef, useState } from "react";
import {
  getTaskCodeServer,
  launchTaskCodeServer,
  stopTaskCodeServer
} from "../agentClient";
import { startVisibilityAwarePolling } from "./visiblePolling";

export function getPreferredEditorSurface(width = typeof window !== "undefined" ? window.innerWidth : 1440) {
  if (width < 980) return "stacked";
  if (width < 1180) return "modal";
  return "split";
}

export function getResponsiveEditorSurface(currentSurface, width = typeof window !== "undefined" ? window.innerWidth : 1440) {
  if (!currentSurface) return null;
  if (currentSurface === "split" || currentSurface === "stacked") {
    return getPreferredEditorSurface(width);
  }
  if (currentSurface === "modal" && width < 980) {
    return "stacked";
  }
  return currentSurface;
}

function copyWithFallback(value) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  const textarea = document.createElement("textarea");
  try {
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    return Promise.resolve();
  } finally {
    textarea.remove();
  }
}

export function useThreadEditor({ taskId, active, serverUrl }) {
  const [session, setSession] = useState(null);
  const [busyOperation, setBusyOperation] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [surface, setSurface] = useState(null);
  const [frameKey, setFrameKey] = useState(0);
  const [frameStatus, setFrameStatus] = useState("idle");
  const [frameReachable, setFrameReachable] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [dockWidth, setDockWidth] = useState(640);
  const [mobilePanel, setMobilePanel] = useState("transcript");
  const copiedPasswordTimerRef = useRef(null);
  const frameReachableRef = useRef(false);
  const dockResizeRef = useRef({ active: false, startX: 0, startWidth: 640 });
  const editorUrl = session?.proxyUrl || session?.url || "";

  const openSurface = (nextSurface) => {
    if (!session?.url) return;
    setFrameKey((value) => value + 1);
    setDetailsExpanded(false);
    setSurface(nextSurface);
    setMobilePanel(nextSurface === "stacked" ? "editor" : "transcript");
  };

  const openPreferredSurface = () => {
    openSurface(getPreferredEditorSurface());
  };

  const closeSurface = () => {
    setSurface(null);
    setDetailsExpanded(false);
    setMobilePanel("transcript");
  };

  useEffect(() => {
    setSession(null);
    setActionError(null);
    closeSurface();
    if (!active || !taskId) return undefined;

    let live = true;
    const load = async () => {
      try {
        const result = await getTaskCodeServer(taskId);
        if (live) setSession(result.session || null);
      } catch {
        // An absent editor session is expected before the operator launches one.
      }
    };

    const stopPolling = startVisibilityAwarePolling(load, 15000);
    return () => {
      live = false;
      stopPolling();
    };
  }, [active, taskId, serverUrl]);

  useEffect(() => {
    if (session) return;
    setSurface(null);
    setDetailsExpanded(false);
    setMobilePanel("transcript");
  }, [session]);

  useEffect(() => {
    setCopiedPassword(false);
  }, [session?.password]);

  useEffect(() => {
    if (!editorUrl || !surface) {
      setFrameStatus("idle");
      setFrameReachable(false);
      frameReachableRef.current = false;
      return;
    }
    setFrameStatus("connecting");
    setFrameReachable(false);
    frameReachableRef.current = false;
  }, [editorUrl, surface]);

  useEffect(() => {
    if (!editorUrl || !surface || frameStatus === "loaded") return undefined;

    let live = true;
    const probe = async () => {
      try {
        await fetch(editorUrl, { mode: "no-cors", cache: "no-store" });
        if (!live) return;
        if (!frameReachableRef.current) setFrameKey((value) => value + 1);
        frameReachableRef.current = true;
        setFrameReachable(true);
      } catch {
        if (live) {
          frameReachableRef.current = false;
          setFrameReachable(false);
        }
      }
    };

    const stopPolling = startVisibilityAwarePolling(probe, 2000);
    return () => {
      live = false;
      stopPolling();
    };
  }, [editorUrl, surface, frameStatus]);

  useEffect(() => {
    if (!editorUrl || !surface || frameStatus !== "connecting") return undefined;
    const timeoutId = window.setTimeout(() => {
      setFrameKey((value) => value + 1);
    }, 4500);
    return () => window.clearTimeout(timeoutId);
  }, [editorUrl, surface, frameStatus, frameKey]);

  useEffect(() => () => {
    if (copiedPasswordTimerRef.current) {
      window.clearTimeout(copiedPasswordTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const onPointerMove = (event) => {
      const resize = dockResizeRef.current;
      if (!resize.active) return;
      const maxWidth = Math.max(520, Math.floor(window.innerWidth * 0.58));
      const nextWidth = resize.startWidth + (resize.startX - event.clientX);
      setDockWidth(Math.min(maxWidth, Math.max(420, nextWidth)));
    };
    const onPointerUp = () => {
      if (!dockResizeRef.current.active) return;
      dockResizeRef.current.active = false;
      document.body.classList.remove("editorDockResizing");
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("editorDockResizing");
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setDockWidth((current) => {
        const maxWidth = Math.max(520, Math.floor(window.innerWidth * 0.58));
        return Math.min(current, maxWidth);
      });
      const nextSurface = getResponsiveEditorSurface(surface, window.innerWidth);
      if (nextSurface && nextSurface !== surface) {
        setFrameKey((value) => value + 1);
        setSurface(nextSurface);
        setMobilePanel(nextSurface === "stacked" ? "editor" : "transcript");
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [surface]);

  const launch = async () => {
    if (!taskId || busyOperation) return;
    setBusyOperation("launch");
    setActionError(null);
    try {
      const result = await launchTaskCodeServer(taskId);
      const nextSession = result.session || null;
      if (!nextSession?.url) throw new Error("The server did not return an editor session.");
      setSession(nextSession);
      setFrameKey((value) => value + 1);
      const nextSurface = getPreferredEditorSurface();
      setSurface(nextSurface);
      setMobilePanel(nextSurface === "stacked" ? "editor" : "transcript");
    } catch (error) {
      setActionError({ operation: "launch", message: error.message || "Unable to launch thread editor" });
    } finally {
      setBusyOperation(null);
    }
  };

  const stop = async () => {
    if (!taskId || busyOperation) return;
    setBusyOperation("stop");
    setActionError(null);
    try {
      await stopTaskCodeServer(taskId);
      setSession(null);
      closeSurface();
    } catch (error) {
      setActionError({ operation: "stop", message: error.message || "Unable to stop thread editor" });
    } finally {
      setBusyOperation(null);
    }
  };

  const copyPassword = async () => {
    if (!session?.password) return;
    setActionError(null);
    try {
      await copyWithFallback(session.password);
      setCopiedPassword(true);
      if (copiedPasswordTimerRef.current) window.clearTimeout(copiedPasswordTimerRef.current);
      copiedPasswordTimerRef.current = window.setTimeout(() => setCopiedPassword(false), 1600);
    } catch {
      setActionError({ operation: "copy", message: "Unable to copy the editor password." });
    }
  };

  const openTab = () => {
    if (!editorUrl) return;
    const nextWindow = window.open(editorUrl, "_blank", "noopener,noreferrer");
    if (nextWindow) closeSurface();
  };

  const retryFrame = () => {
    frameReachableRef.current = false;
    setFrameReachable(false);
    setFrameStatus("connecting");
    setFrameKey((value) => value + 1);
  };

  const showEditor = () => {
    if (!session?.url) {
      launch();
      return;
    }
    openPreferredSurface();
  };

  const retryAction = () => {
    if (actionError?.operation === "stop") return stop();
    if (actionError?.operation === "copy") return copyPassword();
    return launch();
  };

  const beginDockResize = (event) => {
    dockResizeRef.current = {
      active: true,
      startX: event.clientX,
      startWidth: dockWidth
    };
    document.body.classList.add("editorDockResizing");
  };

  return {
    session,
    editorUrl,
    busy: Boolean(busyOperation),
    busyOperation,
    actionError,
    surface,
    frameKey,
    frameStatus,
    frameReachable,
    copiedPassword,
    detailsExpanded,
    dockWidth,
    mobilePanel,
    hasSplit: surface === "split" && Boolean(session?.url),
    hasStacked: surface === "stacked" && Boolean(session?.url),
    launch,
    stop,
    retryAction,
    clearError: () => setActionError(null),
    openTab,
    copyPassword,
    openModal: () => openSurface("modal"),
    openStacked: () => openSurface("stacked"),
    openSplit: () => openSurface(getPreferredEditorSurface()),
    showEditor,
    showTranscript: () => setMobilePanel("transcript"),
    selectEditorPanel: () => setMobilePanel("editor"),
    closeSurface,
    toggleDetails: () => setDetailsExpanded((value) => !value),
    retryFrame,
    onFrameLoad: () => setFrameStatus(frameReachable ? "loaded" : "connecting"),
    beginDockResize
  };
}
