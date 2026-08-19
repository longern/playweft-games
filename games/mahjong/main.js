import { createLocalLuaGame } from "../../src/local-lua-game.js";
import { createPlayweftSoloClient } from "../../src/playweft-solo-client.js";
import { Cog, X, createIcons } from "lucide";
import {
  AI_DELAY_MS,
  AUTO_RIICHI_DISCARD_DELAY_MS,
  HAND_INSERTION_DELAY_MS,
  HAND_END_PRESENTATION_DELAY_MS,
  HUMAN_ID,
  PLAYERS,
} from "./constants.js";
import { MahjongDomView } from "./dom-view.js";
import { bindFixedViewport } from "./fixed-viewport.js";
import {
  activeSeat,
  asArray,
  automaticRiichiDiscard,
  blankDoubleClickAction,
  deferredHandInsertion,
  errorMessage,
  exhaustiveDrawPresentation,
  resultDetailPageCount,
} from "./game-format.js";
import { MahjongThreeRenderer } from "./three-renderer.js";
import { MahjongResultHandRenderer } from "./result-hand-renderer.js";
import { MahjongPresentationController } from "./presentation-controller.js";
import { createMahjongSettingsDialog } from "./settings-dialog.js";
import discardSoundSource from "./assets/audio/discard-sound.js";
import { riverTileSoundCue } from "./render/audio-cues.js";
import {
  activateMahjongAssetPack,
  configureMahjongAssetPackAppearance,
  createMahjongAssetPack,
  deleteMahjongAssetPack,
  deactivateMahjongAssetPacks,
  getMahjongAssetUrl,
  getMahjongDefaultNames,
  getMahjongMatchMusicUrl,
  initializeMahjongAssetPacks,
  listMahjongAssetPacks,
  MAHJONG_YAKU_VOICE_KEYS,
} from "./asset-packs.js";
import {
  DEFAULT_MATCH_MUSIC_COPYRIGHT,
  DEFAULT_MATCH_MUSIC_URL,
  DEFAULT_MATCH_MUSIC_VOLUME,
} from "./media-config.js";
import {
  appendMahjongSoloAction,
  clearMahjongSoloSave,
  createMahjongSoloSave,
  readMahjongSoloSave,
  writeMahjongSoloSave,
} from "./solo-save.js";
import { mahjongInitialEntry } from "./entry-flow.js";
import "../../src/base.css";
import "./styles.css";

const THEME_JSON_EXAMPLE = {
  schemaVersion: 1,
  name: "月下雀席",
  assets: {
    portraits: [
      { id: "fox", file: "portraits/fox.webp", label: "赤狐" },
      { id: "wolf", file: "portraits/wolf.webp", label: "灰狼" },
      { id: "leopard", file: "portraits/leopard.webp", label: "雪豹" },
    ],
    tablecloths: [
      { id: "felt", file: "table/felt.webp", label: "深绿绒面" },
      { id: "brocade", file: "table/brocade.webp", label: "锦缎" },
    ],
    backgrounds: [
      { id: "night", file: "backgrounds/night.webp", label: "夜景" },
    ],
    lobby: [{ id: "evening", file: "lobby/evening.webp", label: "暮色街巷" }],
    tileBacks: [{ id: "cloud", file: "tiles/cloud.webp", label: "祥云" }],
    music: [{ id: "night-wind", file: "music/night-wind.ogg", label: "夜风" }],
    voices: [
      {
        character: "fox",
        lines: {
          chi: "voices/fox/chi.ogg",
          pon: "voices/fox/pon.ogg",
          kan: "voices/fox/kan.ogg",
          riichi: "voices/fox/riichi.ogg",
          ron: "voices/fox/ron.ogg",
          tsumo: "voices/fox/tsumo.ogg",
        },
        yaku: {
          tanyao: "voices/fox/tanyao.ogg",
          iipeikou: "voices/fox/iipeikou.ogg",
        },
      },
    ],
  },
  defaults: {
    appearance: {
      portraits: {
        self: "fox",
        right: "wolf",
        opposite: "leopard",
        left: "fox",
      },
      tablecloth: "felt",
      background: "night",
      lobby: "evening",
      tileBack: "cloud",
      music: "night-wind",
      voice: true,
    },
    names: {
      self: "我",
      right: "右家",
      opposite: "对家",
      left: "左家",
    },
  },
};

