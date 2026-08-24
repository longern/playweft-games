import assert from "node:assert/strict";
import { test } from "node:test";

import { replayMahjongSoloSave } from "../games/mahjong/replay/solo-replay.js";

test("mahjong replay falls back to the action log when a checkpoint cannot load", async () => {
  const save = {
    checkpoint: { actionIndex: 1 },
    actions: [
      { action: { type: "discard", tileId: 11 }, actorId: "human" },
      { action: { type: "discard", tileId: 22 }, actorId: "ai-1" },
    ],
  };
  const originalSave = structuredClone(save);
  const applied = [];
  const game = {
    initialProjection: { state: { moveCount: 0 } },
    async restoreCheckpoint() {
      throw new Error("bad checkpoint");
    },
    async action(action, actorId) {
      applied.push({ action, actorId });
      return {
        result: { accepted: true },
        projection: { state: { moveCount: applied.length } },
      };
    },
  };

  const projection = await replayMahjongSoloSave({
    game,
    save,
    playerId: "human",
    onCheckpointError() {},
  });

  assert.deepEqual(applied, originalSave.actions);
  assert.equal(projection.state.moveCount, 2);
  assert.deepEqual(save, originalSave);
});

test("mahjong replay keeps the saved action log intact when replay is rejected", async () => {
  const save = {
    actions: [{ action: { type: "tsumo" }, actorId: "human" }],
  };
  const originalSave = structuredClone(save);
  const game = {
    initialProjection: { state: { moveCount: 0 } },
    async action() {
      return { result: { accepted: false, error: { code: "wrong_turn" } } };
    },
  };

  await assert.rejects(
    replayMahjongSoloSave({ game, save, playerId: "human" }),
    /saved action rejected: wrong_turn/,
  );
  assert.deepEqual(save, originalSave);
});
