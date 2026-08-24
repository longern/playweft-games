import {
  ChevronLeft,
  ChevronRight,
  Cog,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
  createIcons,
} from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { createLocalLuaGame } from "./workers/local-game-worker-client.js";
import {
  AI_DELAY_MS,
  AUTO_DECISION_DELAY_MS,
  HUMAN_ID,
  NEW_HAND_DEAL_DURATION_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
  PLAYERS,
} from "./rules/constants.js";
import { MahjongDomView } from "./app/dom-view.js";
import { createMahjongSessionController } from "./app/session-controller.js";
import { bindFixedViewport } from "./app/fixed-viewport.js";
import {
  asArray,
  blankDoubleClickAction,
  errorMessage,
  resultDetailPageCount,
} from "./rules/game-format.js";
import { MahjongThreeRenderer } from "./three-renderer.js";
import { MahjongResultHandRenderer } from "./result/result-hand-renderer.js";
import { MahjongPresentationController } from "./app/presentation-controller.js";
import { createMahjongThemeController } from "./theme/theme-controller.js";
import { createMahjongTableController } from "./app/table-controller.js";
import { createMahjongEffectRunner } from "./app/effect-runner.js";
import { createMahjongSettingsDialog } from "./settings-dialog.js";
import { MahjongMatchMusic } from "./theme/match-music.js";
import {
  deferMahjongDecorativeAssets,
  deferMahjongImageAssets,
} from "./theme/deferred-visual-assets.js";
import discardSoundSource from "./assets/audio/discard-sound.js";
import defaultTableBackgroundUrl from "./assets/moonlit-table-v3.jpg?url";
import defaultPortraitsUrl from "./assets/player-portraits-v1.jpg?url";
import defaultResultTableclothUrl from "./assets/felt-skin-moonwave-v1.jpg?url";
import defaultLobbyBackgroundUrl from "./assets/waiting-evening-v1.jpg?url";
import defaultLobbySignpostUrl from "./assets/waiting-signpost-v3.webp?url";
import defaultPaipuNotebookUrl from "./assets/paipu-notebook-v1.jpg?url";
import defaultTileFacesUrl from "./assets/tiles/riichi-faces.webp?url";
import { DEFAULT_MATCH_MUSIC_VOLUME } from "./theme/media-config.js";
import {
  appendMahjongSoloAction,
  clearMahjongSoloSave,
  createMahjongSoloSave,
  MAHJONG_SOLO_CHECKPOINT_VERSION,
  MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
  readMahjongSoloSave,
  setMahjongSoloAutoActions,
  setMahjongSoloCheckpoint,
  writeMahjongSoloSave,
} from "./replay/solo-save.js";
import {
  listMahjongPaipuSummaries,
  loadMahjongPaipu,
  saveMahjongPaipu,
  setMahjongPaipuPinned,
} from "./replay/paipu-store.js";
import { replayMahjongSoloSave } from "./replay/solo-replay.js";
import {
  buildMahjongPaipuTimeline,
  clampPaipuPosition,
  paipuHandIndexAtPosition,
  paipuNextHandPosition,
  paipuPreviousHandPosition,
} from "./replay/paipu-playback.js";
import { mahjongInitialEntry } from "./app/entry-flow.js";
import { orientMahjongRoomProjection } from "./rules/room-state.js";
import "../../src/base.css";
import "./styles.css";

const lucideIcons = {
  ChevronLeft,
  ChevronRight,
  Cog,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
};
createIcons({ icons: lucideIcons });

deferMahjongDecorativeAssets({
  document,
  window,
  urls: {
    "--mahjong-default-portrait-image": defaultPortraitsUrl,
    "--mahjong-default-table-background-image": defaultTableBackgroundUrl,
    "--mahjong-result-tablecloth-image": defaultResultTableclothUrl,
    "--mahjong-setup-background-image": defaultLobbyBackgroundUrl,
    "--mahjong-tile-face-image": defaultTileFacesUrl,
  },
});
deferMahjongImageAssets({
  document,
  window,
  urls: {
    signpost: defaultLobbySignpostUrl,
    "paipu-notebook": defaultPaipuNotebookUrl,
  },
});

const SETUP_EXIT_DURATION_MS = 560;
const SETUP_RECOVERY_ERROR_DURATION_MS = 4600;
const REPLAY_STEP_DELAY_MS = 780;
const REPLAY_RESULT_PAGE_DELAY_MS = 2400;
const REPLAY_SPEEDS = [0.5, 1, 2, 4];
const LATE_WALL_REPORT_START = 4;
const LATE_WALL_REPORT_BUDGET_MS = 500;
const RIVER_BOTTOM_REPORT_BUDGET_MS = 500;
const effectRunner = createMahjongEffectRunner();
const isStandalone = window.parent === window;
let game;
let gameInitializing = false;
let endingSoloMatch = false;
let destroyed = false;
let playerName = "你";
let hasPlatformName = false;
let hasPlatformAvatar = false;
let roomPlayerId = "";
let roomIsOwner = false;
let roomAiGame;
let roomAiPlayerIds = "";
let roomAiBusy = false;
let roomAiSchedule = 0;
let roomLegalGame;
let roomLegalPlayerIds = "";
let roomLegalRequest = 0;
let roomLegalRequestedKey = "";
let roomTenpaiGame;
let roomTenpaiGameReady;
let roomTenpaiPlayerIds = "";
let roomTenpaiRequest = 0;
let roomTenpaiRequestedKey = "";
let roomTenpaiReports;
let roomTenpaiReportsPromise;
let roomTenpaiSupplementRequest = 0;
let roomTenpaiSupplementRequestedKey = "";
let roomTenpaiReportedKey = "";
let setupRecoveryErrorTimer;
let playMode = isStandalone ? "solo" : null;
let autoActions = defaultAutoActions();
let session;
let tableController;
let playweftClient;
let soloSave = readMahjongSoloSave();
let replayRunId = 0;
let replayState = null;
let paipuOpeningFrame = 0;
let paipuClosingTimer = 0;
let paipuOpen = false;
let paipuReturnFocus = null;

const paipuElements = {
  entry: document.querySelector(".setup-paipu-entry"),
  panel: document.querySelector("#paipu-panel"),
  card: document.querySelector(".paipu-card"),
  close: document.querySelector("#paipu-close-button"),
  list: document.querySelector("#paipu-list"),
  empty: document.querySelector("#paipu-empty"),
};

const replayElements = {
  controls: document.querySelector("#paipu-playback-controls"),
  previousHand: document.querySelector("#paipu-replay-previous-hand"),
  nextHand: document.querySelector("#paipu-replay-next-hand"),
  status: document.querySelector("#paipu-replay-status"),
  speed: document.querySelector("#paipu-replay-speed"),
  stepBack: document.querySelector("#paipu-replay-step-back"),
  toggle: document.querySelector("#paipu-replay-toggle"),
  stepForward: document.querySelector("#paipu-replay-step-forward"),
  progress: document.querySelector("#paipu-replay-progress"),
};

const matchMusic = new Audio();
matchMusic.loop = true;
matchMusic.preload = "metadata";
matchMusic.volume = DEFAULT_MATCH_MUSIC_VOLUME;
const riverTileSound = new Audio(discardSoundSource);
riverTileSound.preload = "auto";
const defaultMusicCopyright = document.querySelector("#default-bgm-copyright");

function revealMahjongAppAfterStyles() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.documentElement.classList.add("mahjong-app-ready");
      const splash = document.querySelector("#mahjong-boot-splash");
      window.setTimeout(() => splash?.remove(), 220);
    });
  });
}

