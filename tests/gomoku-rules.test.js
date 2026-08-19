import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

const PROTOCOL_ADAPTER = `
local __protocol_setup = setup
setup = function(context)
  if context.match == nil then
    local players = {}
    for seat, id in ipairs(context.players) do
      players[seat] = { id = id, seat = seat }
    end
    context = {
      protocolVersion = 1,
      players = players,
      match = {
        id = "match_test",
        ownerId = context.hostId or context.players[1],
        startedAt = 0,
        randomSeed = context.randomSeed or "00000000000000000000000000000001",
      },
    }
  end
  return __protocol_setup(context)
end

local __protocol_action = on_action
on_action = function(state, action, context)
  if context.actor == nil then
    context = {
      protocolVersion = 1,
      matchId = "match_test",
      actionId = "action_test",
      actionAt = context.actionAt or 0,
      version = context.version or 0,
      actor = {
        id = context.playerId,
        role = "player",
        isOwner = context.playerId == state.hostId,
      },
    }
  end
  return __protocol_action(state, action, context)
end
`;

async function runLua(scenario, resultName = "result") {
  const source = await readFile("games/gomoku/game.lua", "utf8");
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${PROTOCOL_ADAPTER}\n${scenario}`);
    return lua.global.get(resultName);
  } finally {
    lua.global.close();
  }
}

test("Gomoku always starts on a 15 × 15 board", async () => {
  const result = await runLua(`
    state = setup({ players = { "a", "b" }, randomSeed = "00000000000000000000000000000001", hostId = "a" })
    invalid = on_action(state, {
      type = "start",
      blackMode = "player1",
      forbiddenMoves = false,
      size = 19
    }, { playerId = "a", actionAt = 100 })
    result = {
      size = #invalid.state.board,
      rowSize = #invalid.state.board[1],
      settingSize = invalid.state.settings.size,
      current = invalid.state.current
    }
  `);

  assert.deepEqual(result, {
    size: 15,
    rowSize: 15,
    settingSize: 15,
    current: 1,
  });
});

test("Gomoku alternates turns and rejects occupied points", async () => {
  const result = await runLua(`
    state = setup({ players = { "black", "white" }, randomSeed = "00000000000000000000000000000001", hostId = "black" })
    started = on_action(state, {
      type = "start",
      blackMode = "player1",
      forbiddenMoves = false
    }, { playerId = "black", actionAt = 100 })
    played = on_action(started.state, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 160 })
    occupied = on_action(played.state, {
      type = "play", row = 8, column = 8
    }, { playerId = "white", actionAt = 200 })
    result = {
      accepted = played.accepted,
      piece = played.state.board[8][8],
      current = played.state.current,
      moves = played.state.moves,
      blackTime = played.state.timeUsed[1],
      occupiedCode = occupied.error.code
    }
  `);

  assert.deepEqual(result, {
    accepted: true,
    piece: 1,
    current: 2,
    moves: 1,
    blackTime: 60,
    occupiedCode: "OCCUPIED",
  });
});

test("Gomoku detects horizontal, vertical, and diagonal five-in-a-row", async () => {
  const result = await runLua(`
    function ready()
      local state = setup({
        players = { "black", "white" },
        randomSeed = "00000000000000000000000000000001",
        hostId = "black"
      })
      return on_action(state, {
        type = "start",
        blackMode = "player1",
        forbiddenMoves = false
      }, { playerId = "black", actionAt = 0 }).state
    end

    horizontal = ready()
    vertical = ready()
    diagonal = ready()
    for offset = 0, 3 do
      horizontal.board[8][4 + offset] = 1
      vertical.board[4 + offset][8] = 1
      diagonal.board[4 + offset][4 + offset] = 1
    end
    horizontal.moves = 8
    vertical.moves = 8
    diagonal.moves = 8
    horizontal_result = on_action(horizontal, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 1 })
    vertical_result = on_action(vertical, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 1 })
    diagonal_result = on_action(diagonal, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 1 })
    result = {
      horizontal = horizontal_result.state.winner,
      horizontalCells = #horizontal_result.state.winningCells,
      vertical = vertical_result.state.winner,
      verticalCells = #vertical_result.state.winningCells,
      diagonal = diagonal_result.state.winner,
      diagonalCells = #diagonal_result.state.winningCells
    }
  `);

  assert.deepEqual(result, {
    horizontal: "black",
    horizontalCells: 5,
    vertical: "black",
    verticalCells: 5,
    diagonal: "black",
    diagonalCells: 5,
  });
});

test("Gomoku forbidden-move mode rejects black overlines", async () => {
  const result = await runLua(`
    state = setup({ players = { "black", "white" }, randomSeed = "00000000000000000000000000000001", hostId = "black" })
    state = on_action(state, {
      type = "start",
      blackMode = "player1",
      forbiddenMoves = true
    }, { playerId = "black", actionAt = 0 }).state
    for column = 4, 8 do state.board[8][column] = 1 end
    state.moves = 9
    result = on_action(state, {
      type = "play", row = 8, column = 9
    }, { playerId = "black", actionAt = 10 })
  `);

  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "FORBIDDEN_OVERLINE");
  assert.equal(result.state, undefined);
});

test("Gomoku forbidden-move mode rejects black double-four", async () => {
  const result = await runLua(`
    state = setup({ players = { "black", "white" }, randomSeed = "00000000000000000000000000000001", hostId = "black" })
    state = on_action(state, {
      type = "start",
      blackMode = "player1",
      forbiddenMoves = true
    }, { playerId = "black", actionAt = 0 }).state
    state.board[8][6] = 1
    state.board[8][7] = 1
    state.board[8][9] = 1
    state.board[6][8] = 1
    state.board[7][8] = 1
    state.board[9][8] = 1
    state.moves = 6
    result = on_action(state, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 10 })
  `);

  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "FORBIDDEN_DOUBLE_FOUR");
});

test("Gomoku forbidden-move mode rejects black double-three", async () => {
  const result = await runLua(`
    state = setup({ players = { "black", "white" }, randomSeed = "00000000000000000000000000000001", hostId = "black" })
    state = on_action(state, {
      type = "start",
      blackMode = "player1",
      forbiddenMoves = true
    }, { playerId = "black", actionAt = 0 }).state
    state.board[8][7] = 1
    state.board[8][9] = 1
    state.board[7][8] = 1
    state.board[9][8] = 1
    state.moves = 4
    result = on_action(state, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 10 })
  `);

  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "FORBIDDEN_DOUBLE_THREE");
});

test("Gomoku allows the same patterns without forbidden moves and for white", async () => {
  const result = await runLua(`
    free = setup({ players = { "black", "white" }, randomSeed = "00000000000000000000000000000001", hostId = "black" })
    free = on_action(free, {
      type = "start",
      blackMode = "player1",
      forbiddenMoves = false
    }, { playerId = "black", actionAt = 0 }).state
    restricted = setup({ players = { "black", "white" }, randomSeed = "00000000000000000000000000000001", hostId = "black" })
    restricted = on_action(restricted, {
      type = "start",
      blackMode = "player2",
      forbiddenMoves = true
    }, { playerId = "black", actionAt = 0 }).state
    free.board[8][7] = 1
    free.board[8][9] = 1
    free.board[7][8] = 1
    free.board[9][8] = 1
    free.moves = 4
    restricted.board[8][7] = 2
    restricted.board[8][9] = 2
    restricted.board[7][8] = 2
    restricted.board[9][8] = 2
    restricted.moves = 4
    restricted.current = 1
    free_result = on_action(free, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 10 })
    white_result = on_action(restricted, {
      type = "play", row = 8, column = 8
    }, { playerId = "black", actionAt = 10 })
    result = {
      freeAccepted = free_result.accepted,
      whiteAccepted = white_result.accepted
    }
  `);

  assert.deepEqual(result, { freeAccepted: true, whiteAccepted: true });
});

test("Gomoku rematches swap black and white", async () => {
  const result = await runLua(`
    state = setup({ players = { "a", "b" }, randomSeed = "00000000000000000000000000000001", hostId = "a" })
    state = on_action(state, {
      type = "start",
      blackMode = "player1",
      forbiddenMoves = false
    }, { playerId = "a", actionAt = 0 }).state
    state.ended = true
    state.phase = "ended"
    state.winner = "a"
    state.winnerIndex = 1
    result = on_action(state, {
      type = "rematch"
    }, { playerId = "b", actionAt = 100 })
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.state.blackIndex, 2);
  assert.equal(result.state.current, 2);
  assert.equal(result.state.round, 2);
  assert.equal(result.state.settings.forbiddenMoves, false);
});
