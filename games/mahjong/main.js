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
} from "./rules/constants.js";
import { MahjongDomView } from "./app/dom-view.js";
import { createMahjongSessionController } from "./app/session-controller.js";
import { bindFixedViewport } from "./app/fixed-viewport.js";
import {
  asArray,
  blankDoubleClickAction,
  errorMessage,
} from "./rules/game-format.js";
import { MahjongThreeRenderer } from "./three-renderer.js";
import { MahjongResultHandRenderer } from "./result/result-hand-renderer.js";
import { MahjongPresentationController } from "./app/presentation-controller.js";
import { createMahjongThemeController } from "./theme/theme-controller.js";
import { createMahjongTableController } from "./app/table-controller.js";
import { createMahjongEffectRunner } from "./app/effect-runner.js";
import { createMahjongTransientNotice } from "./app/transient-notice.js";
import { createMahjongReplayController } from "./app/replay-controller.js";
import { createMahjongSoloMatchController } from "./app/solo-match-controller.js";
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
import { createMahjongPaipuPanel } from "./replay/paipu-panel.js";
import { mahjongInitialEntry } from "./app/entry-flow.js";
import { orientMahjongRoomProjection } from "./rules/room-state.js";
import {
  buildRoomLegalState,
  buildRoomTenpaiReportState,
  roomAutomaticKey,
  roomEarlyTenpaiStateKey,
  roomLegalStateKey,
  roomPlayerHasFutureNormalDraw,
  roomTenpaiStateKey,
} from "./rules/room-utils.js";
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
let roomAiAwaitingState = false;
let roomAiSchedule = 0;
let roomAiWaitResolve;
let roomAiGeneration = 0;
let roomAiTurnKey = "";
let roomAiState;
let roomLegalGame;
let roomLegalPlayerIds = "";
let roomLegalRequest = 0;
let roomLegalRequestedKey = "";
let roomLegalAppliedKey = "";
let roomAutomaticStateKey = "";
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
let playMode = isStandalone ? "solo" : null;
let autoActions = defaultAutoActions();
let session;
let tableController;
let playweftClient;
let soloSave = readMahjongSoloSave();
let replayState = null;
let replayController;
let soloController;

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

const paipuPanel = createMahjongPaipuPanel({
  document,
  window,
  elements: paipuElements,
  getGame: () => game,
  getPlayMode: () => playMode,
  listMahjongPaipuSummaries,
  setMahjongPaipuPinned,
  onReplay: (id) => replayMahjongPaipu(id),
});

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
const transientNotice = createMahjongTransientNotice({
  element: elements.transientNotice,
  window,
});
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

replayController = createMahjongReplayController({
  window,
  elements,
  replayElements,
  getGame: () => game,
  setGame: (value) => {
    game = value;
  },
  getGameInitializing: () => gameInitializing,
  setGameInitializing: (value) => {
    gameInitializing = value;
  },
  getPlayMode: () => playMode,
  setPlayMode: (value) => {
    playMode = value;
  },
  getReplayState: () => replayState,
  setReplayState: (value) => {
    replayState = value;
  },
  closePaipuPanel,
  loadMahjongPaipu,
  tableController,
  presentation,
  settingsDialog,
  session,
  showMessage,
  showSetup,
});

soloController = createMahjongSoloMatchController({
  elements,
  getGame: () => game,
  setGame: (value) => {
    game = value;
  },
  getGameInitializing: () => gameInitializing,
  setGameInitializing: (value) => {
    gameInitializing = value;
  },
  getPlayerName: () => playerName,
  setPlayerName: (value) => {
    playerName = value;
  },
  getAutoActions: () => autoActions,
  setAutoActions: (value) => {
    autoActions = value;
  },
  getSoloSave: () => soloSave,
  setSoloSave: (value) => {
    soloSave = value;
  },
  tableController,
  themeController,
  settingsDialog,
  visualRendererReady,
  beginSetupExit,
  selectedMatchRules,
  resetAutoActions,
  syncAutoActionControls,
  scheduleAi,
  showLoadingError,
  showSetup,
  showSetupRecoveryError,
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
    button.addEventListener("click", () => {
      if (playMode === "room") {
        void startRoomMatch(button.dataset.matchType);
        return;
      }
      void initialize(button.dataset.matchType);
    });
  }
  syncAutoActionControls();
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("pointerdown", resumeMatchMusic, { passive: true });
  document.addEventListener("keydown", resumeMatchMusic);
}

function openPaipuPanel() {
  return paipuPanel.show();
}

function closePaipuPanel(options) {
  return paipuPanel.hide(options);
}

async function replayMahjongPaipu(id) {
  return replayController?.replay(id);
}

async function advanceMahjongPaipuReplay() {
  return replayController?.advance() ?? false;
}

async function seekMahjongPaipuReplay(position) {
  return replayController?.seek(position);
}

