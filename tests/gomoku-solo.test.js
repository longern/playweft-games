import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySoloGomokuAction,
  createSoloGomokuState,
} from "../games/gomoku/solo.js";

function startSolo(settings = {}, now = 100) {
  const result = applySoloGomokuAction(
    createSoloGomokuState(),
    {
      type: "start",
      blackMode: "player1",
      forbiddenMoves: false,
      ...settings,
    },
    { now, random: () => 0 },
  );
  assert.equal(result.accepted, true);
  return result.state;
}

test("Solo Gomoku uses a fixed 15 × 15 board and alternates local turns", () => {
  let state = startSolo();
  const black = applySoloGomokuAction(
    state,
    { type: "play", row: 8, column: 8 },
    { now: 160 },
  );
  assert.equal(black.accepted, true);
  state = black.state;

  const white = applySoloGomokuAction(
    state,
    { type: "play", row: 8, column: 9 },
    { now: 240 },
  );
  assert.equal(white.accepted, true);
  assert.equal(white.state.board.length, 15);
  assert.equal(white.state.board[0].length, 15);
  assert.equal(white.state.board[7][7], 1);
  assert.equal(white.state.board[7][8], 2);
  assert.equal(white.state.current, 1);
  assert.equal(white.state.moves, 2);
  assert.deepEqual(white.state.timeUsed, [60, 80]);
});

test("Solo Gomoku detects a win on the local board", () => {
  const state = startSolo();
  for (let column = 4; column <= 7; column += 1) {
    state.board[7][column - 1] = 1;
  }
  state.moves = 8;

  const result = applySoloGomokuAction(
    state,
    { type: "play", row: 8, column: 8 },
    { now: 200 },
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.ended, true);
  assert.equal(result.state.winner, "solo-player-1");
  assert.equal(result.state.winnerIndex, 1);
  assert.equal(result.state.winningCells.length, 5);
});

test("Solo Gomoku enforces black forbidden moves without mutating rejected state", () => {
  const state = startSolo({ forbiddenMoves: true });
  state.board[7][6] = 1;
  state.board[7][8] = 1;
  state.board[6][7] = 1;
  state.board[8][7] = 1;
  state.moves = 4;

  const result = applySoloGomokuAction(
    state,
    { type: "play", row: 8, column: 8 },
    { now: 200 },
  );

  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "FORBIDDEN_DOUBLE_THREE");
  assert.equal(state.board[7][7], 0);
  assert.equal(state.moves, 4);
});

test("Solo Gomoku rematches swap black and white while preserving settings", () => {
  const state = startSolo({ forbiddenMoves: true });
  state.phase = "ended";
  state.ended = true;
  state.winner = "solo-player-1";
  state.winnerIndex = 1;

  const result = applySoloGomokuAction(
    state,
    { type: "rematch" },
    { now: 300 },
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.round, 2);
  assert.equal(result.state.blackIndex, 2);
  assert.equal(result.state.current, 2);
  assert.equal(result.state.settings.forbiddenMoves, true);
  assert.equal(result.state.moves, 0);
});

test("Solo Gomoku can return to editable setup after a finished game", () => {
  const state = startSolo({ blackMode: "player2", forbiddenMoves: true });
  state.phase = "ended";
  state.ended = true;

  const result = applySoloGomokuAction(state, { type: "configure" });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "setup");
  assert.equal(result.state.round, 2);
  assert.equal(result.state.settings.blackMode, "player2");
  assert.equal(result.state.settings.forbiddenMoves, true);
});
