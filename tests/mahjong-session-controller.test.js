import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongSessionController } from "../games/mahjong/app/session-controller.js";

function createScheduler() {
  let generation = 0;
  const scheduled = [];
  return {
    scheduled,
    cancel() {
      generation += 1;
    },
    schedule(callback, delay) {
      const current = ++generation;
      scheduled.push({ callback, delay, generation: current });
      return current;
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
  };
}

function createController({
  state,
  game,
  mode = "solo",
  autoActions = {},
  scheduler = createScheduler(),
  callbacks = {},
} = {}) {
  return {
    scheduler,
    controller: createMahjongSessionController({
      humanId: "human",
      getMode: () => mode,
      getGame: () => game,
      getState: () => state,
      getAutoActions: () => autoActions,
      getRiichiMode: () => false,
      isKanDrawPending: () => false,
      sendRoomAction: callbacks.sendRoomAction,
      persistAcceptedAction: callbacks.persistAcceptedAction,
      refreshProjection: callbacks.refreshProjection,
      onSoloActionAccepted: callbacks.onSoloActionAccepted,
      onActionRejected: callbacks.onActionRejected,
      onActionError: callbacks.onActionError,
      onProjectionTransitionError: callbacks.onProjectionTransitionError,
      delays: {
        ai: 10,
        autoDecision: 40,
        newHandDeal: 30,
        ownDrawEntry: 20,
      },
      scheduler,
    }),
  };
}

test("mahjong session commits an accepted action before resuming AI work", async () => {
  const order = [];
  const state = { phase: "playing", turnIndex: 1 };
  const game = {
    async action() {
      return {
        result: { accepted: true },
        projection: { state: { phase: "hand_ended" }, events: [] },
      };
    },
  };
  const { controller } = createController({
    state,
    game,
    callbacks: {
      async persistAcceptedAction() {
        order.push("saved");
      },
      onSoloActionAccepted() {
        order.push("state-reset");
      },
      async refreshProjection() {
        order.push("rendered");
      },
    },
  });

  const accepted = await controller.dispatch({ type: "claim", option: 1 });

  assert.equal(accepted, true);
  assert.deepEqual(order, ["saved", "state-reset", "rendered"]);
  assert.equal(controller.isActionInFlight(), false);
});

test("mahjong session gives automatic decisions their configured recognition delay", () => {
  const tsumoState = {
    phase: "playing",
    turnIndex: 1,
    legalActions: { canTsumo: true },
  };
  const tsumo = createController({
    state: tsumoState,
    game: {},
    autoActions: { autoWin: true },
  });
  tsumo.controller.scheduleAi({ afterDealIn: true });
  assert.equal(tsumo.scheduler.scheduled[0].delay, 70);

  const tsumogiriState = {
    phase: "playing",
    turnIndex: 1,
    players: ["human"],
    riichi: { human: true },
    drawnTile: 73,
    legalActions: { canDiscard: true, canTsumo: false, selfKans: [] },
  };
  const tsumogiri = createController({
    state: tsumogiriState,
    game: {},
  });
  tsumogiri.controller.scheduleAi();
  assert.equal(tsumogiri.scheduler.scheduled[0].delay, 60);
});

test("mahjong room actions stay locked until the matching room response settles", async () => {
  const sent = [];
  const { controller } = createController({
    state: { phase: "playing" },
    mode: "room",
    callbacks: {
      sendRoomAction(action) {
        sent.push(action);
        return "request-1";
      },
    },
  });

  assert.equal(await controller.dispatch({ type: "discard", tileId: 3 }), true);
  assert.equal(controller.isActionInFlight(), true);
  assert.equal(await controller.dispatch({ type: "discard", tileId: 7 }), false);
  assert.equal(controller.rejectRoomAction("other-request"), false);
  assert.equal(controller.isActionInFlight(), true);
  controller.confirmRoomState();

  assert.deepEqual(sent, [{ type: "discard", tileId: 3 }]);
  assert.equal(controller.isActionInFlight(), false);
});

test("mahjong room does not miss a rejection that arrives before an async transport returns its request id", async () => {
  let controller;
  ({ controller } = createController({
    state: { phase: "playing" },
    mode: "room",
    callbacks: {
      sendRoomAction(_action, { onRequestStarted }) {
        const requestId = "request-1";
        onRequestStarted(requestId);
        queueMicrotask(() => controller.rejectRoomAction(requestId));
        return requestId;
      },
    },
  }));

  assert.equal(await controller.dispatch({ type: "riichi", tileId: 57 }), true);
  assert.equal(controller.isActionInFlight(), false);
});

test("mahjong room can submit the host's start action before a table state exists", async () => {
  const sent = [];
  const { controller } = createController({
    state: undefined,
    mode: "room",
    callbacks: {
      sendRoomAction(action) {
        sent.push(action);
        return "start-request";
      },
    },
  });

  assert.equal(
    await controller.dispatch({ type: "start_match", matchType: "hanchan" }),
    true,
  );
  assert.deepEqual(sent, [{ type: "start_match", matchType: "hanchan" }]);
  assert.equal(controller.isActionInFlight(), true);
});

test("mahjong restores an accepted projection when a result transition fails", async () => {
  const refreshed = [];
  const transitionErrors = [];
  const game = {
    async action() {
      return {
        result: { accepted: true },
        projection: { state: { phase: "playing", turnIndex: 1 }, events: [] },
      };
    },
  };
  const { controller } = createController({
    state: { phase: "hand_ended" },
    game,
    callbacks: {
      async refreshProjection(projection) {
        refreshed.push(projection.state.phase);
      },
      onProjectionTransitionError(error) {
        transitionErrors.push(error.message);
      },
    },
  });

  const accepted = await controller.dispatch(
    { type: "next_hand" },
    {
      async onAcceptedProjection() {
        throw new Error("transition host failed");
      },
    },
  );

  assert.equal(accepted, true);
  assert.deepEqual(transitionErrors, ["transition host failed"]);
  assert.deepEqual(refreshed, ["playing"]);
  assert.equal(controller.isActionInFlight(), false);
});
