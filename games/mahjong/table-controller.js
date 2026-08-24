import {
  AUTO_DECISION_DELAY_MS,
  DRAW_REVEAL_CARD_DELAY_MS,
  DRAW_REVEAL_CARD_GAP_MS,
  DRAW_REVEAL_VISIBLE_BASE_MS,
  DRAW_REVEAL_VISIBLE_EXTENSION_MS,
  DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS,
  HAND_END_PRESENTATION_DELAY_MS,
  HAND_INSERTION_DELAY_MS,
} from "./constants.js";
import {
  asArray,
  canDiscardHandTile,
  clearedTableState,
  deferredHandInsertion,
  exhaustiveDrawPresentation,
  matchResultRows,
  resultDetailPageCount,
} from "./game-format.js";
import { MAHJONG_YAKU_VOICE_KEYS } from "./asset-packs.js";
import {
  hasMahjongRiichi,
  mahjongMatchMusicTarget,
} from "./match-music.js";
import { riverTileSoundCue } from "./render/audio-cues.js";

const MATCH_MUSIC_FADE_DURATION_MS = 800;
const RESULT_PAGE_TRANSITION_MS = 920;
const RESULT_EXIT_DURATION_MS = 320;
const NEW_HAND_TABLE_PAUSE_MS = 360;
const KAN_DRAW_PAUSE_MS = 300;
const MATCH_SUMMARY_PORTRAIT_POSITIONS = ["0% 0%", "100% 0%", "0% 100%", "100% 100%"];
const MATCH_SUMMARY_POSITIONS = ["bottom", "right", "top", "left"];

/**
 * Owns the table projection and every visual/audio consequence of it. The
 * session controller owns rule actions; accepted projections enter here and
 * effects are always isolated from that authoritative action lifecycle.
 */
