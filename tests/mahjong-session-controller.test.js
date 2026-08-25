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
  now,
  wait,
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
      now,
      wait,
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

test("mahjong session starts an AI decision immediately and only waits for its remaining pace", async () => {
  const state = {
    phase: "playing",
    turnIndex: 2,
    moveCount: 4,
    drawnTile: 19,
  };
  const calls = [];
  const waits = [];
  let clock = 100;
  const game = {
    async aiDecision() {
      calls.push("decision");
      clock = 106;
      return {
        status: "acted",
        version: 4,
        actorId: "ai-1",
        action: { type: "discard", tileId: 19 },
      };
    },
    async action(action, actorId) {
      calls.push(`${actorId}:${action.type}`);
      return {
        result: { accepted: true },
        projection: { state: { phase: "playing", moveCount: 5 }, events: [] },
      };
    },
  };
  const { controller, scheduler } = createController({
    state,
    game,
    now: () => clock,
    async wait(delay) {
      waits.push(delay);
      clock += delay;
    },
  });

  controller.scheduleAi();
  assert.equal(scheduler.scheduled[0].delay, 0);
  scheduler.scheduled[0].callback(scheduler.scheduled[0].generation);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, ["decision", "ai-1:discard"]);
  assert.deepEqual(waits, [4]);
});

test("mahjong session drops an AI decision after the turn changes", async () => {
  const state = {
    phase: "playing",
    turnIndex: 2,
    moveCount: 4,
    drawnTile: 19,
  };
  let releaseDecision;
  let applied = false;
  const game = {
    aiDecision() {
      return new Promise((resolve) => {
        releaseDecision = () =>
          resolve({
            status: "acted",
            version: 4,
            actorId: "ai-1",
            action: { type: "discard", tileId: 19 },
          });
      });
    },
    async action() {
      applied = true;
      return { result: { accepted: true }, projection: { state, events: [] } };
    },
  };
  const { controller, scheduler } = createController({
    state,
    game,
    async wait() {},
  });

  controller.scheduleAi();
  scheduler.scheduled[0].callback(scheduler.scheduled[0].generation);
  await Promise.resolve();
  state.moveCount = 5;
  releaseDecision();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(applied, false);
});

test("mahjong session reschedules an AI turn when the decision is not actionable", async () => {
  const state = {
    phase: "playing",
    turnIndex: 2,
    moveCount: 4,
    drawnTile: 19,
  };
  const game = {
    async aiDecision() {
      return { status: "idle", version: 4 };
    },
  };
  const { controller, scheduler } = createController({
    state,
    game,
    async wait() {},
  });

  controller.scheduleAi();
  scheduler.scheduled[0].callback(scheduler.scheduled[0].generation);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(scheduler.scheduled.length, 2);
  assert.equal(scheduler.scheduled[1].delay, 10);
  assert.equal(controller.isActionInFlight(), false);

  scheduler.scheduled[1].callback(scheduler.scheduled[1].generation);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(scheduler.scheduled.length, 2);
  assert.equal(controller.isActionInFlight(), false);
});

test("mahjong session does not retry while the AI decision reports a human claimant", async () => {
  const state = {
    phase: "claiming",
    turnIndex: 2,
    moveCount: 4,
  };
  const game = {
    async aiDecision() {
      return { status: "waiting_for_human", version: 4, actorId: "human" };
    },
  };
  const { controller, scheduler } = createController({ state, game });

  controller.scheduleAi();
  scheduler.scheduled[0].callback(scheduler.scheduled[0].generation);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(scheduler.scheduled.length, 1);
  assert.equal(controller.isActionInFlight(), false);
});

test("mahjong session reschedules after an AI action is rejected", async () => {
  const state = {
    phase: "playing",
    turnIndex: 2,
    moveCount: 4,
    drawnTile: 19,
  };
  const game = {
    async aiDecision() {
      return {
        status: "acted",
        version: 4,
        actorId: "ai-1",
        action: { type: "discard", tileId: 19 },
      };
    },
    async action() {
      return {
        result: { accepted: false, error: { code: "stale" } },
      };
    },
  };
  const { controller, scheduler } = createController({
    state,
    game,
    async wait() {},
  });

  controller.scheduleAi();
  scheduler.scheduled[0].callback(scheduler.scheduled[0].generation);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(scheduler.scheduled.length, 2);
  assert.equal(scheduler.scheduled[1].delay, 10);
  assert.equal(controller.isActionInFlight(), false);
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

test("mahjong room auto actions submit wins and tsumogiri after the local delay", async () => {
  const sent = [];
  const state = {
    phase: "playing",
    turnIndex: 1,
    drawnTile: 42,
    legalActions: { canDiscard: true, canTsumo: true },
  };
  const { controller, scheduler } = createController({
    state,
    mode: "room",
    autoActions: { autoWin: true, autoTsumogiri: true },
    callbacks: {
      sendRoomAction(action) {
        sent.push(action);
        return "auto-room-request";
      },
    },
  });

  controller.scheduleRoomAutomaticAction({ state, isCurrent: () => true });
  assert.equal(scheduler.scheduled[0].delay, 60);
  scheduler.scheduled[0].callback(scheduler.scheduled[0].generation);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(sent, [{ type: "tsumo" }]);
});

test("mahjong room leaves call passing to the server's private setting", () => {
  const state = {
    phase: "claiming",
    legalActions: { claims: [{ kind: "pon", option: 1 }] },
  };
  const { controller, scheduler } = createController({
    state,
    mode: "room",
    autoActions: { passClaims: true },
  });

  controller.scheduleRoomAutomaticAction({ state, isCurrent: () => true });

  assert.equal(scheduler.scheduled.length, 0);
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
