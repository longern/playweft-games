import { createLocalLuaGame } from "../../src/local-lua-game.js";
import { createPlayweftSoloClient } from "../../src/playweft-solo-client.js";
import { Cog, X, createIcons } from "lucide";
import {
  AI_DELAY_MS,
  AUTO_RIICHI_DISCARD_DELAY_MS,
  HAND_INSERTION_DELAY_MS,
  HAND_END_PRESENTATION_DELAY_MS,
  HUMAN_ID,
  LOCAL_WIN_PRESENTATION_DELAY_MS,
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
let destroyed = false;

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
    if (name) playerName = name;
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
    domView.setPlayerAvatar("bottom", initialSource);
  }
  if (!asArray(context?.capabilities).includes("user.getProfile")) return;
  void soloClient
    .getUserProfile({ fields: ["avatar"] })
    .then((profile) => {
      const source = profile?.avatar?.src;
      if (typeof source === "string" && source) {
        domView.setPlayerAvatar("bottom", source);
      } else if (!initialSource) {
        domView.setPlayerAvatar("bottom", "");
      }
    })
    .catch(() => {
      if (!initialSource) domView.setPlayerAvatar("bottom", "");
    });
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
  domView.render(renderState, visibleEvents, selectedTileId, playerName, {
    showResult: resultVisible,
    riichiMode,
  });
  visualRenderer.render(renderState, visibleEvents, {
    ...domView.visualUi(playerName, selectedTileId),
    riichiMode,
    riichiCandidateTiles: asArray(state?.legalActions?.riichiTiles),
    revealPlayerIndices: handRevealPlayerIndices(state),
    coveredPlayerIndices: exhaustiveDrawPresentation(state).covered,
    animateHandReveal:
      handRevealPlayerIndices(state).length > 0 && !resultVisible,
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
  const winners = asArray(current?.winners);
  const localWin = winners.includes(HUMAN_ID);
  const opponentWin = winners.some((id) => id !== HUMAN_ID);
  return localWin && !opponentWin
    ? LOCAL_WIN_PRESENTATION_DELAY_MS
    : HAND_END_PRESENTATION_DELAY_MS;
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
    .filter((id) => id !== HUMAN_ID)
    .map((id) => asArray(current.players).indexOf(id) + 1)
    .filter((seat) => seat > 0);
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
  visualRenderer.render(renderState, [], {
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
