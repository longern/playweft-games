import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongRoomSelfAnalysisController } from "../games/mahjong/app/room-self-analysis-controller.js";

function flushAnalysis() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("room self analysis restores one locked riichi wait without recalculating for remote moves", async () => {
  let lockedWaitRequests = 0;
  const lockedWaits = [];
  const controller = createMahjongRoomSelfAnalysisController({
    isRoom: () => true,
    getPlayerId: () => "self",
    getDestroyed: () => false,
    createGame: async () => ({
      riichiWaitReport: async () => {
        lockedWaitRequests += 1;
        return { tenpai: true, waits: [{ type: 9 }] };
      },
      legalActions: async () => ({}),
      close() {},
    }),
    applyLockedWait: (report) => lockedWaits.push(report),
  });
  const state = {
    phase: "playing",
    players: ["self", "right", "top", "left"],
    roundWind: 1,
    handNumber: 2,
    honba: 0,
    moveCount: 11,
    turnIndex: 2,
    ownHand: [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49],
    riichi: { self: true },
  };

  controller.sync(state);
  await flushAnalysis();
  controller.sync({ ...state, moveCount: 12, turnIndex: 3 });
  await flushAnalysis();

  assert.equal(lockedWaitRequests, 1);
  assert.deepEqual(lockedWaits, [{ tenpai: true, waits: [{ type: 9 }] }]);
  controller.destroy();
});
