const DEFAULT_EXIT_DURATION_MS = 560;

/** Owns setup-screen visibility and its one transition used before a deal. */
export function createMahjongSetupScreenController({
  window,
  elements,
  closePaipuPanel,
  transientNotice,
  exitDuration = DEFAULT_EXIT_DURATION_MS,
}) {
  const matchTypeButtons = () =>
    elements.setup.querySelectorAll("[data-match-type]");

  function show() {
    closePaipuPanel({ animate: false, restoreFocus: false });
    elements.setup.classList.remove(
      "is-leaving",
      "is-prepared-for-result-exit",
    );
    for (const button of matchTypeButtons()) button.disabled = false;
    elements.setup.hidden = false;
  }

  function showRoom() {
    show();
    elements.loading.classList.remove("is-room-waiting");
    elements.loading.hidden = true;
  }

  function showRecoveryError(message) {
    transientNotice.show(message);
  }

  function beginExit() {
    const signpost = elements.setup.querySelector(".setup-signpost");
    elements.setup.classList.add("is-leaving");
    elements.loading.classList.add("is-active");
    for (const button of matchTypeButtons()) button.disabled = true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signpost.removeEventListener("transitionend", handleTransitionEnd);
        window.clearTimeout(fallbackTimer);
        resolve();
      };
      const handleTransitionEnd = (event) => {
        if (event.target === signpost && event.propertyName === "opacity")
          finish();
      };
      const fallbackTimer = window.setTimeout(finish, exitDuration + 100);
      signpost.addEventListener("transitionend", handleTransitionEnd);
    });
  }

  return { beginExit, show, showRecoveryError, showRoom };
}