async function toggleMahjongPaipuPlayback() {
  return replayController?.toggle();
}

function pauseMahjongPaipuPlayback() {
  replayController?.pause();
}

async function advanceMahjongPaipuReplayFromResult(action) {
  return replayController?.advanceFromResult(action) ?? false;
}

async function advanceToNextMahjongPaipuHand(state) {
  return replayController?.nextHand(state);
}

function cycleMahjongPaipuReplaySpeed() {
  replayController?.cycleSpeed();
}

function renderMahjongPaipuReplayControls() {
  replayController?.renderControls();
}

async function exitMahjongPaipuReplay(options) {
  return replayController?.exit(options);
}
function handlePlayweftReady(context) {
  playMode = context?.mode ?? "solo";
  if (playMode === "room") resetAutoActions({ persist: false });
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
  if (roomAiAwaitingState) {
    roomAiAwaitingState = false;
    roomAiBusy = false;
  }
  const projection = orientMahjongRoomProjection(
    {
      state: message?.state,
      events: message?.events,
      serverTime: message?.serverTime,
    },
    roomPlayerId,
  );
  if (!projection?.state) return;
  const startsFreshAutoActionScope = asArray(projection.events).some(
    (event) =>
      event?.type === "match_started" ||
      event?.type === "next_hand" ||
      event?.type === "new_match",
  );
  if (startsFreshAutoActionScope) resetAutoActions({ persist: false });
  syncRoomPassClaims(projection.state);
  const nextAutomaticStateKey = roomAutomaticKey(projection.state);
  if (nextAutomaticStateKey !== roomAutomaticStateKey) {
    roomAutomaticStateKey = nextAutomaticStateKey;
    session.cancelScheduledActions();
  }
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
    scheduleRoomLegalActions(projection.state);
    scheduleRoomTenpaiReports(projection.state);
    scheduleRoomEarlyTenpaiReport(projection.state, projection.events);
    if (!hadState) tableController.syncMatchMusic({ fadeIn: true });
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

function scheduleRoomAutomaticAction() {
  const state = tableController.getState();
  const key = roomAutomaticKey(state);
  if (!key || key !== roomAutomaticStateKey) return;
  if (
    state?.phase === "playing" &&
    roomLegalAppliedKey !== roomLegalStateKey(state)
  )
    return;
  session.scheduleRoomAutomaticAction({
    state,
    isCurrent: () =>
      !destroyed &&
      playMode === "room" &&
      roomAutomaticStateKey === key &&
      roomAutomaticKey(tableController.getState()) === key,
  });
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
  if (
    playMode !== "room" ||
    state?.phase !== "playing" ||
    wallCount > LATE_WALL_REPORT_START
  ) {
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
  const reportPromise = runRoomTenpaiReports(
    buildRoomLegalState(state, roomPlayerId),
    key,
    request,
  );
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
    )
      return undefined;
    roomTenpaiReports =
      reports && typeof reports === "object" ? reports : undefined;
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
  const key = roomEarlyTenpaiStateKey(state, roomPlayerId);
  if (key === roomTenpaiSupplementRequestedKey) return;
  roomTenpaiSupplementRequestedKey = key;
  const request = ++roomTenpaiSupplementRequest;
  void runRoomEarlyTenpaiReport(
    buildRoomTenpaiReportState(state, roomPlayerId),
    request,
  );
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
    )
      return;
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

async function sendRoomActionWithTenpaiReport(
  action,
  { onRequestStarted } = {},
) {
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
        buildRoomLegalState(state, roomPlayerId),
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
    const requestId = playweftClient?.sendAction(enrichedAction);
    onRequestStarted?.(requestId);
    if (requestId && attachedReport?.key)
      roomTenpaiReportedKey = attachedReport.key;
    return requestId;
  } catch (error) {
    console.error("Mahjong room action failed", error);
    return undefined;
  }
}

function scheduleRoomLegalActions(state) {
  const activeIndex =
    state?.phase === "claiming"
      ? Number(state?.responseIndex)
      : Number(state?.turnIndex);
  const activePlayer = asArray(state?.players)[activeIndex - 1];
  if (state?.phase === "claiming" && activePlayer === roomPlayerId) {
    roomLegalRequestedKey = "";
    roomLegalAppliedKey = "";
    roomLegalRequest += 1;
    scheduleRoomAutomaticAction();
    return;
  }
  if (
    !state?.legalContext ||
    state?.phase !== "playing" ||
    activePlayer !== roomPlayerId
  ) {
    roomLegalRequestedKey = "";
    roomLegalAppliedKey = "";
    roomLegalRequest += 1;
    session.cancelScheduledActions();
    return;
  }
  const key = roomLegalStateKey(state);
  if (key === roomLegalRequestedKey) return;
  roomLegalRequestedKey = key;
  roomLegalAppliedKey = "";
  const request = ++roomLegalRequest;
  void runRoomLegalActions(
    buildRoomLegalState(state, roomPlayerId),
    key,
    request,
  );
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
    )
      return;
    tableController.applyLegalActions(legalActions);
    roomLegalAppliedKey = key;
    scheduleRoomAutomaticAction();
  } catch (error) {
    if (request === roomLegalRequest) {
      console.error("Mahjong room legal-action preview failed", error);
    }
  }
}

