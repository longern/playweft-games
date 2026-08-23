import assert from "node:assert/strict";
import { test } from "node:test";

import { orientMahjongRoomProjection } from "../games/mahjong/room-state.js";

test("room projection keeps its viewer at the bottom without changing private tiles", () => {
  const projection = {
    state: {
      players: ["p1", "p2", "p3", "p4"],
      playerNames: ["一", "二", "三", "四"],
      scores: [21000, 22000, 23000, 24000],
      scoreHistory: [{ scores: [21000, 22000, 23000, 24000] }],
      dealerIndex: 2,
      turnIndex: 4,
      responseIndex: 1,
      drawnPlayerIndex: 3,
      winnerIndex: 1,
      abortivePlayerIndex: 4,
      ownHand: [11, 12, 13],
      handCounts: { p1: 13, p2: 13, p3: 13, p4: 13 },
      melds: {
        p1: [{ kind: "pon", fromIndex: 4 }],
        p2: [],
        p3: [],
        p4: [],
      },
      result: {
        winnerIndex: 1,
        paoSeat: 4,
        paoSeats: [2, 4],
        deltas: [3000, -1000, -1000, -1000],
        tenpai: [true, false, true, false],
        tenpaiWaits: [[1], [], [9], []],
      },
      results: [{ winnerIndex: 4, deltas: [-1000, -1000, -1000, 3000] }],
    },
    events: [{ type: "won", playerIndex: 1, fromIndex: 4 }],
  };

  const oriented = orientMahjongRoomProjection(projection, "p3");

  assert.deepEqual(oriented.state.players, ["p3", "p4", "p1", "p2"]);
  assert.deepEqual(oriented.state.playerNames, ["三", "四", "一", "二"]);
  assert.deepEqual(oriented.state.scores, [23000, 24000, 21000, 22000]);
  assert.deepEqual(oriented.state.scoreHistory[0].scores, [23000, 24000, 21000, 22000]);
  assert.equal(oriented.state.dealerIndex, 4);
  assert.equal(oriented.state.turnIndex, 2);
  assert.equal(oriented.state.responseIndex, 3);
  assert.equal(oriented.state.drawnPlayerIndex, 1);
  assert.equal(oriented.state.winnerIndex, 3);
  assert.equal(oriented.state.abortivePlayerIndex, 2);
  assert.equal(oriented.state.melds.p1[0].fromIndex, 2);
  assert.deepEqual(oriented.state.result.deltas, [-1000, -1000, 3000, -1000]);
  assert.deepEqual(oriented.state.result.tenpai, [true, false, true, false]);
  assert.deepEqual(oriented.state.result.tenpaiWaits, [[9], [], [1], []]);
  assert.equal(oriented.state.result.winnerIndex, 3);
  assert.equal(oriented.state.result.paoSeat, 2);
  assert.deepEqual(oriented.state.result.paoSeats, [4, 2]);
  assert.equal(oriented.state.results[0].winnerIndex, 2);
  assert.deepEqual(oriented.events, [{ type: "won", playerIndex: 3, fromIndex: 2 }]);
  assert.deepEqual(oriented.state.ownHand, [11, 12, 13]);
  assert.equal(oriented.state.handCounts[oriented.state.players[0]], 13);
  assert.deepEqual(projection.state.players, ["p1", "p2", "p3", "p4"]);
});
