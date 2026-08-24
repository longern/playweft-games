import { Cog, X, createIcons } from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { createLocalLuaGame } from "./local-game-worker-client.js";
import {
  AI_DELAY_MS,
  AUTO_DECISION_DELAY_MS,
  HUMAN_ID,
  NEW_HAND_DEAL_DURATION_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
  PLAYERS,
} from "./constants.js";
import { MahjongDomView } from "./dom-view.js";
import { createMahjongSessionController } from "./session-controller.js";
import { bindFixedViewport } from "./fixed-viewport.js";
import {
  asArray,
  blankDoubleClickAction,
  errorMessage,
} from "./game-format.js";
import { MahjongThreeRenderer } from "./three-renderer.js";
import { MahjongResultHandRenderer } from "./result-hand-renderer.js";
import { MahjongPresentationController } from "./presentation-controller.js";
import { createMahjongThemeController } from "./theme-controller.js";
import { createMahjongTableController } from "./table-controller.js";
import { createMahjongEffectRunner } from "./effect-runner.js";
import { createMahjongSettingsDialog } from "./settings-dialog.js";
import { MahjongMatchMusic } from "./match-music.js";
import {
  deferMahjongDecorativeAssets,
  deferMahjongImageAssets,
} from "./deferred-visual-assets.js";
import discardSoundSource from "./assets/audio/discard-sound.js";
import defaultTableBackgroundUrl from "./assets/moonlit-table-v3.jpg?url";
import defaultPortraitsUrl from "./assets/player-portraits-v1.jpg?url";
import defaultResultTableclothUrl from "./assets/felt-skin-moonwave-v1.jpg?url";
import defaultLobbyBackgroundUrl from "./assets/waiting-evening-v1.jpg?url";
import defaultLobbySignpostUrl from "./assets/waiting-signpost-v3.webp?url";
import defaultTileFacesUrl from "./assets/tiles/riichi-faces.webp?url";
import { DEFAULT_MATCH_MUSIC_VOLUME } from "./media-config.js";
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
} from "./solo-save.js";
import { replayMahjongSoloSave } from "./solo-replay.js";
import { mahjongInitialEntry } from "./entry-flow.js";
import { orientMahjongRoomProjection } from "./room-state.js";
import "../../src/base.css";
import "./styles.css";

createIcons({ icons: { Cog, X } });

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
  urls: { signpost: defaultLobbySignpostUrl },
});

const SETUP_EXIT_DURATION_MS = 560;
const SETUP_RECOVERY_ERROR_DURATION_MS = 4600;
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
let setupRecoveryErrorTimer;
let playMode = isStandalone ? "solo" : null;
let autoActions = defaultAutoActions();
let session;
let tableController;
let playweftClient;
let soloSave = readMahjongSoloSave();

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
  onEndMatch: () => void endSoloMatch(),
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
  dispatch: (...args) => session?.dispatch(...args),
  isActionInFlight: () => session?.isActionInFlight() === true,
  scheduleAi: (...args) => session?.scheduleAi(...args),
  onRerollPortraits: () => themeController.rerollPortraits(),
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
  sendRoomAction: (action) => playweftClient?.sendAction(action),
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
      () => void initialize(button.dataset.matchType),
    );
  }
  syncAutoActionControls();
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("pointerdown", resumeMatchMusic, { passive: true });
  document.addEventListener("keydown", resumeMatchMusic);
}

function handlePlayweftReady(context) {
  playMode = context?.mode ?? "solo";
  roomPlayerId = context?.playerId || "";
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
  const projection = orientMahjongRoomProjection(
    { state: message?.state, events: message?.events },
    roomPlayerId,
  );
  if (!projection?.state) return;
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
    if (!hadState)
      tableController.syncMatchMusic({ start: true, fadeIn: true });
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    session.confirmRoomState();
  } catch (error) {
    console.error("Mahjong room state failed to render", error);
    showLoadingError("房间状态加载失败，请稍后重试");
  }
}

function handleRoomActionResult() {
  // Wait for the authoritative projection; a fast second tap must not act on stale state.
}

function handlePlayweftError(message, _code, requestId) {
  if (
    session.rejectRoomAction(requestId) &&
    tableController.getState()?.phase === "hand_ended"
  ) {
    tableController.syncMatchMusic();
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
  tableController.syncMatchMusic({ start: true });
  const rules = Object.fromEntries(
    [...elements.setup.querySelectorAll("[data-rule]")].map((input) => [
      input.dataset.rule,
      input.checked,
    ]),
  );
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
    tableController.syncMatchMusic({ start: true });
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    settingsDialog.setSoloMatchActive(true);
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
  elements.setup.classList.remove("is-leaving", "is-prepared-for-result-exit");
  for (const button of elements.setup.querySelectorAll("[data-match-type]"))
    button.disabled = false;
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
  tableController.syncMatchMusic({ start: false });
  presentation.suspend();
  game?.close();
  game = undefined;
  tableController.reset();
  elements.result.hidden = true;
  elements.loading.hidden = true;
  showSetup();
  settingsDialog.setSoloMatchActive(false);
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
  return session?.dispatch(action, options) ?? false;
}

function scheduleAi(options) {
  session?.scheduleAi(options);
}

function resumeMatchMusic() {
  tableController?.resumeMatchMusic();
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
  playweftClient?.destroy();
}
