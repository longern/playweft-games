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
  const replayCalls = [];
  const game = {
    async replayActions(actions, options) {
      replayCalls.push({ actions, options });
      return {
        projection: { state: { moveCount: actions.length } },
        checkpointError: { name: "Error", message: "bad checkpoint" },
      };
    },
  };

  let checkpointError;

  const projection = await replayMahjongSoloSave({
    game,
    save,
    playerId: "human",
    onCheckpointError(error) {
      checkpointError = error;
    },
  });

  assert.equal(replayCalls.length, 1);
  assert.deepEqual(replayCalls[0].actions, originalSave.actions);
  assert.deepEqual(replayCalls[0].options, {
    checkpoint: originalSave.checkpoint,
    checkpointActionIndex: 1,
    restart: false,
    viewerId: "human",
  });
  assert.equal(checkpointError?.message, "bad checkpoint");
  assert.equal(projection.state.moveCount, 2);
  assert.deepEqual(save, originalSave);
});

test("mahjong replay keeps the saved action log intact when replay is rejected", async () => {
  const save = {
    actions: [{ action: { type: "tsumo" }, actorId: "human" }],
  };
  const originalSave = structuredClone(save);
  const game = {
    async replayActions() {
      throw new Error("Mahjong replay action 0 was rejected: wrong_turn");
    },
  };

  await assert.rejects(
    replayMahjongSoloSave({ game, save, playerId: "human" }),
    /replay action 0 was rejected: wrong_turn/,
  );
  assert.deepEqual(save, originalSave);
});
