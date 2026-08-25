import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongEffectRunner } from "../games/mahjong/app/effect-runner.js";
import { createMahjongTableController } from "../games/mahjong/app/table-controller.js";

function createController({
  onDispatch = () => {},
  matchMusicUrl = "",
  riichiMusicUrl = "",
  matchMusicController,
  activeGame = false,
} = {}) {
  const calls = [];
  const game = activeGame ? {} : undefined;
  const music = matchMusicController ?? {
    gain: 1,
    sync() {},
    applyVolume() {},
    suspend() {},
  };
  const controller = createMahjongTableController({
    document: { baseURI: "https://example.com/mahjong/" },
    window: {
      setTimeout,
      clearTimeout,
      requestAnimationFrame(callback) {
        callback();
      },
    },
    elements: {},
    domView: {
      visualUi() {
        return {};
      },
      render(state) {
        calls.push(["dom", state.moveCount]);
      },
      renderSelection(_state, tileId) {
        calls.push(["selection", tileId]);
        return {};
      },
      renderTenpaiPreview() {},
    },
    visualRenderer: {
      render(state, _events, ui) {
        calls.push(["scene", state.moveCount, ui]);
      },
      updateSelection() {},
      resume() {},
    },
    resultHandRenderer: {
      render() {},
      resume() {},
      hide() {},
    },
    presentation: {
      kanDrawPending: false,
      handInsertion: null,
      resultVisible: true,
      drawRevealVisible: false,
      syncHandEnd() {},
      cancelHandInsertion() {},
      scheduleKanDraw() {},
      scheduleHandInsertion() {},
      handRevealSettled() {},
      suspend() {},
      destroy() {},
    },
    effectRunner: createMahjongEffectRunner({ onError() {} }),
    settingsDialog: { gameHintsEnabled: true, discardVolumeScale: 1 },
    matchMusicController: music,
    riverTileSound: { pause() {} },
    humanId: "human",
    getGame: () => game,
    getGameInitializing: () => false,
    getMode: () => "solo",
    getPlayerName: () => "你",
    playerNameIsAuthoritative: () => false,
    getThemeAssetUrl: () => "",
    getThemeDefaultNames: () => [],
    getThemeMatchMusicUrl: () => matchMusicUrl,
    getThemeRiichiMusicUrl: () => riichiMusicUrl,
    dispatch: onDispatch,
  });
  return { controller, calls, music };
}

test("mahjong table controller publishes a projection before rendering it", async () => {
  const { controller, calls } = createController();
  const projection = {
    state: {
      phase: "playing",
      moveCount: 17,
      ownHand: [41],
      legalActions: {},
    },
    events: [],
  };

  await controller.refresh(projection);

  assert.equal(controller.getState(), projection.state);
  assert.deepEqual(calls, [
    ["dom", 17],
    ["scene", 17, {
      riichiMode: false,
      riichiCandidateTiles: [],
      showGameHints: true,
      revealPlayerIndices: [],
      coveredPlayerIndices: [],
      handRevealKey: "",
      animateHandReveal: false,
      handRevealDelay: 0,
      delayHandRevealForCallout: false,
      deferredHandInsertionSeat: 0,
      deferredHandInsertionIndex: 0,
      dealInKey: "",
      animateDealIn: false,
    }],
  ]);
});

test("mahjong table controller allows hand inspection without dispatching a turn action", async () => {
  const dispatched = [];
  const { controller, calls } = createController({
    onDispatch: (action) => dispatched.push(action),
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      ownHand: [41],
      legalActions: { canDiscard: false },
    },
    events: [],
  });

  controller.selectTile(41);

  assert.deepEqual(dispatched, []);
  assert.deepEqual(calls.at(-1), ["selection", 41]);
});

test("mahjong table controller submits the selected riichi tile", async () => {
  const dispatched = [];
  const { controller } = createController({
    onDispatch: (action) => dispatched.push(action),
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      ownHand: [41],
      drawnTile: 42,
      legalActions: { canDiscard: true, canRiichi: true, riichiTiles: [42] },
    },
    events: [],
  });

  controller.enterRiichiMode();
  controller.discardOwnTile(42);

  assert.deepEqual(dispatched, [{ type: "riichi", tileId: 42 }]);
});

test("mahjong keeps the current match track unchanged when riichi music is not configured", async () => {
  const musicCalls = [];
  const { controller } = createController({
    matchMusicUrl: "match.mp3",
    activeGame: true,
    matchMusicController: {
      gain: 1,
      sync(target, options) {
        musicCalls.push([target, options]);
      },
      applyVolume() {},
      suspend() {},
    },
  });
  await controller.refresh({
    state: { phase: "playing", moveCount: 1, ownHand: [], legalActions: {} },
    events: [],
  });
  await controller.refresh({
    state: {
      phase: "playing",
      moveCount: 2,
      ownHand: [],
      legalActions: {},
      riichi: { opponent: true },
    },
    events: [{ type: "riichi" }],
  });

  assert.deepEqual(musicCalls, [
    [
      { mode: "playing", source: "https://example.com/mahjong/match.mp3" },
      { fadeIn: false, fadeOut: false },
    ],
    [
      { mode: "playing", source: "https://example.com/mahjong/match.mp3" },
      { fadeIn: true, fadeOut: false },
    ],
  ]);
});