const releaseFixedViewport = bindFixedViewport(
  document.querySelector("#mahjong-viewport"),
  document.querySelector("#mahjong-app"),
);
const domView = new MahjongDomView({
  onAction: dispatch,
  onSelectTile: (tileId) => tableController?.selectTile(tileId),
  onDiscardTile: (tileId) => tableController?.discardOwnTile(tileId),
});
const { elements } = domView;
const settingsDialog = createMahjongSettingsDialog({
  trigger: elements.settingsButton,
  root: elements.settingsDialog,
  surface: elements.settingsDialogCard,
  closeButton: elements.settingsClose,
  returnButton: elements.settingsReturn,
  endMatchButton: elements.settingsEndMatch,
  tabButtons: elements.settingsTabs,
  tabPanels: elements.settingsPanels,
  gameHints: elements.gameHints,
  doubleClickTsumogiri: elements.doubleClickTsumogiri,
  doubleClickPass: elements.doubleClickPass,
  discardVolume: elements.riverTileVolume,
  discardVolumeValue: elements.riverTileVolumeValue,
  musicVolume: elements.musicVolume,
  musicVolumeValue: elements.musicVolumeValue,
  onMusicVolumeChange: () => tableController?.applyMatchMusicVolume(),
  onGameHintsChange: () => tableController?.renderCurrentState(),
  onEndMatch: () => {
    if (playMode === "replay") void exitMahjongPaipuReplay();
    else void endSoloMatch();
  },
});
const matchMusicController = new MahjongMatchMusic({
  audio: matchMusic,
  getVolumeScale: () => settingsDialog.musicVolumeScale,
  fadeDuration: 800,
});
const presentation = new MahjongPresentationController({
  onHandInsertionReady: () => tableController?.renderCurrentState(),
  onKanDrawReady: () => {
    tableController?.renderCurrentState();
    session?.scheduleAi();
  },
  onResultReady: () => tableController?.renderPresentationOverlays(),
  onDrawRevealReady: () => tableController?.renderPresentationOverlays(),
});
const visualRenderer = new MahjongThreeRenderer(elements.stage, {
  onSelectTile: (tileId) => tableController?.selectTile(tileId),
  onClearSelection: () => tableController?.clearSelectedTile(),
  onPreviewDragTile: (tileId) => tableController?.previewDraggedTile(tileId),
  onEndDragPreview: () => tableController?.restoreSelectedTilePreview(),
  onHandRevealComplete: (key) => tableController?.handRevealSettled(key),
  onDiscardTile: (tileId) => tableController?.discardOwnTile(tileId),
  onDoubleClickBlank() {
    const current = tableController?.getState();
    const action = blankDoubleClickAction({
      doubleClickPassEnabled: settingsDialog.doubleClickPassEnabled,
      passAvailable: !elements.pass.hidden && !elements.pass.disabled,
      doubleClickTsumogiriEnabled: settingsDialog.doubleClickTsumogiriEnabled,
      riichiMode: tableController?.isRiichiMode(),
      canDiscard: current?.legalActions?.canDiscard === true,
      drawnTile: current?.drawnTile,
    });
    if (action) dispatch(action);
  },
});
const resultHandRenderer = new MahjongResultHandRenderer(
  elements.resultDetailContent,
  {
    handsHost: elements.resultDetailHands,
    yakuHost: elements.resultDetailYaku,
    scoreHost: elements.resultScoreContent,
    startControlHost: elements.rematch,
    onStartButtonClick: () => void tableController?.continueResult(),
    onBlankDoubleClick: () => void tableController?.continueResult(),
  },
);
const visualRendererReady = visualRenderer.init().catch((error) => {
  console.error("Mahjong renderer failed", error);
  showLoadingError("图形渲染器加载失败，请刷新页面重试");
});
const resultHandRendererReady = resultHandRenderer.init().catch((error) => {
  console.error("Mahjong result hand renderer failed", error);
});

const themePackElements = {
  upload: document.querySelector("#settings-theme-upload"),
  feedback: document.querySelector("#settings-theme-feedback"),
  list: document.querySelector("#settings-theme-list"),
};
const appearanceElements = {
  feedback: document.querySelector("#settings-appearance-feedback"),
  controls: document.querySelector("#settings-appearance-controls"),
};
const themeController = createMahjongThemeController({
  document,
  window,
  isStandalone,
  confirm: (message) => playweftClient?.confirm(message),
  themeElements: themePackElements,
  appearanceElements,
  copyrightElement: defaultMusicCopyright,
  waitForRenderers: () =>
    Promise.all([visualRendererReady, resultHandRendererReady]),
  setRendererAppearance: ({ tablecloth, tileBack }) =>
    Promise.all([
      visualRenderer.setAppearance({ tablecloth, tileBack }),
      resultHandRenderer.setAppearance({ tablecloth, tileBack }),
    ]),
  setPlayerAvatar: (position, source) =>
    domView.setPlayerAvatar(position, source),
  hasPlatformAvatar: () => hasPlatformAvatar,
  onAssetsChanged() {
    tableController?.syncMatchMusic();
    if (tableController?.getState()) tableController.renderCurrentState();
  },
});
tableController = createMahjongTableController({
  document,
  window,
  elements,
  domView,
  visualRenderer,
  resultHandRenderer,
  presentation,
  effectRunner,
  settingsDialog,
  matchMusicController,
  riverTileSound,
  humanId: HUMAN_ID,
  getGame: () => game,
  getGameInitializing: () => gameInitializing,
  getMode: () => playMode,
  getPlayerName: () => playerName,
  playerNameIsAuthoritative: () => hasPlatformName,
  getThemeAssetUrl: themeController.getAssetUrl,
  getThemeDefaultNames: themeController.getDefaultNames,
  getThemeMatchMusicUrl: themeController.getMatchMusicUrl,
  getThemeRiichiMusicUrl: themeController.getRiichiMusicUrl,
  dispatch: (...args) => session?.dispatch(...args),
  isActionInFlight: () => session?.isActionInFlight() === true,
  scheduleAi: (...args) => session?.scheduleAi(...args),
  onRerollPortraits: () => themeController.rerollPortraits(),
  onReplayAdvance: (action) => advanceMahjongPaipuReplayFromResult(action),
  onReturnToSetup: teardownCompletedSoloMatch,
});

void Promise.all([
  visualRendererReady,
  resultHandRendererReady,
  themeController.ready,
]).then(() => themeController.applyVisualPack());
themeController.syncDefaultMusicCopyright();
void themeController.refreshThemePacks();

bindUiEvents();
playweftClient = isStandalone
  ? undefined
  : createPlayweftClient({
      onReady: handlePlayweftReady,
      onState: handleRoomState,
      onActionResult: handleRoomActionResult,
      onError: handlePlayweftError,
    });
session = createMahjongSessionController({
  humanId: HUMAN_ID,
  getMode: () => playMode,
  getGame: () => game,
  getState: () => tableController.getState(),
  getAutoActions: () => autoActions,
  getRiichiMode: () => tableController.isRiichiMode(),
  isKanDrawPending: () => presentation.kanDrawPending,
  sendRoomAction: sendRoomActionWithTenpaiReport,
  onRoomUnavailable: () => showMessage("尚未连接到房间"),
  persistAcceptedAction,
  refreshProjection: tableController.refresh,
  onSoloActionAccepted(action) {
    if (action.type === "next_hand" || action.type === "new_match")
      resetAutoActions();
    tableController.clearActionUi();
  },
  onActionRejected: (code) => showMessage(errorMessage(code)),
  onActionError(error) {
    console.error("Mahjong action failed", error);
    showMessage("动作处理失败，请重试");
  },
  onProjectionTransitionError(error) {
    console.error(
      "Mahjong result transition failed; restoring the projection",
      error,
    );
  },
  onAiActionRejected(outcome) {
    console.error(
      "AI action rejected",
      outcome.actorId,
      outcome.action,
      outcome.result,
    );
    showMessage("AI 动作未通过规则校验");
  },
  onAiError(error) {
    console.error("Mahjong AI worker failed", error);
    showMessage("AI 思考失败，请刷新页面重试");
  },
  delays: {
    ai: AI_DELAY_MS,
    autoDecision: AUTO_DECISION_DELAY_MS,
    newHandDeal: NEW_HAND_DEAL_DURATION_MS,
    ownDrawEntry: OWN_DRAW_ENTRY_DURATION_MS,
  },
});

if (isStandalone) startMahjongEntry();
revealMahjongAppAfterStyles();

