import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Cog,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
  X,
  createIcons,
} from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import {
  AI_DELAY_MS,
  AUTO_DECISION_DELAY_MS,
  HUMAN_ID,
  NEW_HAND_DEAL_DURATION_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
} from "./rules/constants.js";
import { MahjongDomView } from "./app/dom-view.js";
import { createMahjongSessionController } from "./app/session-controller.js";
import { createMahjongRoomPlayerProfiles } from "./app/room-player-profiles.js";
import { createMahjongRoomPlayerPresentations } from "./app/room-player-identities.js";
import { createMahjongRoomController } from "./app/room-controller.js";
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
import { createMahjongPlayerPresentationStore } from "./app/player-presentation-store.js";
import { resolveMahjongPlayerPresentation } from "./app/player-presentation-resolver.js";
import { createMahjongPageLifecycle } from "./app/page-lifecycle.js";
import { createMahjongSoloMatchController } from "./app/solo-match-controller.js";
import { createMahjongSettingsDialog } from "./settings-dialog.js";
import { createMahjongOfflineResourceController } from "./app/offline-resource-controller.js";
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
  notifyGameOfflineSettings,
  readGameOfflineSettings,
  registerMahjongOfflineServiceWorker,
} from "../../src/game-offline-cache.js";
import {
  appendMahjongSoloAction,
  clearMahjongSoloSave,
  MAHJONG_SOLO_CHECKPOINT_VERSION,
  MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
  readMahjongSoloSave,
  setMahjongSoloAutoActions,
  setMahjongSoloCheckpoint,
  setMahjongSoloOpponentPortraits,
  writeMahjongSoloSave,
} from "./replay/solo-save.js";
import {
  listMahjongPaipuSummaries,
  loadMahjongPaipu,
  saveMahjongPaipu,
  setMahjongPaipuPinned,
} from "./replay/paipu-store.js";
import { createMahjongCompletedPaipuSaver } from "./replay/completed-paipu.js";
import { createMahjongPaipuPanel } from "./replay/paipu-panel.js";
import { mahjongInitialEntry } from "./app/entry-flow.js";
import { orientMahjongPaipuRecord } from "./rules/room-state.js";
import { mahjongPresentationPosition } from "./rules/seat-order.js";
// The room controller owns createLocalLuaGame worker usage; keep that boundary
// visible in the entry module for the room package contract.
import "../../src/base.css";
import "./styles.css";