createIcons({ icons: { Cog, X } });

document.querySelector("#theme-json-example").textContent = JSON.stringify(
  THEME_JSON_EXAMPLE,
  null,
  2,
);

let game;
let gameInitializing = false;
let state;
let resultPageIndex = 0;
let resultPageKey = "";
let resultPageAnimating = false;
let selectedTileId = 0;
let riichiMode = false;
let selectionBeforeRiichi = 0;
let aiTimer;
let visibleEvents = [];
let playerName = "你";
let hasPlatformName = false;
let destroyed = false;
let hasPlatformAvatar = false;
const MATCH_MUSIC_FADE_DURATION_MS = 800;
const SETUP_EXIT_DURATION_MS = 560;
const RESULT_PAGE_TRANSITION_MS = 260;
const RESULT_EXIT_DURATION_MS = 320;
const matchMusic = new Audio();
matchMusic.loop = true;
matchMusic.preload = "metadata";
matchMusic.volume = DEFAULT_MATCH_MUSIC_VOLUME;
const defaultMusicCopyright = document.querySelector("#default-bgm-copyright");
defaultMusicCopyright.textContent = DEFAULT_MATCH_MUSIC_COPYRIGHT;
defaultMusicCopyright.hidden = !DEFAULT_MATCH_MUSIC_COPYRIGHT;
const riverTileSound = new Audio(discardSoundSource);
riverTileSound.preload = "auto";
let musicNeedsGesture = false;
let matchMusicFadeFrame = 0;
let matchMusicGain = 1;
let matchMusicPlayRequest = 0;
let voicedEventKey = "";
let playedRiverTileSoundKey = "";
let soloSave = readMahjongSoloSave();
let playMode = window.parent === window ? "solo" : null;

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
  onDiscardTile(tileId) {
    if (!state?.legalActions?.canDiscard) return;
    selectedTileId = tileId;
    discardSelected();
  },
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
  doubleClickTsumogiri: elements.doubleClickTsumogiri,
  doubleClickPass: elements.doubleClickPass,
  discardVolume: elements.riverTileVolume,
  discardVolumeValue: elements.riverTileVolumeValue,
  musicVolume: elements.musicVolume,
  musicVolumeValue: elements.musicVolumeValue,
  onMusicVolumeChange() {
    applyMatchMusicVolume();
  },
  onEndMatch() {
    endSoloMatch();
  },
});
applyMatchMusicVolume();
const visualRenderer = new MahjongThreeRenderer(elements.stage, {
  onSelectTile: selectTile,
  onClearSelection: clearSelectedTile,
  onPreviewDragTile: previewDraggedTile,
  onEndDragPreview: restoreSelectedTilePreview,
  onDiscardTile(tileId) {
    if (!state?.legalActions?.canDiscard) return;
    selectedTileId = tileId;
    discardSelected();
  },
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
  elements.resultContent,
  {
    handsHost: elements.resultHands,
    yakuHost: elements.resultYaku,
  },
);
const presentation = new MahjongPresentationController({
  onHandInsertionReady: renderCurrentState,
  onResultReady: refresh,
});
const visualRendererReady = visualRenderer.init().catch((error) => {
  console.error("Mahjong renderer failed", error);
  showLoadingError("图形渲染器加载失败，请刷新页面重试");
});
const resultHandRendererReady = resultHandRenderer.init().catch((error) => {
  console.error("Mahjong result hand renderer failed", error);
});
const visualPackElements = {
  upload: document.querySelector("#settings-pack-upload"),
  feedback: document.querySelector("#settings-pack-feedback"),
  list: document.querySelector("#settings-pack-list"),
  appearance: document.querySelector("#settings-pack-appearance"),
};
const DEFAULT_VISUAL_PACK_ID = "__default__";
let visualPacks = [];
const assetPacksReady = initializeMahjongAssetPacks().catch(() => new Map());

void Promise.all([
  visualRendererReady,
  resultHandRendererReady,
  assetPacksReady,
]).then(() => applyVisualPack());
void refreshVisualPacks();
visualPackElements.upload.addEventListener("change", async () => {
  const archive = visualPackElements.upload.files?.[0];
  visualPackElements.upload.value = "";
  if (!archive) return;
  visualPackElements.feedback.textContent = "正在保存素材包…";
  try {
    visualPacks = await createMahjongAssetPack(archive);
    renderVisualPacks();
    visualPackElements.feedback.textContent = "已导入并启用素材包。";
  } catch (error) {
    visualPackElements.feedback.textContent =
      error instanceof Error ? error.message : "导入素材包失败";
  }
});
visualPackElements.list.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const id = button?.dataset.packId;
  const action = button?.dataset.packAction;
  if (!id || !action) return;
  if (
    action === "delete" &&
    !window.confirm("删除这个麻将素材包？此操作无法恢复。")
  )
    return;
  visualPackElements.feedback.textContent =
    action === "delete" ? "正在删除…" : "正在切换…";
  try {
    visualPacks =
      action === "delete"
        ? await deleteMahjongAssetPack(id)
        : id === DEFAULT_VISUAL_PACK_ID
          ? await deactivateMahjongAssetPacks()
          : await activateMahjongAssetPack(id);
    renderVisualPacks();
    visualPackElements.feedback.textContent =
      action === "delete"
        ? "已删除素材包。"
        : id === DEFAULT_VISUAL_PACK_ID
          ? "已切回默认画面。"
          : "已启用素材包。";
  } catch {
    visualPackElements.feedback.textContent =
      action === "delete" ? "删除素材包失败" : "切换素材包失败";
  }
});
visualPackElements.appearance.addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-appearance-key]");
  const activePack = visualPacks.find((pack) => pack.active);
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
  visualPackElements.feedback.textContent = "正在应用画面配置…";
  try {
    visualPacks = await configureMahjongAssetPackAppearance(
      activePack.id,
      appearance,
    );
    renderVisualPacks();
    visualPackElements.feedback.textContent = "已应用画面配置。";
  } catch (error) {
    visualPackElements.feedback.textContent =
      error instanceof Error ? error.message : "画面配置失败";
  }
});
window.addEventListener("mahjong:asset-pack-changed", () => {
  void applyVisualPack();
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
for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
  button.addEventListener(
    "click",
    () => void initialize(button.dataset.matchType),
  );
}
window.addEventListener("pagehide", handlePageHide);
window.addEventListener("pageshow", handlePageShow);
document.addEventListener("visibilitychange", handleVisibilityChange);

const soloClient = createPlayweftSoloClient({
  onReady(context) {
    playMode = context?.mode ?? "solo";
    const name = context?.player?.name?.trim();
    if (name) {
      playerName = name;
      hasPlatformName = true;
    }
    requestPlatformAvatar(context);
    startMahjongEntry();
  },
  onError(message) {
    if (!game) showLoadingError(message);
  },
});

if (window.parent === window) startMahjongEntry();
revealMahjongAppAfterStyles();

function requestPlatformAvatar(context) {
  const initialSource = context?.player?.avatar?.src;
  if (typeof initialSource === "string" && initialSource) {
    hasPlatformAvatar = true;
    domView.setPlayerAvatar("bottom", initialSource);
  } else {
    applyPackAvatars(state);
  }
  if (!asArray(context?.capabilities).includes("user.getProfile")) return;
  void soloClient
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
  matchMusic.volume = Math.min(
    1,
    Math.max(0, settingsDialog.musicVolumeScale * matchMusicGain),
  );
}

function setMatchMusicGain(gain) {
  matchMusicGain = Math.min(1, Math.max(0, gain));
  applyMatchMusicVolume();
}

function cancelMatchMusicFade() {
  if (matchMusicFadeFrame) cancelAnimationFrame(matchMusicFadeFrame);
  matchMusicFadeFrame = 0;
}

function fadeMatchMusicTo(targetGain, { pauseWhenSilent = false } = {}) {
  cancelMatchMusicFade();
  const initialGain = matchMusicGain;
  if (initialGain === targetGain) {
    if (pauseWhenSilent && targetGain === 0) matchMusic.pause();
    return;
  }
  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(
      1,
      (now - startedAt) / MATCH_MUSIC_FADE_DURATION_MS,
    );
    const easedProgress = progress * progress * (3 - 2 * progress);
    setMatchMusicGain(initialGain + (targetGain - initialGain) * easedProgress);
    if (progress < 1) {
      matchMusicFadeFrame = requestAnimationFrame(step);
      return;
    }
    matchMusicFadeFrame = 0;
    if (pauseWhenSilent && targetGain === 0) matchMusic.pause();
  };
  matchMusicFadeFrame = requestAnimationFrame(step);
}

