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
} from "./game-format.js";
import { MahjongThreeRenderer } from "./three-renderer.js";
import { createMahjongSettingsDialog } from "./settings-dialog.js";
import {
  activateMahjongAssetPack,
  configureMahjongAssetPackAppearance,
  createMahjongAssetPack,
  deleteMahjongAssetPack,
  deactivateMahjongAssetPacks,
  getMahjongAssetUrl,
  getMahjongDefaultNames,
  initializeMahjongAssetPacks,
  listMahjongAssetPacks,
} from "./asset-packs.js";
import "../../src/base.css";
import "./styles.css";

createIcons({ icons: { Cog, X } });

let game;
let state;
let selectedTileId = 0;
let riichiMode = false;
let selectionBeforeRiichi = 0;
let aiTimer;
let handInsertionTimer;
let resultTimer;
let handInsertion = null;
let visibleEvents = [];
let resultRevealKey = "";
let resultVisible = true;
let playerName = "你";
let hasPlatformName = false;
let destroyed = false;
let hasPlatformAvatar = false;

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
  tabButtons: elements.settingsTabs,
  tabPanels: elements.settingsPanels,
  doubleClickTsumogiri: elements.doubleClickTsumogiri,
  doubleClickPass: elements.doubleClickPass,
});
const visualRenderer = new MahjongThreeRenderer(elements.stage, {
  onSelectTile: selectTile,
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
const visualRendererReady = visualRenderer.init().catch((error) => {
  console.error("Mahjong renderer failed", error);
  showLoadingError("图形渲染器加载失败，请刷新页面重试");
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

void Promise.all([visualRendererReady, assetPacksReady]).then(() =>
  applyVisualPack(),
);
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
  } else {
    appearance[key] = select.value;
  }
  visualPackElements.feedback.textContent = "正在应用画面配置…";
  try {
    visualPacks = await configureMahjongAssetPackAppearance(activePack.id, appearance);
    renderVisualPacks();
    visualPackElements.feedback.textContent = "已应用画面配置。";
  } catch (error) {
    visualPackElements.feedback.textContent =
      error instanceof Error ? error.message : "画面配置失败";
  }
});
window.addEventListener("mahjong:asset-pack-changed", () => {
  void applyVisualPack();
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
elements.rematch.addEventListener("click", () =>
  dispatch({ type: state.matchEnded ? "new_match" : "next_hand" }),
);
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
    const name = context?.player?.name?.trim();
    if (name) {
      playerName = name;
      hasPlatformName = true;
    }
    requestPlatformAvatar(context);
    elements.setup.hidden = false;
  },
  onError(message) {
    if (!game) showLoadingError(message);
  },
});

if (window.parent === window) elements.setup.hidden = false;

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
      if (!initialSource)
        applyPackAvatars(state);
    });
}

function applyPackAvatars() {
  const portraitSlotByPosition = {
    bottom: "self",
    right: "right",
    top: "opposite",
    left: "left",
  };
  for (const [position, portraitSlot] of Object.entries(portraitSlotByPosition)) {
    if (position === "bottom" && hasPlatformAvatar) continue;
    const source = getMahjongAssetUrl(`portrait-${portraitSlot}`);
    domView.setPlayerAvatar(position, source);
  }
}

