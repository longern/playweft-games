import assert from "node:assert/strict";
import test from "node:test";

import { createMahjongTableTenpaiState } from "../games/mahjong/app/table-tenpai-state.js";

function riichiState() {
  return {
    phase: "playing",
    players: ["self", "p2", "p3", "p4"],
    roundWind: 1,
    handNumber: 1,
    turnIndex: 1,
    ownHand: [1, 5, 9],
    drawnTile: 13,
    melds: { self: [] },
    riichi: { self: true },
  };
}

test("generic action UI cleanup preserves an active held tenpai preview", () => {
  const tenpai = createMahjongTableTenpaiState();
  const state = riichiState();

  assert.equal(
    tenpai.applyLockedWait({ waits: [{ type: 5 }, { type: 8 }], furiten: false }),
    true,
  );
  tenpai.sync(state);
  assert.equal(tenpai.beginConfirmedPreview(state, 17), true);

  const before = tenpai.preview({
    state,
    legalActions: {},
    selectedTileId: 0,
    riichiMode: false,
  });
  assert.deepEqual(before?.waits?.map((wait) => wait.type), [5, 8]);

  // This mirrors tableController.clearActionUi() after a solo action is
  // accepted. It may clear transient drag UI, but must not end a pointer-owned
  // status hold.
  assert.equal(tenpai.clearPreviewIntent(), false);

  const afterCleanup = tenpai.preview({
    state,
    legalActions: {},
    selectedTileId: 0,
    riichiMode: false,
  });
  assert.deepEqual(afterCleanup?.waits?.map((wait) => wait.type), [5, 8]);

  assert.equal(tenpai.endConfirmedPreview(17), true);
  assert.equal(
    tenpai.preview({
      state,
      legalActions: {},
      selectedTileId: 0,
      riichiMode: false,
    }),
    null,
  );
});

test("generic action UI cleanup still clears a transient drag preview", () => {
  const tenpai = createMahjongTableTenpaiState();
  const state = riichiState();
  const legalActions = {
    tenpaiDiscards: [
      {
        tileId: 13,
        furiten: false,
        waits: [{ type: 5, remaining: 3 }],
      },
    ],
  };

  tenpai.beginDragPreview(13);
  assert.deepEqual(
    tenpai.preview({
      state,
      legalActions,
      selectedTileId: 0,
      riichiMode: false,
    })?.waits?.map((wait) => wait.type),
    [5],
  );

  assert.equal(tenpai.clearPreviewIntent(), true);
  assert.equal(
    tenpai.preview({
      state,
      legalActions: {},
      selectedTileId: 0,
      riichiMode: false,
    }),
    null,
  );
});