function bindUiEvents() {
  paipuElements.entry?.addEventListener("click", () => void openPaipuPanel());
  paipuElements.close?.addEventListener("click", closePaipuPanel);
  paipuElements.panel?.addEventListener("click", (event) => {
    if (event.target === paipuElements.panel) closePaipuPanel();
  });
  replayElements.previousHand?.addEventListener("click", () => {
    const state = replayState;
    if (!state) return;
    void seekMahjongPaipuReplay(
      paipuPreviousHandPosition(state.timeline, state.position),
    );
  });
  replayElements.nextHand?.addEventListener("click", () => {
    const state = replayState;
    if (!state) return;
    void advanceToNextMahjongPaipuHand(state);
  });
  replayElements.stepBack?.addEventListener("click", () => {
    const state = replayState;
    if (state) void seekMahjongPaipuReplay(state.position - 1);
  });
  replayElements.stepForward?.addEventListener(
    "click",
    () => void advanceMahjongPaipuReplay(),
  );
  replayElements.toggle?.addEventListener(
    "click",
    () => void toggleMahjongPaipuPlayback(),
  );
  replayElements.speed?.addEventListener("click", cycleMahjongPaipuReplaySpeed);
  replayElements.progress?.addEventListener("change", () => {
    if (!replayState) return;
    void seekMahjongPaipuReplay(replayElements.progress.value);
  });
  elements.pass.addEventListener("click", () => dispatch({ type: "pass" }));
  elements.abort.addEventListener("click", () =>
    dispatch({ type: "abort_nine" }),
  );
  elements.tsumo.addEventListener("click", () => dispatch({ type: "tsumo" }));
  elements.riichi.addEventListener("click", () =>
    tableController.enterRiichiMode(),
  );
  elements.cancelRiichi.addEventListener("click", () =>
    tableController.cancelRiichiMode(),
  );
  elements.rematch.addEventListener(
    "click",
    () => void tableController.continueResult(),
  );
  elements.matchSummaryRematch.addEventListener(
    "click",
    () => void tableController.restartMatchFromSummary(),
  );
  elements.matchSummarySetup.addEventListener(
    "click",
    () => void tableController.returnToSetupFromSummary(),
  );
  elements.result.addEventListener("dblclick", (event) => {
    if (!tableController.isResultBlankSpace(event.target)) return;
    resultHandRenderer.playStartButtonActivation(
      () => void tableController.continueResult(),
    );
  });
  elements.autoWin.addEventListener("click", () => toggleAutoAction("autoWin"));
  elements.passClaims.addEventListener("click", () =>
    toggleAutoAction("passClaims"),
  );
  elements.autoTsumogiri.addEventListener("click", () =>
    toggleAutoAction("autoTsumogiri"),
  );
  for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
    button.addEventListener(
      "click",
      () => {
        if (playMode === "room") {
          void startRoomMatch(button.dataset.matchType);
          return;
        }
        void initialize(button.dataset.matchType);
      },
    );
  }
  syncAutoActionControls();
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("pointerdown", resumeMatchMusic, { passive: true });
  document.addEventListener("keydown", resumeMatchMusic);
}

async function openPaipuPanel() {
  if (!paipuElements.panel || game || playMode !== "solo") return;
  if (paipuOpen) return;
  if (paipuOpeningFrame) window.cancelAnimationFrame(paipuOpeningFrame);
  if (paipuClosingTimer) window.clearTimeout(paipuClosingTimer);
  paipuOpeningFrame = 0;
  paipuClosingTimer = 0;
  paipuReturnFocus = document.activeElement;
  paipuOpen = true;
  paipuElements.panel.classList.remove("is-open");
  paipuElements.panel.hidden = false;
  await renderPaipuList();
  paipuOpeningFrame = window.requestAnimationFrame(() => {
    paipuOpeningFrame = 0;
    if (!paipuOpen) return;
    paipuElements.panel.classList.add("is-open");
    paipuElements.card?.focus({ preventScroll: true });
  });
}

function closePaipuPanel({ animate = true, restoreFocus = true } = {}) {
  if (!paipuElements.panel) return;
  if (!paipuOpen && paipuElements.panel.hidden) return;
  if (paipuOpeningFrame) window.cancelAnimationFrame(paipuOpeningFrame);
  if (paipuClosingTimer) window.clearTimeout(paipuClosingTimer);
  paipuOpeningFrame = 0;
  paipuClosingTimer = 0;
  paipuOpen = false;
  paipuElements.panel.classList.remove("is-open");
  const reducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  if (animate && !reducedMotion) {
    paipuClosingTimer = window.setTimeout(
      () => finishPaipuClose(restoreFocus),
      240,
    );
    return;
  }
  finishPaipuClose(restoreFocus);
}

function finishPaipuClose(restoreFocus) {
  if (paipuOpen || !paipuElements.panel) return;
  if (paipuClosingTimer) window.clearTimeout(paipuClosingTimer);
  paipuClosingTimer = 0;
  paipuElements.panel.hidden = true;
  paipuElements.list.replaceChildren();
  paipuElements.empty.hidden = true;
  if (restoreFocus) paipuReturnFocus?.focus?.({ preventScroll: true });
  paipuReturnFocus = null;
}

async function renderPaipuList() {
  paipuElements.list.replaceChildren();
  paipuElements.empty.hidden = true;
  try {
    const summaries = await listMahjongPaipuSummaries();
    if (!summaries.length) {
      paipuElements.empty.hidden = false;
      return;
    }
    for (const summary of summaries)
      paipuElements.list.append(renderPaipuEntry(summary));
  } catch (error) {
    console.error("Unable to read Mahjong paipu list", error);
    paipuElements.empty.textContent = "牌谱暂时无法读取";
    paipuElements.empty.hidden = false;
  }
}

function renderPaipuEntry(summary) {
  const item = document.createElement("li");
  item.className = "paipu-entry";
  const info = document.createElement("div");
  info.className = "paipu-entry-info";
  const title = document.createElement("strong");
  title.textContent = `${summary.matchType === "hanchan" ? "南风场" : "东风场"} · ${summary.playerName || "你"}`;
  const date = document.createElement("span");
  date.textContent = `${formatPaipuDate(summary.endedAtMs)} · ${summary.handCount} 局 · ${summary.finalScores.join(" / ")}`;
  info.append(title, date);
  const actions = document.createElement("div");
  actions.className = "paipu-entry-actions";
  const replay = document.createElement("button");
  replay.type = "button";
  replay.textContent = "回放";
  replay.addEventListener("click", () => void replayMahjongPaipu(summary.id));
  const pin = document.createElement("button");
  pin.type = "button";
  pin.textContent = summary.pinned ? "已收藏" : "收藏";
  pin.setAttribute("aria-pressed", String(summary.pinned));
  pin.addEventListener("click", async () => {
    pin.disabled = true;
    try {
      await setMahjongPaipuPinned(summary.id, !summary.pinned);
      await renderPaipuList();
    } catch (error) {
      console.error("Unable to update Mahjong paipu favorite", error);
      pin.disabled = false;
    }
  });
  actions.append(replay, pin);
  item.append(info, actions);
  return item;
}

function formatPaipuDate(value) {
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime())
    ? "未知时间"
    : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

async function replayMahjongPaipu(id) {
  if (game || gameInitializing) return;
  let record;
  try {
    record = await loadMahjongPaipu(id);
  } catch (error) {
    console.error("Unable to load Mahjong paipu", error);
    showMessage("牌谱读取失败");
    return;
  }
  let timeline;
  try {
    timeline = buildMahjongPaipuTimeline(record);
  } catch (error) {
    console.error("Mahjong paipu timeline is invalid", error);
    showMessage("牌谱格式无效");
    return;
  }
  closePaipuPanel({ animate: false, restoreFocus: false });
  gameInitializing = true;
  playMode = "replay";
  elements.setup.hidden = true;
  elements.result.hidden = true;
  elements.loading.hidden = false;
  elements.loading.classList.add("is-active");
  try {
    const replayGame = await createMahjongPaipuReplayGame(record, 0);
    game = replayGame;
    replayState = {
      record,
      timeline,
      tileIdsByHand: record.hands.map((hand) =>
        replayTileIdsForWall(hand.wall),
      ),
      position: 0,
      speed: 1,
      playing: false,
      busy: false,
      playbackRunId: 0,
    };
    presentation.suspend();
    tableController.reset();
    const initial = game.initialProjection;
    await tableController.refresh(initial, { animateDealIn: true });
    elements.loading.hidden = true;
    elements.app.setAttribute("aria-busy", "false");
    settingsDialog.setSoloMatchActive(true);
    settingsDialog.setEndMatchLabel("返回大厅");
    replayElements.controls.hidden = false;
    renderMahjongPaipuReplayControls();
  } catch (error) {
    console.error("Mahjong paipu replay failed", error);
    await exitMahjongPaipuReplay({ returnToSetup: true });
    showMessage("牌谱回放无法启动");
  } finally {
    gameInitializing = false;
    elements.loading.hidden = true;
  }
}

async function createMahjongPaipuReplayGame(record, handIndex = 0) {
  const hand = record.hands[handIndex];
  if (!hand) throw new Error("Paipu hand is missing");
  return createLocalLuaGame({
    sourceUrl: "./game.lua",
    players: record.players.map(({ id, name }) => ({ id, name })),
    playerId: record.players[0].id,
    // Replay walls and tile references are the source of truth. This value is
    // only required by the engine's normal setup contract.
    randomSeed: crypto.randomUUID().replaceAll("-", ""),
    matchId: `replay-${record.id}-${crypto.randomUUID()}`,
    settings: {
      matchType: record.game.matchType,
      rules: record.game.rules,
      replayHand: {
        wall: hand.wall,
        round: hand.round,
        startScores: hand.startScores,
      },
    },
  });
}

