import assert from "node:assert/strict";
import { test } from "node:test";

import {
  orientMahjongPaipuRecord,
  orientMahjongRoomProjection,
} from "../games/mahjong/rules/room-state.js";

test("room projection keeps its viewer at the bottom without changing canonical paipu", () => {
  const projection = {
    state: {
      players: ["p1", "p2", "p3", "p4"],
      playerNames: ["一", "二", "三", "四"],
      scores: [21000, 22000, 23000, 24000],
      scoreHistory: [{ scores: [21000, 22000, 23000, 24000] }],
      initialDealerIndex: 1,
      dealerIndex: 2,
      turnIndex: 4,
      responseIndex: 1,
      drawnPlayerIndex: 3,
      winnerIndex: 1,
      abortivePlayerIndex: 4,
      ownHand: [11, 12, 13],
      handCounts: { p1: 13, p2: 13, p3: 13, p4: 13 },
      melds: { p1: [{ kind: "pon", fromIndex: 4 }], p2: [], p3: [], p4: [] },
      result: {
        winnerIndex: 1,
        paoSeat: 4,
        paoSeats: [2, 4],
        deltas: [3000, -1000, -1000, -1000],
        tenpai: [true, false, true, false],
        tenpaiWaits: [[1], [], [9], []],
      },
      results: [{ winnerIndex: 4, deltas: [-1000, -1000, -1000, 3000] }],
      paipu: {
        viewerPlayerId: "p1",
        players: [
          { seat: 1, id: "p1" }, { seat: 2, id: "p2" },
          { seat: 3, id: "p3" }, { seat: 4, id: "p4" },
        ],
        hands: [{
          round: { dealerSeat: 2 },
          startScores: [21000, 22000, 23000, 24000],
          commands: [{ seat: 4 }],
          events: [{ type: "won", playerIndex: 1, fromIndex: 4 }],
          end: {
            winners: [1], result: { winnerIndex: 4, paoSeat: 2 },
            scores: [21000, 22000, 23000, 24000],
          },
        }],
        final: { scores: [21000, 22000, 23000, 24000], ranks: [3, 2, 1, 4] },
      },
    },
    events: [{ type: "won", playerIndex: 1, fromIndex: 4 }],
  };

  const canonicalPaipu = projection.state.paipu;
  const oriented = orientMahjongRoomProjection(projection, "p3");

  assert.deepEqual(oriented.state.players, ["p3", "p4", "p1", "p2"]);
  assert.deepEqual(oriented.state.playerNames, ["三", "四", "一", "二"]);
  assert.deepEqual(oriented.state.scores, [23000, 24000, 21000, 22000]);
  assert.deepEqual(oriented.state.scoreHistory[0].scores, [23000, 24000, 21000, 22000]);
  assert.equal(oriented.state.initialDealerIndex, 3);
  assert.equal(oriented.state.dealerIndex, 4);
  assert.equal(oriented.state.turnIndex, 2);
  assert.equal(oriented.state.responseIndex, 3);
  assert.equal(oriented.state.drawnPlayerIndex, 1);
  assert.equal(oriented.state.winnerIndex, 3);
  assert.equal(oriented.state.abortivePlayerIndex, 2);
  assert.equal(oriented.state.melds.p1[0].fromIndex, 2);
  assert.deepEqual(oriented.state.result.deltas, [-1000, -1000, 3000, -1000]);
  assert.equal(oriented.state.result.winnerIndex, 3);
  assert.equal(oriented.state.result.paoSeat, 2);
  assert.deepEqual(oriented.state.results[0].deltas, [-1000, 3000, -1000, -1000]);
  assert.strictEqual(oriented.state.paipu, canonicalPaipu);
  assert.equal(oriented.state.paipu.hands[0].commands[0].seat, 4);
  assert.deepEqual(oriented.events, [{ type: "won", playerIndex: 3, fromIndex: 2 }]);
  assert.deepEqual(oriented.state.ownHand, [11, 12, 13]);
  assert.deepEqual(projection.state.players, ["p1", "p2", "p3", "p4"]);
});

test("paipu remains canonical regardless of viewer id", () => {
  const record = {
    viewerPlayerId: "p3",
    players: [
      { id: "p1", seat: 1 }, { id: "p2", seat: 2 },
      { id: "p3", seat: 3 }, { id: "p4", seat: 4 },
    ],
    hands: [{
      round: { dealerSeat: 2 },
      startScores: [1, 2, 3, 4],
      commands: [{ seat: 3 }],
    }],
    final: { scores: [1, 2, 3, 4], ranks: [4, 3, 1, 2] },
  };
  const replayRecord = orientMahjongPaipuRecord(record, record.viewerPlayerId);
  assert.strictEqual(replayRecord, record);
  assert.deepEqual(replayRecord.players.map(({ id, seat }) => ({ id, seat })), [
    { id: "p1", seat: 1 }, { id: "p2", seat: 2 },
    { id: "p3", seat: 3 }, { id: "p4", seat: 4 },
  ]);
  assert.deepEqual(replayRecord.final.scores, [1, 2, 3, 4]);
  assert.equal(replayRecord.hands[0].commands[0].seat, 3);
  assert.equal(replayRecord.players[replayRecord.hands[0].commands[0].seat - 1].id, "p3");
});