function scheduleRoomAi(state) {
  roomAiState = state;
  const key = roomAiStateKey(state);
  if (!roomIsOwner || !key) {
    roomAiGeneration += 1;
    roomAiTurnKey = "";
    cancelRoomAiWait();
    return;
  }
  if (key === roomAiTurnKey) return;
  roomAiTurnKey = key;
  const generation = ++roomAiGeneration;
  cancelRoomAiWait();
  void runRoomAi(
    state.aiContext,
    state.aiTurn.player,
    key,
    generation,
    performance.now(),
  );
}

function roomAiStateKey(state) {
  if (!state?.aiTurn?.player || !state?.aiContext) return "";
  return JSON.stringify([
    state.phase,
    state.turnIndex,
    state.moveCount,
    state.drawnTile,
    state.lastDiscard,
    state.aiTurn.player,
  ]);
}

function waitForRoomAiPacing(startedAt) {
  const remaining = AI_DELAY_MS - (performance.now() - startedAt);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    roomAiWaitResolve = resolve;
    roomAiSchedule = window.setTimeout(() => {
      roomAiSchedule = 0;
      roomAiWaitResolve = undefined;
      resolve();
    }, remaining);
  });
}

function cancelRoomAiWait() {
  window.clearTimeout(roomAiSchedule);
  roomAiSchedule = 0;
  const resolve = roomAiWaitResolve;
  roomAiWaitResolve = undefined;
  resolve?.();
}

async function runRoomAi(aiContext, actorId, turnKey, generation, startedAt) {
  if (roomAiBusy || destroyed || !roomIsOwner || !aiContext || !actorId) return;
  roomAiBusy = true;
  let submitted = false;
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
    if (outcome?.status !== "acted" || !outcome.action) return;
    await waitForRoomAiPacing(startedAt);
    if (
      !roomIsOwner ||
      destroyed ||
      generation !== roomAiGeneration ||
      turnKey !== roomAiTurnKey ||
      turnKey !== roomAiStateKey(roomAiState)
    )
      return;
    const requestId = playweftClient?.sendAction({
      type: "ai_turn",
      playerId: actorId,
      action: outcome.action,
    });
    submitted = Boolean(requestId);
    roomAiAwaitingState = submitted;
  } catch (error) {
    console.error("Mahjong room AI failed", error);
  } finally {
    if (submitted) return;
    roomAiBusy = false;
    if (generation !== roomAiGeneration && roomAiState) {
      roomAiTurnKey = "";
      scheduleRoomAi(roomAiState);
    }
  }
}

function handleRoomActionResult() {
  // Wait for the authoritative projection; a fast second tap must not act on stale state.
}

function handlePlayweftError(message, _code, requestId) {
  roomAiBusy = false;
  roomAiAwaitingState = false;
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
  if (playMode === "room") {
    transientNotice.show(message);
    return;
  }
  showMessage(message);
}

function showRoomWaiting() {
  elements.setup.hidden = true;
  elements.loading.classList.remove("is-error");
  elements.loading.classList.add("is-room-waiting");
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
  if (playMode !== "solo") return;
  return soloController?.initialize(matchType);
}

async function resumeSavedMatch() {
  return soloController?.resumeSavedMatch();
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
  if (playMode === "room" && name === "passClaims") {
    void session.dispatch({
      type: "set_pass_claims",
      enabled: !autoActions.passClaims,
    });
    return;
  }
  autoActions = { ...autoActions, [name]: !autoActions[name] };
  syncAutoActionControls();
  persistAutoActions();
  if (playMode === "room") scheduleRoomAutomaticAction();
  else scheduleAi();
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

function syncRoomPassClaims(state) {
  if (playMode !== "room" || typeof state?.passClaimsEnabled !== "boolean")
    return;
  if (autoActions.passClaims === state.passClaimsEnabled) return;
  autoActions = { ...autoActions, passClaims: state.passClaimsEnabled };
  syncAutoActionControls();
}

function persistAutoActions() {
  if (playMode !== "solo" || !soloSave) return;
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
  elements.loading.classList.remove("is-room-waiting");
  elements.loading.hidden = true;
  elements.setup.hidden = false;
}

function showSetupRecoveryError(message) {
  transientNotice.show(message);
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
  cancelRoomAiWait();
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
  roomLegalAppliedKey = "";
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