function replayHandSetup(record, handIndex) {
  const hand = record.hands[handIndex];
  if (!hand) throw new Error("Paipu hand is missing");
  return {
    wall: hand.wall,
    round: hand.round,
    startScores: hand.startScores,
  };
}

function replayActionForStep(state, step) {
  const action = replayAction(
    step.command.action,
    state.tileIdsByHand[step.handIndex],
  );
  return {
    action,
    actorId: state.record.players[step.command.seat - 1]?.id,
    animateDealIn: false,
  };
}

async function advanceMahjongPaipuReplay() {
  const state = replayState;
  if (!state || state.busy || state.position >= state.timeline.steps.length)
    return false;
  state.busy = true;
  renderMahjongPaipuReplayControls();
  try {
    const step = state.timeline.steps[state.position];
    if (step.kind === "next-hand") {
      const loaded = await game?.loadReplayHand(
        replayHandSetup(state.record, step.handIndex),
        state.record.players[0]?.id,
      );
      if (!loaded?.projection)
        throw new Error("Replay hand could not be loaded");
      if (state !== replayState) return false;
      state.position += 1;
      await tableController.refresh(loaded.projection, { animateDealIn: true });
      return true;
    }
    const { action, actorId, animateDealIn } = replayActionForStep(state, step);
    const outcome = await game?.action(action, actorId);
    if (!outcome?.result?.accepted)
      throw new Error("Replay action was rejected");
    if (state !== replayState) return false;
    state.position += 1;
    await tableController.refresh(outcome.projection, {
      animateDealIn,
      ownDiscardedTile:
        action.type === "discard" || action.type === "riichi"
          ? Number(action.tileId) || 0
          : 0,
    });
    return outcome.projection?.state?.phase === "hand_ended"
      ? "hand-ended"
      : true;
  } catch (error) {
    console.error("Mahjong paipu playback step failed", error);
    pauseMahjongPaipuPlayback();
    showMessage("牌谱回放中断");
    return false;
  } finally {
    if (state === replayState) {
      state.busy = false;
      renderMahjongPaipuReplayControls();
    }
  }
}

async function seekMahjongPaipuReplay(position) {
  const state = replayState;
  if (!state || state.busy) return;
  const target = clampPaipuPosition(state.timeline, position);
  if (target === state.position) {
    renderMahjongPaipuReplayControls();
    return;
  }
  pauseMahjongPaipuPlayback();
  state.busy = true;
  const seekRunId = ++replayRunId;
  renderMahjongPaipuReplayControls();
  try {
    const handIndex = paipuHandIndexAtPosition(state.timeline, target);
    const loaded = await game?.loadReplayHand(
      replayHandSetup(state.record, handIndex),
      state.record.players[0]?.id,
    );
    let projection = loaded?.projection;
    if (!projection) throw new Error("Replay hand could not be loaded");
    const handStart = state.timeline.handStarts[handIndex];
    for (let index = handStart; index < target; index += 1) {
      if (state !== replayState || seekRunId !== replayRunId) return;
      const step = state.timeline.steps[index];
      const { action, actorId } = replayActionForStep(state, step);
      const outcome = await game?.action(action, actorId);
      if (!outcome?.result?.accepted)
        throw new Error("Replay seek action was rejected");
      projection = outcome.projection;
    }
    if (state !== replayState || seekRunId !== replayRunId) return;
    presentation.suspend();
    tableController.reset();
    elements.result.hidden = true;
    state.position = target;
    await tableController.refresh(projection, { animateDealIn: target === 0 });
  } catch (error) {
    console.error("Mahjong paipu seek failed", error);
    showMessage("无法跳转到该位置");
  } finally {
    if (state === replayState) {
      state.busy = false;
      renderMahjongPaipuReplayControls();
    }
  }
}

async function toggleMahjongPaipuPlayback() {
  const state = replayState;
  if (!state || state.busy) return;
  if (state.playing) {
    pauseMahjongPaipuPlayback();
    return;
  }
  if (state.position >= state.timeline.steps.length) return;
  tableController.syncMatchMusic();
  state.playing = true;
  const runId = ++state.playbackRunId;
  renderMahjongPaipuReplayControls();
  while (
    state === replayState &&
    state.playing &&
    runId === state.playbackRunId
  ) {
    const advanced = await advanceMahjongPaipuReplay();
    if (
      !advanced ||
      !state.playing ||
      state.position >= state.timeline.steps.length
    )
      break;
    if (advanced === "hand-ended") {
      const continued = await autoAdvanceMahjongPaipuResult(state, runId);
      if (!continued) break;
    }
    await waitForReplayStep(state.speed);
  }
  if (state === replayState && runId === state.playbackRunId) {
    state.playing = false;
    renderMahjongPaipuReplayControls();
  }
}

function pauseMahjongPaipuPlayback() {
  const state = replayState;
  if (!state) return;
  state.playing = false;
  state.playbackRunId += 1;
}

async function autoAdvanceMahjongPaipuResult(state, playbackRunId) {
  const resultShown = await waitForMahjongPaipuResult(state, playbackRunId);
  if (!resultShown) return false;
  const detailCount = resultDetailPageCount(tableController.getState());
  for (let page = 0; page < detailCount; page += 1) {
    await waitForReplayDelay(REPLAY_RESULT_PAGE_DELAY_MS);
    if (!isMahjongPaipuPlaybackActive(state, playbackRunId)) return false;
    await tableController.continueResult();
  }
  await waitForReplayDelay(REPLAY_RESULT_PAGE_DELAY_MS);
  if (!isMahjongPaipuPlaybackActive(state, playbackRunId)) return false;
  if (tableController.getState()?.matchEnded) return false;
  await tableController.continueResult();
  return (
    isMahjongPaipuPlaybackActive(state, playbackRunId) &&
    tableController.getState()?.phase !== "hand_ended"
  );
}

async function waitForMahjongPaipuResult(state, playbackRunId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!isMahjongPaipuPlaybackActive(state, playbackRunId)) return false;
    // The panel is mounted while the hand-end reveal is still warming up.
    // Autoplay must wait for the actual, interactive result page, then start
    // its per-page dwell timer from that point.
    if (
      !elements.result.hidden &&
      !elements.result.inert &&
      elements.result.getAttribute("aria-hidden") === "false"
    ) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return false;
}

function isMahjongPaipuPlaybackActive(state, playbackRunId) {
  return (
    state === replayState &&
    state.playing &&
    playbackRunId === state.playbackRunId
  );
}

async function advanceMahjongPaipuReplayFromResult(action) {
  const state = replayState;
  if (
    !state ||
    action?.type !== "next_hand" ||
    state.timeline.steps[state.position]?.kind !== "next-hand"
  ) {
    return false;
  }
  await tableController.dismissResultForReplay();
  return advanceMahjongPaipuReplay();
}

async function advanceToNextMahjongPaipuHand(state) {
  const nextPosition = paipuNextHandPosition(state.timeline, state.position);
  if (nextPosition === state.position) return;
  if (
    state.timeline.steps[state.position]?.kind === "next-hand" &&
    tableController.getState()?.phase === "hand_ended"
  ) {
    await advanceMahjongPaipuReplayFromResult({ type: "next_hand" });
    return;
  }
  await seekMahjongPaipuReplay(nextPosition);
}

function cycleMahjongPaipuReplaySpeed() {
  const state = replayState;
  if (!state || state.busy) return;
  const current = REPLAY_SPEEDS.indexOf(state.speed);
  state.speed = REPLAY_SPEEDS[(current + 1) % REPLAY_SPEEDS.length];
  renderMahjongPaipuReplayControls();
}

