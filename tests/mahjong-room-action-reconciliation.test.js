import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reconcileRoomAction,
  roomActionStateKey,
} from "../games/mahjong/rules/room-action-reconciliation.js";

function attempt(action, state) {
  return {
    requestId: "request-1",
    action,
    baseStateKey: roomActionStateKey(state),
    baseMoveCount: Number(state.moveCount) || 0,
  };
}

test("room action reconciliation silently accepts a result request superseded by the next hand", () => {
  const before = {
    phase: "hand_ended",
    resultPage: 0,
    resultPageReady: false,
    moveCount: 20,
    players: ["human"],
  };
  const after = {
    ...before,
    phase: "playing",
    moveCount: 21,
  };

  assert.deepEqual(
    reconcileRoomAction({
      attempt: attempt({ type: "result_ready" }, before),
      state: after,
      errorCode: "result_ready_not_available",
    }),
    { outcome: "confirmed", shouldNotify: false },
  );
});

test("room action reconciliation treats an already-ready result page as idempotent", () => {
  const state = {
    phase: "hand_ended",
    resultPage: 1,
    resultPageReady: false,
    players: ["human"],
  };

  assert.deepEqual(
    reconcileRoomAction({
      attempt: attempt({ type: "result_ready" }, state),
      state,
      errorCode: "result_already_ready",
    }),
    { outcome: "confirmed", shouldNotify: false },
  );
});

test("room action reconciliation silently supersedes a late discard after another state transition", () => {
  const before = {
    phase: "playing",
    moveCount: 8,
    turnIndex: 1,
    players: ["human"],
    discards: { human: [] },
  };
  const after = {
    ...before,
    moveCount: 9,
    turnIndex: 2,
    discards: { human: [] },
  };

  assert.deepEqual(
    reconcileRoomAction({
      attempt: attempt({ type: "discard", tileId: 42 }, before),
      state: after,
      errorCode: "NOT_YOUR_TURN",
    }),
    { outcome: "superseded", shouldNotify: false },
  );
});

test("room action reconciliation keeps a real rule rejection visible", () => {
  const state = {
    phase: "playing",
    moveCount: 8,
    turnIndex: 1,
    players: ["human"],
    discards: { human: [] },
  };

  assert.deepEqual(
    reconcileRoomAction({
      attempt: attempt({ type: "riichi", tileId: 42 }, state),
      state,
      errorCode: "RIICHI_NOT_ALLOWED",
    }),
    { outcome: "rejected", shouldNotify: true },
  );
});

test("room action reconciliation resolves the viewer discard by viewer seat", () => {
  const before = {
    phase: "playing",
    moveCount: 8,
    turnIndex: 2,
    viewerSeat: 2,
    players: ["east", "self", "west", "north"],
    viewerPlayerId: "self",
    discards: { self: [] },
    riichi: { self: false },
  };
  const after = {
    ...before,
    moveCount: 9,
    discards: { self: [{ type: 1, red: false }] },
    riichi: { self: true },
  };
  assert.equal(
    reconcileRoomAction({
      attempt: attempt({ type: "riichi", tileId: 1 }, before),
      state: after,
    }).outcome,
    "confirmed",
  );
});