export function createMahjongTableController({
  document = window.document,
  window: browserWindow = window,
  elements,
  domView,
  visualRenderer,
  resultHandRenderer,
  presentation,
  effectRunner,
  settingsDialog,
  matchMusicController,
  riverTileSound,
  humanId,
  getGame,
  getGameInitializing,
  getMode,
  getPlayerName,
  playerNameIsAuthoritative,
  getThemeAssetUrl,
  getThemeDefaultNames,
  getThemeMatchMusicUrl,
  getThemeRiichiMusicUrl,
  dispatch,
  isActionInFlight,
  scheduleAi,
  onRerollPortraits,
  onReplayAdvance,
  onReturnToSetup,
} = {}) {
  let state;
  let serverTimeAtSync = 0;
  let visibleEvents = [];
  let selectedTileId = 0;
  let riichiMode = false;
  let selectionBeforeRiichi = 0;
  let resultPageIndex = 0;
  let resultPageKey = "";
  let resultPageAnimating = false;
  let matchSummaryVisible = false;
  let voicedEventKey = "";
  let playedRiverTileSoundKey = "";

  function getState() {
    return state;
  }

  function isRiichiMode() {
    return riichiMode;
  }

  function clearActionUi() {
    riichiMode = false;
    selectionBeforeRiichi = 0;
    selectedTileId = 0;
  }

  function reset() {
    state = undefined;
    serverTimeAtSync = 0;
    visibleEvents = [];
    clearActionUi();
    resultPageIndex = 0;
    resultPageKey = "";
    resultPageAnimating = false;
    hideMatchSummary();
    resetResultPageTrack();
  }

  async function refresh(
    projection,
    { ownDiscardedTile = 0, animateDealIn = false } = {},
  ) {
    const currentGame = getGame?.();
    if (!projection && getMode?.() === "solo") {
      projection = await currentGame?.view(humanId);
    }
    if (!projection || (getMode?.() === "solo" && currentGame !== getGame?.())) return;
    const previousState = state;
    state = projection.state;
    const projectionServerTime = Number(projection.serverTime);
    serverTimeAtSync = Number.isFinite(projectionServerTime)
      ? projectionServerTime
      : 0;
    if (riichiMode && !state.legalActions?.canRiichi) {
      riichiMode = false;
      selectionBeforeRiichi = 0;
    }
    const events = asArray(projection.events);
    visibleEvents = events;
    effectRunner.runAll([
      ["match music", () => syncMatchMusicForHandState(previousState, state)],
      ["result state", () => syncResultPage(state)],
      ["role voices", () => playRoleVoices(events)],
      ["kan draw presentation", () => queueKanDraw(events)],
      ["hand insertion presentation", () => queueHandInsertion(previousState, events, ownDiscardedTile)],
      ["hand-end presentation", () => presentation.syncHandEnd(handEndPresentationPlan(state))],
    ]);
    renderCurrentState({ animateDealIn });
    effectRunner.run("river tile sound", () => playRiverTileSound(events));
  }

  function renderCurrentState({ animateDealIn = false } = {}) {
    const renderState = presentedState();
    const revealedPlayerIndices = handRevealPlayerIndices(state);
    const coveredPlayerIndices = handCoveredPlayerIndices(state);
    effectRunner.run("table overlays", () => renderPresentationOverlays(renderState, { animateDealIn }));
    effectRunner.run("table scene", () => visualRenderer.render(renderState, visibleEvents, {
      ...domView.visualUi(getPlayerName?.(), selectedTileId),
      dealInKey: animateDealIn ? handDealInKey(state) : "",
      animateDealIn,
      riichiMode,
      riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
      showGameHints: settingsDialog.gameHintsEnabled,
      revealPlayerIndices: revealedPlayerIndices,
      coveredPlayerIndices,
      handRevealKey: handEndPresentationKey(state),
      animateHandReveal: revealedPlayerIndices.length + coveredPlayerIndices.length > 0 && !presentation.resultVisible,
      handRevealDelay: isExhaustiveDrawRevealState(state) ? AUTO_DECISION_DELAY_MS : 0,
      delayHandRevealForCallout: visibleEvents.some((event) => event.type === "won"),
      deferredHandInsertionSeat: Number(presentation.handInsertion?.seat) || 0,
      deferredHandInsertionIndex: Number(presentation.handInsertion?.rackIndex) || 0,
    }));
  }

  function renderPresentationOverlays(renderState = presentedState(), { animateDealIn = false } = {}) {
    if (!renderState) return;
    effectRunner.run("table DOM", () => domView.render(renderState, visibleEvents, selectedTileId, getPlayerName?.(), {
      showResult: presentation.resultVisible,
      showGameHints: settingsDialog.gameHintsEnabled,
      showDrawReveal: isDrawRevealState(state) && presentation.drawRevealVisible && !presentation.resultVisible,
      resultPage: resultPageIndex,
      dealInKey: animateDealIn ? handDealInKey(state) : "",
      animateDealIn,
      riichiMode,
      defaultNames: getThemeDefaultNames?.(),
      playerNameIsAuthoritative: playerNameIsAuthoritative?.(),
      serverTime: serverTimeAtSync,
    }));
    if (matchSummaryVisible) {
      effectRunner.run("result hand cleanup", () => resultHandRenderer.hide());
      effectRunner.run("match summary", () => renderMatchSummary());
    } else {
      effectRunner.run("result hand", () => resultHandRenderer.render(renderState, resultPageIndex, getPlayerName?.(), {
        defaultNames: getThemeDefaultNames?.(),
        playerNameIsAuthoritative: playerNameIsAuthoritative?.(),
      }));
    }
  }

  function renderResultExitTable(tableState) {
    const renderState = clearedTableState(tableState ?? state);
    visibleEvents = [];
    selectedTileId = 0;
    riichiMode = false;
    effectRunner.run("result exit DOM", () => domView.render({ ...renderState, legalActions: {} }, [], selectedTileId, getPlayerName?.(), {
      preserveResult: true,
      riichiMode,
      serverTime: serverTimeAtSync,
      defaultNames: getThemeDefaultNames?.(),
      playerNameIsAuthoritative: playerNameIsAuthoritative?.(),
    }));
    const staticState = { ...renderState, legalActions: {} };
    effectRunner.run("result exit scene", () => visualRenderer.render(staticState, [], {
      ...domView.visualUi(getPlayerName?.(), selectedTileId),
      riichiMode,
      riichiCandidateTiles: [],
      revealPlayerIndices: [],
      coveredPlayerIndices: [],
      handRevealKey: "",
      animateHandReveal: false,
      dealInKey: "",
      animateDealIn: false,
      delayHandRevealForCallout: false,
      deferredHandInsertionSeat: 0,
      deferredHandInsertionIndex: 0,
    }));
  }

  async function continueResult() {
    if (
      resultPageAnimating ||
      state?.phase !== "hand_ended" ||
      elements.result.hidden ||
      elements.result.inert
    ) return;
    const detailCount = resultDetailPageCount(state);
    resultPageAnimating = true;
    elements.rematch.disabled = true;
    try {
      if (resultPageIndex < detailCount) {
        const outgoing = elements.resultDetailContent.cloneNode(true);
        copyCanvasBitmaps(elements.resultDetailContent, outgoing);
        for (const node of [outgoing, ...outgoing.querySelectorAll("[id]")]) node.removeAttribute("id");
        outgoing.classList.add("is-step-previous");
        outgoing.setAttribute("aria-hidden", "true");
        elements.resultTrack.prepend(outgoing);
        resultPageIndex += 1;
        const defaultNames = getThemeDefaultNames?.();
        domView.renderResult(state, getPlayerName?.(), true, resultPageIndex, {
          defaultNames,
          playerNameIsAuthoritative: playerNameIsAuthoritative?.(),
        });
        resultHandRenderer.render(state, resultPageIndex, getPlayerName?.(), {
          defaultNames,
          playerNameIsAuthoritative: playerNameIsAuthoritative?.(),
        });
        void elements.resultTrack.offsetWidth;
        elements.resultTrack.classList.add("is-step-advancing");
        await waitForAnimation(elements.resultTrack, "result-page-step", RESULT_PAGE_TRANSITION_MS);
        return;
      }
      if (state.matchEnded) {
        showMatchSummary();
        return;
      }
      syncMatchMusic({ transition: "next-hand" });
      const advanced = await advanceFromResult({ type: "next_hand" });
      if (!advanced && state?.phase === "hand_ended") syncMatchMusic();
    } finally {
      resultPageAnimating = false;
      elements.rematch.disabled = false;
      resetResultPageTrack();
      if (state?.phase === "hand_ended") elements.result.classList.remove("is-exiting");
    }
  }

  async function restartMatchFromSummary() {
    if (!matchSummaryVisible || !state?.matchEnded || resultPageAnimating) return;
    resultPageAnimating = true;
    elements.matchSummaryRematch.disabled = true;
    elements.matchSummarySetup.disabled = true;
    try {
      syncMatchMusic({ transition: "next-hand" });
      const advanced = await advanceFromResult({ type: "new_match" });
      if (!advanced && state?.phase === "hand_ended") syncMatchMusic();
    } finally {
      resultPageAnimating = false;
      elements.matchSummaryRematch.disabled = false;
      elements.matchSummarySetup.disabled = false;
      resetResultPageTrack();
      if (state?.phase === "hand_ended") elements.result.classList.remove("is-exiting");
    }
  }

  async function returnToSetupFromSummary() {
    if (getMode?.() !== "solo" || !matchSummaryVisible || !state?.matchEnded || resultPageAnimating) return;
    resultPageAnimating = true;
    elements.matchSummaryRematch.disabled = true;
    elements.matchSummarySetup.disabled = true;
    try {
      elements.setup.classList.remove("is-leaving");
      elements.setup.classList.add("is-prepared-for-result-exit");
      elements.setup.hidden = false;
      elements.result.classList.add("is-exiting");
      await waitForAnimation(elements.result, "result-screen-exit", RESULT_EXIT_DURATION_MS);
      hideMatchSummary();
      syncMatchMusic({ enabled: false });
      await onReturnToSetup?.();
    } finally {
      resultPageAnimating = false;
      elements.matchSummaryRematch.disabled = false;
      elements.matchSummarySetup.disabled = false;
      resetResultPageTrack();
      elements.result.classList.remove("is-exiting");
    }
  }

  async function advanceFromResult(action) {
    if (getMode?.() === "replay") return onReplayAdvance?.(action) ?? false;
    if (getMode?.() === "room") {
      if (!state || isActionInFlight?.()) return false;
      await dispatch?.(action);
      return isActionInFlight?.() === true;
    }
    return dispatch?.(action, {
      onAcceptedProjection: async (projection) => {
        renderResultExitTable(projection?.state);
        elements.result.classList.add("is-exiting");
        await waitForAnimation(elements.result, "result-screen-exit", RESULT_EXIT_DURATION_MS);
        hideMatchSummary();
        elements.result.hidden = true;
        elements.result.classList.remove("is-exiting");
        await waitForDelay(NEW_HAND_TABLE_PAUSE_MS);
        visualRenderer.prepareDealIn();
        if (action.type === "new_match") await onRerollPortraits?.();
        await refresh(projection, { animateDealIn: true });
      },
    });
  }

  async function dismissResultForReplay() {
    if (state?.phase !== "hand_ended" || elements.result.hidden) return;
    renderResultExitTable(state);
    elements.result.classList.add("is-exiting");
    try {
      await waitForAnimation(elements.result, "result-screen-exit", RESULT_EXIT_DURATION_MS);
      hideMatchSummary();
      elements.result.hidden = true;
      await waitForDelay(NEW_HAND_TABLE_PAUSE_MS);
      visualRenderer.prepareDealIn();
    } finally {
      elements.result.classList.remove("is-exiting");
    }
  }

  function syncResultPage(current) {
    const key = current?.phase === "hand_ended"
      ? [current.roundWind, current.handNumber, current.moveCount, current.winType || "draw", ...asArray(current.winners)].join(":")
      : "";
    if (key === resultPageKey) return;
    resultPageKey = key;
    resultPageIndex = 0;
    resultPageAnimating = false;
    hideMatchSummary();
    elements.rematch.disabled = false;
    elements.result.classList.remove("is-exiting");
    resetResultPageTrack();
  }

  function showMatchSummary() {
    if (!state?.matchEnded) return;
    matchSummaryVisible = true;
    elements.result.classList.add("is-match-summary");
    elements.matchSummarySetup.hidden = getMode?.() === "room";
    elements.matchSummary.hidden = false;
    resultHandRenderer.hide();
    renderMatchSummary();
  }

  function hideMatchSummary() {
    matchSummaryVisible = false;
    elements.result.classList.remove("is-match-summary");
    elements.matchSummarySetup.hidden = false;
    elements.matchSummary.hidden = true;
  }

  function renderMatchSummary() {
    const rows = matchResultRows(state, getPlayerName?.(), {
      defaultNames: getThemeDefaultNames?.(),
      playerNameIsAuthoritative: playerNameIsAuthoritative?.(),
    });
    const winner = rows[0];
    if (!winner) return;
    elements.matchSummaryRows.replaceChildren(...rows.map((entry) => {
      const row = document.createElement("tr");
      for (const value of [`${entry.rank}位`, entry.name, String(entry.score)]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    renderMatchSummaryPortrait(winner.seat);
  }

  function renderMatchSummaryPortrait(seat) {
    const index = Number(seat) - 1;
    const position = MATCH_SUMMARY_POSITIONS[index] || "bottom";
    const stationImage = elements.stations[position]?.querySelector("[data-player-avatar]");
    const source = stationImage?.dataset.source || "";
    const crop = elements.matchSummaryPhotoCrop;
    const image = elements.matchSummaryPhotoImage;
    crop.style.setProperty("--match-summary-portrait-position", MATCH_SUMMARY_PORTRAIT_POSITIONS[index] || "0% 0%");
    if (!source) {
      crop.classList.remove("is-custom");
      image.hidden = true;
      image.removeAttribute("src");
      delete image.dataset.source;
      return;
    }
    if (image.dataset.source === source && !image.hidden) return;
    crop.classList.remove("is-custom");
    image.hidden = true;
    image.dataset.source = source;
    image.onload = () => {
      if (image.dataset.source !== source) return;
      crop.classList.add("is-custom");
      image.hidden = false;
    };
    image.onerror = () => {
      if (image.dataset.source !== source) return;
      crop.classList.remove("is-custom");
      image.hidden = true;
      image.removeAttribute("src");
    };
    image.src = source;
  }

  function isResultBlankSpace(target) {
    return target === elements.result || target === elements.resultStage || target === elements.resultTrack || target === elements.resultDetailContent || target === elements.resultScoreContent;
  }

  function copyCanvasBitmaps(source, clone) {
    const sourceCanvases = source.querySelectorAll("canvas");
    const cloneCanvases = clone.querySelectorAll("canvas");
    sourceCanvases.forEach((canvas, index) => {
      const copy = cloneCanvases[index];
      if (!copy) return;
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext("2d")?.drawImage(canvas, 0, 0);
    });
  }

  function resetResultPageTrack() {
    const { resultTrack } = elements;
    resultTrack.classList.add("is-step-resetting");
    resultTrack.querySelectorAll(".is-step-previous").forEach((page) => page.remove());
    resultTrack.classList.remove("is-step-advancing");
    void resultTrack.offsetWidth;
    resultTrack.classList.remove("is-step-resetting");
  }

  function waitForDelay(duration) {
    return new Promise((resolve) => browserWindow.setTimeout(resolve, duration));
  }

  function waitForAnimation(element, animationName, duration) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        element.removeEventListener("animationend", handleAnimationEnd);
        browserWindow.clearTimeout(fallbackTimer);
        resolve();
      };
      const handleAnimationEnd = (event) => {
        if (event.target === element && event.animationName === animationName) finish();
      };
      const fallbackTimer = browserWindow.setTimeout(finish, duration + 100);
      element.addEventListener("animationend", handleAnimationEnd);
    });
  }

  function syncMatchMusic({ enabled, transition, userGesture = false, fadeIn = false, fadeOut = false } = {}) {
    const target = mahjongMatchMusicTarget({
      gameInitializing: getGameInitializing?.(),
      game: getGame?.(),
      playMode: getMode?.(),
      state,
      matchSource: getThemeMatchMusicUrl?.(),
      riichiSource: getThemeRiichiMusicUrl?.(),
      transition,
    });
    if (enabled === false) target.mode = "stopped";
    if (userGesture && target.mode !== "playing") return;
    if (target.source) target.source = new URL(target.source, document.baseURI).href;
    matchMusicController.sync(target, {
      fadeIn: fadeIn || (target.mode === "playing" && matchMusicController.gain === 0),
      fadeOut,
    });
  }

  function applyMatchMusicVolume() {
    matchMusicController.applyVolume();
  }

  function syncMatchMusicForHandState(previousState, currentState) {
    const handWasEnded = previousState?.phase === "hand_ended";
    const handIsEnded = currentState?.phase === "hand_ended";
    if (!previousState) syncMatchMusic();
    else if (!handWasEnded && handIsEnded) syncMatchMusic({ fadeOut: true });
    else if (handWasEnded && !handIsEnded) syncMatchMusic({ fadeIn: true });
    else if (
      !handIsEnded &&
      !hasMahjongRiichi(previousState) &&
      hasMahjongRiichi(currentState)
    ) {
      syncMatchMusic({ fadeIn: true });
    }
  }

  function playRiverTileSound(events) {
    const cue = riverTileSoundCue(state, events);
    if (!cue || cue.key === playedRiverTileSoundKey) return;
    playedRiverTileSoundKey = cue.key;
    const volume = cue.volume * settingsDialog.discardVolumeScale;
    if (volume <= 0) return;
    riverTileSound.pause();
    riverTileSound.currentTime = 0;
    riverTileSound.volume = volume;
    riverTileSound.playbackRate = cue.playbackRate;
    void riverTileSound.play().catch(() => {});
  }

  function playRoleVoices(events) {
    const voiceEvents = events.filter((event) => voiceCueForEvent(event));
    if (!voiceEvents.length) return;
    const key = [Number(state?.moveCount) || 0, ...voiceEvents.map((event) => `${event.type}:${event.kind ?? event.method ?? ""}:${event.playerIndex}`)].join("|");
    if (key === voicedEventKey) return;
    voicedEventKey = key;
    for (const event of voiceEvents) {
      const cue = voiceCueForEvent(event);
      if (event.type === "won") playRoleVoiceSequence(event.playerIndex, [cue, ...winningYakuVoiceCues(event.playerIndex)]);
      else playRoleVoice(event.playerIndex, cue);
    }
  }

  function winningYakuVoiceCues(playerIndex) {
    const score = asArray(state?.results).find((result) => Number(result?.winnerIndex) === Number(playerIndex));
    return asArray(score?.yaku).map((yaku) => MAHJONG_YAKU_VOICE_KEYS[yaku?.name]).map((cue) => cue && `yaku:${cue}`).filter(Boolean);
  }

  function voiceCueForEvent(event) {
    if (event?.type === "claimed") return ["chi", "pon", "kan"].includes(event.kind) || ["ankan", "kakan"].includes(event.kind) ? (event.kind === "ankan" || event.kind === "kakan" ? "kan" : event.kind) : "";
    if (event?.type === "riichi") return "riichi";
    if (event?.type === "won") return event.method === "tsumo" ? "tsumo" : "ron";
    return "";
  }

  function playerPosition(playerIndex) {
    return ["", "self", "right", "opposite", "left"][Number(playerIndex)] ?? "";
  }

  function playRoleVoice(playerIndex, cue, delay = 0) {
    const position = playerPosition(playerIndex);
    const source = position && getThemeAssetUrl?.(`voice-${position}:${cue}`);
    if (!source) return;
    browserWindow.setTimeout(() => {
      const audio = new Audio(source);
      audio.preload = "auto";
      audio.addEventListener("ended", () => audio.remove(), { once: true });
      audio.addEventListener("error", () => audio.remove(), { once: true });
      void audio.play().catch(() => audio.remove());
    }, delay);
  }

  function playRoleVoiceSequence(playerIndex, cues) {
    const sources = cues.map((cue) => getRoleVoiceSource(playerIndex, cue)).filter(Boolean);
    if (!sources.length) return;
    void sources.reduce((sequence, source) => sequence.then(() => playVoiceSource(source)), Promise.resolve());
  }

  function getRoleVoiceSource(playerIndex, cue) {
    const position = playerPosition(playerIndex);
    const isYaku = cue.startsWith("yaku:");
    const slot = `voice-${position}:${isYaku ? "yaku:" : ""}${isYaku ? cue.slice(5) : cue}`;
    return position ? getThemeAssetUrl?.(slot) : "";
  }

  function playVoiceSource(source) {
    return new Promise((resolve) => {
      const audio = new Audio(source);
      const finish = () => { audio.remove(); resolve(); };
      audio.preload = "auto";
      audio.addEventListener("ended", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
      void audio.play().catch(finish);
    });
  }

  function presentedState() {
    let presented = state;
    if (presentation.kanDrawPending) presented = { ...presented, drawnTile: 0, drawnPlayerIndex: 0, legalActions: {} };
    if (Number(presentation.handInsertion?.seat) !== 1) return presented;
    return { ...presented, ownHand: presentation.handInsertion.ownHand, drawnTile: presentation.handInsertion.drawnTile };
  }

  function queueKanDraw(events) {
    const kan = asArray(events).find((event) => event?.type === "claimed" && ["kan", "ankan", "kakan"].includes(event.kind));
    if (!kan) return;
    const draw = asArray(events).find((event) => event?.type === "drew" && Number(event.playerIndex) === Number(kan.playerIndex));
    if (!draw) return;
    const key = [Number(state?.roundWind) || 0, Number(state?.handNumber) || 0, Number(state?.honba) || 0, Number(state?.moveCount) || 0, kan.kind, Number(kan.playerIndex) || 0].join(":");
    presentation.scheduleKanDraw(key, KAN_DRAW_PAUSE_MS);
  }

  function queueHandInsertion(previousState, events, ownDiscardedTile = 0) {
    if (state?.phase === "hand_ended") {
      presentation.cancelHandInsertion();
      return;
    }
    const discard = asArray(events).find((event) => (event?.type === "discarded" || event?.type === "riichi") && typeof event.fromDrawn === "boolean");
    if (!discard) return;
    const key = [Number(state?.roundWind) || 0, Number(state?.handNumber) || 0, Number(state?.honba) || 0, Number(state?.moveCount) || 0, discard.type, Number(discard.playerIndex) || 0, Number(discard.tile) || 0, String(discard.fromDrawn)].join(":");
    presentation.scheduleHandInsertion(key, deferredHandInsertion(previousState, events, { ownDiscardedTile }), HAND_INSERTION_DELAY_MS);
  }

  function handEndPresentationKey(current) {
    if (current?.phase !== "hand_ended") return "";
    if (current.result?.abortive === true) return `${current.moveCount}:abortive-draw:${current.abortiveReason || current.result.reason || "unknown"}`;
    if (current.abortiveReason === "九种九牌" && Number(current.abortivePlayerIndex) > 0) return `${current.moveCount}:nine-terminals:${current.abortivePlayerIndex}`;
    const exhaustive = exhaustiveDrawPresentation(current);
    if (exhaustive.revealed.length + exhaustive.covered.length > 0) return `${current.moveCount}:exhaustive-draw`;
    if (current.winType === "nagashi") return `${current.moveCount}:nagashi:${asArray(current.winners).join(",")}`;
    if (current.draw) return "";
    const winners = asArray(current.winners);
    return winners.length ? `${current.moveCount}:${current.winType}:${winners.join(",")}` : "";
  }

  function handDealInKey(current) {
    if (!current || current.phase === "hand_ended") return "";
    return [Number(current.roundWind) || 0, Number(current.handNumber) || 0, Number(current.honba) || 0, Number(current.moveCount) || 0].join(":");
  }

  function isDrawRevealState(current) {
    return current?.phase === "hand_ended" && (current.winType === "nagashi" || (current.draw === true && (current.result?.abortive === true || isExhaustiveDrawRevealState(current))));
  }

  function isExhaustiveDrawRevealState(current) {
    return current?.phase === "hand_ended" && current.draw === true && current.result?.abortive !== true && Array.isArray(current.result?.tenpai);
  }

  function handEndPresentationPlan(current) {
    const key = handEndPresentationKey(current);
    if (!key) return null;
    const showDrawReveal = isDrawRevealState(current);
    const handMotionCount = handRevealPlayerIndices(current).length + handCoveredPlayerIndices(current).length;
    const waitForHandReveal = showDrawReveal && handMotionCount > 0;
    return {
      key,
      waitForHandReveal,
      showDrawReveal,
      drawRevealDelay: waitForHandReveal ? DRAW_REVEAL_CARD_GAP_MS : DRAW_REVEAL_CARD_DELAY_MS,
      drawRevealDuration: showDrawReveal ? drawRevealVisibleDuration(current) : 0,
      resultDelay: HAND_END_PRESENTATION_DELAY_MS,
    };
  }

  function drawRevealVisibleDuration(current) {
    const tenpaiPlayerCount = asArray(current?.result?.tenpaiWaits).filter((waits) => asArray(waits).length > 0).length;
    return DRAW_REVEAL_VISIBLE_BASE_MS + DRAW_REVEAL_VISIBLE_EXTENSION_MS + tenpaiPlayerCount * DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS;
  }

  function handRevealPlayerIndices(current) {
    if (current?.winType === "nagashi") return [];
    const exhaustive = exhaustiveDrawPresentation(current);
    if (exhaustive.revealed.length + exhaustive.covered.length > 0) return exhaustive.revealed;
    if (current?.abortiveReason === "九种九牌") {
      const seat = Number(current.abortivePlayerIndex) || 0;
      return seat > 0 ? [seat] : [];
    }
    return asArray(current?.winners).map((id) => asArray(current.players).indexOf(id) + 1).filter((seat) => seat > 0);
  }

  function handCoveredPlayerIndices(current) {
    const exhaustive = exhaustiveDrawPresentation(current);
    return exhaustive.revealed.length + exhaustive.covered.length > 0 ? exhaustive.covered : [];
  }

  function selectTile(tileId) {
    const renderState = presentedState();
    const selectableTiles = orderedOwnTiles(renderState);
    if (!selectableTiles.includes(Number(tileId)) || state?.phase === "hand_ended") return;
    if (riichiMode && !asArray(state?.legalActions?.riichiTiles).includes(Number(tileId))) return;
    selectedTileId = selectedTileId === tileId ? 0 : tileId;
    renderTileSelection(renderState);
  }

  function clearSelectedTile() {
    if (!selectedTileId) return;
    selectedTileId = 0;
    renderTileSelection(presentedState());
  }

  function previewDraggedTile(tileId) {
    domView.renderTenpaiPreview(presentedState(), Number(tileId) || 0);
  }

  function restoreSelectedTilePreview() {
    domView.renderTenpaiPreview(presentedState(), selectedTileId);
  }

  function renderTileSelection(renderState) {
    const ui = domView.renderSelection(renderState, selectedTileId, getPlayerName?.(), { riichiMode, showGameHints: settingsDialog.gameHintsEnabled });
    visualRenderer.updateSelection({
      ...ui,
      riichiMode,
      riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
      showGameHints: settingsDialog.gameHintsEnabled,
      deferredHandInsertionSeat: Number(presentation.handInsertion?.seat) || 0,
      deferredHandInsertionIndex: Number(presentation.handInsertion?.rackIndex) || 0,
    });
  }

  function orderedOwnTiles(current) {
    return [...asArray(current?.ownHand).map(Number), ...(Number(current?.drawnTile) > 0 ? [Number(current.drawnTile)] : [])];
  }

  function discardSelected() {
    if (!selectedTileId || !state?.legalActions?.canDiscard) return;
    if (riichiMode) {
      if (!asArray(state.legalActions.riichiTiles).includes(selectedTileId)) return;
      dispatch?.({ type: "riichi", tileId: selectedTileId });
      return;
    }
    dispatch?.({ type: "discard", tileId: selectedTileId });
  }

  function discardOwnTile(tileId) {
    if (!canDiscardHandTile({
      canDiscard: state?.legalActions?.canDiscard,
      riichiDeclared: state?.riichi?.[state?.players?.[0]] === true,
      drawnTile: state?.drawnTile,
      tileId,
    })) return;
    selectedTileId = Number(tileId) || 0;
    discardSelected();
  }

  function enterRiichiMode() {
    if (!state?.legalActions?.canRiichi || !asArray(state.legalActions.riichiTiles).length) return;
    selectionBeforeRiichi = selectedTileId;
    selectedTileId = 0;
    riichiMode = true;
    renderCurrentState();
  }

  function cancelRiichiMode() {
    if (!riichiMode) return;
    riichiMode = false;
    selectedTileId = orderedOwnTiles(presentedState()).includes(selectionBeforeRiichi) ? selectionBeforeRiichi : 0;
    selectionBeforeRiichi = 0;
    renderCurrentState();
  }

  function suspend() {
    matchMusicController.suspend();
    riverTileSound.pause();
    presentation.suspend();
  }

  function resume() {
    syncMatchMusic();
    visualRenderer.resume();
    resultHandRenderer.resume();
    browserWindow.requestAnimationFrame(() => {
      if (state?.phase === "hand_ended") {
        void refresh();
        return;
      }
      renderCurrentState();
      visualRenderer.resume();
      scheduleAi?.();
    });
  }

  function destroy() {
    presentation.destroy();
    syncMatchMusic({ enabled: false });
    riverTileSound.pause();
  }

  return {
    getState,
    isRiichiMode,
    clearActionUi,
    reset,
    refresh,
    renderCurrentState,
    renderPresentationOverlays,
    applyMatchMusicVolume,
    syncMatchMusic,
    dismissResultForReplay,
    selectTile,
    clearSelectedTile,
    previewDraggedTile,
    restoreSelectedTilePreview,
    discardOwnTile,
    enterRiichiMode,
    cancelRiichiMode,
    continueResult,
    restartMatchFromSummary,
    returnToSetupFromSummary,
    isResultBlankSpace,
    handRevealSettled(key) { presentation.handRevealSettled(key); },
    suspend,
    resume,
    destroy,
  };
}