function renderMahjongPaipuReplayControls() {
  const state = replayState;
  if (!state || !replayElements.controls) return;
  const { timeline, position } = state;
  const handIndex = paipuHandIndexAtPosition(timeline, position);
  const hand = timeline.hands[handIndex];
  const commandCount = timeline.steps
    .slice(0, position)
    .filter(
      (step) => step.kind === "action" && step.handIndex === handIndex,
    ).length;
  const roundWind =
    ["东", "南", "西", "北"][Math.max(0, Number(hand?.round?.wind) - 1)] ||
    "牌谱";
  const roundNumber = Number(hand?.round?.number) || handIndex + 1;
  const completed = position >= timeline.steps.length;
  replayElements.status.textContent = completed
    ? "对局回放结束"
    : `${roundWind}${roundNumber}局 · 第 ${commandCount} 手`;
  replayElements.progress.max = String(timeline.steps.length);
  replayElements.progress.value = String(position);
  replayElements.progress.setAttribute(
    "aria-valuetext",
    `${position} / ${timeline.steps.length}`,
  );
  replayElements.controls.setAttribute("aria-busy", String(state.busy));
  setMahjongPaipuReplayControlState(
    replayElements.previousHand,
    state.busy,
    paipuPreviousHandPosition(timeline, position) === position,
  );
  setMahjongPaipuReplayControlState(
    replayElements.nextHand,
    state.busy,
    paipuNextHandPosition(timeline, position) === position,
  );
  setMahjongPaipuReplayControlState(
    replayElements.stepBack,
    state.busy,
    position === 0,
  );
  setMahjongPaipuReplayControlState(
    replayElements.stepForward,
    state.busy,
    completed,
  );
  setMahjongPaipuReplayControlState(
    replayElements.toggle,
    state.busy,
    completed,
  );
  setMahjongPaipuReplayControlState(replayElements.speed, state.busy, false);
  replayElements.progress.setAttribute("aria-disabled", String(state.busy));
  replayElements.speed.textContent = `${state.speed}×`;
  replayElements.toggle.setAttribute(
    "aria-label",
    state.playing ? "暂停" : "播放",
  );
  replayElements.toggle.setAttribute("aria-pressed", String(state.playing));
  replayElements.toggle.title = state.playing ? "暂停" : "播放";
  replayElements.toggle
    .querySelector('[data-lucide="play"]')
    ?.toggleAttribute("hidden", state.playing);
  replayElements.toggle
    .querySelector('[data-lucide="pause"]')
    ?.toggleAttribute("hidden", !state.playing);
}

function setMahjongPaipuReplayControlState(element, busy, unavailable) {
  element.disabled = unavailable;
  element.setAttribute("aria-disabled", String(busy || unavailable));
}

async function exitMahjongPaipuReplay({ returnToSetup = true } = {}) {
  const state = replayState;
  if (!state && playMode !== "replay") return;
  replayRunId += 1;
  pauseMahjongPaipuPlayback();
  replayState = null;
  replayElements.controls.hidden = true;
  const replayGame = game;
  game = undefined;
  try {
    session?.cancelScheduledActions();
    tableController.syncMatchMusic({ enabled: false });
    presentation.suspend();
    replayGame?.close();
    tableController.reset();
  } catch (error) {
    console.error("Mahjong paipu replay cleanup failed", error);
  } finally {
    elements.result.hidden = true;
    elements.loading.hidden = true;
    playMode = "solo";
    settingsDialog.setOpen(false, { restoreFocus: false, animate: false });
    settingsDialog.setSoloMatchActive(false);
    settingsDialog.setEndMatchLabel("结束本局");
    if (returnToSetup) showSetup();
  }
}

function replayAction(action, replayTileIds) {
  const replay = structuredClone(action);
  if (replay.tile) {
    const tileId = tileIdForReference(replay.tile, replayTileIds);
    if (!tileId) throw new Error("Paipu action has an invalid tile reference");
    replay.tileId = tileId;
  }
  delete replay.tile;
  return replay;
}

function tileIdForReference(reference, replayTileIds) {
  if (!Number.isInteger(reference?.ref)) return 0;
  return replayTileIds?.[reference.ref] || 0;
}

function replayTileIdsForWall(wall) {
  if (typeof wall !== "string" || wall.length !== 272) {
    throw new Error("Paipu hand has an invalid wall");
  }
  const available = new Map();
  for (let tileId = 1; tileId <= 136; tileId += 1) {
    const code = tileCode(tileId);
    const ids = available.get(code) || [];
    ids.push(tileId);
    available.set(code, ids);
  }
  const tileIds = [];
  for (let offset = 0; offset < wall.length; offset += 2) {
    const code = wall.slice(offset, offset + 2);
    const ids = available.get(code);
    if (!ids?.length) throw new Error("Paipu hand has an invalid tile code");
    tileIds.push(ids.shift());
  }
  return tileIds;
}

function tileCode(tileId) {
  if (tileId === 17) return "0m";
  if (tileId === 53) return "0p";
  if (tileId === 89) return "0s";
  const kind = Math.floor((tileId - 1) / 4) + 1;
  if (kind <= 27) {
    return `${((kind - 1) % 9) + 1}${["m", "p", "s"][Math.floor((kind - 1) / 9)]}`;
  }
  return `${kind - 27}z`;
}

function waitForReplayStep(speed) {
  const delay = REPLAY_STEP_DELAY_MS / Math.max(0.25, Number(speed) || 1);
  return waitForReplayDelay(delay);
}

