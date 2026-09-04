export function helpIframeRectStyle(rect) {
  return {
    left: `${Math.round(rect.left)}px`,
    top: `${Math.round(rect.top)}px`,
    width: `${Math.round(rect.width)}px`,
    height: `${Math.round(rect.height)}px`,
  };
}

export function createMahjongHelpIframePortal({
  template,
  slot,
  panel,
  dialog,
  viewport,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  if (!template || !slot || !panel || !dialog || !documentRef?.body) {
    return {
      getFocusableElements: () => [],
      setActive() {},
      destroy() {},
    };
  }

  const portal = documentRef.createElement("div");
  portal.className = "settings-help-iframe-portal";
  portal.hidden = true;
  documentRef.body.append(portal);

  let iframe = null;
  let frame = 0;
  let trackingFrames = 0;
  let active = false;
  let destroyed = false;
  let mutationObserver = null;
  let resizeObserver = null;

  function sync() {
    frame = 0;
    if (destroyed || !active) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      portal.hidden = true;
      return;
    }
    portal.hidden = false;
    Object.assign(portal.style, helpIframeRectStyle(rect));
    if (trackingFrames > 0) {
      trackingFrames -= 1;
      frame = windowRef.requestAnimationFrame(sync);
    }
  }

  function schedule(frames = 4) {
    if (!active) return;
    trackingFrames = Math.max(trackingFrames, frames);
    if (!frame) frame = windowRef.requestAnimationFrame(sync);
  }

  function startMonitoring() {
    const MutationObserverImpl =
      windowRef.MutationObserver || globalThis.MutationObserver;
    const ResizeObserverImpl =
      windowRef.ResizeObserver || globalThis.ResizeObserver;
    mutationObserver = new MutationObserverImpl(() => schedule(18));
    mutationObserver.observe(dialog, {
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    mutationObserver.observe(panel, {
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    resizeObserver = new ResizeObserverImpl(() => schedule(4));
    resizeObserver.observe(panel);
    resizeObserver.observe(dialog);
    if (viewport) resizeObserver.observe(viewport);
    if (viewport?.parentElement) resizeObserver.observe(viewport.parentElement);
    windowRef.addEventListener("resize", onWindowResize);
    windowRef.addEventListener("scroll", onWindowScroll, true);
    windowRef.visualViewport?.addEventListener(
      "resize",
      onVisualViewportResize,
    );
  }

  function stopMonitoring() {
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
    mutationObserver = null;
    resizeObserver = null;
    windowRef.removeEventListener("resize", onWindowResize);
    windowRef.removeEventListener("scroll", onWindowScroll, true);
    windowRef.visualViewport?.removeEventListener(
      "resize",
      onVisualViewportResize,
    );
    trackingFrames = 0;
    if (frame) windowRef.cancelAnimationFrame(frame);
    frame = 0;
  }

  function onWindowResize() {
    schedule(8);
  }

  function onWindowScroll() {
    schedule(2);
  }

  function onVisualViewportResize() {
    schedule(8);
  }

  function setActive(nextActive) {
    if (destroyed || active === nextActive) {
      if (nextActive) schedule(1);
      return;
    }
    active = nextActive;
    if (active) {
      if (!iframe) {
        iframe = template.content.firstElementChild.cloneNode(true);
        portal.append(iframe);
      }
      startMonitoring();
      schedule(4);
      return;
    }
    portal.hidden = true;
    stopMonitoring();
  }

  return {
    getFocusableElements() {
      return active && !portal.hidden && iframe ? [iframe] : [];
    },
    setActive,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopMonitoring();
      iframe?.remove();
      portal.remove();
    },
  };
}
