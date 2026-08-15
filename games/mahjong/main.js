import { createLocalLuaGame } from "../../src/local-lua-game.js";
import { createPlayweftSoloClient } from "../../src/playweft-solo-client.js";
import {
  AI_DELAY_MS,
  AUTO_RIICHI_DISCARD_DELAY_MS,
  HUMAN_ID,
  PLAYERS,
} from "./constants.js";
import { MahjongDomView } from "./dom-view.js";
import {
  activeSeat,
  asArray,
  automaticRiichiDiscard,
  errorMessage,
} from "./game-format.js";
import { MahjongThreeRenderer } from "./three-renderer.js";
import "../../src/base.css";
import "./styles.css";

let game;
let state;
let selectedTileId = 0;
let aiTimer;
let playerName = "你";
let destroyed = false;

const domView = new MahjongDomView({
  onAction: dispatch,
  onSelectTile: selectTile,
  onDiscardTile(tileId) {
    selectedTileId = tileId;
    discardSelected();
  },
});
const { elements } = domView;
const visualRenderer = new MahjongThreeRenderer(elements.stage, {
  onSelectTile: selectTile,
  onDiscardTile(tileId) {
    selectedTileId = tileId;
    discardSelected();
  },
});
const visualRendererReady = visualRenderer.init().catch((error) => {
  console.error("Mahjong renderer failed", error);
  showLoadingError("图形渲染器加载失败，请刷新页面重试");
});

elements.discard.addEventListener("click", discardSelected);
elements.pass.addEventListener("click", () => dispatch({ type: "pass" }));
elements.abort.addEventListener("click", () => dispatch({ type: "abort_nine" }));
elements.tsumo.addEventListener("click", () => dispatch({ type: "tsumo" }));
elements.riichi.addEventListener("click", declareRiichi);
elements.rematch.addEventListener("click", () =>
  dispatch({ type: state.matchEnded ? "new_match" : "next_hand" }));
for (const button of elements.setup.querySelectorAll("[data-match-type]")) {
  button.addEventListener("click", () => void initialize(button.dataset.matchType));
}
window.addEventListener("pagehide", handlePageHide);
window.addEventListener("pageshow", handlePageShow);
document.addEventListener("visibilitychange", handleVisibilityChange);

const soloClient = createPlayweftSoloClient({
  onReady(context) {
    const name = context?.player?.name?.trim();
    if (name) playerName = name;
    elements.setup.hidden = false;
  },
  onError(message) {
    if (!game) showLoadingError(message);
  },
});

if (window.parent === window) elements.setup.hidden = false;

async function initialize(matchType = "east") {
  if (game) return;
  elements.setup.hidden = true;
  elements.loading.hidden = false;
  elements.loadingMessage.textContent = "加载 Lua 规则并初始化牌山…";
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
          [...elements.setup.querySelectorAll("[data-rule]")]
            .map((input) => [input.dataset.rule, input.checked]),
        ),
      },
    });
    refresh();
    elements.app.setAttribute("aria-busy", "false");
    elements.loading.hidden = true;
    scheduleAi();
  } catch (error) {
    console.error(error);
    showLoadingError("Lua 规则加载失败，请刷新页面重试");
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
  selectedTileId = 0;
  refresh();
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

function refresh() {
  const projection = game.view(HUMAN_ID);
  state = projection.state;
  const events = asArray(projection.events);
  domView.render(state, events, selectedTileId, playerName);
  visualRenderer.render(
    state,
    events,
    domView.visualUi(playerName, selectedTileId),
  );
}

function selectTile(tileId) {
  if (!state?.legalActions?.canDiscard) return;
  selectedTileId = selectedTileId === tileId ? 0 : tileId;
  const ui = domView.renderSelection(state, selectedTileId, playerName);
  visualRenderer.render(state, [], ui);
}

function discardSelected() {
  if (!selectedTileId || !state?.legalActions?.canDiscard) return;
  dispatch({ type: "discard", tileId: selectedTileId });
}

function declareRiichi() {
  if (!selectedTileId
    || !asArray(state?.legalActions?.riichiTiles).includes(selectedTileId)) return;
  dispatch({ type: "riichi", tileId: selectedTileId });
}

function handlePageHide(event) {
  window.clearTimeout(aiTimer);
  if (!event.persisted) destroy();
}

function handlePageShow(event) {
  if (event.persisted) resumeAfterSuspension();
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    window.clearTimeout(aiTimer);
    return;
  }
  resumeAfterSuspension();
}

function resumeAfterSuspension() {
  if (destroyed) return;
  visualRenderer.resume();
  window.requestAnimationFrame(() => {
    if (destroyed) return;
    visualRenderer.resume();
    scheduleAi();
  });
}

function destroy() {
  if (destroyed) return;
  destroyed = true;
  window.clearTimeout(aiTimer);
  window.removeEventListener("pagehide", handlePageHide);
  window.removeEventListener("pageshow", handlePageShow);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  visualRenderer.destroy();
  game?.close();
  soloClient.destroy();
}
