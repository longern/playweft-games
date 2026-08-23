import { createLocalLuaGame } from "./local-game-worker-client.js";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { Cog, X, createIcons } from "lucide";
import {
  AI_DELAY_MS,
  AUTO_DECISION_DELAY_MS,
  DRAW_REVEAL_CARD_DELAY_MS,
  DRAW_REVEAL_CARD_GAP_MS,
  DRAW_REVEAL_VISIBLE_BASE_MS,
  DRAW_REVEAL_VISIBLE_EXTENSION_MS,
  DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS,
  HAND_INSERTION_DELAY_MS,
  HAND_END_PRESENTATION_DELAY_MS,
  HUMAN_ID,
  NEW_HAND_DEAL_DURATION_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
  PLAYERS,
} from "./constants.js";
import { MahjongDomView } from "./dom-view.js";
import { automaticMahjongAction, sameMahjongAction } from "./auto-actions.js";
import { bindFixedViewport } from "./fixed-viewport.js";
import {
  activeSeat,
  asArray,
  automaticRiichiDiscard,
  blankDoubleClickAction,
  canDiscardHandTile,
  clearedTableState,
  deferredHandInsertion,
  errorMessage,
  exhaustiveDrawPresentation,
  matchResultRows,
  resultDetailPageCount,
} from "./game-format.js";
import { MahjongThreeRenderer } from "./three-renderer.js";
import { MahjongResultHandRenderer } from "./result-hand-renderer.js";
import { MahjongPresentationController } from "./presentation-controller.js";
import { createMahjongSettingsDialog } from "./settings-dialog.js";
import {
  isMahjongMatchMusicActive,
  MahjongMatchMusic,
} from "./match-music.js";
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
import { riverTileSoundCue } from "./render/audio-cues.js";
import {
  activateMahjongAssetPack,
  configureMahjongAssetPackAppearance,
  createMahjongAssetPack,
  deleteMahjongAssetPack,
  deactivateMahjongAssetPacks,
  getMahjongAssetUrl,
  getMahjongConfiguredAssetPacks,
  getMahjongDefaultPack,
  configureMahjongDefaultPackAppearance,
  getMahjongMatchMusicCopyright,
  getMahjongDefaultNames,
  getMahjongMatchMusicUrl,
  initializeMahjongAssetPacks,
  listMahjongAssetPacks,
  rerollMahjongAssetPackPortraits,
  MAHJONG_YAKU_VOICE_KEYS,
} from "./asset-packs.js";
import {
  DEFAULT_MATCH_MUSIC_VOLUME,
} from "./media-config.js";
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

let game;
let gameInitializing = false;
let actionInFlight = false;
let state;
let resultPageIndex = 0;
let resultPageKey = "";
let resultPageAnimating = false;
let matchSummaryVisible = false;
let selectedTileId = 0;
let riichiMode = false;
let selectionBeforeRiichi = 0;
let aiTimer;
let visibleEvents = [];
let playerName = "你";
let hasPlatformName = false;
let destroyed = false;
let hasPlatformAvatar = false;
let endingSoloMatch = false;
let roomPlayerId = "";
let roomActionRequestId = "";
const MATCH_MUSIC_FADE_DURATION_MS = 800;
const SETUP_EXIT_DURATION_MS = 560;
const RESULT_PAGE_TRANSITION_MS = 920;
const RESULT_EXIT_DURATION_MS = 320;
const NEW_HAND_TABLE_PAUSE_MS = 360;
const KAN_DRAW_PAUSE_MS = 300;
const MATCH_SUMMARY_PORTRAIT_POSITIONS = [
  "0% 0%",
  "100% 0%",
  "0% 100%",
  "100% 100%",
];
const MATCH_SUMMARY_POSITIONS = ["bottom", "right", "top", "left"];
const matchMusic = new Audio();
matchMusic.loop = true;
matchMusic.preload = "metadata";
matchMusic.volume = DEFAULT_MATCH_MUSIC_VOLUME;
const defaultMusicCopyright = document.querySelector("#default-bgm-copyright");
syncDefaultMusicCopyright();
const riverTileSound = new Audio(discardSoundSource);
riverTileSound.preload = "auto";
let voicedEventKey = "";
let playedRiverTileSoundKey = "";
let soloSave = readMahjongSoloSave();
const isStandalone = window.parent === window;
let playMode = isStandalone ? "solo" : null;
let autoActions = defaultAutoActions();

