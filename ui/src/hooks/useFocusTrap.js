import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function getFocusableElements(container) {
  return Array.from(container?.querySelectorAll(FOCUSABLE_SELECTOR) || []).filter((element) => (
    element.getAttribute("aria-hidden") !== "true"
    && element.tabIndex >= 0
    && (element.offsetParent !== null || element === document.activeElement)
  ));
}

export function useFocusTrap({ active, onDismiss, containerId, initialFocusSelector } = {}) {
  const containerRef = useRef(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) return undefined;

    const previouslyFocused = document.activeElement;
    const getContainer = () => containerRef.current || (containerId ? document.getElementById(containerId) : null);
    const focusInitialElement = () => {
      const container = getContainer();
      if (!container) return;
      const preferred = initialFocusSelector ? container.querySelector(initialFocusSelector) : null;
      const target = preferred || getFocusableElements(container)[0] || container;
      if (target === container && !container.hasAttribute("tabindex")) {
        container.setAttribute("tabindex", "-1");
      }
      target.focus({ preventScroll: true });
    };

    const frameId = window.requestAnimationFrame(focusInitialElement);
    const onKeyDown = (event) => {
      const container = getContainer();
      if (!container) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onDismissRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, containerId, initialFocusSelector]);

  return containerRef;
}