async function applyVisualPack() {
  await visualRendererReady;
  await visualRenderer.setAppearance({
    tablecloth: getMahjongAssetUrl("tablecloth"),
    tileBack: getMahjongAssetUrl("tile-back"),
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
  portraitLegend.textContent = "四家主题肖像";
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
    if (options.length) surfaceGroup.append(createAppearanceSelect(label, key, options, selected));
  }
  if (surfaceGroup.childElementCount > 1) controls.append(surfaceGroup);
  visualPackElements.appearance.replaceChildren(controls);
  visualPackElements.appearance.hidden = !visualPackElements.appearance.childElementCount;
}

function createAppearanceSelect(label, key, options, selected) {
  const row = document.createElement("label");
  row.className = "settings-pack-choice";
  const text = document.createElement("span");
  text.textContent = label;
  const select = document.createElement("select");
  select.dataset.appearanceKey = key;
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
  if (game) return;
  elements.setup.hidden = true;
  elements.loading.hidden = false;
  elements.loadingMessage.textContent = "正在洗牌并码好牌山…";
  try {
    await visualRendererReady;
    game = await createLocalLuaGame({
      sourceUrl: "./game.lua",
      players: PLAYERS.map((player, index) => ({
        ...player,
        name: index === 0 ? playerName : player.name,
      })),
      playerId: HUMAN_ID,
      randomSeed: Date.now(),
      settings: {
        matchType,
        rules: Object.fromEntries(
          [...elements.setup.querySelectorAll("[data-rule]")].map((input) => [
            input.dataset.rule,
            input.checked,
          ]),
        ),
      },
    });
    refresh();
    elements.app.setAttribute("aria-busy", "false");
    elements.loading.hidden = true;
    scheduleAi();
  } catch (error) {
    console.error(error);
    showLoadingError("牌桌准备失败，请刷新页面重试");
  }
}

function showLoadingError(message) {
  elements.loading.classList.add("is-error");
  elements.loadingMessage.textContent = message;
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
  if (riichiMode && !state.legalActions?.canRiichi) {
    riichiMode = false;
    selectionBeforeRiichi = 0;
  }
  const events = asArray(projection.events);
  visibleEvents = events;
  queueHandInsertion(previousState, events, ownDiscardedTile);
  const revealKey = handEndPresentationKey(state);
  if (!revealKey) {
    window.clearTimeout(resultTimer);
    resultRevealKey = "";
    resultVisible = true;
  } else if (revealKey !== resultRevealKey) {
    resultRevealKey = revealKey;
    resultVisible = false;
    window.clearTimeout(resultTimer);
    resultTimer = window.setTimeout(() => {
      resultVisible = true;
      refresh();
    }, handEndPresentationDelay(state));
  }
  renderCurrentState();
}

function renderCurrentState() {
  const renderState = presentedState();
  const revealedPlayerIndices = handRevealPlayerIndices(state);
  const coveredPlayerIndices = handCoveredPlayerIndices(state);
  domView.render(renderState, visibleEvents, selectedTileId, playerName, {
    showResult: resultVisible,
    riichiMode,
    defaultNames: getMahjongDefaultNames(),
    playerNameIsAuthoritative: hasPlatformName,
  });
  applyPackAvatars(renderState);
  visualRenderer.render(renderState, visibleEvents, {
    ...domView.visualUi(playerName, selectedTileId),
    riichiMode,
    riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
    revealPlayerIndices: revealedPlayerIndices,
    coveredPlayerIndices,
    animateHandReveal:
      revealedPlayerIndices.length + coveredPlayerIndices.length > 0 &&
      !resultVisible,
    delayHandRevealForCallout: visibleEvents.some(
      (event) => event.type === "won",
    ),
    deferredHandInsertionSeat: Number(handInsertion?.seat) || 0,
    deferredHandInsertionIndex: Number(handInsertion?.rackIndex) || 0,
  });
}

function presentedState() {
  if (Number(handInsertion?.seat) !== 1) return state;
  return {
    ...state,
    ownHand: handInsertion.ownHand,
    drawnTile: handInsertion.drawnTile,
  };
}

function queueHandInsertion(previousState, events, ownDiscardedTile = 0) {
  const discard = asArray(events).find(
    (event) =>
      (event?.type === "discarded" || event?.type === "riichi") &&
      typeof event.fromDrawn === "boolean",
  );
  if (!discard) return;
  const eventKey = [
    Number(state?.moveCount) || 0,
    discard.type,
    Number(discard.playerIndex) || 0,
    Number(discard.tile) || 0,
    String(discard.fromDrawn),
  ].join(":");
  if (eventKey === queueHandInsertion.lastEventKey) return;
  queueHandInsertion.lastEventKey = eventKey;
  window.clearTimeout(handInsertionTimer);
  handInsertion = deferredHandInsertion(previousState, events, {
    ownDiscardedTile,
  });
  if (!handInsertion) return;
  handInsertionTimer = window.setTimeout(() => {
    handInsertion = null;
    renderCurrentState();
  }, HAND_INSERTION_DELAY_MS);
}
queueHandInsertion.lastEventKey = "";

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
  const ui = domView.renderSelection(renderState, selectedTileId, playerName, {
    riichiMode,
  });
  visualRenderer.updateSelection({
    ...ui,
    riichiMode,
    riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
    deferredHandInsertionSeat: Number(handInsertion?.seat) || 0,
    deferredHandInsertionIndex: Number(handInsertion?.rackIndex) || 0,
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
  window.clearTimeout(aiTimer);
  window.clearTimeout(handInsertionTimer);
  window.clearTimeout(resultTimer);
  handInsertion = null;
  resultVisible = true;
  if (!event.persisted) destroy();
}

function handlePageShow(event) {
  if (event.persisted) resumeAfterSuspension();
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    window.clearTimeout(aiTimer);
    window.clearTimeout(handInsertionTimer);
    window.clearTimeout(resultTimer);
    handInsertion = null;
    resultVisible = true;
    return;
  }
  resumeAfterSuspension();
}

function resumeAfterSuspension() {
  if (destroyed) return;
  visualRenderer.resume();
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
  window.clearTimeout(handInsertionTimer);
  window.clearTimeout(resultTimer);
  window.removeEventListener("pagehide", handlePageHide);
  window.removeEventListener("pageshow", handlePageShow);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  releaseFixedViewport();
  settingsDialog.destroy();
  visualRenderer.destroy();
  game?.close();
  soloClient.destroy();
}
