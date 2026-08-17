const DOUBLE_CLICK_TSUMOGIRI_KEY = "playweft.mahjong.double-click-tsumogiri";
const DOUBLE_CLICK_PASS_KEY = "playweft.mahjong.double-click-pass";

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

  function setOpen(open, { restoreFocus = true } = {}) {
    if (open) {
      if (!root.hidden) return;
      returnFocus = document.activeElement;
      root.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      setTab("operation");
      surface.focus({ preventScroll: true });
      return;
    }
    if (root.hidden) return;
    root.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function onRootClick(event) {
    if (event.target === root) setOpen(false);
  }

  function onKeyDown(event) {
    if (root.hidden) return;
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

  trigger.addEventListener("click", () => setOpen(true));
  closeButton.addEventListener("click", () => setOpen(false));
  root.addEventListener("click", onRootClick);
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
      setOpen(false, { restoreFocus: false });
      root.removeEventListener("click", onRootClick);
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
