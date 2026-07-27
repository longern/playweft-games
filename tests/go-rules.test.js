import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

async function runGo(scenario) {
  const source = await readFile("go/game.lua", "utf8");
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${scenario}`);
    return lua.global.get("result");
  } finally {
    lua.global.close();
  }
}

test("Go captures a surrounded group and alternates turns", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    state.board[1][2] = 1
    state.board[2][1] = 1
    state.board[2][2] = 2
    state.board[2][3] = 1
    result = on_action(state, { type = "play", row = 3, column = 2 }, { playerId = "black" })
  `);

  assert.equal(result.state.board[1][1], 0);
  assert.equal(result.state.captures[0], 1);
  assert.equal(result.state.current, 2);
  assert.equal(result.state.lastEvent.captured, 1);
});

test("Go rejects occupied points, suicide, and out-of-turn play", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    state.board[1][2] = 2
    state.board[2][1] = 2
    suicide = on_action(state, { type = "play", row = 1, column = 1 }, { playerId = "black" })
    occupied = on_action(state, { type = "play", row = 1, column = 2 }, { playerId = "black" })
    wrong_turn = on_action(state, { type = "play", row = 3, column = 3 }, { playerId = "white" })
    result = {
      suicide = suicide.events[1].reason,
      occupied = occupied.events[1].reason,
      wrongTurn = wrong_turn.events[1].reason,
    }
  `);

  assert.deepEqual(result, {
    suicide: "suicide",
    occupied: "occupied",
    wrongTurn: "not_your_turn",
  });
});

test("Go enforces the simple ko rule", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    state.board[1][2] = 1
    state.board[2][1] = 1
    state.board[3][2] = 1
    state.board[2][2] = 2
    state.board[1][3] = 2
    state.board[3][3] = 2
    state.board[2][4] = 2
    captured = on_action(state, { type = "play", row = 2, column = 3 }, { playerId = "black" })
    result = on_action(captured.state, { type = "play", row = 2, column = 2 }, { playerId = "white" })
  `);

  assert.equal(result.events[0].reason, "ko");
  assert.equal(result.state.board[1][2], 1);
  assert.equal(result.state.board[1][1], 0);
});

test("Go ends and scores after two consecutive passes", async () => {
  const result = await runGo(`
    state = setup({ players = { "black", "white" } })
    state = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 6.5,
      handicap = 0, blackMode = "player1"
    }, { playerId = "black" }).state
    first = on_action(state, { type = "pass" }, { playerId = "black" })
    result = on_action(first.state, { type = "pass" }, { playerId = "white" })
  `);

  assert.equal(result.state.ended, true);
  assert.equal(result.state.scores.black, 0);
  assert.equal(result.state.scores.white, 6.5);
  assert.equal(result.state.winner, "white");
  assert.equal(result.events[0].type, "scored");
});

test("Go preserves board, rule, komi, colour, and handicap settings for a rematch", async () => {
  const result = await runGo(`
    state = setup({ players = { "a", "b" } })
    state = on_action(state, {
      type = "start", size = 13, rules = "japanese", komi = 0.5,
      handicap = 2, blackMode = "player2"
    }, { playerId = "a" }).state
    state.ended = true
    state.winner = "a"
    state.winnerIndex = 1
    result = on_action(state, { type = "rematch" }, { playerId = "b" })
  `);

  assert.equal(result.state.blackIndex, 2);
  assert.equal(result.state.current, 1);
  assert.equal(result.state.board.length, 13);
  assert.equal(result.state.settings.rules, "japanese");
  assert.equal(result.state.settings.komi, 0.5);
  assert.equal(result.state.settings.handicap, 2);
  assert.equal(result.state.board.flat().filter((point) => point === 1).length, 2);
  assert.equal(result.state.round, 2);
  assert.equal(result.events[0].type, "rematched");
});

test("Go allows only the host to submit setup", async () => {
  const result = await runGo(`
    state = setup({
      players = { "guest", "host" },
      hostId = "host",
      randomSeed = 12
    })
    denied = on_action(state, {
      type = "start", size = 19, rules = "chinese", komi = 7.5,
      handicap = 0, blackMode = "random"
    }, { playerId = "guest" })
    accepted = on_action(state, {
      type = "start", size = 19, rules = "chinese", komi = 7.5,
      handicap = 0, blackMode = "random"
    }, { playerId = "host" })
    result = {
      denied = denied.events[1].reason,
      phase = accepted.state.phase,
      size = accepted.state.settings.size,
      hostId = accepted.state.hostId,
    }
  `);

  assert.deepEqual(result, {
    denied: "only_host_can_setup",
    phase: "playing",
    size: 19,
    hostId: "host",
  });
});

test("Go requires fixed black for handicap games and starts with white", async () => {
  const result = await runGo(`
    state = setup({ players = { "a", "b" }, hostId = "a" })
    denied = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 0.5,
      handicap = 4, blackMode = "random"
    }, { playerId = "a" })
    accepted = on_action(state, {
      type = "start", size = 9, rules = "chinese", komi = 0.5,
      handicap = 4, blackMode = "player1"
    }, { playerId = "a" })
    result = {
      denied = denied.events[1].reason,
      current = accepted.state.current,
      stones = accepted.state.board,
    }
  `);

  assert.equal(result.denied, "handicap_requires_fixed_black");
  assert.equal(result.current, 2);
  assert.equal(result.stones.flat().filter((point) => point === 1).length, 4);
});

test("Go can return to setup after a game and keeps prior values editable by the host", async () => {
  const result = await runGo(`
    state = setup({ players = { "host", "guest" }, hostId = "host" })
    state = on_action(state, {
      type = "start", size = 13, rules = "japanese", komi = 5.5,
      handicap = 0, blackMode = "player2"
    }, { playerId = "host" }).state
    state.ended = true
    configured = on_action(state, { type = "configure" }, { playerId = "guest" })
    result = configured
  `);

  assert.equal(result.state.phase, "setup");
  assert.equal(result.state.round, 2);
  assert.equal(result.state.settings.size, 13);
  assert.equal(result.state.settings.rules, "japanese");
  assert.equal(result.state.settings.komi, 5.5);
  assert.equal(result.state.settings.blackMode, "player2");
  assert.equal(result.state.hostId, "host");
  assert.equal(result.events[0].type, "configuration_opened");
});