const lucideIcons = {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Cog,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
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
const effectRunner = createMahjongEffectRunner();
const isStandalone = window.parent === window;
let game;
let gameInitializing = false;
let endingSoloMatch = false;
let destroyed = false;
let playerName = "你";
let hasPlatformName = false;
let roomPlayerProfiles;
let roomPlayerPresentations;
let roomController;
let roomPlayerId = "";
let playMode = isStandalone ? "solo" : null;
let autoActions = defaultAutoActions();
let autoWinAfterRiichiKey = "";
let autoWinAfterRiichiManuallyDisabled = false;
let session;
let tableController;
let playweftClient;
let soloSave = readMahjongSoloSave();
let replayState = null;
let replayController;
let soloController;
const replayPlayerPresentationStore = createMahjongPlayerPresentationStore();
const soloPlayerPresentationStore = createMahjongPlayerPresentationStore();

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
  stepStatus: document.querySelector("#paipu-replay-step-status"),
  handVisibility: document.querySelector("#replay-hand-visibility-button"),
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
const saveCompletedPaipu = createMahjongCompletedPaipuSaver({
  save: saveMahjongPaipu,
});

const matchMusic = new Audio();
matchMusic.loop = true;
matchMusic.preload = "metadata";
matchMusic.volume = DEFAULT_MATCH_MUSIC_VOLUME;
const riverTileSound = new Audio(discardSoundSource);
riverTileSound.preload = "auto";
const defaultMusicCopyright = document.querySelector("#default-bgm-copyright");

const releaseFixedViewport = bindFixedViewport(
  document.querySelector("#mahjong-viewport"),
  document.querySelector("#mahjong-app"),
);
const domView = new MahjongDomView({
  onAction: (action) =>
    (tableController ? tableController.submitAction(action) : dispatch(action)),
  onSelectTile: (tileId) => tableController?.selectTile(tileId),
  onDiscardTile: (tileId) => tableController?.discardOwnTile(tileId),
  onTenpaiPreviewStart: (pointerId) =>
    tableController?.beginConfirmedTenpaiPreview(pointerId),
  onTenpaiPreviewEnd: (pointerId) =>
    tableController?.endConfirmedTenpaiPreview(pointerId),
});
const { elements } = domView;
const transientNotice = createMahjongTransientNotice({
  element: elements.transientNotice,
  window,
});
const offlineResourceController = createMahjongOfflineResourceController({
  button: document.querySelector("#mahjong-offline-action-button"),
  feedback: document.querySelector("#mahjong-offline-feedback"),
  icons: lucideIcons,
  createIconsImpl: createIcons,
  confirm: (message) => isStandalone
    ? window.confirm(message)
    : playweftClient?.confirm(message),
  extraUrls: [defaultTileFacesUrl, defaultPortraitsUrl, defaultTableBackgroundUrl],
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
  autoWinAfterRiichi: elements.autoWinAfterRiichi,
  doubleClickTsumogiri: elements.doubleClickTsumogiri,
  doubleClickPass: elements.doubleClickPass,
  discardVolume: elements.riverTileVolume,
  discardVolumeValue: elements.riverTileVolumeValue,
  masterVolume: elements.masterVolume,
  masterVolumeValue: elements.masterVolumeValue,
  musicVolume: elements.musicVolume,
  musicVolumeValue: elements.musicVolumeValue,
  voiceVolume: elements.voiceVolume,
  voiceVolumeValue: elements.voiceVolumeValue,
  avatarSourcePreference: elements.avatarSourcePreference,
  offlinePolicy: document.querySelector("#mahjong-offline-policy-setting"),
  offlineAction: document.querySelector("#mahjong-offline-action-button"),
  onMusicVolumeChange: () => tableController?.applyAudioVolumes(),
  onMasterVolumeChange: () => tableController?.applyAudioVolumes(),
  onVoiceVolumeChange: () => tableController?.applyAudioVolumes(),
  onGameHintsChange: () => tableController?.renderCurrentState(),
  onAvatarSourcePreferenceChange: () => {
    if (playMode === "replay") {
      void applyMahjongReplayPlayerPresentations(replayState?.record);
      return;
    }
    const currentState = tableController?.getState?.();
    if (
      (playMode === "solo" && game) ||
      (playMode === "room" && currentState?.phase !== "lobby")
    ) return;
    themeController?.applyPackAvatars?.();
    if (playMode === "room") roomController?.syncPlayerPresentation?.();
  },
  onEndMatch: () => {
    if (playMode === "replay") void exitMahjongPaipuReplay();
    else void endSoloMatch();
  },
  onOfflinePolicyChange: (policy) => notifyGameOfflineSettings("mahjong", {
    ...readGameOfflineSettings("mahjong"),
    policy,
  }),
  onOfflineAction: () => void offlineResourceController.handleAction(),
});

void registerMahjongOfflineServiceWorker().then(() => {
  notifyGameOfflineSettings("mahjong");
});
const matchMusicController = new MahjongMatchMusic({
  audio: matchMusic,
  getVolumeScale: () =>
    settingsDialog.masterVolumeScale * settingsDialog.musicVolumeScale,
  fadeDuration: 800,
});
const presentation = new MahjongPresentationController({
  onHandInsertionReady: () => tableController?.renderCurrentState(),
  onKanDrawReady: () => {
    tableController?.renderCurrentState();
    session?.scheduleAi();
  },
  onResultReady: () => {
    tableController?.renderPresentationOverlays();
    replayController?.onResultReady();
    replayController?.renderControls();
  },
  onDrawRevealReady: () => tableController?.renderPresentationOverlays(),
});
const visualRenderer = new MahjongThreeRenderer(elements.stage, {
  onSelectTile: (tileId) => tableController?.selectTile(tileId),
  onClearSelection: () => tableController?.clearSelectedTile(),
  onPreviewDragTile: (tileId) =>
    tableController?.beginDraggedTilePreview(tileId),
  onEndDragPreview: () => tableController?.endDraggedTilePreview(),
  onHandRevealComplete: (key) => tableController?.handRevealSettled(key),
  onDiscardTile: (tileId) => tableController?.discardOwnTile(tileId),
  onDoubleClickBlank() {
    if (playMode === "replay") return;
    const current = tableController?.getState();
    const action = blankDoubleClickAction({
      doubleClickPassEnabled: settingsDialog.doubleClickPassEnabled,
      passAvailable: !elements.pass.hidden && !elements.pass.disabled,
      doubleClickTsumogiriEnabled: settingsDialog.doubleClickTsumogiriEnabled,
      riichiMode: tableController?.isRiichiMode(),
      canDiscard: current?.legalActions?.canDiscard === true,
      drawnTile: current?.drawnTile,
    });
    if (action) tableController?.submitAction(action);
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
  uploadZone: document.querySelector(".settings-theme-upload"),
  list: document.querySelector("#settings-theme-list"),
};
const appearanceElements = {
  controls: document.querySelector("#settings-appearance-controls"),
};
const soundElements = {
  controls: document.querySelector("#settings-sound-controls"),
};
const themeController = createMahjongThemeController({
  document,
  window,
  isStandalone,
  confirm: (message) => playweftClient?.confirm(message),
  themeElements: themePackElements,
  appearanceElements,
  soundElements,
  copyrightElement: defaultMusicCopyright,
  waitForRenderers: () =>
    Promise.all([visualRendererReady, resultHandRendererReady]),
  setRendererAppearance: ({ tablecloth, tileBack }) =>
    Promise.all([
      visualRenderer.setAppearance({ tablecloth, tileBack }),
      resultHandRenderer.setAppearance({ tablecloth, tileBack }),
    ]),
  setPlayerIdentityState: (state) => domView.applyPlayerIdentityState(state),
  getAvatarSourcePreference: () => settingsDialog.avatarSourcePreference,
  initialMatchPortraitRequest: soloSave
    ? {
        savedPortraits: soloSave.opponentPortraits,
        randomSeed: soloSave.randomSeed,
    }
    : undefined,
  isRoomActive: () => playMode === "room",
  onAssetsChanged() {
    tableController?.syncMatchMusic();
    if (playMode === "room") roomController?.syncPlayerPresentation();
    if (playMode === "replay" && replayState?.record) {
      void applyMahjongReplayPlayerPresentations(replayState.record);
    }
    if (tableController?.getState()) {
      tableController.renderCurrentState();
      if (playMode === "room") {
        void roomPlayerPresentations?.apply(tableController.getState());
      }
    }
  },
});
// Create the stable local default before either solo play or room identity is
// entered. A room later replaces HUMAN_ID with the authoritative player ID.
themeController.setRoomPlayerIdentity?.(HUMAN_ID);
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
  getRoomCharacterVoiceSource: (...args) =>
    roomPlayerPresentations?.resolveCharacterVoice(...args),
  getThemeDefaultNames: themeController.getDefaultNames,
  ensurePlayerPresentations: (state) => {
    if (playMode !== "solo" || !Array.isArray(state?.players)) return;
    const persisted = themeController.getPaipuPlayerPresentations?.(
      state.players,
      state.viewerPlayerId || state.players?.[Number(state.viewerSeat) - 1] || HUMAN_ID,
    ) || {};
    soloPlayerPresentationStore.replace(
      new Map(
        Object.entries(persisted).map(([playerId, presentation]) => [
          playerId,
          presentation || {},
        ]),
      ),
    );
  },
  getThemeMatchMusicUrl: themeController.getMatchMusicUrl,
  getThemeRiichiMusicUrl: themeController.getRiichiMusicUrl,
  dispatch: (...args) => session?.dispatch(...args),
  isActionInFlight: () => session?.isActionInFlight() === true,
  scheduleAi: (...args) => session?.scheduleAi(...args),
  onRerollPortraits: async () => {
    if (playMode !== "solo") return;
    await themeController.rerollPortraits(
      crypto.randomUUID().replaceAll("-", ""),
    );
    if (playMode !== "solo" || !soloSave) return;
    const next = setMahjongSoloOpponentPortraits(
      soloSave,
      themeController.getPortraits(),
    );
    if (!next) return;
    soloSave = next;
    writeMahjongSoloSave(soloSave);
  },
  onReplayAdvance: (action) => advanceMahjongPaipuReplayFromResult(action),
  onReplayResultExitStart: () => replayController?.onResultExitStart(),
  onReturnToSetup: teardownCompletedSoloMatch,
});

roomPlayerProfiles = createMahjongRoomPlayerProfiles({
  isRoom: () => playMode === "room",
  getState: () => tableController?.getState(),
  onChanged: () => void roomPlayerPresentations?.apply(),
  onOwnPlatformPortraitChanged: (source) => {
    const applied = roomPlayerPresentations?.setPlatformPortraitSource(source);
    roomController?.syncPlayerPresentation();
    return applied;
  },
});
roomPlayerPresentations = createMahjongRoomPlayerPresentations({
  isRoom: () => playMode === "room",
  getState: () => tableController?.getState(),
  getRoomPlayerId: () => roomController?.getPlayerId(),
  getProfile: (playerId) => roomPlayerProfiles?.get(playerId),
  themeController,
  domView,
});
resultHandRenderer.setPlayerPresentationProvider({
  get: (context) => {
    if (playMode === "room") {
      return roomPlayerPresentations?.getPlayerPresentation(context);
    }
    if (playMode === "replay") {
      return replayPlayerPresentationStore.get(context);
    }
    if (playMode === "solo") {
      return soloPlayerPresentationStore.get(context);
    }
    return themeController.getPlayerPresentation(context);
  },
  subscribe: (listener) => {
    const unsubscribeRoom = roomPlayerPresentations.subscribePlayerPresentations(
      listener,
    );
    const unsubscribeTheme = themeController.subscribePlayerPresentations(listener);
    const unsubscribeReplay = replayPlayerPresentationStore.subscribe(listener);
    const unsubscribeSolo = soloPlayerPresentationStore.subscribe(listener);
    return () => {
      unsubscribeRoom();
      unsubscribeTheme();
      unsubscribeReplay();
      unsubscribeSolo();
    };
  },
});

const pageLifecycle = createMahjongPageLifecycle({
  window,
  document,
  getSession: () => session,
  getTableController: () => tableController,
  isDestroyed: () => destroyed,
  onDestroy: () => destroy(),
  resumeMatchMusic,
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
      onReady: (context) => roomController?.handleReady(context),
      onState: (message) => roomController?.handleState(message),
      onActionResult: (...args) => roomController?.handleActionResult(...args),
      onError: (...args) => roomController?.handleError(...args),
      onPlayerProfileChanged: (change) =>
        roomController?.handlePlayerProfileChanged(change),
    });
session = createMahjongSessionController({
  humanId: HUMAN_ID,
  getMode: () => playMode,
  getGame: () => game,
  getState: () => tableController.getState(),
  getAutoActions: () => autoActions,
  getRiichiMode: () => tableController.isRiichiMode(),
  isKanDrawPending: () => presentation.kanDrawPending,
  sendRoomAction: (...args) =>
    roomController?.sendActionWithTenpaiReport(...args),
  onRoomUnavailable: () => {
    tableController.rollbackPendingDiscard();
    tableController.clearActionInFlight();
    showMessage("尚未连接到房间");
  },
  persistAcceptedAction,
  refreshProjection: tableController.refresh,
  onSoloActionAccepted(action, projection) {
    if (action.type === "riichi") {
      const event = asArray(projection?.events).find(
        (candidate) =>
          candidate?.type === "riichi" &&
          Number(candidate.playerIndex) ===
            (Number(projection?.state?.viewerSeat) ||
              (projection?.state?.players?.indexOf(HUMAN_ID) ?? 0) + 1),
      );
      enableAutoWinAfterRiichi(projection?.state, event);
    }
    if (action.type === "next_hand" || action.type === "new_match")
      resetAutoActions();
    tableController.clearActionUi();
  },
  onActionRejected: (code) => {
    tableController.rollbackPendingDiscard();
    tableController.clearActionInFlight();
    showMessage(errorMessage(code));
  },
  onActionError(error) {
    tableController.rollbackPendingDiscard();
    tableController.clearActionInFlight();
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

roomController = createMahjongRoomController({
  window,
  elements,
  getPlayMode: () => playMode,
  setPlayMode: (value) => {
    if (playMode === "replay" && value !== "replay") {
      replayPlayerPresentationStore.clear();
    }
    playMode = value;
    syncReplayHandVisibilityControl();
  },
  getPlayerId: () => roomPlayerId,
  setPlayerId: (value) => {
    roomPlayerId = value;
  },
  setPlayerName: (value) => {
    playerName = value;
  },
  setHasPlatformName: (value) => {
    hasPlatformName = value;
  },
  setIsOwner: () => {},
  getGameInitializing: () => gameInitializing,
  setGameInitializing: (value) => {
    gameInitializing = value;
  },
  getDestroyed: () => destroyed,
  getClient: () => playweftClient,
  getSession: () => session,
  tableController,
  visualRendererReady,
  settingsDialog,
  transientNotice,
  roomPlayerProfiles,
  roomPlayerPresentations,
  themeController,
  beginSetupExit,
  resetAutoActions,
  syncRoomPassClaims,
  enableAutoWinAfterRiichi,
  persistCompletedPaipu: saveCompletedPaipu,
  showMessage,
  showLoadingError,
  showSetupRecoveryError,
  showRoomSetup,
  startSoloEntry: startMahjongEntry,
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
    syncReplayHandVisibilityControl();
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
  applyPlayerPresentations: applyMahjongReplayPlayerPresentations,
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
pageLifecycle.revealAppAfterStyles();

function bindUiEvents() {
  paipuElements.entry?.addEventListener("click", () => void openPaipuPanel());
  paipuElements.close?.addEventListener("click", closePaipuPanel);
  paipuElements.panel?.addEventListener("click", (event) => {
    if (event.target === paipuElements.panel) closePaipuPanel();
  });
  replayElements.previousHand?.addEventListener("click", () => {
    void replayController?.previousHand(replayState);
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
  replayElements.handVisibility?.addEventListener("click", () => {
    void replayController?.toggleOpponentHands();
  });
  elements.pass.addEventListener("click", () =>
    tableController?.submitAction({ type: "pass" }),
  );
  elements.abort.addEventListener("click", () =>
    tableController?.submitAction({ type: "abort_nine" }),
  );
  elements.tsumo.addEventListener("click", () =>
    tableController?.submitAction({ type: "tsumo" }),
  );
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
        void roomController?.startMatch(button.dataset.matchType);
        return;
      }
      void initialize(button.dataset.matchType);
    });
  }
  syncAutoActionControls();
  pageLifecycle.bind();
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

async function initialize(matchType = "east") {
  if (playMode !== "solo") return;
  return soloController?.initialize(matchType);
}

function selectedMatchRules() {
  return Object.fromEntries(
    [...elements.setup.querySelectorAll("[data-rule]")].map((input) => [
      input.dataset.rule,
      input.checked,
    ]),
  );
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
      const paipu = {
        ...(await currentGame.exportPaipu()),
        viewerPlayerId: currentGame.playerId || HUMAN_ID,
      };
      paipu.playerPresentations =
        soloSave?.playerPresentations ||
        themeController.getPaipuPlayerPresentations?.(
          paipu.players,
          paipu.viewerPlayerId,
        ) || {};
      if (paipu?.status === "completed") await saveCompletedPaipu(paipu);
    } catch (error) {
      console.warn("Mahjong paipu save failed", error);
    }
  }
}

async function applyMahjongReplayPlayerPresentations(record) {
  if (!record) return false;
  const oriented = orientMahjongPaipuRecord(record, record?.viewerPlayerId);
  const portraits = {};
  const fallbackPortraits = {};
  const builtinCharacters = {};
  const resolvedPresentations = new Map();
  const viewerSeat =
    (oriented?.players || []).findIndex(
      (player) => player?.id === record?.viewerPlayerId,
    ) + 1;
  for (const [index, player] of (oriented?.players || []).entries()) {
    const position = mahjongPresentationPosition(index + 1, viewerSeat || 1);
    if (!position) continue;
    const presentation = record?.playerPresentations?.[player?.id] || {};
    const resolved = await resolveMahjongPlayerPresentation({
      playerId: player?.id,
      presentation,
      platformSource:
        player?.id === record?.viewerPlayerId
          ? themeController.getPlatformAvatarSource?.() || ""
          : "",
      resolveThemePortrait: themeController.resolveCharacterPortrait,
    });
    portraits[position] = resolved.source;
    const fallbackSource = resolved.fallbackSource;
    resolvedPresentations.set(String(player?.id || ""), {
      source: resolved.source,
      ...(fallbackSource ? { fallbackSource } : {}),
      ...(resolved.builtinCharacterId
        ? { builtinCharacterId: resolved.builtinCharacterId }
        : {}),
    });
    fallbackPortraits[position] = fallbackSource;
    builtinCharacters[position] = resolved.builtinCharacterId;
  }
  replayPlayerPresentationStore.replace(resolvedPresentations);
  return domView.applyPlayerIdentityState({
    portraits,
    fallbackPortraits,
    builtinCharacters,
  });
}

function defaultAutoActions() {
  return { autoWin: false, passClaims: false, autoTsumogiri: false };
}

function enableAutoWinAfterRiichi(state, event) {
  if (!settingsDialog.autoWinAfterRiichiEnabled) return;
  const key = autoWinAfterRiichiStateKey(state, event);
  if (
    !key ||
    key === autoWinAfterRiichiKey ||
    autoWinAfterRiichiManuallyDisabled
  )
    return;
  autoWinAfterRiichiKey = key;
  if (autoActions.autoWin) return;
  autoActions = { ...autoActions, autoWin: true };
  syncAutoActionControls();
  persistAutoActions();
  if (playMode === "room") roomController?.scheduleAutomaticAction();
  else scheduleAi();
}

function toggleAutoAction(name) {
  if (playMode === "room" && name === "passClaims") {
    void session.dispatch({
      type: "set_pass_claims",
      enabled: !autoActions.passClaims,
    });
    return;
  }
  const enabled = !autoActions[name];
  autoActions = { ...autoActions, [name]: enabled };
  if (name === "autoWin" && !enabled && autoWinAfterRiichiKey) {
    autoWinAfterRiichiManuallyDisabled = true;
  }
  syncAutoActionControls();
  persistAutoActions();
  if (playMode === "room") roomController?.scheduleAutomaticAction();
  else scheduleAi();
}

function resetAutoActions({ persist = true } = {}) {
  autoActions = defaultAutoActions();
  autoWinAfterRiichiKey = "";
  autoWinAfterRiichiManuallyDisabled = false;
  syncAutoActionControls();
  if (persist) persistAutoActions();
}

function autoWinAfterRiichiStateKey(state, event) {
  if (!state || !event) return "";
  return [
    Number(state.roundWind) || 0,
    Number(state.handNumber) || 0,
    Number(state.honba) || 0,
    Number(state.moveCount) || 0,
    Number(event.playerIndex) || 0,
  ].join(":");
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

function syncReplayHandVisibilityControl() {
  const isReplay = playMode === "replay";
  for (const button of [
    elements.autoWin,
    elements.passClaims,
    elements.autoTsumogiri,
  ]) {
    button.hidden = isReplay;
  }
  const visibility = replayElements.handVisibility;
  if (!visibility) return;
  visibility.hidden = !isReplay;
  if (!isReplay) {
    visibility.setAttribute("aria-pressed", "false");
    visibility.setAttribute("aria-label", "显示其他玩家手牌");
    visibility.title = "显示其他玩家手牌";
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
  await themeController.clearMatchPortraits();
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

function destroy() {
  if (destroyed) return;
  destroyed = true;
  session?.cancelScheduledActions();
  tableController?.destroy();
  pageLifecycle.destroy();
  themeController.destroy();
  releaseFixedViewport();
  settingsDialog.destroy();
  visualRenderer.destroy();
  resultHandRenderer.destroy();
  game?.close();
  roomController?.destroy();
  playweftClient?.destroy();
}
