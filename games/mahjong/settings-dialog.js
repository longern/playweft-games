const DOUBLE_CLICK_TSUMOGIRI_KEY = "playweft.mahjong.double-click-tsumogiri";
const DOUBLE_CLICK_PASS_KEY = "playweft.mahjong.double-click-pass";
const DIALOG_TRANSITION_FALLBACK_MS = 240;

export function createMahjongSettingsDialog({
  trigger,
  root,
  surface,
  closeButton,
  tabButtons,
  tabPanels,
  doubleClickTsumogiri,
  doubleClickPass,
}) {
  let returnFocus = null;
  let open = false;
  let openingFrame = 0;
  let closingTimer = 0;
  let restoreFocusAfterClose = true;
  doubleClickTsumogiri.checked = readBooleanSetting(
    DOUBLE_CLICK_TSUMOGIRI_KEY,
    false,
  );
  doubleClickPass.checked = readBooleanSetting(DOUBLE_CLICK_PASS_KEY, false);

  function setTab(name) {
    for (const button of tabButtons) {
      const selected = button.dataset.settingsTab === name;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of tabPanels) {
      panel.hidden = panel.dataset.settingsPanel !== name;
    }
  }

  function clearMotionTimers() {
    if (openingFrame) cancelAnimationFrame(openingFrame);
    if (closingTimer) clearTimeout(closingTimer);
    openingFrame = 0;
    closingTimer = 0;
  }

  function finishClose() {
    if (open) return;
    clearMotionTimers();
    root.hidden = true;
    root.classList.remove("is-open");
    if (restoreFocusAfterClose) returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function motionReduced() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  function setOpen(nextOpen, { restoreFocus = true, animate = true } = {}) {
    if (nextOpen) {
      if (open) return;
      const wasHidden = root.hidden;
      open = true;
      clearMotionTimers();
      if (wasHidden) {
        returnFocus = document.activeElement;
        root.classList.remove("is-open");
      }
      root.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      setTab("operation");
      const reveal = () => {
        openingFrame = 0;
        if (!open) return;
        root.classList.add("is-open");
        surface.focus({ preventScroll: true });
      };
      if (animate && !motionReduced() && wasHidden) {
        openingFrame = requestAnimationFrame(reveal);
      } else {
        reveal();
      }
      return;
    }
    if (!open && root.hidden) return;
    const wasVisible = root.classList.contains("is-open");
    open = false;
    clearMotionTimers();
    restoreFocusAfterClose = restoreFocus;
    root.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    if (!animate || motionReduced() || !wasVisible) {
      finishClose();
      return;
    }
    closingTimer = window.setTimeout(finishClose, DIALOG_TRANSITION_FALLBACK_MS);
  }

  function onRootClick(event) {
    if (event.target === root) setOpen(false);
  }

  function onSurfaceTransitionEnd(event) {
    if (!open && event.target === surface && event.propertyName === "transform") {
      finishClose();
    }
  }

  function onKeyDown(event) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...surface.querySelectorAll(
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), iframe',
    )].filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onTabKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = tabButtons.indexOf(event.currentTarget);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabButtons[(current + direction + tabButtons.length) % tabButtons.length];
    setTab(next.dataset.settingsTab);
    next.focus();
  }

  function onTsumogiriSettingChange() {
    writeBooleanSetting(DOUBLE_CLICK_TSUMOGIRI_KEY, doubleClickTsumogiri.checked);
  }

  function onPassSettingChange() {
    writeBooleanSetting(DOUBLE_CLICK_PASS_KEY, doubleClickPass.checked);
  }

  function onTriggerClick() {
    setOpen(true);
  }

  function onCloseClick() {
    setOpen(false);
  }

  trigger.addEventListener("click", onTriggerClick);
  closeButton.addEventListener("click", onCloseClick);
  root.addEventListener("click", onRootClick);
  surface.addEventListener("transitionend", onSurfaceTransitionEnd);
  document.addEventListener("keydown", onKeyDown);
  doubleClickTsumogiri.addEventListener("change", onTsumogiriSettingChange);
  doubleClickPass.addEventListener("change", onPassSettingChange);
  for (const button of tabButtons) {
    button.addEventListener("click", () => setTab(button.dataset.settingsTab));
    button.addEventListener("keydown", onTabKeyDown);
  }

  return {
    get doubleClickTsumogiriEnabled() {
      return doubleClickTsumogiri.checked;
    },
    get doubleClickPassEnabled() {
      return doubleClickPass.checked;
    },
    setOpen,
    destroy() {
      open = false;
      restoreFocusAfterClose = false;
      finishClose();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeEventListener("click", onTriggerClick);
      closeButton.removeEventListener("click", onCloseClick);
      root.removeEventListener("click", onRootClick);
      surface.removeEventListener("transitionend", onSurfaceTransitionEnd);
      document.removeEventListener("keydown", onKeyDown);
      doubleClickTsumogiri.removeEventListener("change", onTsumogiriSettingChange);
      doubleClickPass.removeEventListener("change", onPassSettingChange);
      for (const button of tabButtons) {
        button.removeEventListener("keydown", onTabKeyDown);
      }
    },
  };
}

function readBooleanSetting(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeBooleanSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in sandboxed game hosts; the session value remains active.
  }
}