function syncMatchMusic({ start = Boolean(game), fadeIn = false } = {}) {
  const source = getMahjongMatchMusicUrl(DEFAULT_MATCH_MUSIC_URL);
  if (!start || !source) {
    matchMusicPlayRequest += 1;
    cancelMatchMusicFade();
    matchMusic.pause();
    matchMusic.removeAttribute("src");
    matchMusic.load();
    setMatchMusicGain(1);
    musicNeedsGesture = false;
    return;
  }
  const resolvedSource = new URL(source, document.baseURI).href;
  if (matchMusic.src !== resolvedSource) {
    cancelMatchMusicFade();
    matchMusic.pause();
    matchMusic.src = resolvedSource;
  }
  if (state?.phase === "hand_ended") {
    matchMusicPlayRequest += 1;
    cancelMatchMusicFade();
    setMatchMusicGain(0);
    matchMusic.pause();
    musicNeedsGesture = false;
    return;
  }
  cancelMatchMusicFade();
  setMatchMusicGain(fadeIn ? 0 : 1);
  const playRequest = ++matchMusicPlayRequest;
  void matchMusic.play().then(
    () => {
      if (playRequest !== matchMusicPlayRequest) return;
      musicNeedsGesture = false;
      if (fadeIn) fadeMatchMusicTo(1);
    },
    (error) => {
      if (playRequest !== matchMusicPlayRequest) return;
      musicNeedsGesture = error?.name === "NotAllowedError";
    },
  );
}

