import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongEffectRunner } from "../games/mahjong/effect-runner.js";
import { createMahjongTableController } from "../games/mahjong/table-controller.js";

function createController({ onDispatch = () => {} } = {}) {
  const calls = [];
  const controller = createMahjongTableController({
    document: {},
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
    matchMusicController: {
      stop() {}, mute() {}, play() {}, setSource() {}, applyVolume() {}, suspend() {},
    },
    riverTileSound: { pause() {} },
    humanId: "human",
    getGame: () => undefined,
    getGameInitializing: () => false,
    getMode: () => "solo",
    getPlayerName: () => "你",
    playerNameIsAuthoritative: () => false,
    getThemeAssetUrl: () => "",
    getThemeDefaultNames: () => [],
    getThemeMatchMusicUrl: () => "",
    dispatch: onDispatch,
  });
  return { controller, calls };
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
