import assert from "node:assert/strict";
import { test } from "node:test";

import {
  goRecordToSgf,
  historyResultLabel,
  updateGoHistory,
} from "../games/go/history.js";

function gameState(overrides = {}) {
  return {
    players: ["black", "white"],
    phase: "playing",
    settings: {
      size: 9,
      rules: "chinese",
      komi: 6.5,
      handicap: 0,
      blackMode: "player1",
    },
    board: Array.from({ length: 9 }, () => Array(9).fill(0)),
    current: 1,
    blackIndex: 1,
    captures: [0, 0],
    timeUsed: [0, 0],
    moves: 0,
    ended: false,
    lastMove: { row: 0, column: 0 },
    lastEvent: { kind: "start", playerIndex: 1 },
    round: 1,
    ...overrides,
  };
}

test("Go history records moves once and exports SGF", () => {
  let records = updateGoHistory([], {
    matchId: "match-one",
    version: 1,
    state: gameState(),
    events: [{ type: "started", player: "black" }],
  }, Date.UTC(2026, 6, 28, 10));

  const board = gameState().board;
  board[3][3] = 1;
  const played = {
    matchId: "match-one",
    version: 2,
    state: gameState({
      board,
      current: 2,
      moves: 1,
      timeUsed: [3500, 0],
      lastMove: { row: 4, column: 4 },
      lastEvent: { kind: "play", playerIndex: 1 },
    }),
    events: [{ type: "played", player: "black", row: 4, column: 4 }],
  };
  records = updateGoHistory(records, played, Date.UTC(2026, 6, 28, 10, 1));
  records = updateGoHistory(records, played, Date.UTC(2026, 6, 28, 10, 2));

  assert.equal(records.length, 1);
  assert.equal(records[0].moves.length, 1);
  assert.deepEqual(records[0].moves[0], {
    color: "B",
    pass: false,
    row: 4,
    column: 4,
    elapsedMs: 3500,
    cumulativeMs: 3500,
    version: 2,
  });
  assert.match(goRecordToSgf(records[0]), /SZ\[9\].*KM\[6.5\].*;B\[dd\]/);
});

test("Go history stores the confirmed result", () => {
  const records = updateGoHistory([], {
    matchId: "match-two",
    version: 8,
    state: gameState({
      phase: "ended",
      ended: true,
      winner: "white",
      winnerIndex: 2,
      scores: { black: 1, white: 7.5 },
      lastEvent: { kind: "scored", playerIndex: 2 },
    }),
    events: [{ type: "scored", winner: "white" }],
  });

  assert.equal(historyResultLabel(records[0]), "白方胜 6.5 目");
  assert.match(goRecordToSgf(records[0]), /RE\[W\+6.5\]/);
});

test("Go history stores resignation as an SGF resignation result", () => {
  const records = updateGoHistory([], {
    matchId: "match-resigned",
    version: 3,
    state: gameState({
      phase: "ended",
      ended: true,
      winner: "white",
      winnerIndex: 2,
      lastEvent: { kind: "resigned", playerIndex: 1 },
    }),
    events: [{ type: "resigned", player: "black", winner: "white" }],
  });

  assert.equal(historyResultLabel(records[0]), "白方胜");
  assert.match(goRecordToSgf(records[0]), /RE\[W\+R\]/);
});
