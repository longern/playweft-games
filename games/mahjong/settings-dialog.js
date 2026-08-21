const DOUBLE_CLICK_TSUMOGIRI_KEY = "playweft.mahjong.double-click-tsumogiri";
const DOUBLE_CLICK_PASS_KEY = "playweft.mahjong.double-click-pass";
const GAME_HINTS_KEY = "playweft.mahjong.game-hints";
const DISCARD_VOLUME_KEY = "playweft.mahjong.discard-volume";
const MUSIC_VOLUME_KEY = "playweft.mahjong.music-volume";
const DEFAULT_DISCARD_VOLUME = 100;
const DEFAULT_MUSIC_VOLUME = 32;
const DIALOG_TRANSITION_FALLBACK_MS = 240;

export function createMahjongSettingsDialog({
  trigger,
  root,
  surface,
  closeButton,
  returnButton,
  endMatchButton,
  tabButtons,
  tabPanels,
  gameHints,
  doubleClickTsumogiri,
  doubleClickPass,
  discardVolume,
  discardVolumeValue,
  musicVolume,
  musicVolumeValue,
  onMusicVolumeChange,
  onGameHintsChange,
  onEndMatch,
}) {
  let returnFocus = null;
  let open = false;
  let openingFrame = 0;
  let closingTimer = 0;
  let restoreFocusAfterClose = true;
  gameHints.checked = readBooleanSetting(GAME_HINTS_KEY, true);
  doubleClickTsumogiri.checked = readBooleanSetting(
    DOUBLE_CLICK_TSUMOGIRI_KEY,
    false,
  );
  doubleClickPass.checked = readBooleanSetting(DOUBLE_CLICK_PASS_KEY, false);
  discardVolume.value = String(
    readVolumeSetting(DISCARD_VOLUME_KEY, DEFAULT_DISCARD_VOLUME),
  );
  renderDiscardVolume();
  musicVolume.value = String(
    readVolumeSetting(MUSIC_VOLUME_KEY, DEFAULT_MUSIC_VOLUME),
  );
  renderMusicVolume();

  function renderDiscardVolume() {
    const value = normalizeDiscardVolume(discardVolume.value);
    const label = value === 0 ? "静音" : `${value}%`;
    discardVolume.value = String(value);
    discardVolume.setAttribute("aria-valuetext", label);
    discardVolumeValue.textContent = label;
    return value;
  }

  function renderMusicVolume() {
    const value = normalizeMusicVolume(musicVolume.value);
    const label = value === 0 ? "静音" : `${value}%`;
    musicVolume.value = String(value);
    musicVolume.setAttribute("aria-valuetext", label);
    musicVolumeValue.textContent = label;
    return value;
  }

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
    return (
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
    );
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
    closingTimer = window.setTimeout(
      finishClose,
      DIALOG_TRANSITION_FALLBACK_MS,
    );
  }

  function onRootClick(event) {
    if (event.target === root) setOpen(false);
  }

  function onSurfaceTransitionEnd(event) {
    if (
      !open &&
      event.target === surface &&
      event.propertyName === "transform"
    ) {
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
    const focusable = [
      ...surface.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), iframe',
      ),
    ].filter((element) => !element.closest("[hidden]"));
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
    const next =
      tabButtons[(current + direction + tabButtons.length) % tabButtons.length];
    setTab(next.dataset.settingsTab);
    next.focus();
  }

  function onTsumogiriSettingChange() {
    writeBooleanSetting(
      DOUBLE_CLICK_TSUMOGIRI_KEY,
      doubleClickTsumogiri.checked,
    );
  }

  function onGameHintsSettingChange() {
    writeBooleanSetting(GAME_HINTS_KEY, gameHints.checked);
    onGameHintsChange?.();
  }

  function onPassSettingChange() {
    writeBooleanSetting(DOUBLE_CLICK_PASS_KEY, doubleClickPass.checked);
  }

  function onDiscardVolumeInput() {
    writeVolumeSetting(DISCARD_VOLUME_KEY, renderDiscardVolume());
  }

  function onMusicVolumeInput() {
    const value = renderMusicVolume();
    writeVolumeSetting(MUSIC_VOLUME_KEY, value);
    onMusicVolumeChange?.();
  }

  function onTriggerClick() {
    setOpen(true);
  }

  function onCloseClick() {
    setOpen(false);
  }

  function onReturnClick() {
    setOpen(false);
  }

  function onEndMatchClick() {
    onEndMatch?.();
  }

  trigger.addEventListener("click", onTriggerClick);
  closeButton.addEventListener("click", onCloseClick);
  returnButton?.addEventListener("click", onReturnClick);
  endMatchButton?.addEventListener("click", onEndMatchClick);
  root.addEventListener("click", onRootClick);
  surface.addEventListener("transitionend", onSurfaceTransitionEnd);
  document.addEventListener("keydown", onKeyDown);
  gameHints.addEventListener("change", onGameHintsSettingChange);
  doubleClickTsumogiri.addEventListener("change", onTsumogiriSettingChange);
  doubleClickPass.addEventListener("change", onPassSettingChange);
  discardVolume.addEventListener("input", onDiscardVolumeInput);
  musicVolume.addEventListener("input", onMusicVolumeInput);
  for (const button of tabButtons) {
    button.addEventListener("click", () => setTab(button.dataset.settingsTab));
    button.addEventListener("keydown", onTabKeyDown);
  }

  return {
    get gameHintsEnabled() {
      return gameHints.checked;
    },
    get doubleClickTsumogiriEnabled() {
      return doubleClickTsumogiri.checked;
    },
    get doubleClickPassEnabled() {
      return doubleClickPass.checked;
    },
    get discardVolumeScale() {
      return normalizeDiscardVolume(discardVolume.value) / 100;
    },
    get musicVolumeScale() {
      return normalizeMusicVolume(musicVolume.value) / 100;
    },
    setSoloMatchActive(active) {
      if (endMatchButton) endMatchButton.hidden = !active;
    },
    setOpen,
    destroy() {
      open = false;
      restoreFocusAfterClose = false;
      finishClose();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeEventListener("click", onTriggerClick);
      closeButton.removeEventListener("click", onCloseClick);
      returnButton?.removeEventListener("click", onReturnClick);
      endMatchButton?.removeEventListener("click", onEndMatchClick);
      root.removeEventListener("click", onRootClick);
      surface.removeEventListener("transitionend", onSurfaceTransitionEnd);
      document.removeEventListener("keydown", onKeyDown);
      gameHints.removeEventListener("change", onGameHintsSettingChange);
      doubleClickTsumogiri.removeEventListener(
        "change",
        onTsumogiriSettingChange,
      );
      doubleClickPass.removeEventListener("change", onPassSettingChange);
      discardVolume.removeEventListener("input", onDiscardVolumeInput);
      musicVolume.removeEventListener("input", onMusicVolumeInput);
      for (const button of tabButtons) {
        button.removeEventListener("keydown", onTabKeyDown);
      }
    },
  };
}

export function normalizeDiscardVolume(
  value,
  fallback = DEFAULT_DISCARD_VOLUME,
) {
  return normalizeVolume(value, fallback);
}

export function normalizeMusicVolume(value, fallback = DEFAULT_MUSIC_VOLUME) {
  return normalizeVolume(value, fallback);
}

function normalizeVolume(value, fallback = DEFAULT_DISCARD_VOLUME) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
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

function readVolumeSetting(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : normalizeDiscardVolume(value, fallback);
  } catch {
    return fallback;
  }
}

function writeVolumeSetting(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in sandboxed game hosts; the session value remains active.
  }
}
