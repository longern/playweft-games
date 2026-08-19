import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

const source = await readFile("games/xiangqi/game.lua", "utf8");

async function runScenario(scenario, resultName = "result") {
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${scenario}`);
    return lua.global.get(resultName);
  } finally {
    lua.global.close();
  }
}

const setupContext = `{
  protocolVersion = 1,
  players = { { id = "red", seat = 1 }, { id = "black", seat = 2 } },
  match = { id = "xiangqi_test", ownerId = "red", startedAt = 0, randomSeed = "00000000000000000000000000000001" },
}`;

function actionContext(player) {
  return `{
    protocolVersion = 1,
    matchId = "xiangqi_test",
    actionId = "move_test",
    actionAt = 1,
    version = 0,
    actor = { id = "${player}", role = "player", seat = 1, isOwner = ${player === "red"} },
  }`;
}

const clearBoard = `
  for row = 1, 10 do
    for column = 1, 9 do state.board[row][column] = "" end
  end
  state.current = 1
  state.redIndex = 1
  state.winner = ""
  state.winnerIndex = 0
  state.draw = false
  state.endReason = ""
  state.inCheck = false
  state.moves = 0
  state.noCaptureMoves = 0
  state.board[1][5] = "bK"
  state.board[10][5] = "rK"
  state.board[5][5] = "rE"
`;

test("Xiangqi starts from the standard position with red to move", async () => {
  const result = await runScenario(`
    state = setup(${setupContext})
    rejected = on_action(state, {
      type = "move", fromRow = 4, fromColumn = 1, toRow = 5, toColumn = 1,
    }, ${actionContext("black")})
    accepted = on_action(state, {
      type = "move", fromRow = 7, fromColumn = 1, toRow = 6, toColumn = 1,
    }, ${actionContext("red")})
    result = { rejected = rejected, accepted = accepted }
  `);

  assert.equal(result.rejected.error.code, "NOT_YOUR_TURN");
  assert.equal(result.accepted.accepted, true);
  assert.equal(result.accepted.state.board[5][0], "rP");
  assert.equal(result.accepted.state.current, 2);
  assert.ok(result.accepted.state.legalMoves.length > 30);
});

test("Xiangqi enforces horse legs, elephant eyes, and the river", async () => {
  const result = await runScenario(`
    state = setup(${setupContext})
    ${clearBoard}
    state.board[10][2] = "rN"
    state.board[9][2] = "rP"
    horse_blocked = on_action(state, {
      type = "move", fromRow = 10, fromColumn = 2, toRow = 8, toColumn = 3,
    }, ${actionContext("red")})

    state.board[10][2] = ""
    state.board[9][2] = ""
    state.board[8][3] = "rE"
    state.board[7][4] = "rP"
    elephant_blocked = on_action(state, {
      type = "move", fromRow = 8, fromColumn = 3, toRow = 6, toColumn = 5,
    }, ${actionContext("red")})
    state.board[7][4] = ""
    elephant_river = on_action(state, {
      type = "move", fromRow = 8, fromColumn = 3, toRow = 6, toColumn = 5,
    }, ${actionContext("red")})
    state.current = 1
    state.board[8][3] = ""
    state.board[6][3] = "rE"
    elephant_crossing = on_action(state, {
      type = "move", fromRow = 6, fromColumn = 3, toRow = 4, toColumn = 5,
    }, ${actionContext("red")})
    result = {
      horse = horse_blocked.error.code,
      eye = elephant_blocked.error.code,
      legal = elephant_river.accepted,
      crossing = elephant_crossing.error.code,
    }
  `);

  assert.deepEqual(result, {
    horse: "ILLEGAL_MOVE",
    eye: "ILLEGAL_MOVE",
    legal: true,
    crossing: "ILLEGAL_MOVE",
  });
});

test("Xiangqi cannon captures over exactly one screen", async () => {
  const result = await runScenario(`
    state = setup(${setupContext})
    ${clearBoard}
    state.board[8][2] = "rC"
    state.board[5][2] = "rP"
    state.board[3][2] = "bR"
    capture = on_action(state, {
      type = "move", fromRow = 8, fromColumn = 2, toRow = 3, toColumn = 2,
    }, ${actionContext("red")})

    state = setup(${setupContext})
    ${clearBoard}
    state.board[8][2] = "rC"
    state.board[6][2] = "rP"
    state.board[5][2] = "bP"
    state.board[3][2] = "bR"
    blocked = on_action(state, {
      type = "move", fromRow = 8, fromColumn = 2, toRow = 3, toColumn = 2,
    }, ${actionContext("red")})
    result = { capture = capture, blocked = blocked }
  `);

  assert.equal(result.capture.accepted, true);
  assert.equal(result.capture.state.board[2][1], "rC");
  assert.equal(result.capture.events[0].type, "captured");
  assert.equal(result.blocked.error.code, "ILLEGAL_MOVE");
});

test("Xiangqi rejects moves that expose the two generals", async () => {
  const result = await runScenario(`
    state = setup(${setupContext})
    ${clearBoard}
    state.board[5][5] = "rR"
    result = on_action(state, {
      type = "move", fromRow = 5, fromColumn = 5, toRow = 5, toColumn = 4,
    }, ${actionContext("red")})
  `);

  assert.equal(result.error.code, "ILLEGAL_MOVE");
});

test("Xiangqi detects checkmate and stalemate as wins", async () => {
  const result = await runScenario(`
    state = setup(${setupContext})
    ${clearBoard}
    state.board[5][5] = "rE"
    state.board[2][4] = "rR"
    state.board[2][6] = "rR"
    state.board[3][5] = "rR"
    mate = on_action(state, {
      type = "move", fromRow = 3, fromColumn = 5, toRow = 2, toColumn = 5,
    }, ${actionContext("red")})

    state = setup(${setupContext})
    ${clearBoard}
    state.board[2][4] = "rR"
    state.board[2][6] = "rR"
    state.board[4][4] = "rN"
    state.board[6][1] = "rP"
    stale = on_action(state, {
      type = "move", fromRow = 6, fromColumn = 1, toRow = 5, toColumn = 1,
    }, ${actionContext("red")})
    result = { mate = mate, stale = stale }
  `);

  assert.equal(result.mate.state.winner, "red");
  assert.equal(result.mate.state.endReason, "checkmate");
  assert.equal(result.stale.state.winner, "red");
  assert.equal(result.stale.state.endReason, "stalemate");
});

test("Xiangqi draws after 120 non-capturing moves and swaps colors on rematch", async () => {
  const result = await runScenario(`
    state = setup(${setupContext})
    ${clearBoard}
    state.noCaptureMoves = 119
    state.board[7][1] = "rP"
    drawn = on_action(state, {
      type = "move", fromRow = 7, fromColumn = 1, toRow = 6, toColumn = 1,
    }, ${actionContext("red")})
    rematch = on_action(drawn.state, { type = "rematch" }, ${actionContext("black")})
    result = { drawn = drawn, rematch = rematch }
  `);

  assert.equal(result.drawn.state.draw, true);
  assert.equal(result.drawn.state.endReason, "no_capture_limit");
  assert.equal(result.rematch.state.redIndex, 2);
  assert.equal(result.rematch.state.current, 2);
  assert.equal(result.rematch.state.round, 2);
});
