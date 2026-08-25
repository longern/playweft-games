/** Shows short, non-blocking Mahjong status notices over any screen. */
export function createMahjongTransientNotice({
  element,
  window = globalThis.window,
  duration = 4600,
  transitionDuration = 180,
} = {}) {
  let hideTimer = 0;
  let concealTimer = 0;

  function clearTimers() {
    window?.clearTimeout(hideTimer);
    window?.clearTimeout(concealTimer);
    hideTimer = 0;
    concealTimer = 0;
  }

  function show(message) {
    if (!element || typeof message !== "string" || !message) return;
    clearTimers();
    element.textContent = message;
    element.hidden = false;
    void element.offsetWidth;
    element.classList.add("is-visible");
    hideTimer = window?.setTimeout(() => {
      element.classList.remove("is-visible");
      concealTimer = window?.setTimeout(() => {
        if (!element.classList.contains("is-visible")) element.hidden = true;
      }, transitionDuration);
    }, duration);
  }

  return { show, clear: clearTimers };
}
