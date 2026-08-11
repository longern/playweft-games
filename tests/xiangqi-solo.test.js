import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySoloXiangqiAction,
  createSoloXiangqiState,
} from "../games/xiangqi/solo.js";

function clearBoard(state) {
  state.board = Array.from({ length: 10 }, () => Array(9).fill(""));
  state.board[0][4] = "bK";
  state.board[9][4] = "rK";
  state.board[4][4] = "rE";
  state.current = 1;
  state.redIndex = 1;
  state.moves = 0;
  state.noCaptureMoves = 0;
  state.winner = "";
  state.winnerIndex = 0;
  state.draw = false;
  state.endReason = "";
  return state;
}

test("Solo Xiangqi starts immediately and alternates red and black locally", () => {
  let state = createSoloXiangqiState();
  assert.equal(state.current, 1);
  assert.equal(state.redIndex, 1);
  assert.equal(state.board[9][4], "rK");
  assert.equal(state.board[0][4], "bK");

  const red = applySoloXiangqiAction(state, {
    type: "move",
    fromRow: 7,
    fromColumn: 1,
    toRow: 6,
    toColumn: 1,
  });
  assert.equal(red.accepted, true);
  assert.equal(red.state.current, 2);
  assert.equal(red.state.board[5][0], "rP");

  const black = applySoloXiangqiAction(red.state, {
    type: "move",
    fromRow: 4,
    fromColumn: 1,
    toRow: 5,
    toColumn: 1,
  });
  assert.equal(black.accepted, true);
  assert.equal(black.state.current, 1);
  assert.equal(black.state.board[4][0], "bP");
  assert.equal(black.state.moves, 2);
});

test("Solo Xiangqi enforces cannon screens and does not mutate rejected state", () => {
  const state = clearBoard(createSoloXiangqiState());
  state.board[7][1] = "rC";
  state.board[5][1] = "rP";
  state.board[4][1] = "bP";
  state.board[2][1] = "bR";

  const result = applySoloXiangqiAction(state, {
    type: "move",
    fromRow: 8,
    fromColumn: 2,
    toRow: 3,
    toColumn: 2,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "ILLEGAL_MOVE");
  assert.equal(state.board[7][1], "rC");
  assert.equal(state.board[2][1], "bR");
  assert.equal(state.moves, 0);
});

test("Solo Xiangqi rejects a move that exposes facing generals", () => {
  const state = clearBoard(createSoloXiangqiState());
  state.board[4][4] = "rR";

  const result = applySoloXiangqiAction(state, {
    type: "move",
    fromRow: 5,
    fromColumn: 5,
    toRow: 5,
    toColumn: 4,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "ILLEGAL_MOVE");
});

test("Solo Xiangqi detects checkmate", () => {
  const state = clearBoard(createSoloXiangqiState());
  state.board[1][3] = "rR";
  state.board[1][5] = "rR";
  state.board[2][4] = "rR";

  const result = applySoloXiangqiAction(state, {
    type: "move",
    fromRow: 3,
    fromColumn: 5,
    toRow: 2,
    toColumn: 5,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.winner, "solo-player-1");
  assert.equal(result.state.winnerIndex, 1);
  assert.equal(result.state.endReason, "checkmate");
  assert.deepEqual(result.state.legalMoves, []);
});

test("Solo Xiangqi draws on the no-capture limit and swaps colors for a rematch", () => {
  const state = clearBoard(createSoloXiangqiState());
  state.noCaptureMoves = 119;
  state.board[6][0] = "rP";

  const drawn = applySoloXiangqiAction(state, {
    type: "move",
    fromRow: 7,
    fromColumn: 1,
    toRow: 6,
    toColumn: 1,
  });
  assert.equal(drawn.accepted, true);
  assert.equal(drawn.state.draw, true);
  assert.equal(drawn.state.endReason, "no_capture_limit");

  const rematch = applySoloXiangqiAction(drawn.state, { type: "rematch" });
  assert.equal(rematch.accepted, true);
  assert.equal(rematch.state.round, 2);
  assert.equal(rematch.state.redIndex, 2);
  assert.equal(rematch.state.current, 2);
  assert.equal(rematch.state.moves, 0);
});
