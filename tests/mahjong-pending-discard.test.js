import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMahjongPendingDiscard,
  createMahjongPendingDiscard,
  pendingDiscardState,
} from "../games/mahjong/app/pending-discard.js";

test("room discard gets a reversible local river projection without advancing the turn", () => {
  const state = {
    players: ["self"],
    roundWind: 1,
    handNumber: 2,
    moveCount: 9,
    ownHand: [11, 21],
    drawnTile: 17,
    legalActions: { canDiscard: true },
    discards: { self: [{ type: 1, red: false }] },
  };
  const pending = createMahjongPendingDiscard(state, {
    type: "discard",
    tileId: 11,
  });
  const projected = applyMahjongPendingDiscard(state, pending);

  assert.deepEqual(projected.ownHand, [21, 17]);
  assert.equal(projected.drawnTile, 0);
  assert.deepEqual(projected.discards.self.at(-1), {
    type: 3,
    red: false,
    riichi: false,
    tsumogiri: false,
  });
  assert.deepEqual(projected.legalActions, {});
  assert.equal(projected.moveCount, state.moveCount);
});

test("pending discard stays until the authoritative discard arrives and rolls back on a different move", () => {
  const initial = {
    players: ["self"],
    moveCount: 4,
    ownHand: [1],
    drawnTile: 0,
    legalActions: { canDiscard: true },
    discards: { self: [] },
  };
  const pending = createMahjongPendingDiscard(initial, {
    type: "discard",
    tileId: 1,
  });

  assert.equal(pendingDiscardState(initial, pending), "pending");
  assert.equal(
    pendingDiscardState(
      { ...initial, moveCount: 5, discards: { self: [{ type: 1, red: false }] } },
      pending,
    ),
    "confirmed",
  );
  assert.equal(
    pendingDiscardState(
      { ...initial, moveCount: 5, discards: { self: [{ type: 2, red: false }] } },
      pending,
    ),
    "rejected",
  );
});