function revealMahjongAppAfterStyles() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
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
  onSelectTile: selectTile,
  onDiscardTile: discardOwnTile,
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
  onMusicVolumeChange() {
    applyMatchMusicVolume();
  },
  onGameHintsChange() {
    if (state) renderCurrentState();
  },
  onEndMatch() {
    void endSoloMatch();
  },
});
const matchMusicController = new MahjongMatchMusic({
  audio: matchMusic,
  getVolumeScale: () => settingsDialog.musicVolumeScale,
  fadeDuration: MATCH_MUSIC_FADE_DURATION_MS,
});
const visualRenderer = new MahjongThreeRenderer(elements.stage, {
  onSelectTile: selectTile,
  onClearSelection: clearSelectedTile,
  onPreviewDragTile: previewDraggedTile,
  onEndDragPreview: restoreSelectedTilePreview,
  onHandRevealComplete(key) {
    presentation.handRevealSettled(key);
  },
  onDiscardTile: discardOwnTile,
  onDoubleClickBlank() {
    const action = blankDoubleClickAction({
      doubleClickPassEnabled: settingsDialog.doubleClickPassEnabled,
      passAvailable: !elements.pass.hidden && !elements.pass.disabled,
      doubleClickTsumogiriEnabled: settingsDialog.doubleClickTsumogiriEnabled,
      riichiMode,
      canDiscard: state?.legalActions?.canDiscard === true,
      drawnTile: state?.drawnTile,
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
    onStartButtonClick: () => void continueResult(),
    onBlankDoubleClick: () => void continueResult(),
  },
);
const presentation = new MahjongPresentationController({
  onHandInsertionReady: renderCurrentState,
  onKanDrawReady() {
    renderCurrentState();
    scheduleAi();
  },
  onResultReady: renderPresentationOverlays,
  onDrawRevealReady: renderPresentationOverlays,
});
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
const DEFAULT_VISUAL_PACK_ID = "__default__";
let visualPacks = [];
const assetPacksReady = initializeMahjongAssetPacks().catch(() => new Map());

void Promise.all([
  visualRendererReady,
  resultHandRendererReady,
  assetPacksReady,
]).then(() => applyVisualPack());
void refreshThemePacks();
themePackElements.upload.addEventListener("change", async () => {
  const archive = themePackElements.upload.files?.[0];
  themePackElements.upload.value = "";
  if (!archive) return;
  themePackElements.feedback.textContent = "正在保存主题包…";
  try {
    visualPacks = await createMahjongAssetPack(archive);
    renderThemePacks();
    themePackElements.feedback.textContent = "已导入并启用主题包。";
  } catch (error) {
    themePackElements.feedback.textContent =
      error instanceof Error ? error.message : "导入主题包失败";
  }
});
themePackElements.list.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const id = button?.dataset.packId;
  const action = button?.dataset.packAction;
  const packUrl = button?.dataset.packUrl;
  if (!action) return;
  if (action === "download") {
    if (!packUrl) return;
    const configuredPack = getMahjongConfiguredAssetPacks().find(
      (pack) => pack.url === packUrl,
    );
    if (!configuredPack) return;
    themePackElements.feedback.textContent = `正在下载「${configuredPack.name}」…`;
    try {
      const response = await fetch(configuredPack.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const archive = {
        name: `${configuredPack.name}.zip`,
        size: blob.size,
        arrayBuffer: () => blob.arrayBuffer(),
      };
      visualPacks = await createMahjongAssetPack(archive, {
        sourceUrl: configuredPack.url,
      });
      renderThemePacks();
      themePackElements.feedback.textContent = "已下载并启用主题包。";
    } catch (error) {
      themePackElements.feedback.textContent =
        error instanceof Error ? `主题包下载失败：${error.message}` : "主题包下载失败";
    }
    return;
  }
  if (!id) return;
  if (action === "delete") {
    const confirmation = "删除这个麻将主题包？此操作无法恢复。";
    const confirmed =
      isStandalone
        ? window.confirm(confirmation)
        : await playweftClient?.confirm(confirmation);
    if (!confirmed) return;
  }
  themePackElements.feedback.textContent =
    action === "delete" ? "正在删除…" : "正在切换主题包…";
  try {
    visualPacks =
      action === "delete"
        ? await deleteMahjongAssetPack(id)
        : id === DEFAULT_VISUAL_PACK_ID
          ? await deactivateMahjongAssetPacks()
          : await activateMahjongAssetPack(id);
    renderThemePacks();
    themePackElements.feedback.textContent =
      action === "delete"
        ? "已删除主题包。"
        : id === DEFAULT_VISUAL_PACK_ID
          ? "已切回默认主题。"
          : "已启用主题包。";
  } catch {
    themePackElements.feedback.textContent =
      action === "delete" ? "删除主题包失败" : "切换主题包失败";
  }
});
appearanceElements.controls.addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-appearance-key]");
  const activePack = getActiveVisualPack();
  if (!select || !activePack) return;
  const appearance = structuredClone(activePack.appearance);
  const key = select.dataset.appearanceKey;
  if (key.startsWith("portrait:")) {
    appearance.portraits[key.slice("portrait:".length)] = select.value;
  } else if (key === "voice") {
    appearance.voice = select.value === "on";
  } else {
    appearance[key] = select.value;
  }
  appearanceElements.feedback.textContent = "正在应用装扮配置…";
  try {
    if (activePack.isDefault) {
      configureMahjongDefaultPackAppearance(appearance);
    } else {
      visualPacks = await configureMahjongAssetPackAppearance(
        activePack.id,
        appearance,
      );
    }
    renderThemePacks();
    appearanceElements.feedback.textContent = "已应用装扮配置。";
  } catch (error) {
    appearanceElements.feedback.textContent =
      error instanceof Error ? error.message : "装扮配置失败";
  }
});
window.addEventListener("mahjong:asset-pack-changed", () => {
  void applyVisualPack();
  syncDefaultMusicCopyright();
  syncMatchMusic();
  applyPackAvatars(state);
  if (state) renderCurrentState();
});
elements.pass.addEventListener("click", () => dispatch({ type: "pass" }));
elements.abort.addEventListener("click", () =>
  dispatch({ type: "abort_nine" }),
);
elements.tsumo.addEventListener("click", () => dispatch({ type: "tsumo" }));
elements.riichi.addEventListener("click", enterRiichiMode);
elements.cancelRiichi.addEventListener("click", cancelRiichiMode);
elements.rematch.addEventListener("click", () => void continueResult());
elements.matchSummaryRematch.addEventListener(
  "click",
  () => void restartMatchFromSummary(),
);
elements.matchSummarySetup.addEventListener(
  "click",
  () => void returnToSetupFromSummary(),
);
elements.result.addEventListener("dblclick", (event) => {
  if (!isResultBlankSpace(event.target)) return;
  resultHandRenderer.playStartButtonActivation(() => void continueResult());
});
elements.autoWin.addEventListener("click", () => toggleAutoAction("autoWin"));
elements.passClaims.addEventListener("click", () =>
  toggleAutoAction("passClaims"),
);
elements.autoTsumogiri.addEventListener("click", () =>
  toggleAutoAction("autoTsumogiri"),
);
syncAutoActionControls();
for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
  button.addEventListener(
    "click",
    () => void initialize(button.dataset.matchType),
  );
}
window.addEventListener("pagehide", handlePageHide);
window.addEventListener("pageshow", handlePageShow);
document.addEventListener("visibilitychange", handleVisibilityChange);
document.addEventListener("pointerdown", resumeMatchMusic, { passive: true });
document.addEventListener("keydown", resumeMatchMusic);

const playweftClient = isStandalone
  ? undefined
  : createPlayweftClient({
      onReady: handlePlayweftReady,
      onState: handleRoomState,
      onActionResult: handleRoomActionResult,
      onError: handlePlayweftError,
    });

if (isStandalone) startMahjongEntry();
revealMahjongAppAfterStyles();

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
  const hadState = Boolean(state);
  const animateDealIn =
    !hadState ||
    asArray(projection.events).some(
      (event) => event?.type === "next_hand" || event?.type === "new_match",
    );
  try {
    await visualRendererReady;
    if (destroyed || playMode !== "room") return;
    await refresh(projection, { animateDealIn });
    if (!hadState) syncMatchMusic({ start: true, fadeIn: true });
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    actionInFlight = false;
    roomActionRequestId = "";
  } catch (error) {
    console.error("Mahjong room state failed to render", error);
    showLoadingError("房间状态加载失败，请稍后重试");
  }
}

function handleRoomActionResult(_result) {
  // Keep the action locked until the following authoritative state update.
  // Otherwise a fast second tap can send an action against the old projection.
}

function handlePlayweftError(message, _code, requestId) {
  if (!requestId || requestId === roomActionRequestId) {
    actionInFlight = false;
    roomActionRequestId = "";
    if (state?.phase === "hand_ended") syncMatchMusic();
  }
  if (!state) {
    showLoadingError(message);
    return;
  }
  elements.message.textContent = message;
  elements.message.classList.add("is-error");
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
    applyPackAvatars(state);
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
        applyPackAvatars(state);
      }
    })
    .catch(() => {
      if (!initialSource) applyPackAvatars(state);
    });
}

function applyPackAvatars() {
  const portraitSlotByPosition = {
    bottom: "self",
    right: "right",
    top: "opposite",
    left: "left",
  };
  for (const [position, portraitSlot] of Object.entries(
    portraitSlotByPosition,
  )) {
    if (position === "bottom" && hasPlatformAvatar) continue;
    const source = getMahjongAssetUrl(`portrait-${portraitSlot}`);
    domView.setPlayerAvatar(position, source);
  }
}

function syncDefaultMusicCopyright() {
  const copyright = getMahjongMatchMusicCopyright();
  defaultMusicCopyright.textContent = copyright;
  defaultMusicCopyright.hidden = !copyright;
}

