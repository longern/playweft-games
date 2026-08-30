import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LuaFactory } from "wasmoon";

import { buildMahjongOnlineSource } from "../games/mahjong/room-paipu-online-source.js";

const MAX_ROOM_STATE_BYTES = 64 * 1024;

function byteSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

test("rolling room paipu stays below 64 KiB throughout a complete ordinary hand", async () => {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const source = buildMahjongOnlineSource(fullSource);
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${String.raw`
      local lobby = setup({
        protocolVersion = 1,
        serverTime = 1000,
        players = {
          { id = "p1", name = "One", seat = 1 },
          { id = "p2", name = "Two", seat = 2 },
          { id = "p3", name = "Three", seat = 3 },
          { id = "p4", name = "Four", seat = 4 },
        },
        match = {
          id = "room-paipu-state-size",
          ownerId = "p1",
          randomSeed = "0000000000000000000000000000005a",
        },
      })
      local started = on_action(lobby.state, {
        type = "start_match",
        matchType = "east",
        rules = {},
      }, {
        protocolVersion = 1,
        serverTime = 1001,
        actor = { id = "p1", seat = 1, isOwner = true },
      })
      assert(started.accepted == true)
      state = started.state
      step_count = 0
      accepted_all = true

      function advance_room_paipu_state()
        if state.phase == "hand_ended" then return end
        step_count = step_count + 1
        local actor_id
        local actor_seat
        local action
        if state.phase == "playing" then
          actor_seat = state.turnIndex
          actor_id = state.players[actor_seat]
          action = { type = "discard", tileId = state.drawnTile }
        elseif state.phase == "claiming" then
          local claimant = state.claimants[state.claimIndex]
          actor_id = claimant.playerId
          actor_seat = claimant.playerIndex
          action = { type = "pass" }
        else
          accepted_all = false
          return
        end
        local result = on_action(state, action, {
          protocolVersion = 1,
          serverTime = 1001 + step_count,
          actor = {
            id = actor_id,
            seat = actor_seat,
            isOwner = actor_id == "p1",
          },
        })
        if not result.accepted then
          accepted_all = false
          return
        end
        state = result.state
      end
    `}`);

    let maxBytes = 0;
    let maxStep = 0;
    for (let step = 0; step < 240; step += 1) {
      const state = lua.global.get("state");
      const bytes = byteSize(state);
      if (bytes > maxBytes) {
        maxBytes = bytes;
        maxStep = step;
      }
      assert.ok(
        bytes < MAX_ROOM_STATE_BYTES,
        `room state exceeded 64 KiB at step ${step}: ${bytes} bytes`,
      );
      if (state.phase === "hand_ended") break;
      await lua.doString("advance_room_paipu_state()")
    }

    const finalState = lua.global.get("state");
    assert.equal(lua.global.get("accepted_all"), true);
    assert.equal(finalState.phase, "hand_ended");
    assert.ok(lua.global.get("step_count") > 20);
    assert.equal(finalState.paipu.hands.length, 1);
    assert.ok(finalState.paipu.hands[0].end);
    assert.equal(finalState.paipuTilePositions, undefined);
    assert.ok(maxBytes < MAX_ROOM_STATE_BYTES);
    assert.ok(maxStep >= 0);
  } finally {
    lua.global.close();
  }
});
