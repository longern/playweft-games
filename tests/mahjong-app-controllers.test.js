import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongAutoActionController } from "../games/mahjong/app/auto-action-controller.js";
import { createMahjongMatchCoordinator } from "../games/mahjong/app/match-coordinator.js";
import { createMahjongSoloSaveController } from "../games/mahjong/app/solo-save-controller.js";
import { bindMahjongUi } from "../games/mahjong/app/ui-bindings.js";
import { createMahjongSoloSave } from "../games/mahjong/replay/solo-save.js";

function button() {
  return {
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type, listener) {
      const handlers = listeners.get(type);
      handlers?.delete(listener);
      if (handlers?.size === 0) listeners.delete(type);
    },
    emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ target: this, ...event });
      }
    },
    querySelectorAll() {
      return [];
    },
  };
}

function createSave() {
  return createMahjongSoloSave({
    randomSeed: "0123456789abcdef0123456789abcdef",
    matchId: "solo-example",
    matchType: "east",
    rules: { multipleRon: true },
    playerName: "小满",
  });
}

test("mahjong match coordinator owns app-level state and transition guards", () => {
  const transitions = [];
  const coordinator = createMahjongMatchCoordinator({
    initialMode: "solo",
    onModeChange(nextMode, previousMode) {
      transitions.push({ nextMode, previousMode });
    },
  });
  const game = { id: "game-1" };

  coordinator.setGame(game);
  coordinator.setGameInitializing(true);
  coordinator.setPlayerName("小满");
  coordinator.setPlayerNameIsAuthoritative(true);
  coordinator.setRoomPlayerId("room-player");
  coordinator.setReplayState({ position: 4 });
  coordinator.setMode("replay");

  assert.equal(coordinator.getGame(), game);
  assert.equal(coordinator.isGameInitializing(), true);
  assert.equal(coordinator.getPlayerName(), "小满");
  assert.equal(coordinator.playerNameIsAuthoritative(), true);
  assert.equal(coordinator.getRoomPlayerId(), "room-player");
  assert.deepEqual(coordinator.getReplayState(), { position: 4 });
  assert.deepEqual(transitions, [{ nextMode: "replay", previousMode: "solo" }]);
  assert.equal(coordinator.beginEnding(), true);
  assert.equal(coordinator.beginEnding(), false);
  coordinator.endEnding();
  assert.equal(coordinator.isEnding(), false);
  assert.equal(coordinator.destroy(), true);
  assert.equal(coordinator.destroy(), false);
  assert.equal(coordinator.isDestroyed(), true);
});

test("mahjong UI bindings detach their listeners during app teardown", () => {
  const actions = [];
  const pass = eventTarget();
  const unused = eventTarget();
  let lifecycleBindings = 0;
  const dispose = bindMahjongUi({
    paipuElements: { entry: unused, close: unused, panel: unused },
    replayElements: {
      previousHand: unused,
      nextHand: unused,
      stepBack: unused,
      stepForward: unused,
      toggle: unused,
      speed: unused,
      progress: unused,
      handVisibility: unused,
    },
    elements: {
      pass,
      abort: unused,
      tsumo: unused,
      riichi: unused,
      cancelRiichi: unused,
      rematch: unused,
      matchSummaryRematch: unused,
      matchSummarySetup: unused,
      result: unused,
      autoWin: unused,
      passClaims: unused,
      autoTsumogiri: unused,
      setup: unused,
    },
    tableController: {
      submitAction(action) {
        actions.push(action);
      },
      enterRiichiMode() {},
      cancelRiichiMode() {},
      continueResult() {},
      restartMatchFromSummary() {},
      returnToSetupFromSummary() {},
      isResultBlankSpace() {
        return false;
      },
    },
    resultHandRenderer: { playStartButtonActivation() {} },
    autoActionController: { syncControls() {}, toggle() {} },
    getMode: () => "solo",
    getReplayState: () => null,
    getRoomController: () => null,
    getReplayController: () => null,
    openPaipuPanel() {},
    closePaipuPanel() {},
    initializeSoloMatch() {},
    pageLifecycle: { bind: () => lifecycleBindings++ },
  });

  pass.emit("click");
  dispose();
  pass.emit("click");

  assert.deepEqual(actions, [{ type: "pass" }]);
  assert.equal(lifecycleBindings, 1);
});

test("mahjong auto action controller scopes riichi auto-win to one hand", () => {
  let mode = "solo";
  let scheduled = 0;
  const controller = createMahjongAutoActionController({
    elements: {
      autoWin: button(),
      passClaims: button(),
      autoTsumogiri: button(),
    },
    settingsDialog: { autoWinAfterRiichiEnabled: true },
    getMode: () => mode,
    scheduleAi: () => {
      scheduled += 1;
    },
  });

  controller.enableAfterRiichi(
    { roundWind: 1, handNumber: 2, honba: 0, moveCount: 12 },
    { playerIndex: 1 },
  );
  controller.enableAfterRiichi(
    { roundWind: 1, handNumber: 2, honba: 0, moveCount: 12 },
    { playerIndex: 1 },
  );
  assert.equal(controller.get().autoWin, true);
  assert.equal(scheduled, 1);

  controller.reset({ persist: false });
  assert.deepEqual(controller.get(), {
    autoWin: false,
    passClaims: false,
    autoTsumogiri: false,
  });
  mode = "room";
});

test("mahjong auto action controller delegates room claim preference", () => {
  const requests = [];
  const controller = createMahjongAutoActionController({
    elements: {
      autoWin: button(),
      passClaims: button(),
      autoTsumogiri: button(),
    },
    settingsDialog: { autoWinAfterRiichiEnabled: true },
    getMode: () => "room",
    getSession: () => ({
      dispatch(action) {
        requests.push(action);
      },
    }),
  });

  controller.toggle("passClaims");
  assert.deepEqual(requests, [{ type: "set_pass_claims", enabled: true }]);
});

test("mahjong solo save controller checkpoints accepted hand ends", async () => {
  const completed = [];
  const controller = createMahjongSoloSaveController({
    initialSave: createSave(),
    humanId: "human",
    getThemeController: () => ({
      getPaipuPlayerPresentations: () => ({
        human: { avatarPreference: "auto" },
      }),
    }),
    saveCompletedPaipu: async (record) => completed.push(record),
  });
  const game = {
    playerId: "",
    checkpoint: async () => ({
      state: { phase: "hand_ended" },
      events: [],
      version: 9,
    }),
    exportPaipu: async () => ({
      status: "completed",
      players: [{ id: "human" }],
    }),
  };

  await controller.persistAcceptedAction(
    { type: "discard", tileId: 12 },
    "human",
    { state: { phase: "hand_ended", matchEnded: true } },
    game,
  );

  assert.equal(controller.get().actions.length, 1);
  assert.equal(controller.get().checkpoint?.stateVersion, 9);
  assert.equal(completed[0].viewerPlayerId, "human");
});