function waitForReplayDelay(delay) {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function handlePlayweftReady(context) {
  playMode = context?.mode ?? "solo";
  roomPlayerId = context?.playerId || "";
  roomIsOwner =
    context?.player?.isOwner === true ||
    context?.isOwner === true ||
    (context?.match?.ownerId && context.match.ownerId === context.playerId);
  const name = context?.player?.name?.trim();
  if (name) {
    playerName = name;
    hasPlatformName = true;
  }
  requestPlatformAvatar(context);
  if (playMode === "room") {
    settingsDialog.setSoloMatchActive(false);
    showRoomWaiting();
    return;
  }
  startMahjongEntry();
}

async function handleRoomState(message) {
  if (playMode !== "room") return;
  roomPlayerId = message?.playerId || roomPlayerId;
  roomIsOwner = message?.state?.roomIsOwner === true;
  roomAiBusy = false;
  const projection = orientMahjongRoomProjection(
    {
      state: message?.state,
      events: message?.events,
      serverTime: message?.serverTime,
    },
    roomPlayerId,
  );
  if (!projection?.state) return;
  if (projection.state.phase === "lobby") {
    session.confirmRoomState();
    gameInitializing = false;
    elements.app.setAttribute("aria-busy", "false");
    if (projection.state.roomIsOwner) showRoomSetup();
    else showRoomWaiting();
    return;
  }
  scheduleRoomAi(projection.state);
  const hadState = Boolean(tableController.getState());
  const animateDealIn =
    !hadState ||
    asArray(projection.events).some(
      (event) => event?.type === "next_hand" || event?.type === "new_match",
    );
  try {
    await visualRendererReady;
    if (destroyed || playMode !== "room") return;
    await tableController.refresh(projection, { animateDealIn });
    scheduleRoomLegalActions(message?.state);
    scheduleRoomTenpaiReports(projection.state);
    scheduleRoomEarlyTenpaiReport(projection.state, projection.events);
    if (!hadState)
      tableController.syncMatchMusic({ fadeIn: true });
    gameInitializing = false;
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    session.confirmRoomState();
  } catch (error) {
    console.error("Mahjong room state failed to render", error);
    showLoadingError("房间状态加载失败，请稍后重试");
  }
}

function roomLegalStateKey(state) {
  return JSON.stringify([
    state?.phase,
    state?.turnIndex,
    state?.moveCount,
    state?.drawnTile,
    state?.ownHand,
    state?.legalContext?.kanCount,
    state?.legalContext?.tempFuriten,
    state?.legalContext?.riichiFuriten,
    state?.legalContext?.firstTurn,
  ]);
}

function buildRoomLegalState(state) {
  const context = state?.legalContext;
  const playerId = roomPlayerId;
  const doraTiles = asArray(context?.doraTiles);
  const deadWall = Array.from({ length: doraTiles.length * 2 }, () => 0);
  doraTiles.forEach((tile, index) => {
    deadWall[index * 2] = Number(tile) || 0;
  });
  return {
    players: asArray(state?.players),
    phase: state?.phase,
    turnIndex: Number(state?.turnIndex) || 0,
    drawnTile: Number(state?.drawnTile) || 0,
    hands: { [playerId]: asArray(state?.ownHand).map(Number) },
    wall: Array.from({ length: Math.max(0, Number(state?.wallCount) || 0) }, () => 0),
    deadWall,
    kanCount: Number(context?.kanCount) || 0,
    callOccurred: context?.callOccurred === true,
    melds: context?.melds || {},
    discards: context?.discards || {},
    riichi: state?.riichi || {},
    scores: asArray(state?.scores).map(Number),
    matchType: state?.matchType,
    roundWind: Number(state?.roundWind) || 0,
    handNumber: Number(state?.handNumber) || 0,
    dealerIndex: Number(state?.dealerIndex) || 0,
    honba: Number(state?.honba) || 0,
    riichiSticks: Number(state?.riichiSticks) || 0,
    rules: state?.rules || {},
    kuikaeForbidden: { [playerId]: context?.kuikaeForbidden || {} },
    tempFuriten: { [playerId]: context?.tempFuriten === true },
    riichiFuriten: { [playerId]: context?.riichiFuriten === true },
    firstTurn: { [playerId]: context?.firstTurn === true },
    doubleRiichi: { [playerId]: context?.doubleRiichi === true },
    ippatsu: { [playerId]: context?.ippatsu === true },
    rinshanWin: context?.rinshanWin === true,
    chankanWin: context?.chankanWin === true,
  };
}

function buildRoomTenpaiReportState(state) {
  return {
    players: asArray(state?.players),
    phase: state?.phase,
    turnIndex: Number(state?.turnIndex) || 0,
    drawnTile: Number(state?.drawnTile) || 0,
    hands: { [roomPlayerId]: asArray(state?.ownHand).map(Number) },
    melds: state?.melds || {},
  };
}

function roomTenpaiStateKey(state) {
  const activePlayer = asArray(state?.players)[Number(state?.turnIndex) - 1];
  return JSON.stringify([
    state?.phase,
    activePlayer,
    state?.turnIndex,
    state?.moveCount,
    state?.wallCount,
    state?.drawnTile,
    state?.ownHand,
    state?.melds?.[activePlayer],
  ]);
}

async function ensureRoomTenpaiGame(state) {
  const players = asArray(state?.players).map((id) => ({ id, name: id }));
  const playerIds = JSON.stringify(asArray(state?.players));
  if (!players.length) return undefined;
  if (roomTenpaiGame && roomTenpaiPlayerIds === playerIds) {
    return roomTenpaiGame;
  }
  if (roomTenpaiGameReady && roomTenpaiPlayerIds === playerIds) {
    return roomTenpaiGameReady;
  }
  roomTenpaiGame?.close();
  roomTenpaiGame = undefined;
  roomTenpaiPlayerIds = playerIds;
  const ready = createLocalLuaGame({
    sourceUrl: "./game.lua",
    players,
    playerId: roomPlayerId,
  }).then((createdGame) => {
    if (destroyed || roomTenpaiPlayerIds !== playerIds) {
      createdGame.close();
      return undefined;
    }
    roomTenpaiGame = createdGame;
    return createdGame;
  });
  roomTenpaiGameReady = ready;
  try {
    return await ready;
  } finally {
    if (roomTenpaiGameReady === ready) roomTenpaiGameReady = undefined;
  }
}

function scheduleRoomTenpaiReports(state) {
  const wallCount = Math.max(0, Number(state?.wallCount) || 0);
  if (playMode !== "room" || state?.phase !== "playing" || wallCount > LATE_WALL_REPORT_START) {
    roomTenpaiRequest += 1;
    roomTenpaiRequestedKey = "";
    roomTenpaiReports = undefined;
    roomTenpaiReportsPromise = undefined;
    if (wallCount > LATE_WALL_REPORT_START) {
      roomTenpaiSupplementRequest += 1;
      roomTenpaiSupplementRequestedKey = "";
      roomTenpaiReportedKey = "";
    }
    return;
  }
  void ensureRoomTenpaiGame(state).catch((error) => {
    console.error("Mahjong room tenpai worker failed to start", error);
  });
  const activePlayer = asArray(state.players)[Number(state.turnIndex) - 1];
  if (activePlayer !== roomPlayerId || wallCount === 0) {
    roomTenpaiRequest += 1;
    roomTenpaiRequestedKey = "";
    roomTenpaiReports = undefined;
    roomTenpaiReportsPromise = undefined;
    return;
  }
  const key = roomTenpaiStateKey(state);
  if (key === roomTenpaiRequestedKey) return;
  roomTenpaiRequestedKey = key;
  roomTenpaiReports = undefined;
  const request = ++roomTenpaiRequest;
  const reportPromise = runRoomTenpaiReports(buildRoomLegalState(state), key, request);
  roomTenpaiReportsPromise = reportPromise;
}

async function runRoomTenpaiReports(state, key, request) {
  try {
    const localGame = await ensureRoomTenpaiGame(state);
    if (!localGame) return undefined;
    const reports = await Promise.race([
      localGame.tenpaiReports(state, roomPlayerId),
      new Promise((resolve) => {
        window.setTimeout(resolve, LATE_WALL_REPORT_BUDGET_MS);
      }),
    ]);
    if (
      destroyed ||
      playMode !== "room" ||
      request !== roomTenpaiRequest ||
      key !== roomTenpaiRequestedKey
    ) return undefined;
    roomTenpaiReports = reports && typeof reports === "object" ? reports : undefined;
    return roomTenpaiReports;
  } catch (error) {
    if (request === roomTenpaiRequest) {
      console.error("Mahjong room tenpai report failed", error);
    }
    return undefined;
  }
}

async function roomTenpaiReportForDiscard(state, tileId) {
  try {
    const localGame = await ensureRoomTenpaiGame(state);
    if (!localGame) return undefined;
    return await Promise.race([
      localGame.tenpaiReport(state, tileId, roomPlayerId),
      new Promise((resolve) => {
        window.setTimeout(resolve, RIVER_BOTTOM_REPORT_BUDGET_MS);
      }),
    ]);
  } catch (error) {
    console.error("Mahjong river-bottom tenpai report failed", error);
    return undefined;
  }
}

function roomPlayerHasFutureNormalDraw(state, playerId) {
  const players = asArray(state?.players);
  const remainingDraws = Math.max(0, Number(state?.wallCount) || 0);
  if (!players.length || remainingDraws === 0) return false;
  const firstDrawIndex = Number(state?.turnIndex) % players.length;
  for (let offset = 0; offset < remainingDraws; offset += 1) {
    if (players[(firstDrawIndex + offset) % players.length] === playerId) {
      return true;
    }
  }
  return false;
}

function roomEarlyTenpaiStateKey(state) {
  return JSON.stringify([
    state?.moveCount,
    state?.phase,
    state?.turnIndex,
    state?.wallCount,
    state?.ownHand,
    state?.melds?.[roomPlayerId],
  ]);
}

function scheduleRoomEarlyTenpaiReport(state, events) {
  const wallCount = Math.max(0, Number(state?.wallCount) || 0);
  const sawCall = asArray(events).some((event) => event?.type === "claimed");
  const activePlayer = asArray(state?.players)[Number(state?.turnIndex) - 1];
  if (
    !sawCall ||
    state?.phase !== "playing" ||
    wallCount === 0 ||
    wallCount > LATE_WALL_REPORT_START ||
    activePlayer === roomPlayerId ||
    roomPlayerHasFutureNormalDraw(state, roomPlayerId)
  ) {
    return;
  }
  const key = roomEarlyTenpaiStateKey(state);
  if (key === roomTenpaiSupplementRequestedKey) return;
  roomTenpaiSupplementRequestedKey = key;
  const request = ++roomTenpaiSupplementRequest;
  void runRoomEarlyTenpaiReport(buildRoomTenpaiReportState(state), request);
}

async function runRoomEarlyTenpaiReport(state, request) {
  try {
    const localGame = await ensureRoomTenpaiGame(state);
    if (!localGame) return;
    const report = await Promise.race([
      localGame.currentTenpaiReport(state, roomPlayerId),
      new Promise((resolve) => {
        window.setTimeout(resolve, LATE_WALL_REPORT_BUDGET_MS);
      }),
    ]);
    if (
      destroyed ||
      playMode !== "room" ||
      request !== roomTenpaiSupplementRequest ||
      !report?.key ||
      report.key === roomTenpaiReportedKey
    ) return;
    const requestId = playweftClient?.sendAction({
      type: "tenpai_report",
      tenpaiReport: report,
    });
    if (requestId) roomTenpaiReportedKey = report.key;
  } catch (error) {
    if (request === roomTenpaiSupplementRequest) {
      console.error("Mahjong room early tenpai report failed", error);
    }
  }
}

async function sendRoomActionWithTenpaiReport(action) {
  let enrichedAction = action;
  let attachedReport;
  const state = tableController?.getState();
  const isLateDiscard =
    (action?.type === "discard" || action?.type === "riichi") &&
    state?.phase === "playing" &&
    asArray(state?.players)[Number(state?.turnIndex) - 1] === roomPlayerId &&
    Math.max(0, Number(state?.wallCount) || 0) <= LATE_WALL_REPORT_START;
  if (isLateDiscard) {
    const key = roomTenpaiStateKey(state);
    if (Number(state?.wallCount) === 0) {
      const report = await roomTenpaiReportForDiscard(
        buildRoomLegalState(state),
        Number(action.tileId),
      );
      if (report) {
        enrichedAction = { ...action, tenpaiReport: report };
        attachedReport = report;
      }
    } else if (key === roomTenpaiRequestedKey) {
      const report = roomTenpaiReports?.[Number(action.tileId)];
      if (report) {
        enrichedAction = { ...action, tenpaiReport: report };
        attachedReport = report;
      }
    }
  }
  try {
    const requestId = await playweftClient?.sendAction(enrichedAction);
    if (requestId && attachedReport?.key) roomTenpaiReportedKey = attachedReport.key;
    return requestId;
  } catch (error) {
    console.error("Mahjong room action failed", error);
    return undefined;
  }
}

function scheduleRoomLegalActions(state) {
  const activePlayer = asArray(state?.players)[Number(state?.turnIndex) - 1];
  if (
    !state?.legalContext ||
    state?.phase !== "playing" ||
    activePlayer !== roomPlayerId
  ) {
    roomLegalRequestedKey = "";
    roomLegalRequest += 1;
    return;
  }
  const key = roomLegalStateKey(state);
  if (key === roomLegalRequestedKey) return;
  roomLegalRequestedKey = key;
  const request = ++roomLegalRequest;
  void runRoomLegalActions(buildRoomLegalState(state), key, request);
}

async function runRoomLegalActions(state, key, request) {
  try {
    const players = asArray(state.players).map((id) => ({ id, name: id }));
    const playerIds = JSON.stringify(state.players);
    if (!roomLegalGame || roomLegalPlayerIds !== playerIds) {
      roomLegalGame?.close();
      roomLegalGame = await createLocalLuaGame({
        sourceUrl: "./game.lua",
        players,
        playerId: roomPlayerId,
      });
      roomLegalPlayerIds = playerIds;
    }
    const legalActions = await roomLegalGame.legalActions(state, roomPlayerId);
    if (
      destroyed ||
      playMode !== "room" ||
      request !== roomLegalRequest ||
      key !== roomLegalRequestedKey
    ) return;
    tableController.applyLegalActions(legalActions);
  } catch (error) {
    if (request === roomLegalRequest) {
      console.error("Mahjong room legal-action preview failed", error);
    }
  }
}

function scheduleRoomAi(state) {
  if (!roomIsOwner || !state?.aiTurn?.player || !state?.aiContext) return;
  window.clearTimeout(roomAiSchedule);
  roomAiSchedule = window.setTimeout(() => {
    void runRoomAi(state.aiContext, state.aiTurn.player);
  }, AI_DELAY_MS);
}

async function runRoomAi(aiContext, actorId) {
  if (roomAiBusy || !roomIsOwner || !aiContext || !actorId) return;
  roomAiBusy = true;
  try {
    const players = (aiContext.players || []).map((id) => ({
      id,
      name: id,
    }));
    const currentIds = JSON.stringify(aiContext.players || []);
    if (!roomAiGame || roomAiPlayerIds !== currentIds) {
      roomAiGame?.close();
      roomAiGame = await createLocalLuaGame({
        sourceUrl: "./game.lua",
        players,
        playerId: actorId,
      });
      roomAiPlayerIds = currentIds;
    }
    const outcome = await roomAiGame.aiAction(aiContext, actorId);
    if (outcome?.status !== "acted" || !outcome.action) {
      roomAiBusy = false;
      return;
    }
    const requestId = playweftClient?.sendAction({
      type: "ai_turn",
      playerId: actorId,
      action: outcome.action,
    });
    if (!requestId) roomAiBusy = false;
  } catch (error) {
    roomAiBusy = false;
    console.error("Mahjong room AI failed", error);
  }
}

function handleRoomActionResult() {
  // Wait for the authoritative projection; a fast second tap must not act on stale state.
}

function handlePlayweftError(message, _code, requestId) {
  roomAiBusy = false;
  if (session.rejectRoomAction(requestId)) {
    tableController.clearResultPageReadyPending();
    if (tableController.getState()?.phase === "hand_ended") {
      tableController.syncMatchMusic();
    }
  }
  if (playMode === "room" && !tableController.getState()) {
    gameInitializing = false;
    showRoomSetup();
    showSetupRecoveryError(message);
    return;
  }
  if (!tableController.getState()) {
    showLoadingError(message);
    return;
  }
  showMessage(message);
}

function showRoomWaiting() {
  elements.setup.hidden = true;
  elements.loading.classList.remove("is-error");
  elements.loading.classList.add("is-active");
  elements.loadingMessage.textContent = "等待其他玩家加入…";
  elements.loadingMessage.hidden = false;
  elements.loading.hidden = false;
}

function selectedMatchRules() {
  return Object.fromEntries(
    [...elements.setup.querySelectorAll("[data-rule]")].map((input) => [
      input.dataset.rule,
      input.checked,
    ]),
  );
}

async function startRoomMatch(matchType = "east") {
  if (playMode !== "room" || !roomIsOwner || gameInitializing) return;
  gameInitializing = true;
  const setupExit = beginSetupExit();
  const started = await session.dispatch({
    type: "start_match",
    matchType,
    rules: selectedMatchRules(),
  });
  if (started) return;
  await setupExit;
  gameInitializing = false;
  showRoomSetup();
}

function requestPlatformAvatar(context) {
  const initialSource = context?.player?.avatar?.src;
  if (typeof initialSource === "string" && initialSource) {
    hasPlatformAvatar = true;
    domView.setPlayerAvatar("bottom", initialSource);
  } else {
    themeController.applyPackAvatars();
  }
  if (!asArray(context?.capabilities).includes("user.getProfile")) return;
  void playweftClient
    .getUserProfile({ fields: ["avatar"] })
    .then((profile) => {
      const source = profile?.avatar?.src;
      if (typeof source === "string" && source) {
        hasPlatformAvatar = true;
        domView.setPlayerAvatar("bottom", source);
      } else if (!initialSource) {
        themeController.applyPackAvatars();
      }
    })
    .catch(() => {
      if (!initialSource) themeController.applyPackAvatars();
    });
}

async function initialize(matchType = "east") {
  if (playMode !== "solo" || game || gameInitializing) return;
  gameInitializing = true;
  tableController.syncMatchMusic();
  const rules = selectedMatchRules();
  elements.loading.classList.remove("is-active", "is-error");
  elements.loadingMessage.hidden = true;
  elements.loading.hidden = false;
  void elements.loadingSpinner.offsetWidth;
  const setupExit = beginSetupExit();
  const randomSeed = crypto.randomUUID().replaceAll("-", "");
  const matchId = `solo-${crypto.randomUUID()}`;
  const gamePreparation = createLocalLuaGame({
    sourceUrl: "./game.lua",
    players: PLAYERS.map((player, index) => ({
      ...player,
      name: index === 0 ? playerName : player.name,
    })),
    playerId: HUMAN_ID,
    randomSeed,
    matchId,
    settings: { matchType, rules },
  });
  try {
    await themeController.rerollPortraits();
    [game] = await Promise.all([
      gamePreparation,
      setupExit,
      visualRendererReady,
    ]);
    resetAutoActions({ persist: false });
    soloSave = createMahjongSoloSave({
      randomSeed,
      matchId,
      matchType,
      rules,
      playerName,
      autoActions,
    });
    writeMahjongSoloSave(soloSave);
    await tableController.refresh(game.initialProjection, {
      animateDealIn: true,
    });
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    settingsDialog.setSoloMatchActive(true);
    settingsDialog.setEndMatchLabel("结束本局");
    scheduleAi({ afterDealIn: true });
  } catch (error) {
    console.error(error);
    await setupExit;
    showLoadingError("牌桌准备失败，请刷新页面重试");
  } finally {
    gameInitializing = false;
  }
}

async function resumeSavedMatch() {
  if (game || gameInitializing || !soloSave) return;
  gameInitializing = true;
  const save = soloSave;
  elements.loading.classList.remove("is-active", "is-error");
  elements.loadingMessage.hidden = true;
  elements.loading.hidden = false;
  void elements.loadingSpinner.offsetWidth;
  elements.setup.hidden = true;
  let restored;
  try {
    restored = await createLocalLuaGame({
      sourceUrl: "./game.lua",
      players: PLAYERS.map((player, index) => ({
        ...player,
        name: index === 0 ? save.playerName || playerName : player.name,
      })),
      playerId: HUMAN_ID,
      randomSeed: save.randomSeed,
      matchId: save.matchId,
      settings: { matchType: save.matchType, rules: save.rules },
    });
    const projection = await replayMahjongSoloSave({
      game: restored,
      save,
      playerId: HUMAN_ID,
    });
    await visualRendererReady;
    game = restored;
    await themeController.rerollPortraits();
    if (save.playerName) playerName = save.playerName;
    autoActions = { ...save.autoActions };
    syncAutoActionControls();
    await tableController.refresh(projection);
    tableController.syncMatchMusic();
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    settingsDialog.setSoloMatchActive(true);
    settingsDialog.setEndMatchLabel("结束本局");
    scheduleAi();
  } catch (error) {
    console.error(error);
    restored?.close();
    if (game === restored) game = undefined;
    tableController.reset();
    settingsDialog.setSoloMatchActive(false);
    showSetup();
    elements.loading.hidden = true;
    showSetupRecoveryError(
      error instanceof Error && error.message
        ? error.message
        : "Failed to restore saved game.",
    );
  } finally {
    gameInitializing = false;
  }
}

async function persistAcceptedAction(
  action,
  actorId,
  projection,
  currentGame = game,
) {
  if (!soloSave) return;
  let next = appendMahjongSoloAction(soloSave, action, actorId);
  if (!next) return;
  if (projection?.state?.phase === "hand_ended" && currentGame) {
    try {
      const snapshot = await currentGame.checkpoint();
      next =
        setMahjongSoloCheckpoint(next, {
          formatVersion: MAHJONG_SOLO_CHECKPOINT_VERSION,
          actionIndex: next.actions.length,
          state: snapshot.state,
          events: snapshot.events,
          engineVersion: MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
          stateVersion: snapshot.version,
        }) || next;
    } catch (error) {
      console.warn(
        "Mahjong save checkpoint failed; keeping the action log",
        error,
      );
    }
  }
  soloSave = next;
  writeMahjongSoloSave(soloSave);
  if (projection?.state?.matchEnded && currentGame?.exportPaipu) {
    try {
      const paipu = await currentGame.exportPaipu();
      if (paipu?.status === "completed") await saveMahjongPaipu(paipu);
    } catch (error) {
      console.warn("Mahjong paipu save failed", error);
    }
  }
}

function defaultAutoActions() {
  return { autoWin: false, passClaims: false, autoTsumogiri: false };
}

function toggleAutoAction(name) {
  autoActions = { ...autoActions, [name]: !autoActions[name] };
  syncAutoActionControls();
  persistAutoActions();
  scheduleAi();
}

function resetAutoActions({ persist = true } = {}) {
  autoActions = defaultAutoActions();
  syncAutoActionControls();
  if (persist) persistAutoActions();
}

function syncAutoActionControls() {
  for (const [button, enabled, label] of [
    [elements.autoWin, autoActions.autoWin, "自动胡牌"],
    [elements.passClaims, autoActions.passClaims, "放弃鸣牌"],
    [elements.autoTsumogiri, autoActions.autoTsumogiri, "自动摸切"],
  ]) {
    button.setAttribute("aria-pressed", String(enabled));
    button.title = `${label}（${enabled ? "开启" : "关闭"}）`;
  }
}

function persistAutoActions() {
  if (!soloSave) return;
  const next = setMahjongSoloAutoActions(soloSave, autoActions);
  if (!next) return;
  soloSave = next;
  writeMahjongSoloSave(soloSave);
}

function clearSoloSave() {
  clearMahjongSoloSave();
  soloSave = null;
}

function startMahjongEntry() {
  if (playMode !== "solo" || game || gameInitializing) return;
  if (mahjongInitialEntry(playMode, Boolean(soloSave)) === "resume") {
    void resumeSavedMatch();
    return;
  }
  showSetup();
}

function showSetup() {
  closePaipuPanel({ animate: false, restoreFocus: false });
  elements.setup.classList.remove("is-leaving", "is-prepared-for-result-exit");
  for (const button of elements.setup.querySelectorAll("[data-match-type]"))
    button.disabled = false;
  elements.setup.hidden = false;
}

function showRoomSetup() {
  closePaipuPanel({ animate: false, restoreFocus: false });
  elements.setup.classList.remove("is-leaving", "is-prepared-for-result-exit");
  for (const button of elements.setup.querySelectorAll("[data-match-type]"))
    button.disabled = false;
  elements.loading.hidden = true;
  elements.setup.hidden = false;
}

function showSetupRecoveryError(message) {
  window.clearTimeout(setupRecoveryErrorTimer);
  elements.setupRecoveryError.textContent = message;
  elements.setupRecoveryError.hidden = false;
  void elements.setupRecoveryError.offsetWidth;
  elements.setupRecoveryError.classList.add("is-visible");
  setupRecoveryErrorTimer = window.setTimeout(() => {
    elements.setupRecoveryError.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!elements.setupRecoveryError.classList.contains("is-visible"))
        elements.setupRecoveryError.hidden = true;
    }, 180);
  }, SETUP_RECOVERY_ERROR_DURATION_MS);
}

