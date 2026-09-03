/**
 * The DOM layer only translates gestures into application actions. It owns no
 * match state and returns a disposer for an explicit application teardown.
 */
export function bindMahjongUi({
  paipuElements,
  replayElements,
  elements,
  tableController,
  resultHandRenderer,
  autoActionController,
  getMode,
  getReplayState,
  getRoomController,
  getReplayController,
  openPaipuPanel,
  closePaipuPanel,
  initializeSoloMatch,
  pageLifecycle,
}) {
  const removeListeners = [];
  const listen = (element, type, listener) => {
    if (!element) return;
    element.addEventListener(type, listener);
    removeListeners.push(() => element.removeEventListener(type, listener));
  };

  listen(paipuElements.entry, "click", () => void openPaipuPanel());
  listen(paipuElements.close, "click", closePaipuPanel);
  listen(paipuElements.panel, "click", (event) => {
    if (event.target === paipuElements.panel) closePaipuPanel();
  });
  listen(replayElements.previousHand, "click", () => {
    void getReplayController()?.previousHand(getReplayState());
  });
  listen(replayElements.nextHand, "click", () => {
    const state = getReplayState();
    if (state) void getReplayController()?.nextHand(state);
  });
  listen(replayElements.stepBack, "click", () => {
    const state = getReplayState();
    if (state) void getReplayController()?.seek(state.position - 1);
  });
  listen(
    replayElements.stepForward,
    "click",
    () => void getReplayController()?.advance(),
  );
  listen(
    replayElements.toggle,
    "click",
    () => void getReplayController()?.toggle(),
  );
  listen(replayElements.speed, "click", () =>
    getReplayController()?.cycleSpeed(),
  );
  listen(replayElements.progress, "change", () => {
    if (getReplayState())
      void getReplayController()?.seek(replayElements.progress.value);
  });
  listen(replayElements.handVisibility, "click", () => {
    void getReplayController()?.toggleOpponentHands();
  });
  listen(elements.pass, "click", () =>
    tableController.submitAction({ type: "pass" }),
  );
  listen(elements.abort, "click", () =>
    tableController.submitAction({ type: "abort_nine" }),
  );
  listen(elements.tsumo, "click", () =>
    tableController.submitAction({ type: "tsumo" }),
  );
  listen(elements.riichi, "click", () => tableController.enterRiichiMode());
  listen(elements.cancelRiichi, "click", () =>
    tableController.cancelRiichiMode(),
  );
  listen(
    elements.rematch,
    "click",
    () => void tableController.continueResult(),
  );
  listen(
    elements.matchSummaryRematch,
    "click",
    () => void tableController.restartMatchFromSummary(),
  );
  listen(
    elements.matchSummarySetup,
    "click",
    () => void tableController.returnToSetupFromSummary(),
  );
  listen(elements.result, "dblclick", (event) => {
    if (!tableController.isResultBlankSpace(event.target)) return;
    resultHandRenderer.playStartButtonActivation(
      () => void tableController.continueResult(),
    );
  });
  listen(elements.autoWin, "click", () =>
    autoActionController.toggle("autoWin"),
  );
  listen(elements.passClaims, "click", () =>
    autoActionController.toggle("passClaims"),
  );
  listen(elements.autoTsumogiri, "click", () =>
    autoActionController.toggle("autoTsumogiri"),
  );
  for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
    listen(button, "click", () => {
      if (getMode() === "room") {
        void getRoomController()?.startMatch(button.dataset.matchType);
        return;
      }
      void initializeSoloMatch(button.dataset.matchType);
    });
  }
  autoActionController.syncControls();
  pageLifecycle.bind();

  return () => {
    for (const remove of removeListeners) remove();
  };
}