async function applyVisualPack() {
  await Promise.all([visualRendererReady, resultHandRendererReady]);
  const tileBack = getMahjongAssetUrl("tile-back");
  const tablecloth = getMahjongAssetUrl("tablecloth");
  await Promise.all([
    visualRenderer.setAppearance({
      tablecloth,
      tileBack,
    }),
    resultHandRenderer.setAppearance({ tablecloth, tileBack }),
  ]);
}

function applyMatchMusicVolume() {
  matchMusicController.applyVolume();
}

function syncMatchMusic({
  start = isMahjongMatchMusicActive({
    gameInitializing,
    game,
    playMode,
    state,
  }),
  fadeIn = false,
} = {}) {
  const source = getMahjongMatchMusicUrl();
  if (!start || !source) {
    matchMusicController.stop();
    return;
  }
  const resolvedSource = new URL(source, document.baseURI).href;
  matchMusicController.setSource(resolvedSource);
  if (state?.phase === "hand_ended") {
    matchMusicController.mute();
    return;
  }
  matchMusicController.play({ fadeIn });
}

function primeMatchMusicForNextHand() {
  const source = getMahjongMatchMusicUrl();
  if (!source) return;
  matchMusicController.primeForNextHand(
    new URL(source, document.baseURI).href,
  );
}

function resumeMatchMusic() {
  if (
    !matchMusicController.blockedByAutoplay ||
    !(game || (playMode === "room" && state)) ||
    state?.phase === "hand_ended"
  )
    return;
  matchMusicController.resumeIfBlocked({
    fadeIn: matchMusicController.gain === 0,
  });
}

function syncMatchMusicForHandState(previousState, currentState) {
  const handWasEnded = previousState?.phase === "hand_ended";
  const handIsEnded = currentState?.phase === "hand_ended";
  if (!handWasEnded && handIsEnded) {
    matchMusicController.mute({ fade: true });
  } else if (handWasEnded && !handIsEnded) {
    syncMatchMusic({ start: true, fadeIn: true });
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
  const key = [
    Number(state?.moveCount) || 0,
    ...voiceEvents.map(
      (event) =>
        `${event.type}:${event.kind ?? event.method ?? ""}:${event.playerIndex}`,
    ),
  ].join("|");
  if (key === voicedEventKey) return;
  voicedEventKey = key;
  for (const event of voiceEvents) {
    const cue = voiceCueForEvent(event);
    if (event.type === "won") {
      const yakuCues = winningYakuVoiceCues(event.playerIndex);
      playRoleVoiceSequence(event.playerIndex, [cue, ...yakuCues]);
    } else {
      playRoleVoice(event.playerIndex, cue);
    }
  }
}

function winningYakuVoiceCues(playerIndex) {
  const score = asArray(state?.results).find(
    (result) => Number(result?.winnerIndex) === Number(playerIndex),
  );
  return asArray(score?.yaku)
    .map((yaku) => MAHJONG_YAKU_VOICE_KEYS[yaku?.name])
    .map((cue) => cue && `yaku:${cue}`)
    .filter(Boolean);
}

function voiceCueForEvent(event) {
  if (event?.type === "claimed") {
    return ["chi", "pon", "kan"].includes(event.kind) ||
      ["ankan", "kakan"].includes(event.kind)
      ? event.kind === "ankan" || event.kind === "kakan"
        ? "kan"
        : event.kind
      : "";
  }
  if (event?.type === "riichi") return "riichi";
  if (event?.type === "won") return event.method === "tsumo" ? "tsumo" : "ron";
  return "";
}

function playRoleVoice(playerIndex, cue, delay = 0) {
  const position =
    ["", "self", "right", "opposite", "left"][Number(playerIndex)] ?? "";
  const source = position && getMahjongAssetUrl(`voice-${position}:${cue}`);
  if (!source) return;
  window.setTimeout(() => {
    const audio = new Audio(source);
    audio.preload = "auto";
    audio.addEventListener("ended", () => audio.remove(), { once: true });
    audio.addEventListener("error", () => audio.remove(), { once: true });
    void audio.play().catch(() => audio.remove());
  }, delay);
}

function playRoleVoiceSequence(playerIndex, cues) {
  const sources = cues
    .map((cue) => getRoleVoiceSource(playerIndex, cue))
    .filter(Boolean);
  if (!sources.length) return;
  void sources.reduce(
    (sequence, source) => sequence.then(() => playVoiceSource(source)),
    Promise.resolve(),
  );
}

function getRoleVoiceSource(playerIndex, cue) {
  const position =
    ["", "self", "right", "opposite", "left"][Number(playerIndex)] ?? "";
  const isYaku = cue.startsWith("yaku:");
  const slot = `voice-${position}:${isYaku ? "yaku:" : ""}${isYaku ? cue.slice(5) : cue}`;
  return position ? getMahjongAssetUrl(slot) : "";
}

function playVoiceSource(source) {
  return new Promise((resolve) => {
    const audio = new Audio(source);
    const finish = () => {
      audio.remove();
      resolve();
    };
    audio.preload = "auto";
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    void audio.play().catch(finish);
  });
}

async function refreshThemePacks() {
  try {
    await assetPacksReady;
    visualPacks = await listMahjongAssetPacks();
    renderThemePacks();
  } catch {
    visualPacks = [];
    renderThemePacks();
  }
}

function renderThemePacks() {
  const defaultPack = getMahjongDefaultPack();
  defaultPack.active = !visualPacks.some((pack) => pack.active);
  const packs = [
    defaultPack,
    ...visualPacks,
  ];
  const localItems = packs.map((pack) => {
    const item = document.createElement("li");
    item.classList.toggle("is-active", pack.active);
    const details = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = pack.name;
    const summary = document.createElement("small");
    summary.textContent = pack.isDefault
      ? "内置主题包"
      : `${pack.assetNames.length} 项装扮内容`;
    details.append(title, summary);
    const actions = document.createElement("span");
    actions.className = "settings-theme-actions";
    if (pack.active) {
      const active = document.createElement("em");
      active.textContent = "使用中";
      actions.append(active);
    } else {
      actions.append(createVisualPackButton("使用", "activate", pack.id));
    }
    if (!pack.isDefault) {
      actions.append(createVisualPackButton("删除", "delete", pack.id));
    }
    item.append(details, actions);
    return item;
  });
  const downloadedUrls = new Set(
    visualPacks.map((pack) => pack.sourceUrl).filter(Boolean),
  );
  const remoteItems = getMahjongConfiguredAssetPacks()
    .filter((pack) => !downloadedUrls.has(pack.url))
    .map((pack) => {
      const item = document.createElement("li");
      item.className = "is-remote";
      const details = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = pack.name;
      const summary = document.createElement("small");
      summary.textContent = "在线主题包";
      details.append(title, summary);
      const actions = document.createElement("span");
      actions.className = "settings-theme-actions";
      const download = createVisualPackButton("下载", "download");
      download.dataset.packUrl = pack.url;
      actions.append(download);
      item.append(details, actions);
      return item;
    });
  themePackElements.list.replaceChildren(...localItems, ...remoteItems);
  renderAppearanceSettings();
}

function renderAppearanceSettings() {
  const pack = getActiveVisualPack();
  const catalog = pack?.catalog;
  if (!pack || !catalog) {
    appearanceElements.controls.hidden = false;
    appearanceElements.controls.replaceChildren(
      createAppearanceEmptyState("暂无可配置的主题内容，请先选择一个主题包。"),
    );
    return;
  }
  const portraitLabels = {
    self: "自己",
    right: "右手边",
    opposite: "对家",
    left: "左手边",
  };
  const controls = document.createDocumentFragment();
  const portraitGroup = document.createElement("fieldset");
  portraitGroup.className = "settings-appearance-choice-group";
  const portraitLegend = document.createElement("legend");
  portraitLegend.textContent = "四家角色";
  portraitGroup.append(portraitLegend);
  for (const [position, label] of Object.entries(portraitLabels)) {
    portraitGroup.append(
      createAppearanceSelect(
        label,
        `portrait:${position}`,
        catalog.portraits,
        pack.appearance.portraits[position],
      ),
    );
  }
  if (catalog.portraits.length) controls.append(portraitGroup);

  const surfaceGroup = document.createElement("fieldset");
  surfaceGroup.className = "settings-appearance-choice-group";
  const surfaceLegend = document.createElement("legend");
  surfaceLegend.textContent = "牌桌画面";
  surfaceGroup.append(surfaceLegend);
  const surfaces = [
    ["桌布", "tablecloth", catalog.tablecloths, pack.appearance.tablecloth],
    [
      "背景",
      "tableBackground",
      catalog.tableBackgrounds,
      pack.appearance.tableBackground,
    ],
    ["牌背", "tileBack", catalog.tileBacks, pack.appearance.tileBack],
  ];
  for (const [label, key, options, selected] of surfaces) {
    if (options.length)
      surfaceGroup.append(
        createAppearanceSelect(label, key, options, selected),
      );
  }
  if (surfaceGroup.childElementCount > 1) controls.append(surfaceGroup);
  if (catalog.lobbyBackgrounds.length) {
    const lobbyGroup = document.createElement("fieldset");
    lobbyGroup.className = "settings-appearance-choice-group";
    const lobbyLegend = document.createElement("legend");
    lobbyLegend.textContent = "大厅";
    lobbyGroup.append(lobbyLegend);
    lobbyGroup.append(
      createAppearanceSelect(
        "大厅背景",
        "lobbyBackground",
        catalog.lobbyBackgrounds,
        pack.appearance.lobbyBackground,
      ),
    );
    controls.append(lobbyGroup);
  }
  if (catalog.matchBgm.length || catalog.voices.length) {
    const soundGroup = document.createElement("fieldset");
    soundGroup.className = "settings-appearance-choice-group";
    const soundLegend = document.createElement("legend");
    soundLegend.textContent = "声音";
    soundGroup.append(soundLegend);
    if (catalog.matchBgm.length)
      soundGroup.append(
        createAppearanceSelect(
          "对局音乐",
          "matchBgm",
          catalog.matchBgm,
          pack.appearance.matchBgm,
          "不播放",
        ),
      );
    if (catalog.voices.length)
      soundGroup.append(
        createAppearanceSelect(
          "角色语音",
          "voice",
          [
            { id: "on", label: "播放" },
            { id: "off", label: "不播放" },
          ],
          pack.appearance.voice ? "on" : "off",
        ),
      );
    controls.append(soundGroup);
  }
  const hasControls = controls.childElementCount > 0;
  if (hasControls) {
    const heading = document.createElement("h3");
    heading.textContent = `当前主题包：${pack.name}`;
    appearanceElements.controls.replaceChildren(heading, controls);
  } else {
    appearanceElements.controls.replaceChildren(
      createAppearanceEmptyState("当前主题包没有可配置的装扮内容。"),
    );
  }
  appearanceElements.controls.hidden = false;
}

function createAppearanceEmptyState(message) {
  const empty = document.createElement("p");
  empty.className = "settings-appearance-empty";
  empty.textContent = message;
  return empty;
}

function getActiveVisualPack() {
  return visualPacks.find((candidate) => candidate.active) ||
    getMahjongDefaultPack();
}

function createAppearanceSelect(
  label,
  key,
  options,
  selected,
  emptyLabel = "",
) {
  const row = document.createElement("label");
  row.className = "settings-appearance-choice";
  const text = document.createElement("span");
  text.textContent = label;
  const select = document.createElement("select");
  select.dataset.appearanceKey = key;
  if (emptyLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    option.selected = !selected;
    select.append(option);
  }
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    element.selected = option.id === selected;
    select.append(element);
  }
  row.append(text, select);
  return row;
}

