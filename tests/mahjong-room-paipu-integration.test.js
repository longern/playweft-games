import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

import { buildMahjongOnlineSource } from "../games/mahjong/room-paipu-online-source.js";
import { buildCompletedRoomPaipuRecord } from "../games/mahjong/replay/room-paipu.js";
import { validateMahjongPaipu } from "../games/mahjong/replay/paipu-store.js";

async function runOnlineScenario(scenario) {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const source = buildMahjongOnlineSource(fullSource);
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${scenario}`);
    return lua.global.get("result");
  } finally {
    lua.global.close();
  }
}

async function exportCompletedRoomPaipu() {
  return runOnlineScenario(String.raw`
    local lobby = setup({
      serverTime = 1000,
      players = {
        { id = "p1", name = "One", seat = 1 },
        { id = "p2", name = "Two", seat = 2 },
        { id = "p3", name = "Three", seat = 3 },
        { id = "p4", name = "Four", seat = 4 },
      },
      match = {
        id = "room-paipu-integration",
        ownerId = "p1",
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local started = on_action(lobby.state, {
      type = "start_match",
      matchType = "east",
      rules = {},
    }, {
      serverTime = 1001,
      actor = { id = "p1", isOwner = true },
    })
    assert(started.accepted == true)
    local state = started.state

    -- Record a real discard first so the exported command must carry a
    -- wall-relative tile ref. This catches accidental clearing of the
    -- authoritative paipuTilePositions map between room actions.
    local first_actor = state.players[1]
    local first_tile = state.drawnTile
    local discarded = on_action(state, {
      type = "discard",
      tileId = first_tile,
    }, {
      serverTime = 1002,
      actor = { id = first_actor, seat = 1 },
    })
    assert(discarded.accepted == true)
    state = discarded.state

    -- Force the next authoritative action into a deterministic terminal
    -- hand. Bankruptcy ends the match; nine terminals gives us a cheap,
    -- legal hand-ending action without depending on random scoring.
    local terminal_actor = state.players[2]
    state.phase = "playing"
    state.turnIndex = 2
    state.claimants = {}
    state.claimResponses = {}
    state.claimIndex = 0
    state.lastDiscard = nil
    state.callOccurred = false
    state.firstTurn[terminal_actor] = true
    state.melds[terminal_actor] = {}
    state.hands[terminal_actor] = {
      1, 33, 37, 69, 73, 105, 109,
      113, 117, 121, 125, 129, 133,
    }
    state.drawnTile = 2
    state.scores[4] = -100

    local ended = on_action(state, { type = "abort_nine" }, {
      serverTime = 1003,
      actor = { id = terminal_actor, seat = 2 },
    })
    assert(ended.accepted == true)
    state = ended.state
    assert(state.matchEnded == true)

    local projection = view(state, {}, {
      serverTime = 1004,
      viewer = { id = first_actor, seat = 1, isOwner = first_actor == state.roomOwnerId },
    })
    result = {
      paipu = projection.state.paipu,
      viewerId = first_actor,
    }
  `);
}

test("Mahjong room exports a saveable and replayable authoritative final hand", async () => {
  const exported = await exportCompletedRoomPaipu();
  assert.equal(exported.paipu.status, "completed");
  assert.equal(exported.paipu.game.mode, "room");
  assert.ok(exported.paipu.hands[0].end);
  assert.ok(exported.paipu.hands[0].commands.length >= 2);
  assert.ok(exported.paipu.hands[0].events.length >= 2);

  const record = buildCompletedRoomPaipuRecord({
    paipu: exported.paipu,
    matchId: "room-paipu-integration",
    viewerPlayerId: exported.viewerId,
    completedAtMs: 1_780_000_000_000,
  });
  delete record.roomFragment;
  const validated = validateMahjongPaipu(record);
  assert.equal(validated.id, "room-paipu-integration:room");

  const discard = validated.hands[0].commands.find(
    (command) => command?.action?.type === "discard",
  );
  assert.ok(discard, "room paipu should contain the authoritative discard");
  assert.match(discard.action.tile, /^(?:[1-9][mps]|0[mps]|[1-7]z)$/);
  assert.equal(typeof discard.action.tsumogiri, "boolean");
});

test("Mahjong room streams a completed hand, then keeps only the new current hand", async () => {
  const streamed = await runOnlineScenario(String.raw`
    local lobby = setup({
      serverTime = 3000,
      players = {
        { id = "p1", name = "One", seat = 1 },
        { id = "p2", name = "Two", seat = 2 },
        { id = "p3", name = "Three", seat = 3 },
        { id = "p4", name = "Four", seat = 4 },
      },
      match = {
        id = "room-paipu-streaming",
        ownerId = "p1",
        randomSeed = "0000000000000000000000000000004a",
      },
    })
    local started = on_action(lobby.state, {
      type = "start_match",
      matchType = "east",
      rules = {},
    }, {
      serverTime = 3001,
      actor = { id = "p1", isOwner = true },
    })
    assert(started.accepted == true)
    local state = started.state
    local first_actor = state.players[1]

    local discarded = on_action(state, {
      type = "discard",
      tileId = state.drawnTile,
      tenpaiReport = { witness = string.rep("x", 6000) },
    }, {
      serverTime = 3002,
      actor = { id = first_actor, seat = 1 },
    })
    assert(discarded.accepted == true)
    state = discarded.state

    local terminal_actor = state.players[2]
    state.phase = "playing"
    state.turnIndex = 2
    state.claimants = {}
    state.claimResponses = {}
    state.claimIndex = 0
    state.lastDiscard = nil
    state.callOccurred = false
    state.firstTurn[terminal_actor] = true
    state.melds[terminal_actor] = {}
    state.hands[terminal_actor] = {
      1, 33, 37, 69, 73, 105, 109,
      113, 117, 121, 125, 129, 133,
    }
    state.drawnTile = 2

    local ended = on_action(state, { type = "abort_nine" }, {
      serverTime = 3003,
      actor = { id = terminal_actor, seat = 2 },
    })
    assert(ended.accepted == true)
    state = ended.state
    assert(state.matchEnded ~= true)

    local hand_projection = view(state, {}, {
      serverTime = 3004,
      viewer = { id = first_actor, seat = 1, isOwner = true },
    })
    local fragment = hand_projection.state.paipu
    assert(fragment ~= nil)

    local advanced = on_action(state, { type = "next_hand" }, {
      serverTime = 3005,
      actor = { id = first_actor, seat = 1 },
    })
    assert(advanced.accepted == true)
    local next_state = advanced.state
    local playing_projection = view(next_state, {}, {
      serverTime = 3006,
      viewer = { id = first_actor, seat = 1, isOwner = true },
    })

    result = {
      fragment = fragment,
      nextState = next_state,
      nextProjectionHasPaipu = playing_projection.state.paipu ~= nil,
    }
  `);

  assert.equal(streamed.fragment.status, "in_progress");
  assert.equal(streamed.fragment.hands.length, 1);
  assert.equal(streamed.fragment.hands[0].index, 0);
  assert.ok(streamed.fragment.hands[0].end);
  const firstDiscard = streamed.fragment.hands[0].commands.find(
    (command) => command?.action?.type === "discard",
  );
  assert.ok(firstDiscard);
  assert.equal(firstDiscard.action.tenpaiReport, undefined);

  assert.equal(streamed.nextState.paipu.hands.length, 1);
  assert.equal(streamed.nextState.paipu.hands[0].index, 1);
  assert.equal(streamed.nextProjectionHasPaipu, false);
  const stateBytes = new TextEncoder().encode(JSON.stringify(streamed.nextState)).byteLength;
  assert.ok(stateBytes < 64 * 1024, `room state should stay below 64 KiB, got ${stateBytes}`);
});

test("Mahjong room records AI and server-timer gameplay actions", async () => {
  const recorded = await runOnlineScenario(String.raw`
    local lobby = setup({
      serverTime = 2000,
      players = {
        { id = "host", name = "Host", seat = 1 },
        { id = "guest", name = "Guest", seat = 2 },
      },
      match = {
        id = "room-paipu-action-paths",
        ownerId = "host",
        randomSeed = "0000000000000000000000000000003a",
      },
    })
    local started = on_action(lobby.state, {
      type = "start_match",
      matchType = "east",
      rules = {},
    }, {
      serverTime = 2001,
      actor = { id = "host", isOwner = true },
    })
    assert(started.accepted == true)
    local state = started.state
    local hand = state.paipu.hands[#state.paipu.hands]

    local ai_id, ai_seat
    for seat, player_id in ipairs(state.players) do
      if state.aiPlayers[player_id] then
        ai_id, ai_seat = player_id, seat
        break
      end
    end
    assert(ai_id ~= nil)

    state.phase = "playing"
    state.turnIndex = ai_seat
    state.claimants = {}
    state.claimResponses = {}
    state.claimIndex = 0
    state.lastDiscard = nil
    state.drawnTile = 1
    state.riichi[ai_id] = false
    state.kuikaeForbidden[ai_id] = {}
    local ai_result = on_action(state, {
      type = "ai_turn",
      playerId = ai_id,
      action = { type = "discard", tileId = 1 },
    }, {
      serverTime = 2002,
      actor = { id = "host", isOwner = true },
    })
    assert(ai_result.accepted == true)
    state = ai_result.state
    local after_ai = #hand.commands
    local ai_command = hand.commands[after_ai]

    local timer_actor = state.players[1]
    state.phase = "playing"
    state.turnIndex = 1
    state.claimants = {}
    state.claimResponses = {}
    state.claimIndex = 0
    state.lastDiscard = nil
    state.hands[timer_actor] = {
      1, 5, 13, 17, 25, 29, 37,
      41, 49, 53, 61, 65, 109,
    }
    state.melds[timer_actor] = {}
    state.drawnTile = 117
    state.riichi[timer_actor] = false
    state.kuikaeForbidden[timer_actor] = {}
    local timer_result = on_timer(state, {
      id = "mahjong-turn",
      payload = {
        phase = state.phase,
        turnIndex = state.turnIndex,
        claimIndex = state.claimIndex,
        moveCount = state.moveCount,
        drawnTile = state.drawnTile,
      },
    }, { firedAt = 2003 })
    state = timer_result.state
    local after_timer = #hand.commands
    local timer_command = hand.commands[after_timer]

    result = {
      aiRecorded = after_ai >= 1
        and ai_command.action.type == "discard"
        and type(ai_command.action.tile) == "string",
      timerRecorded = after_timer == after_ai + 1
        and timer_command.action.type == "discard"
        and type(timer_command.action.tile) == "string",
    }
  `);

  assert.deepEqual(recorded, {
    aiRecorded: true,
    timerRecorded: true,
  });
});
