import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applySoloGoAction,
  createSoloGoState,
} from "../games/go/solo.js";

function startSolo(settings = {}) {
  return applySoloGoAction(
    createSoloGoState(),
    {
      type: "start",
      size: 9,
      rules: "chinese",
      komi: 6.5,
      handicap: 0,
      blackMode: "player1",
      ...settings,
    },
    { now: 1000, random: () => 0 },
  ).state;
}

test("Go solo mode alternates black and white on one client", () => {
  let state = startSolo();
  const black = applySoloGoAction(
    state,
    { type: "play", row: 4, column: 4 },
    { now: 3500 },
  );
  state = black.state;
  const white = applySoloGoAction(
    state,
    { type: "play", row: 4, column: 5 },
    { now: 6000 },
  );

  assert.equal(black.accepted, true);
  assert.equal(black.state.board[3][3], 1);
  assert.equal(black.state.current, 2);
  assert.equal(black.state.timeUsed[0], 2500);
  assert.equal(white.accepted, true);
  assert.equal(white.state.board[3][4], 2);
  assert.equal(white.state.current, 1);
  assert.equal(white.state.timeUsed[1], 2500);
});

test("Go solo mode applies captures locally", () => {
  const state = startSolo();
  state.board[0][1] = 1;
  state.board[1][0] = 1;
  state.board[1][1] = 2;
  state.board[1][2] = 1;
  state.current = 1;

  const result = applySoloGoAction(
    state,
    { type: "play", row: 3, column: 2 },
    { now: 2000 },
  );

  assert.equal(result.accepted, true);
  assert.equal(result.state.board[1][1], 0);
  assert.equal(result.state.captures[0], 1);
});

test("Go solo mode scores after two passes on the same terminal", () => {
  let state = startSolo();
  state = applySoloGoAction(
    state,
    { type: "pass" },
    { now: 2000 },
  ).state;
  state = applySoloGoAction(
    state,
    { type: "pass" },
    { now: 3000 },
  ).state;

  assert.equal(state.phase, "scoring");
  const result = applySoloGoAction(
    state,
    { type: "score", scoreRound: state.scoreRound },
    { now: 3000 },
  );

  assert.equal(result.state.ended, true);
  assert.equal(result.state.scores.black, 0);
  assert.equal(result.state.scores.white, 6.5);
  assert.equal(result.state.winnerIndex, 2);
});

test("Go solo mode keeps settings for rematches and returns them to setup", () => {
  let state = startSolo({
    size: 13,
    rules: "japanese",
    komi: 5.5,
    handicap: 4,
    blackMode: "player2",
  });

  assert.equal(state.blackIndex, 2);
  assert.equal(state.current, 1);
  assert.equal(state.board.flat().filter((point) => point === 1).length, 4);

  state.ended = true;
  state.phase = "ended";
  const rematch = applySoloGoAction(
    state,
    { type: "rematch" },
    { now: 5000 },
  );
  assert.equal(rematch.accepted, true);
  assert.deepEqual(rematch.state.settings, state.settings);
  assert.equal(rematch.state.round, 2);
  assert.equal(rematch.state.board.flat().filter((point) => point === 1).length, 4);

  rematch.state.ended = true;
  rematch.state.phase = "ended";
  const configure = applySoloGoAction(
    rematch.state,
    { type: "configure" },
  );
  assert.equal(configure.accepted, true);
  assert.equal(configure.state.phase, "setup");
  assert.deepEqual(configure.state.settings, state.settings);
  assert.equal(configure.state.round, 3);
});