function createVisualPackButton(label, action, id = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.packAction = action;
  if (id) button.dataset.packId = id;
  button.textContent = label;
  return button;
}

async function initialize(matchType = "east") {
  if (playMode !== "solo" || game || gameInitializing) return;
  gameInitializing = true;
  syncMatchMusic({ start: true });
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
    await rerollMahjongAssetPackPortraits();
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
    await refresh(game.initialProjection, { animateDealIn: true });
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
  // A local save resumes straight to the table.  The setup screen is only an
  // entry point for a brand-new solo match (and future online flows).
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
    let projection = restored.initialProjection;
    let actions = save.actions;
    if (save.checkpoint) {
      try {
        const restoredCheckpoint = await restored.restoreCheckpoint(save.checkpoint);
        projection = restoredCheckpoint.projection;
        actions = save.actions.slice(save.checkpoint.actionIndex);
      } catch (checkpointError) {
        console.warn("Mahjong save checkpoint was unusable; replaying full log", checkpointError);
      }
    }
    for (const { action, actorId } of actions) {
      const outcome = await restored.action(action, actorId);
      if (!outcome.result?.accepted) {
        throw new Error(
          `saved action rejected: ${outcome.result?.error?.code || "unknown"}`,
        );
      }
      projection = outcome.projection;
    }
    await visualRendererReady;
    game = restored;
    await rerollMahjongAssetPackPortraits();
    if (save.playerName) playerName = save.playerName;
    autoActions = { ...save.autoActions };
    syncAutoActionControls();
    await refresh(projection);
    // Start BGM only after the restored game and its hand state are live.
    // Starting earlier can be overwritten by asset-pack initialization, and
    // a mid-hand restore has no hand-transition to start it again.
    syncMatchMusic({ start: true });
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    settingsDialog.setSoloMatchActive(true);
    scheduleAi();
  } catch (error) {
    console.error(error);
    restored?.close();
    clearSoloSave();
    showSetup();
    elements.loading.hidden = true;
  } finally {
    gameInitializing = false;
  }
}

async function persistAcceptedAction(action, actorId, projection, currentGame = game) {
  if (!soloSave) return;
  let next = appendMahjongSoloAction(soloSave, action, actorId);
  if (!next) return;
  if (projection?.state?.phase === "hand_ended" && currentGame) {
    try {
      const snapshot = await currentGame.checkpoint();
      next = setMahjongSoloCheckpoint(next, {
        formatVersion: MAHJONG_SOLO_CHECKPOINT_VERSION,
        actionIndex: next.actions.length,
        state: snapshot.state,
        events: snapshot.events,
        engineVersion: MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
        stateVersion: snapshot.version,
      }) || next;
    } catch (error) {
      console.warn("Mahjong save checkpoint failed; keeping the action log", error);
    }
  }
  soloSave = next;
  writeMahjongSoloSave(soloSave);
}