function resumeMatchMusic() {
  if (musicNeedsGesture) syncMatchMusic({ fadeIn: matchMusicGain === 0 });
}

function syncMatchMusicForHandState(previousState, currentState) {
  const handWasEnded = previousState?.phase === "hand_ended";
  const handIsEnded = currentState?.phase === "hand_ended";
  if (!handWasEnded && handIsEnded) {
    matchMusicPlayRequest += 1;
    fadeMatchMusicTo(0, { pauseWhenSilent: true });
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

async function refreshVisualPacks() {
  try {
    await assetPacksReady;
    visualPacks = await listMahjongAssetPacks();
    renderVisualPacks();
  } catch {
    visualPackElements.feedback.textContent = "当前浏览器未开放本机素材存储。";
  }
}

function renderVisualPacks() {
  const packs = [
    {
      id: DEFAULT_VISUAL_PACK_ID,
      name: "默认主题",
      assetNames: ["内置画面"],
      active: !visualPacks.some((pack) => pack.active),
      isDefault: true,
    },
    ...visualPacks,
  ];
  visualPackElements.list.replaceChildren(
    ...packs.map((pack) => {
      const item = document.createElement("li");
      item.classList.toggle("is-active", pack.active);
      const details = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = pack.name;
      const summary = document.createElement("small");
      summary.textContent = pack.assetNames.join(" · ");
      details.append(title, summary);
      const actions = document.createElement("span");
      actions.className = "settings-pack-actions";
      if (pack.active) {
        const active = document.createElement("em");
        active.textContent = "使用中";
        actions.append(active);
      } else {
        actions.append(createVisualPackButton("启用", "activate", pack.id));
      }
      if (!pack.isDefault) {
        actions.append(createVisualPackButton("删除", "delete", pack.id));
      }
      item.append(details, actions);
      return item;
    }),
  );
  renderVisualPackAppearance();
}

function renderVisualPackAppearance() {
  const pack = visualPacks.find((candidate) => candidate.active);
  const catalog = pack?.catalog;
  if (!pack || !catalog) {
    visualPackElements.appearance.hidden = true;
    visualPackElements.appearance.replaceChildren();
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
  portraitGroup.className = "settings-pack-choice-group";
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
  surfaceGroup.className = "settings-pack-choice-group";
  const surfaceLegend = document.createElement("legend");
  surfaceLegend.textContent = "牌桌画面";
  surfaceGroup.append(surfaceLegend);
  const surfaces = [
    ["桌布", "tablecloth", catalog.tablecloths, pack.appearance.tablecloth],
    ["背景", "background", catalog.backgrounds, pack.appearance.background],
    ["牌背", "tileBack", catalog.tileBacks, pack.appearance.tileBack],
  ];
  for (const [label, key, options, selected] of surfaces) {
    if (options.length)
      surfaceGroup.append(
        createAppearanceSelect(label, key, options, selected),
      );
  }
  if (surfaceGroup.childElementCount > 1) controls.append(surfaceGroup);
  if (catalog.lobby.length) {
    const lobbyGroup = document.createElement("fieldset");
    lobbyGroup.className = "settings-pack-choice-group";
    const lobbyLegend = document.createElement("legend");
    lobbyLegend.textContent = "大厅";
    lobbyGroup.append(lobbyLegend);
    lobbyGroup.append(
      createAppearanceSelect(
        "大厅背景",
        "lobby",
        catalog.lobby,
        pack.appearance.lobby,
      ),
    );
    controls.append(lobbyGroup);
  }
  if (catalog.music.length || catalog.voices.length) {
    const soundGroup = document.createElement("fieldset");
    soundGroup.className = "settings-pack-choice-group";
    const soundLegend = document.createElement("legend");
    soundLegend.textContent = "声音";
    soundGroup.append(soundLegend);
    if (catalog.music.length)
      soundGroup.append(
        createAppearanceSelect(
          "对局音乐",
          "music",
          catalog.music,
          pack.appearance.music,
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
  visualPackElements.appearance.replaceChildren(controls);
  visualPackElements.appearance.hidden =
    !visualPackElements.appearance.childElementCount;
}

function createAppearanceSelect(
  label,
  key,
  options,
  selected,
  emptyLabel = "",
) {
  const row = document.createElement("label");
  row.className = "settings-pack-choice";
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
  if (game || gameInitializing) return;
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
    [game] = await Promise.all([
      gamePreparation,
      setupExit,
      visualRendererReady,
    ]);
    soloSave = createMahjongSoloSave({
      randomSeed,
      matchId,
      matchType,
      rules,
      playerName,
    });
    writeMahjongSoloSave(soloSave);
    refresh();
    elements.app.setAttribute("aria-busy", "false");
    elements.setup.hidden = true;
    elements.loading.hidden = true;
    settingsDialog.setSoloMatchActive(true);
    scheduleAi();
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
    for (const { action, actorId } of save.actions) {
      const result = restored.action(action, actorId);
      if (!result?.accepted) {
        throw new Error(
          `saved action rejected: ${result?.error?.code || "unknown"}`,
        );
      }
    }
    await visualRendererReady;
    game = restored;
    if (save.playerName) playerName = save.playerName;
    refresh();
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

function persistAcceptedAction(action, actorId) {
  if (!soloSave) return;
  const next = appendMahjongSoloAction(soloSave, action, actorId);
  if (!next) return;
  soloSave = next;
  writeMahjongSoloSave(soloSave);
}

function clearSoloSave() {
  clearMahjongSoloSave();
  soloSave = null;
}

function startMahjongEntry() {
  if (game || gameInitializing) return;
  if (mahjongInitialEntry(playMode, Boolean(soloSave)) === "resume") {
    void resumeSavedMatch();
    return;
  }
  showSetup();
}

function showSetup() {
  elements.setup.classList.remove("is-leaving");
  for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
    button.disabled = false;
  }
  elements.setup.hidden = false;
}

function endSoloMatch() {
  if (!game || gameInitializing) return;
  if (!window.confirm("结束本局并返回标题？本局进度不会保留。")) return;
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

function dispatch(action) {
  if (!game || !state) return;
  window.clearTimeout(aiTimer);
  const result = game.action(action, HUMAN_ID);
  if (!result?.accepted) {
    elements.message.textContent = errorMessage(result?.error?.code);
    elements.message.classList.add("is-error");
    return;
  }
  persistAcceptedAction(action, HUMAN_ID);
  riichiMode = false;
  selectionBeforeRiichi = 0;
  selectedTileId = 0;
  refresh({
    ownDiscardedTile:
      action.type === "discard" || action.type === "riichi"
        ? Number(action.tileId) || 0
        : 0,
  });
  scheduleAi();
}

function runAiTurn() {
  if (!game || !state || state.phase === "hand_ended") return;
  if (state.phase === "claiming") {
    // Claim-response identity is deliberately hidden from this projection.
    // Probe the local AI seats; only the currently queried claimant returns an action.
    for (const actorId of state.players.slice(1)) {
      const action = game.aiAction(actorId);
      if (!action) continue;
      const result = game.action(action, actorId);
      if (!result?.accepted) {
        console.error("AI action rejected", actorId, action, result);
        elements.message.textContent = "AI 动作未通过规则校验";
        elements.message.classList.add("is-error");
        return;
      }
      persistAcceptedAction(action, actorId);
      refresh();
      scheduleAi();
      return;
    }
    return;
  }
  const seat = activeSeat(state);
  if (seat === 1 || seat < 1) return;
  const actorId = state.players[seat - 1];
  const action = game.aiAction(actorId);
  if (!action) return;
  const result = game.action(action, actorId);
  if (!result?.accepted) {
    console.error("AI action rejected", actorId, action, result);
    elements.message.textContent = "AI 动作未通过规则校验";
    elements.message.classList.add("is-error");
    return;
  }
  persistAcceptedAction(action, actorId);
  refresh();
  scheduleAi();
}

function scheduleAi() {
  window.clearTimeout(aiTimer);
  if (!state || state.phase === "hand_ended") return;
  const automaticTile = automaticRiichiDiscard(state, HUMAN_ID);
  if (automaticTile) {
    aiTimer = window.setTimeout(() => {
      if (automaticRiichiDiscard(state, HUMAN_ID) === automaticTile) {
        dispatch({ type: "discard", tileId: automaticTile });
      }
    }, AUTO_RIICHI_DISCARD_DELAY_MS);
    return;
  }
  if (state.phase === "claiming") {
    aiTimer = window.setTimeout(runAiTurn, AI_DELAY_MS);
    return;
  }
  const seat = activeSeat(state);
  if (seat <= 1) return;
  aiTimer = window.setTimeout(runAiTurn, AI_DELAY_MS);
}

function refresh({ ownDiscardedTile = 0 } = {}) {
  const previousState = state;
  const projection = game.view(HUMAN_ID);
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
  queueHandInsertion(previousState, events, ownDiscardedTile);
  const revealKey = handEndPresentationKey(state);
  presentation.syncResult(revealKey, handEndPresentationDelay(state));
  renderCurrentState();
  playRiverTileSound(events);
}

function renderCurrentState() {
  const renderState = presentedState();
  const revealedPlayerIndices = handRevealPlayerIndices(state);
  const coveredPlayerIndices = handCoveredPlayerIndices(state);
  domView.render(renderState, visibleEvents, selectedTileId, playerName, {
    showResult: presentation.resultVisible,
    resultPage: resultPageIndex,
    riichiMode,
    defaultNames: getMahjongDefaultNames(),
    playerNameIsAuthoritative: hasPlatformName,
  });
  resultHandRenderer.render(renderState, resultPageIndex);
  applyPackAvatars(renderState);
  visualRenderer.render(renderState, visibleEvents, {
    ...domView.visualUi(playerName, selectedTileId),
    riichiMode,
    riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
    revealPlayerIndices: revealedPlayerIndices,
    coveredPlayerIndices,
    handRevealKey: handEndPresentationKey(state),
    animateHandReveal:
      revealedPlayerIndices.length + coveredPlayerIndices.length > 0 &&
      !presentation.resultVisible,
    delayHandRevealForCallout: visibleEvents.some(
      (event) => event.type === "won",
    ),
    deferredHandInsertionSeat: Number(presentation.handInsertion?.seat) || 0,
    deferredHandInsertionIndex:
      Number(presentation.handInsertion?.rackIndex) || 0,
  });
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
      const outgoing = elements.resultContent.cloneNode(true);
      copyCanvasBitmaps(elements.resultContent, outgoing);
      for (const node of [outgoing, ...outgoing.querySelectorAll("[id]")]) {
        node.removeAttribute("id");
      }
      outgoing.classList.add("is-page-leaving");
      elements.resultStage.append(outgoing);
      resultPageIndex += 1;
      domView.renderResult(state, playerName, true, resultPageIndex);
      resultHandRenderer.render(state, resultPageIndex);
      elements.resultContent.classList.add("is-page-entering");
      await waitForAnimation(
        elements.resultContent,
        "result-page-enter",
        RESULT_PAGE_TRANSITION_MS,
      );
      return;
    }

    elements.result.classList.add("is-exiting");
    await waitForAnimation(
      elements.result,
      "result-screen-exit",
      RESULT_EXIT_DURATION_MS,
    );
    dispatch({ type: state.matchEnded ? "new_match" : "next_hand" });
  } finally {
    resultPageAnimating = false;
    elements.rematch.disabled = false;
    elements.resultContent.classList.remove("is-page-entering");
    elements.resultStage
      .querySelectorAll(".is-page-leaving")
      .forEach((page) => page.remove());
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
  elements.rematch.disabled = false;
  elements.result.classList.remove("is-exiting");
  elements.resultContent.classList.remove("is-page-entering");
  elements.resultStage
    .querySelectorAll(".is-page-leaving")
    .forEach((page) => page.remove());
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
  if (Number(presentation.handInsertion?.seat) !== 1) return state;
  return {
    ...state,
    ownHand: presentation.handInsertion.ownHand,
    drawnTile: presentation.handInsertion.drawnTile,
  };
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
  if (current.draw || current.winType === "nagashi") return "";
  const winners = asArray(current.winners);
  if (!winners.length) return "";
  return `${current.moveCount}:${current.winType}:${winners.join(",")}`;
}

function handEndPresentationDelay(current) {
  return current?.phase === "hand_ended" ? HAND_END_PRESENTATION_DELAY_MS : 0;
}

function handRevealPlayerIndices(current) {
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
  });
  visualRenderer.updateSelection({
    ...ui,
    riichiMode,
    riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
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
  cancelMatchMusicFade();
  matchMusic.pause();
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
    cancelMatchMusicFade();
    matchMusic.pause();
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
  matchMusicPlayRequest += 1;
  cancelMatchMusicFade();
  matchMusic.pause();
  matchMusic.removeAttribute("src");
  riverTileSound.pause();
  window.removeEventListener("pagehide", handlePageHide);
  window.removeEventListener("pageshow", handlePageShow);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  releaseFixedViewport();
  settingsDialog.destroy();
  visualRenderer.destroy();
  resultHandRenderer.destroy();
  game?.close();
  soloClient.destroy();
}
