import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

async function runLua(gamePath, scenario, resultName = "result") {
  const source = await readFile(gamePath, "utf8");
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${scenario}`);
    return lua.global.get(resultName);
  } finally {
    lua.global.close();
  }
}

test("Pig Dice produces a deterministic server-side roll", async () => {
  const result = await runLua(
    "pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = 123 })
      result = on_action(state, { type = "roll" }, { playerId = "a", version = 0 })
    `,
  );

  assert.equal(result.state.lastRoll, 4);
  assert.equal(result.state.turnTotal, 4);
  assert.equal(result.state.seed, 5937333);
  assert.equal(result.state.turnIndex, 1);
});

test("Pig Dice clears the turn total on a one and advances the turn", async () => {
  const result = await runLua(
    "pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = 6 })
      state.turnTotal = 18
      result = on_action(state, { type = "roll" }, { playerId = "a", version = 0 })
    `,
  );

  assert.equal(result.state.lastRoll, 1);
  assert.equal(result.state.turnTotal, 0);
  assert.equal(result.state.turnIndex, 2);
  assert.equal(result.events[0].type, "bust");
});

test("Pig Dice banks a winning score and rejects out-of-turn actions", async () => {
  const result = await runLua(
    "pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = 123 })
      rejected = on_action(state, { type = "roll" }, { playerId = "b", version = 0 })
      state.scores.a = 49
      state.turnTotal = 3
      result = on_action(state, { type = "bank" }, { playerId = "a", version = 1 })
    `,
  );
  const rejected = await runLua(
    "pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = 123 })
      result = on_action(state, { type = "roll" }, { playerId = "b", version = 0 })
    `,
  );

  assert.equal(rejected.events[0].reason, "not_your_turn");
  assert.equal(result.state.scores.a, 52);
  assert.equal(result.state.winner, "a");
  assert.equal(result.events[0].type, "won");
});

test("Pig Dice starts a fresh rematch with the other player going first", async () => {
  const result = await runLua(
    "pig-dice/game.lua",
    `
      state = setup({ players = { "a", "b" }, randomSeed = 123 })
      state.scores.a = 52
      state.scores.b = 31
      state.winner = "a"
      state.seed = 456
      result = on_action(state, { type = "rematch" }, { playerId = "b", version = 9 })
    `,
  );

  assert.deepEqual(result.state.scores, { a: 0, b: 0 });
  assert.equal(result.state.winner, "");
  assert.equal(result.state.turnIndex, 2);
  assert.equal(result.state.round, 2);
  assert.equal(result.state.seed, 456);
  assert.equal(result.events[0].type, "rematched");
});

test("Connect Four applies gravity and alternates turns", async () => {
  const result = await runLua(
    "connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = 1 })
      result = on_action(state, { type = "drop", column = 4 }, { playerId = "red", version = 0 })
    `,
  );

  assert.equal(result.state.board[5][3], 1);
  assert.equal(result.state.lastMove.row, 6);
  assert.equal(result.state.lastMove.column, 4);
  assert.equal(result.state.current, 2);
});

test("Connect Four rejects invalid columns and the wrong player", async () => {
  const invalid = await runLua(
    "connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = 1 })
      result = on_action(state, { type = "drop", column = 8 }, { playerId = "red", version = 0 })
    `,
  );
  const wrongTurn = await runLua(
    "connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = 1 })
      result = on_action(state, { type = "drop", column = 1 }, { playerId = "yellow", version = 0 })
    `,
  );

  assert.equal(invalid.events[0].reason, "invalid_column");
  assert.equal(wrongTurn.events[0].reason, "not_your_turn");
});

test("Connect Four detects vertical, horizontal, and diagonal wins", async () => {
  const winners = await runLua(
    "connect-four/game.lua",
    `
      vertical = setup({ players = { "red", "yellow" }, randomSeed = 1 })
      vertical.board[6][1] = 1
      vertical.board[5][1] = 1
      vertical.board[4][1] = 1
      vertical.moves = 3
      vertical_result = on_action(vertical, { type = "drop", column = 1 }, { playerId = "red", version = 0 })

      horizontal = setup({ players = { "red", "yellow" }, randomSeed = 1 })
      horizontal.board[6][1] = 1
      horizontal.board[6][2] = 1
      horizontal.board[6][3] = 1
      horizontal.moves = 3
      horizontal_result = on_action(horizontal, { type = "drop", column = 4 }, { playerId = "red", version = 0 })

      diagonal = setup({ players = { "red", "yellow" }, randomSeed = 1 })
      diagonal.board[6][1] = 1
      diagonal.board[5][2] = 1
      diagonal.board[4][3] = 1
      diagonal.board[6][4] = 2
      diagonal.board[5][4] = 2
      diagonal.board[4][4] = 2
      diagonal.moves = 6
      diagonal_result = on_action(diagonal, { type = "drop", column = 4 }, { playerId = "red", version = 0 })

      result = {
        vertical = vertical_result.state,
        horizontal = horizontal_result.state,
        diagonal = diagonal_result.state,
      }
    `,
  );

  for (const state of Object.values(winners)) {
    assert.equal(state.winner, "red");
    assert.equal(state.winnerIndex, 1);
    assert.ok(state.winningCells.length >= 4);
  }
});

test("Connect Four clears the board and rotates the starter for a rematch", async () => {
  const result = await runLua(
    "connect-four/game.lua",
    `
      state = setup({ players = { "red", "yellow" }, randomSeed = 1 })
      state.board[6][1] = 1
      state.moves = 1
      state.winner = "red"
      state.winnerIndex = 1
      result = on_action(state, { type = "rematch" }, { playerId = "yellow", version = 8 })
    `,
  );

  assert.equal(result.state.board[5][0], 0);
  assert.equal(result.state.moves, 0);
  assert.equal(result.state.winner, "");
  assert.equal(result.state.current, 2);
  assert.equal(result.state.round, 2);
  assert.equal(result.events[0].type, "rematched");
});