function defaultAutoActions() {
  return {
    autoWin: false,
    passClaims: false,
    autoTsumogiri: false,
  };
}

function toggleAutoAction(name) {
  autoActions = {
    ...autoActions,
    [name]: !autoActions[name],
  };
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
  const controls = [
    [elements.autoWin, autoActions.autoWin, "自动胡牌"],
    [elements.passClaims, autoActions.passClaims, "放弃鸣牌"],
    [elements.autoTsumogiri, autoActions.autoTsumogiri, "自动摸切"],
  ];
  for (const [button, enabled, label] of controls) {
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

function showSetup({ behindResult = false } = {}) {
  elements.setup.classList.remove("is-leaving");
  elements.setup.classList.toggle("is-prepared-for-result-exit", behindResult);
  for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
    button.disabled = false;
  }
  elements.setup.hidden = false;
}

async function endSoloMatch() {
  if (!game || gameInitializing || endingSoloMatch) return;
  endingSoloMatch = true;
  try {
    const confirmation = "结束本局并返回标题？本局进度不会保留。";
    const confirmed =
      isStandalone
        ? window.confirm(confirmation)
        : await playweftClient?.confirm(confirmation);
    if (!confirmed) return;
    window.clearTimeout(aiTimer);
    settingsDialog.setOpen(false, { restoreFocus: false, animate: false });
    presentation.suspend();
    game.close();
    game = undefined;
    state = undefined;
    visibleEvents = [];
    selectedTileId = 0;
    riichiMode = false;
    selectionBeforeRiichi = 0;
    resultPageIndex = 0;
    resultPageKey = "";
    resultPageAnimating = false;
    syncMatchMusic({ start: false });
    elements.result.hidden = true;
    elements.loading.hidden = true;
    showSetup();
    settingsDialog.setSoloMatchActive(false);
    clearSoloSave();
  } catch (error) {
    console.error("Unable to confirm ending the Mahjong match", error);
  } finally {
    endingSoloMatch = false;
  }
}

function beginSetupExit() {
  const signpost = elements.setup.querySelector(".setup-signpost");
  elements.setup.classList.add("is-leaving");
  elements.loading.classList.add("is-active");
  for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
    button.disabled = true;
  }
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

async function dispatch(action) {
  if (!state || actionInFlight) return;
  if (playMode === "room") {
    const requestId = playweftClient?.sendAction(action);
    if (!requestId) {
      elements.message.textContent = "尚未连接到房间";
      elements.message.classList.add("is-error");
      return;
    }
    window.clearTimeout(aiTimer);
    actionInFlight = true;
    roomActionRequestId = requestId;
    return;
  }
  if (!game) return;
  const currentGame = game;
  actionInFlight = true;
  window.clearTimeout(aiTimer);
  try {
    const outcome = await currentGame.action(action, HUMAN_ID);
    if (currentGame !== game) return;
    if (!outcome.result?.accepted) {
      elements.message.textContent = errorMessage(outcome.result?.error?.code);
      elements.message.classList.add("is-error");
      return;
    }
    await persistAcceptedAction(action, HUMAN_ID, outcome.projection, currentGame);
    if (action.type === "next_hand" || action.type === "new_match") {
      resetAutoActions();
    }
    riichiMode = false;
    selectionBeforeRiichi = 0;
    selectedTileId = 0;
    await refresh(outcome.projection, {
      ownDiscardedTile:
        action.type === "discard" || action.type === "riichi"
          ? Number(action.tileId) || 0
          : 0,
    });
    scheduleAi();
  } catch (error) {
    if (currentGame !== game) return;
    console.error("Mahjong action failed", error);
    elements.message.textContent = "动作处理失败，请重试";
    elements.message.classList.add("is-error");
  } finally {
    actionInFlight = false;
  }
}

async function runAiTurn() {
  if (
    playMode !== "solo" ||
    !game ||
    !state ||
    state.phase === "hand_ended" ||
    actionInFlight
  )
    return;
  const currentGame = game;
  const actorIds =
    state.phase === "claiming"
      ? state.players.slice(1)
      : (() => {
          const seat = activeSeat(state);
          return seat > 1 ? [state.players[seat - 1]] : [];
        })();
  if (!actorIds.length) return;
  actionInFlight = true;
  try {
    // Claim-response identity is deliberately hidden from the projection. The
    // worker probes the AI seats against its authoritative state atomically.
    const outcome = await currentGame.aiTurn(actorIds);
    if (currentGame !== game || !outcome.action) return;
    if (!outcome.result?.accepted) {
      console.error(
        "AI action rejected",
        outcome.actorId,
        outcome.action,
        outcome.result,
      );
      elements.message.textContent = "AI 动作未通过规则校验";
      elements.message.classList.add("is-error");
      return;
    }
    await persistAcceptedAction(
      outcome.action,
      outcome.actorId,
      outcome.projection,
      currentGame,
    );
    await refresh(outcome.projection);
    scheduleAi();
  } catch (error) {
    if (currentGame !== game) return;
    console.error("Mahjong AI worker failed", error);
    elements.message.textContent = "AI 思考失败，请刷新页面重试";
    elements.message.classList.add("is-error");
  } finally {
    actionInFlight = false;
  }
}

function scheduleAi({ afterDealIn = false } = {}) {
  window.clearTimeout(aiTimer);
  if (playMode !== "solo") return;
  if (!state || state.phase === "hand_ended" || presentation.kanDrawPending)
    return;
  const visualDelay = afterDealIn ? NEW_HAND_DEAL_DURATION_MS : 0;
  const autoAction = automaticMahjongAction(state, autoActions, { riichiMode });
  if (autoAction) {
    const isVisibleTileDecision = ["claim", "tsumo", "discard"].includes(
      autoAction.type,
    );
    aiTimer = window.setTimeout(
      () => {
        const currentAction = automaticMahjongAction(state, autoActions, {
          riichiMode,
        });
        if (sameMahjongAction(currentAction, autoAction))
          dispatch(currentAction);
      },
      isVisibleTileDecision
        ? Math.max(
            visualDelay,
            autoAction.type === "claim" ? 0 : OWN_DRAW_ENTRY_DURATION_MS,
          ) + AUTO_DECISION_DELAY_MS
        : 0,
    );
    return;
  }
  const automaticTile = automaticRiichiDiscard(state, HUMAN_ID);
  if (automaticTile) {
    aiTimer = window.setTimeout(
      () => {
        if (automaticRiichiDiscard(state, HUMAN_ID) === automaticTile) {
          dispatch({ type: "discard", tileId: automaticTile });
        }
      },
      Math.max(visualDelay, OWN_DRAW_ENTRY_DURATION_MS) +
        AUTO_DECISION_DELAY_MS,
    );
    return;
  }
  if (state.phase === "claiming") {
    aiTimer = window.setTimeout(runAiTurn, visualDelay + AI_DELAY_MS);
    return;
  }
  const seat = activeSeat(state);
  if (seat <= 1) return;
  aiTimer = window.setTimeout(runAiTurn, visualDelay + AI_DELAY_MS);
}

async function refresh(
  projection,
  { ownDiscardedTile = 0, animateDealIn = false } = {},
) {
  const currentGame = game;
  if (!projection && playMode === "solo") {
    projection = await currentGame?.view(HUMAN_ID);
  }
  if (!projection || (playMode === "solo" && currentGame !== game)) return;
  const previousState = state;
  state = projection.state;
  syncMatchMusicForHandState(previousState, state);
  if (riichiMode && !state.legalActions?.canRiichi) {
    riichiMode = false;
    selectionBeforeRiichi = 0;
  }
  const events = asArray(projection.events);
  visibleEvents = events;
  syncResultPage(state);
  playRoleVoices(events);
  queueKanDraw(events);
  queueHandInsertion(previousState, events, ownDiscardedTile);
  presentation.syncHandEnd(handEndPresentationPlan(state));
  renderCurrentState({ animateDealIn });
  playRiverTileSound(events);
}

function renderCurrentState({ animateDealIn = false } = {}) {
  const renderState = presentedState();
  const revealedPlayerIndices = handRevealPlayerIndices(state);
  const coveredPlayerIndices = handCoveredPlayerIndices(state);
  renderPresentationOverlays(renderState, { animateDealIn });
  visualRenderer.render(renderState, visibleEvents, {
    ...domView.visualUi(playerName, selectedTileId),
    dealInKey: animateDealIn ? handDealInKey(state) : "",
    animateDealIn,
    riichiMode,
    riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
    showGameHints: settingsDialog.gameHintsEnabled,
    revealPlayerIndices: revealedPlayerIndices,
    coveredPlayerIndices,
    handRevealKey: handEndPresentationKey(state),
    animateHandReveal:
      revealedPlayerIndices.length + coveredPlayerIndices.length > 0 &&
      !presentation.resultVisible,
    handRevealDelay: isExhaustiveDrawRevealState(state)
      ? AUTO_DECISION_DELAY_MS
      : 0,
    delayHandRevealForCallout: visibleEvents.some(
      (event) => event.type === "won",
    ),
    deferredHandInsertionSeat: Number(presentation.handInsertion?.seat) || 0,
    deferredHandInsertionIndex:
      Number(presentation.handInsertion?.rackIndex) || 0,
  });
}

function renderPresentationOverlays(
  renderState = presentedState(),
  { animateDealIn = false } = {},
) {
  if (!renderState) return;
  domView.render(renderState, visibleEvents, selectedTileId, playerName, {
    showResult: presentation.resultVisible,
    showGameHints: settingsDialog.gameHintsEnabled,
    showDrawReveal:
      isDrawRevealState(state) &&
      presentation.drawRevealVisible &&
      !presentation.resultVisible,
    resultPage: resultPageIndex,
    dealInKey: animateDealIn ? handDealInKey(state) : "",
    animateDealIn,
    riichiMode,
    defaultNames: getMahjongDefaultNames(),
    playerNameIsAuthoritative: hasPlatformName,
  });
  if (matchSummaryVisible) {
    resultHandRenderer.hide();
    renderMatchSummary();
  } else {
    resultHandRenderer.render(renderState, resultPageIndex, playerName, {
      defaultNames: getMahjongDefaultNames(),
      playerNameIsAuthoritative: hasPlatformName,
    });
  }
}

function renderResultExitTable(tableState) {
  // Keep the next hand's metadata visible beneath the fading result sheet,
  // but keep the table itself empty until the deal-in animation begins.
  const renderState = clearedTableState(tableState ?? state);
  visibleEvents = [];
  selectedTileId = 0;
  riichiMode = false;
  domView.render(
    { ...renderState, legalActions: {} },
    [],
    selectedTileId,
    playerName,
    {
      preserveResult: true,
      riichiMode,
      defaultNames: getMahjongDefaultNames(),
      playerNameIsAuthoritative: hasPlatformName,
    },
  );
  const staticState = { ...renderState, legalActions: {} };
  visualRenderer.render(staticState, [], {
    ...domView.visualUi(playerName, selectedTileId),
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
  });
}

function isResultBlankSpace(target) {
  return (
    target === elements.result ||
    target === elements.resultStage ||
    target === elements.resultTrack ||
    target === elements.resultDetailContent ||
    target === elements.resultScoreContent
  );
}

async function continueResult() {
  if (
    resultPageAnimating ||
    state?.phase !== "hand_ended" ||
    elements.result.hidden
  ) {
    return;
  }
  const detailCount = resultDetailPageCount(state);
  resultPageAnimating = true;
  elements.rematch.disabled = true;
  try {
    if (resultPageIndex < detailCount) {
      const outgoing = elements.resultDetailContent.cloneNode(true);
      copyCanvasBitmaps(elements.resultDetailContent, outgoing);
      for (const node of [outgoing, ...outgoing.querySelectorAll("[id]")]) {
        node.removeAttribute("id");
      }
      outgoing.classList.add("is-step-previous");
      outgoing.setAttribute("aria-hidden", "true");
      elements.resultTrack.prepend(outgoing);
      resultPageIndex += 1;
      const defaultNames = getMahjongDefaultNames();
      domView.renderResult(state, playerName, true, resultPageIndex, {
        defaultNames,
        playerNameIsAuthoritative: hasPlatformName,
      });
      resultHandRenderer.render(state, resultPageIndex, playerName, {
        defaultNames,
        playerNameIsAuthoritative: hasPlatformName,
      });
      void elements.resultTrack.offsetWidth;
      elements.resultTrack.classList.add("is-step-advancing");
      await waitForAnimation(
        elements.resultTrack,
        "result-page-step",
        RESULT_PAGE_TRANSITION_MS,
      );
      return;
    }

    if (state.matchEnded) {
      showMatchSummary();
      return;
    }

    primeMatchMusicForNextHand();
    const advanced = await advanceFromResult({ type: "next_hand" });
    if (!advanced && state?.phase === "hand_ended") syncMatchMusic();
  } finally {
    resultPageAnimating = false;
    elements.rematch.disabled = false;
    resetResultPageTrack();
    if (state?.phase === "hand_ended") {
      elements.result.classList.remove("is-exiting");
    }
  }
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

function syncResultPage(current) {
  const key =
    current?.phase === "hand_ended"
      ? [
          current.roundWind,
          current.handNumber,
          current.moveCount,
          current.winType || "draw",
          ...asArray(current.winners),
        ].join(":")
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
  elements.matchSummarySetup.hidden = playMode === "room";
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
  const rows = matchResultRows(state, playerName, {
    defaultNames: getMahjongDefaultNames(),
    playerNameIsAuthoritative: hasPlatformName,
  });
  const winner = rows[0];
  if (!winner) return;
  elements.matchSummaryRows.replaceChildren(
    ...rows.map((entry) => {
      const row = document.createElement("tr");
      for (const value of [
        `${entry.rank}位`,
        entry.name,
        String(entry.score),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
  renderMatchSummaryPortrait(winner.seat);
}

function renderMatchSummaryPortrait(seat) {
  const index = Number(seat) - 1;
  const position = MATCH_SUMMARY_POSITIONS[index] || "bottom";
  const stationImage = elements.stations[position]?.querySelector(
    "[data-player-avatar]",
  );
  const source = stationImage?.dataset.source || "";
  const crop = elements.matchSummaryPhotoCrop;
  const image = elements.matchSummaryPhotoImage;
  crop.style.setProperty(
    "--match-summary-portrait-position",
    MATCH_SUMMARY_PORTRAIT_POSITIONS[index] || "0% 0%",
  );
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

async function restartMatchFromSummary() {
  if (!matchSummaryVisible || !state?.matchEnded || resultPageAnimating) return;
  resultPageAnimating = true;
  elements.matchSummaryRematch.disabled = true;
  elements.matchSummarySetup.disabled = true;
  try {
    primeMatchMusicForNextHand();
    const advanced = await advanceFromResult({ type: "new_match" });
    if (!advanced && state?.phase === "hand_ended") syncMatchMusic();
  } finally {
    resultPageAnimating = false;
    elements.matchSummaryRematch.disabled = false;
    elements.matchSummarySetup.disabled = false;
    resetResultPageTrack();
    if (state?.phase === "hand_ended") {
      elements.result.classList.remove("is-exiting");
    }
  }
}

async function returnToSetupFromSummary() {
  if (
    playMode !== "solo" ||
    !matchSummaryVisible ||
    !state?.matchEnded ||
    resultPageAnimating
  )
    return;
  resultPageAnimating = true;
  elements.matchSummaryRematch.disabled = true;
  elements.matchSummarySetup.disabled = true;
  try {
    // Keep the completed-match sheet on top while the lobby is made ready
    // directly underneath it.  The exit fade therefore reveals the lobby,
    // never an intermediate table frame.
    showSetup({ behindResult: true });
    elements.result.classList.add("is-exiting");
    await waitForAnimation(
      elements.result,
      "result-screen-exit",
      RESULT_EXIT_DURATION_MS,
    );
    hideMatchSummary();
    window.clearTimeout(aiTimer);
    presentation.suspend();
    game?.close();
    game = undefined;
    state = undefined;
    visibleEvents = [];
    selectedTileId = 0;
    riichiMode = false;
    selectionBeforeRiichi = 0;
    resultPageIndex = 0;
    resultPageKey = "";
    syncMatchMusic({ start: false });
    elements.result.hidden = true;
    elements.loading.hidden = true;
    showSetup();
    settingsDialog.setSoloMatchActive(false);
    clearSoloSave();
  } finally {
    resultPageAnimating = false;
    elements.matchSummaryRematch.disabled = false;
    elements.matchSummarySetup.disabled = false;
    resetResultPageTrack();
    elements.result.classList.remove("is-exiting");
  }
}

async function advanceFromResult(action) {
  if (playMode === "room") {
    if (!state || actionInFlight) return false;
    await dispatch(action);
    return actionInFlight;
  }
  const currentGame = game;
  if (!currentGame || !state) return false;
  const outcome = await currentGame.action(action, HUMAN_ID);
  if (currentGame !== game) return false;
  if (!outcome.result?.accepted) {
    elements.message.textContent = errorMessage(outcome.result?.error?.code);
    elements.message.classList.add("is-error");
    return false;
  }
  await persistAcceptedAction(action, HUMAN_ID, outcome.projection, currentGame);
  resetAutoActions();
  riichiMode = false;
  selectionBeforeRiichi = 0;
  selectedTileId = 0;
  renderResultExitTable(outcome.projection?.state);
  elements.result.classList.add("is-exiting");
  await waitForAnimation(
    elements.result,
    "result-screen-exit",
    RESULT_EXIT_DURATION_MS,
  );
  hideMatchSummary();
  elements.result.hidden = true;
  elements.result.classList.remove("is-exiting");
  await waitForDelay(NEW_HAND_TABLE_PAUSE_MS);
  visualRenderer.prepareDealIn();
  if (action.type === "new_match") {
    await rerollMahjongAssetPackPortraits();
  }
  await refresh(outcome.projection, { animateDealIn: true });
  scheduleAi({ afterDealIn: true });
  return true;
}

function waitForDelay(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function resetResultPageTrack() {
  const { resultTrack } = elements;
  resultTrack.classList.add("is-step-resetting");
  resultTrack
    .querySelectorAll(".is-step-previous")
    .forEach((page) => page.remove());
  resultTrack.classList.remove("is-step-advancing");
  void resultTrack.offsetWidth;
  resultTrack.classList.remove("is-step-resetting");
}

function waitForAnimation(element, animationName, duration) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      element.removeEventListener("animationend", handleAnimationEnd);
      window.clearTimeout(fallbackTimer);
      resolve();
    };
    const handleAnimationEnd = (event) => {
      if (event.target === element && event.animationName === animationName) {
        finish();
      }
    };
    const fallbackTimer = window.setTimeout(finish, duration + 100);
    element.addEventListener("animationend", handleAnimationEnd);
  });
}

function presentedState() {
  let presented = state;
  if (presentation.kanDrawPending) {
    presented = {
      ...presented,
      drawnTile: 0,
      drawnPlayerIndex: 0,
      legalActions: {},
    };
  }
  if (Number(presentation.handInsertion?.seat) !== 1) return presented;
  return {
    ...presented,
    ownHand: presentation.handInsertion.ownHand,
    drawnTile: presentation.handInsertion.drawnTile,
  };
}

function queueKanDraw(events) {
  const kan = asArray(events).find(
    (event) =>
      event?.type === "claimed" &&
      ["kan", "ankan", "kakan"].includes(event.kind),
  );
  if (!kan) return;
  const draw = asArray(events).find(
    (event) =>
      event?.type === "drew" &&
      Number(event.playerIndex) === Number(kan.playerIndex),
  );
  if (!draw) return;
  const eventKey = [
    Number(state?.roundWind) || 0,
    Number(state?.handNumber) || 0,
    Number(state?.honba) || 0,
    Number(state?.moveCount) || 0,
    kan.kind,
    Number(kan.playerIndex) || 0,
  ].join(":");
  presentation.scheduleKanDraw(eventKey, KAN_DRAW_PAUSE_MS);
}

function queueHandInsertion(previousState, events, ownDiscardedTile = 0) {
  // A last hand-cut discard can end the hand while its delayed rack insertion
  // is still pending. Do not let that timer rebuild the presented hands and
  // restart their reveal/cover animation partway through.
  if (state?.phase === "hand_ended") {
    presentation.cancelHandInsertion();
    return;
  }
  const discard = asArray(events).find(
    (event) =>
      (event?.type === "discarded" || event?.type === "riichi") &&
      typeof event.fromDrawn === "boolean",
  );
  if (!discard) return;
  const eventKey = [
    Number(state?.roundWind) || 0,
    Number(state?.handNumber) || 0,
    Number(state?.honba) || 0,
    Number(state?.moveCount) || 0,
    discard.type,
    Number(discard.playerIndex) || 0,
    Number(discard.tile) || 0,
    String(discard.fromDrawn),
  ].join(":");
  const insertion = deferredHandInsertion(previousState, events, {
    ownDiscardedTile,
  });
  presentation.scheduleHandInsertion(
    eventKey,
    insertion,
    HAND_INSERTION_DELAY_MS,
  );
}

function handEndPresentationKey(current) {
  if (current?.phase !== "hand_ended") return "";
  if (current.result?.abortive === true) {
    return `${current.moveCount}:abortive-draw:${current.abortiveReason || current.result.reason || "unknown"}`;
  }
  if (
    current.abortiveReason === "九种九牌" &&
    Number(current.abortivePlayerIndex) > 0
  ) {
    return `${current.moveCount}:nine-terminals:${current.abortivePlayerIndex}`;
  }
  const exhaustive = exhaustiveDrawPresentation(current);
  if (exhaustive.revealed.length + exhaustive.covered.length > 0) {
    return `${current.moveCount}:exhaustive-draw`;
  }
  if (current.winType === "nagashi") {
    return `${current.moveCount}:nagashi:${asArray(current.winners).join(",")}`;
  }
  if (current.draw) return "";
  const winners = asArray(current.winners);
  if (!winners.length) return "";
  return `${current.moveCount}:${current.winType}:${winners.join(",")}`;
}

function handDealInKey(current) {
  if (!current || current.phase === "hand_ended") return "";
  return [
    Number(current.roundWind) || 0,
    Number(current.handNumber) || 0,
    Number(current.honba) || 0,
    Number(current.moveCount) || 0,
  ].join(":");
}

function isDrawRevealState(current) {
  return (
    current?.phase === "hand_ended" &&
    (current.winType === "nagashi" ||
      (current.draw === true &&
        (current.result?.abortive === true ||
          isExhaustiveDrawRevealState(current))))
  );
}

function isExhaustiveDrawRevealState(current) {
  return (
    current?.phase === "hand_ended" &&
    current.draw === true &&
    current.result?.abortive !== true &&
    Array.isArray(current.result?.tenpai)
  );
}

function handEndPresentationPlan(current) {
  const key = handEndPresentationKey(current);
  if (!key) return null;
  const showDrawReveal = isDrawRevealState(current);
  const handMotionCount =
    handRevealPlayerIndices(current).length +
    handCoveredPlayerIndices(current).length;
  const waitForHandReveal = showDrawReveal && handMotionCount > 0;
  return {
    key,
    waitForHandReveal,
    showDrawReveal,
    drawRevealDelay: waitForHandReveal
      ? DRAW_REVEAL_CARD_GAP_MS
      : DRAW_REVEAL_CARD_DELAY_MS,
    drawRevealDuration: showDrawReveal ? drawRevealVisibleDuration(current) : 0,
    resultDelay: HAND_END_PRESENTATION_DELAY_MS,
  };
}

function drawRevealVisibleDuration(current) {
  const tenpaiPlayerCount = asArray(current?.result?.tenpaiWaits).filter(
    (waits) => asArray(waits).length > 0,
  ).length;
  return (
    DRAW_REVEAL_VISIBLE_BASE_MS +
    DRAW_REVEAL_VISIBLE_EXTENSION_MS +
    tenpaiPlayerCount * DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS
  );
}

function handRevealPlayerIndices(current) {
  if (current?.winType === "nagashi") return [];
  const exhaustive = exhaustiveDrawPresentation(current);
  if (exhaustive.revealed.length + exhaustive.covered.length > 0) {
    return exhaustive.revealed;
  }
  if (current?.abortiveReason === "九种九牌") {
    const seat = Number(current.abortivePlayerIndex) || 0;
    return seat > 0 ? [seat] : [];
  }
  return asArray(current?.winners)
    .map((id) => asArray(current.players).indexOf(id) + 1)
    .filter((seat) => seat > 0);
}

function handCoveredPlayerIndices(current) {
  const exhaustive = exhaustiveDrawPresentation(current);
  if (exhaustive.revealed.length + exhaustive.covered.length > 0) {
    return exhaustive.covered;
  }
  return [];
}

function selectTile(tileId) {
  const renderState = presentedState();
  const selectableTiles = orderedOwnTiles(renderState);
  if (
    !selectableTiles.includes(Number(tileId)) ||
    state?.phase === "hand_ended"
  )
    return;
  if (
    riichiMode &&
    !asArray(state?.legalActions?.riichiTiles).includes(Number(tileId))
  )
    return;
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
  const ui = domView.renderSelection(renderState, selectedTileId, playerName, {
    riichiMode,
    showGameHints: settingsDialog.gameHintsEnabled,
  });
  visualRenderer.updateSelection({
    ...ui,
    riichiMode,
    riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
    showGameHints: settingsDialog.gameHintsEnabled,
    deferredHandInsertionSeat: Number(presentation.handInsertion?.seat) || 0,
    deferredHandInsertionIndex:
      Number(presentation.handInsertion?.rackIndex) || 0,
  });
}

function orderedOwnTiles(current) {
  return [
    ...asArray(current?.ownHand).map(Number),
    ...(Number(current?.drawnTile) > 0 ? [Number(current.drawnTile)] : []),
  ];
}

function discardSelected() {
  if (!selectedTileId || !state?.legalActions?.canDiscard) return;
  if (riichiMode) {
    if (!asArray(state.legalActions.riichiTiles).includes(selectedTileId))
      return;
    dispatch({ type: "riichi", tileId: selectedTileId });
    return;
  }
  dispatch({ type: "discard", tileId: selectedTileId });
}

function discardOwnTile(tileId) {
  if (
    !canDiscardHandTile({
      canDiscard: state?.legalActions?.canDiscard,
      riichiDeclared: state?.riichi?.[state?.players?.[0]] === true,
      drawnTile: state?.drawnTile,
      tileId,
    })
  )
    return;
  selectedTileId = Number(tileId) || 0;
  discardSelected();
}

function enterRiichiMode() {
  if (
    !state?.legalActions?.canRiichi ||
    !asArray(state.legalActions.riichiTiles).length
  )
    return;
  selectionBeforeRiichi = selectedTileId;
  selectedTileId = 0;
  riichiMode = true;
  renderCurrentState();
}

function cancelRiichiMode() {
  if (!riichiMode) return;
  riichiMode = false;
  selectedTileId = orderedOwnTiles(presentedState()).includes(
    selectionBeforeRiichi,
  )
    ? selectionBeforeRiichi
    : 0;
  selectionBeforeRiichi = 0;
  renderCurrentState();
}

function handlePageHide(event) {
  matchMusicController.suspend();
  riverTileSound.pause();
  window.clearTimeout(aiTimer);
  presentation.suspend();
  if (!event.persisted) destroy();
}

function handlePageShow(event) {
  if (event.persisted) resumeAfterSuspension();
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    matchMusicController.suspend();
    riverTileSound.pause();
    window.clearTimeout(aiTimer);
    presentation.suspend();
    return;
  }
  resumeAfterSuspension();
}

function resumeAfterSuspension() {
  if (destroyed) return;
  syncMatchMusic();
  visualRenderer.resume();
  resultHandRenderer.resume();
  window.requestAnimationFrame(() => {
    if (destroyed) return;
    if (state?.phase === "hand_ended") {
      refresh();
      return;
    }
    renderCurrentState();
    visualRenderer.resume();
    scheduleAi();
  });
}

function destroy() {
  if (destroyed) return;
  destroyed = true;
  window.clearTimeout(aiTimer);
  presentation.destroy();
  matchMusicController.stop();
  riverTileSound.pause();
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