async function endSoloMatch() {
  if (!game || gameInitializing || endingSoloMatch) return;
  endingSoloMatch = true;
  try {
    const message = "结束本局并返回标题？本局进度不会保留。";
    const confirmed = isStandalone
      ? window.confirm(message)
      : await playweftClient?.confirm(message);
    if (!confirmed) return;
    settingsDialog.setOpen(false, { restoreFocus: false, animate: false });
    await teardownCompletedSoloMatch();
  } catch (error) {
    console.error("Unable to confirm ending the Mahjong match", error);
  } finally {
    endingSoloMatch = false;
  }
}

async function teardownCompletedSoloMatch() {
  session?.cancelScheduledActions();
  tableController.syncMatchMusic({ enabled: false });
  presentation.suspend();
  game?.close();
  game = undefined;
  tableController.reset();
  elements.result.hidden = true;
  elements.loading.hidden = true;
  showSetup();
  settingsDialog.setSoloMatchActive(false);
  settingsDialog.setEndMatchLabel("结束本局");
  clearSoloSave();
}

function beginSetupExit() {
  const signpost = elements.setup.querySelector(".setup-signpost");
  elements.setup.classList.add("is-leaving");
  elements.loading.classList.add("is-active");
  for (const button of elements.setup.querySelectorAll("[data-match-type]"))
    button.disabled = true;
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
    const fallbackTimer = window.setTimeout(
      finish,
      SETUP_EXIT_DURATION_MS + 100,
    );
    signpost.addEventListener("transitionend", handleTransitionEnd);
  });
}

function showLoadingError(message) {
  elements.loading.classList.add("is-error");
  elements.loadingMessage.textContent = message;
  elements.loadingMessage.hidden = false;
}

function showMessage(message) {
  elements.message.textContent = message;
  elements.message.classList.add("is-error");
}

function dispatch(action, options) {
  if (playMode === "replay") return false;
  return session?.dispatch(action, options) ?? false;
}

function scheduleAi(options) {
  session?.scheduleAi(options);
}

function resumeMatchMusic() {
  tableController?.syncMatchMusic({ userGesture: true });
}

function handlePageHide(event) {
  session.cancelScheduledActions();
  tableController.suspend();
  if (!event.persisted) destroy();
}

function handlePageShow(event) {
  if (event.persisted) resumeAfterSuspension();
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    session.cancelScheduledActions();
    tableController.suspend();
    return;
  }
  resumeAfterSuspension();
}

function resumeAfterSuspension() {
  if (destroyed) return;
  tableController.resume();
}

function destroy() {
  if (destroyed) return;
  destroyed = true;
  window.clearTimeout(roomAiSchedule);
  session?.cancelScheduledActions();
  tableController?.destroy();
  themeController.destroy();
  window.removeEventListener("pagehide", handlePageHide);
  window.removeEventListener("pageshow", handlePageShow);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("pointerdown", resumeMatchMusic);
  document.removeEventListener("keydown", resumeMatchMusic);
  releaseFixedViewport();
  settingsDialog.destroy();
  visualRenderer.destroy();
  resultHandRenderer.destroy();
  game?.close();
  roomAiGame?.close();
  roomAiGame = undefined;
  roomLegalRequest += 1;
  roomLegalRequestedKey = "";
  roomLegalGame?.close();
  roomLegalGame = undefined;
  roomTenpaiRequest += 1;
  roomTenpaiRequestedKey = "";
  roomTenpaiReports = undefined;
  roomTenpaiReportsPromise = undefined;
  roomTenpaiSupplementRequest += 1;
  roomTenpaiSupplementRequestedKey = "";
  roomTenpaiReportedKey = "";
  roomTenpaiGame?.close();
  roomTenpaiGame = undefined;
  roomTenpaiGameReady = undefined;
  playweftClient?.destroy();
}
