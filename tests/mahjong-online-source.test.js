import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";
import {
  buildMahjongOnlineSource,
  MAHJONG_ONLINE_SOURCE_LIMIT,
} from "../games/mahjong/online-source.js";

const PLAYERS = `{
  { id = "p1", name = "East", seat = 1 },
  { id = "p2", name = "South", seat = 2 },
  { id = "p3", name = "West", seat = 3 },
  { id = "p4", name = "North", seat = 4 }
}`;

const AUTO_START_ROOM_FOR_EXISTING_SCENARIOS = String.raw`
  local function __test_seat_of(state, player_id)
    for seat, id in ipairs(state.players or {}) do
      if id == player_id then return seat end
    end
    return nil
  end

  local __test_lobby_setup = setup
  function setup(context)
    local lobby = __test_lobby_setup(context)
    if context and context.keepLobby == true then return lobby end
    return on_action(lobby.state, {
      type = "start_match",
      matchType = "east",
      rules = {},
    }, {
      serverTime = context and context.serverTime,
      actor = {
        id = context.match.ownerId,
        isOwner = true,
      },
    })
  end
`;

async function runOnlineMock(scenario) {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const source = buildMahjongOnlineSource(fullSource);
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${AUTO_START_ROOM_FOR_EXISTING_SCENARIOS}\n${scenario}`);
    return lua.global.get("result");
  } finally {
    lua.global.close();
  }
}

async function runOnlineWithinRuntimeQuota(scenario, runtimeQuota = 50_000) {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const source = buildMahjongOnlineSource(fullSource);
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`
      local __quota_fuel = 0
      local __quota_sethook = debug.sethook
      local function __quota_hook()
        __quota_fuel = __quota_fuel + 1000
        if __quota_fuel > ${runtimeQuota} then error("instruction quota exceeded", 0) end
      end
      debug = nil
      local function __within_quota(callback)
        __quota_fuel = 0
        __quota_sethook(__quota_hook, "", 1000)
        local result = callback()
        __quota_sethook(nil)
        return result
      end
      ${source}
      ${AUTO_START_ROOM_FOR_EXISTING_SCENARIOS}
      ${scenario}
    `);
    return lua.global.get("result");
  } finally {
    lua.global.close();
  }
}

test("Mahjong room entry stays below the Lua source limit", async () => {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const onlineSource = buildMahjongOnlineSource(fullSource);

  assert.ok(Buffer.byteLength(onlineSource) < MAHJONG_ONLINE_SOURCE_LIMIT);
});

test("Mahjong rooms stay in a private game lobby until the owner starts the selected match", async () => {
  const result = await runOnlineMock(`
    local lobby = setup({
      keepLobby = true,
      serverTime = 1000,
      players = {
        { id = "host", name = "Host", seat = 1 },
        { id = "guest", name = "Guest", seat = 2 },
      },
      match = {
        id = "lobby-room",
        ownerId = "host",
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local state = lobby.state
    local host_lobby = view(state, {}, { viewer = { id = "host", isOwner = true } })
    local guest_lobby = view(state, {}, { viewer = { id = "guest", isOwner = false } })
    local rejected_start = on_action(state, {
      type = "start_match",
      matchType = "hanchan",
    }, {
      actor = { id = "guest", isOwner = false },
    })
    local started = on_action(state, {
      type = "start_match",
      matchType = "hanchan",
      rules = { multipleRon = false, nagashiMangan = false },
    }, {
      serverTime = 1001,
      actor = { id = "host", isOwner = true },
    })
    local ai_count = 0
    for _ in pairs(started.state.aiPlayers) do ai_count = ai_count + 1 end
    result = {
      lobby = host_lobby.state.phase == "lobby",
      host_can_start = host_lobby.state.roomIsOwner == true,
      guest_cannot_start = guest_lobby.state.roomIsOwner ~= true,
      lobby_has_no_hand = host_lobby.state.ownHand == nil,
      rejected_non_owner = rejected_start.accepted == false,
      started = started.accepted == true and started.state.phase == "playing",
      selected_length = started.state.matchType == "hanchan",
      selected_rules = started.state.rules.multipleRon == false and started.state.rules.nagashiMangan == false,
      added_ai = ai_count == 2,
      dealt = #(started.state.hands.host or {}) == 13,
    }
  `);

  assert.deepEqual(result, {
    lobby: true,
    host_can_start: true,
    guest_cannot_start: true,
    lobby_has_no_hand: true,
    rejected_non_owner: true,
    started: true,
    selected_length: true,
    selected_rules: true,
    added_ai: true,
    dealt: true,
  });
});

test("Mahjong room start shuffles humans and AI into deterministic fixed seats", async () => {
  const result = await runOnlineMock(`
    local function start(seed)
      local lobby = setup({
        keepLobby = true,
        players = {
          { id = "p1", name = "Host" },
          { id = "p2", name = "Guest" },
        },
        match = { ownerId = "p1", randomSeed = seed },
      })
      return on_action(lobby.state, {
        type = "start_match", matchType = "east", rules = {},
      }, { actor = { id = "p1", isOwner = true } }).state
    end
    local first = start("0000000000000000000000000000002a")
    local repeat_match = start("0000000000000000000000000000002a")
    local ids, names = {}, {}
    for seat, player_id in ipairs(first.players) do
      ids[player_id] = true
      names[player_id] = first.playerNames[seat]
    end
    result = {
      east_is_first_shuffled_seat = first.dealerIndex == 1,
      has_all_players = ids.p1 and ids.p2 and ids["mahjong-ai-3"] and ids["mahjong-ai-4"],
      names_follow_ids = names["mahjong-ai-3"] == "AI 1" and names["mahjong-ai-4"] == "AI 2",
      deterministic = table.concat(first.players, ",") == table.concat(repeat_match.players, ","),
      lobby_order_was_not_used_as_seats = not (
        first.players[1] == "p1"
        and first.players[2] == "p2"
        and first.players[3] == "mahjong-ai-3"
        and first.players[4] == "mahjong-ai-4"
      ),
    }
  `);

  assert.deepEqual(result, {
    east_is_first_shuffled_seat: true,
    has_all_players: true,
    names_follow_ids: true,
    deterministic: true,
    lobby_order_was_not_used_as_seats: true,
  });
});

test("Mahjong room player presentations are player-owned and survive the match start", async () => {
  const result = await runOnlineMock(`
    local lobby = setup({
      keepLobby = true,
      serverTime = 1000,
      players = {
        { id = "host", name = "Host", seat = 1 },
        { id = "guest", name = "Guest", seat = 2 },
      },
      match = {
        id = "player-presentations",
        ownerId = "host",
        randomSeed = "0000000000000000000000000000002b",
      },
    })
    local guest_presentation = on_action(lobby.state, {
      type = "set_player_presentation",
      playerPresentation = {
        avatarPreference = "auto",
        portraitMode = "platform",
        themeCharacter = { packId = "moonlit", characterId = "fox" },
        builtinCharacterId = "builtin-2",
        displayName = "Guest Fox",
      },
    }, { actor = { id = "guest" }, serverTime = 1001 })
    local outsider_presentation = on_action(lobby.state, {
      type = "set_player_presentation",
      playerPresentation = {
        portraitMode = "character",
        builtinCharacterId = "builtin-1",
      },
    }, { actor = { id = "outsider" }, serverTime = 1001 })
    local host_view = view(guest_presentation.state, {}, { viewer = { id = "host", isOwner = true } })
    local guest_view = view(guest_presentation.state, {}, { viewer = { id = "guest", isOwner = false } })
    local started = on_action(guest_presentation.state, {
      type = "start_match", matchType = "east", rules = {},
      aiPresentations = {
        ["mahjong-ai-3"] = {
          portraitMode = "character",
          themeCharacter = { packId = "moonlit", characterId = "fox" },
          builtinCharacterId = "builtin-2",
          displayName = "AI Fox",
        },
      },
    }, { actor = { id = "host", isOwner = true }, serverTime = 1002 })
    local ai_seat
    for seat, player_id in ipairs(started.state.players) do
      if player_id == "mahjong-ai-3" then ai_seat = seat end
    end
    result = {
      accepted = guest_presentation.accepted == true,
      outsider_rejected = outsider_presentation.accepted == false,
      host_sees_theme_character = host_view.state.playerPresentations.guest.themeCharacter.characterId == "fox",
      host_sees_builtin_fallback = host_view.state.playerPresentations.guest.builtinCharacterId == "builtin-2",
      guest_sees_platform_mode = guest_view.state.playerPresentations.guest.portraitMode == "platform",
      guest_sees_avatar_preference = guest_view.state.playerPresentations.guest.avatarPreference == "auto",
      survives_start = started.state.playerPresentations.guest.builtinCharacterId == "builtin-2",
      snapshots_role_name = ai_seat and started.state.playerNames[ai_seat] == "AI Fox",
    }
  `);

  assert.deepEqual(result, {
    accepted: true,
    outsider_rejected: true,
    host_sees_theme_character: true,
    host_sees_builtin_fallback: true,
    guest_sees_platform_mode: true,
    guest_sees_avatar_preference: true,
    survives_start: true,
    snapshots_role_name: true,
  });
});

test("Mahjong room requires and shares a built-in character fallback", async () => {
  const result = await runOnlineMock(`
    local lobby = setup({
      keepLobby = true,
      players = { { id = "host", name = "Host" }, { id = "guest", name = "Guest" } },
      match = { ownerId = "host", randomSeed = "0000000000000000000000000000002c" },
    })
    local changed = on_action(lobby.state, {
      type = "set_player_presentation",
      playerPresentation = {
        portraitMode = "character",
        builtinCharacterId = "builtin-4",
      },
    }, { actor = { id = "guest" } })
    local projected = view(changed.state, {}, { viewer = { id = "host", isOwner = true } })
    result = {
      accepted = changed.accepted == true,
      mode = projected.state.playerPresentations.guest.portraitMode,
      characterId = projected.state.playerPresentations.guest.builtinCharacterId,
    }
  `);
  assert.deepEqual(result, {
    accepted: true,
    mode: "character",
    characterId: "builtin-4",
  });
});

test("Mahjong room exposes permanent riichi furiten only to its owner", async () => {
  const result = await runOnlineMock(`
    local started = setup({
      players = ${PLAYERS},
      match = {
        ownerId = "p1",
        randomSeed = "0000000000000000000000000000002d",
      },
    })
    started.state.riichiFuriten.p1 = true
    local own = view(started.state, {}, { viewer = { id = "p1", isOwner = true } })
    local other = view(started.state, {}, { viewer = { id = "p2", isOwner = false } })
    result = {
      own_flag = own.state.selfRiichiFuriten == true,
      other_flag = other.state.selfRiichiFuriten == false,
    }
  `);

  assert.deepEqual(result, { own_flag: true, other_flag: true });
});

test("Mahjong room pass-claims stays private, skips calls, and preserves ron", async () => {
  const result = await runOnlineMock(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local lobby = setup({
      keepLobby = true,
      serverTime = 1000,
      players = ${PLAYERS},
      match = {
        id = "private-pass-claims",
        ownerId = "p1",
        randomSeed = "00000000000000000000000000000063",
      },
    })
    local enabled = on_action(lobby.state, {
      type = "set_pass_claims",
      enabled = true,
    }, { serverTime = 1001, actor = { id = "p2", seat = 2 } })
    local started = on_action(enabled.state, {
      type = "start_match",
      matchType = "east",
      rules = {},
    }, { serverTime = 1002, actor = { id = "p1", seat = 1, isOwner = true } })
    local started_setting = started.state.autoPassClaims.p2 == nil
    local enabled_in_hand = on_action(started.state, {
      type = "set_pass_claims",
      enabled = true,
    }, { serverTime = 1002.5, actor = { id = "p2", seat = 2 } })
    local state = enabled_in_hand.state
    local p1_seat = __test_seat_of(state, "p1")
    local p2_seat = __test_seat_of(state, "p2")
    state.phase, state.turnIndex, state.wall = "playing", p1_seat, { 1, 2, 3, 4 }
    state.hands.p1 = ids({ 2, 10,11,12,13,14,15,16,17,18,19,20,21,22 })
    state.hands.p2 = ids({ 2,2,3,4,5,4,5,6,6,7,8,9,9 })
    state.hands.p3 = ids({ 10,10,11,11,12,12,13,13,14,14,15,15,16 })
    state.hands.p4 = ids({ 17,17,18,18,19,19,20,20,21,21,22,22,23 })
    state.drawnTile = state.hands.p1[1]
    for _, player_id in ipairs(state.players) do
      state.melds[player_id], state.discards[player_id] = {}, {}
      state.riichi[player_id], state.tempFuriten[player_id], state.riichiFuriten[player_id] = false, false, false
    end
    local discarded = on_action(state, { type = "discard", tileId = state.drawnTile }, {
      serverTime = 1003,
      actor = { id = "p1", seat = p1_seat, isOwner = true },
    })
    local p2_view = view(discarded.state, {}, { viewer = { id = "p2", seat = p2_seat } })
    local p1_view = view(discarded.state, {}, { viewer = { id = "p1", seat = p1_seat } })
    local claims = p2_view.state.legalActions.claims
    result = {
      setting_accepted = enabled.accepted == true,
      setting_cleared_for_first_hand = started_setting,
      owner_cannot_see_guest_setting = p1_view.state.passClaimsEnabled == false,
      guest_sees_own_setting = p2_view.state.passClaimsEnabled == true,
      waiting_for_guest = p2_view.state.responseIndex == p2_seat,
      only_ron_remains = #claims == 1 and claims[1].kind == "ron",
    }
  `);

  assert.deepEqual(result, {
    setting_accepted: true,
    setting_cleared_for_first_hand: true,
    owner_cannot_see_guest_setting: true,
    guest_sees_own_setting: true,
    waiting_for_guest: true,
    only_ron_remains: true,
  });
});

test("Mahjong room clears private pass-claims settings at hand and match boundaries", async () => {
  const result = await runOnlineMock(`
    local setup_result = setup({
      keepLobby = true,
      serverTime = 1000,
      players = ${PLAYERS},
      match = {
        id = "reset-pass-claims",
        ownerId = "p1",
        randomSeed = "00000000000000000000000000000065",
      },
    })
    local started = on_action(setup_result.state, {
      type = "start_match", matchType = "east", rules = {},
    }, { serverTime = 1001, actor = { id = "p1", seat = 1, isOwner = true } })
    local enabled = on_action(started.state, {
      type = "set_pass_claims", enabled = true,
    }, { serverTime = 1002, actor = { id = "p2", seat = 2 } })
    local state = enabled.state
    state.phase = "hand_ended"
    state.matchEnded = false
    state.nextDealerIndex = state.dealerIndex
    state.nextHandNumber = state.handNumber + 1
    state.nextRoundWind = state.roundWind
    state.nextHonba = state.honba
    local next_hand = on_action(state, { type = "next_hand" }, {
      serverTime = 1003,
      actor = { id = "p2", seat = 2 },
    })
    local next_hand_cleared = next_hand.accepted == true
      and next_hand.state.autoPassClaims.p2 ~= true
    local reenabled = on_action(next_hand.state, {
      type = "set_pass_claims", enabled = true,
    }, { serverTime = 1004, actor = { id = "p2", seat = 2 } })
    reenabled.state.phase = "hand_ended"
    reenabled.state.matchEnded = true
    local new_match = on_action(reenabled.state, { type = "new_match" }, {
      serverTime = 1005,
      actor = { id = "p2", seat = 2 },
    })
    result = {
      next_hand_cleared = next_hand_cleared,
      new_match_cleared = new_match.accepted == true
        and new_match.state.autoPassClaims.p2 ~= true,
    }
  `);

  assert.deepEqual(result, {
    next_hand_cleared: true,
    new_match_cleared: true,
  });
});

test("enabling Mahjong room pass-claims immediately skips a pending non-ron call", async () => {
  const result = await runOnlineMock(`
    local setup_result = setup({
      keepLobby = true,
      serverTime = 1000,
      players = ${PLAYERS},
      match = {
        id = "pending-pass-claims",
        ownerId = "p1",
        randomSeed = "00000000000000000000000000000064",
      },
    })
    local state = on_action(setup_result.state, {
      type = "start_match", matchType = "east", rules = {},
    }, { serverTime = 1001, actor = { id = "p1", seat = 1, isOwner = true } }).state
    state.phase, state.claimIndex, state.claimResponses = "claiming", 1, {}
    state.claimants = {
      {
        playerId = "p2", playerIndex = 2, distance = 1,
        options = { { kind = "pon", tileIds = { 1, 2 } } },
        ronOpportunity = true,
      },
      {
        playerId = "p3", playerIndex = 3, distance = 2,
        options = { { kind = "pon", tileIds = { 3, 4 } } },
        ronOpportunity = false,
      },
    }
    state.tempFuriten.p2, state.riichiFuriten.p2 = false, false
    local enabled = on_action(state, {
      type = "set_pass_claims", enabled = true,
    }, { serverTime = 1002, actor = { id = "p2", seat = 2 } })
    result = {
      accepted = enabled.accepted == true,
      skipped_current_call = enabled.state.claimIndex == 2 and #enabled.state.claimResponses == 1,
      no_ron_furiten = enabled.state.tempFuriten.p2 == false and enabled.state.riichiFuriten.p2 == false,
      private_marker_cleared = enabled.state.autoPassClaimsApplying == nil,
    }
  `);

  assert.deepEqual(result, {
    accepted: true,
    skipped_current_call: true,
    no_ron_furiten: true,
    private_marker_cleared: true,
  });
});

test("a non-owner room player can declare riichi from the private legal preview", async () => {
  const result = await runOnlineMock(`
    local setup_result = setup({
      serverTime = 1000,
      players = ${PLAYERS},
      match = {
        id = "room-riichi-flow",
        ownerId = "p1",
        randomSeed = "00000000000000000000000000003039",
      },
    })
    local state = setup_result.state
    state.phase, state.turnIndex, state.drawnTile = "playing", 2, 89
    state.wall = { 1, 2, 3, 4 }
    state.hands.p2 = { 5, 6, 9, 13, 17, 18, 21, 25, 49, 53, 57, 81, 85 }
    state.melds.p2, state.discards.p2 = {}, {}
    state.riichi.p2, state.tempFuriten.p2, state.riichiFuriten.p2 = false, false, false
    state.firstTurn.p2, state.doubleRiichi.p2, state.ippatsu.p2 = false, false, false
    local projection = view(state, {}, { viewer = { id = "p2", seat = 2, isOwner = false } })
    local applied = on_action(state, { type = "riichi", tileId = 89 }, {
      serverTime = 1001,
      actor = { id = "p2", seat = 2, isOwner = false },
    })
    result = {
      private_preview = projection.state.legalContext ~= nil,
      server_preview_is_fast = projection.state.legalActions.canRiichi == false,
      accepted = applied.accepted == true,
      declared = applied.state.riichi.p2 == true,
      paid_stick = applied.state.riichiSticks == 1,
    }
  `);

  assert.deepEqual(result, {
    private_preview: true,
    server_preview_is_fast: true,
    accepted: true,
    declared: true,
    paid_stick: true,
  });
});

test("Mahjong room opens and processes a discard within the runtime instruction quota", async () => {
  const result = await runOnlineWithinRuntimeQuota(`
    local players = {
      { id = "p1", name = "East", seat = 1 },
      { id = "p2", name = "South", seat = 2 },
    }
    local setup_result = __within_quota(function()
      return setup({
        protocolVersion = 1,
        serverTime = 1000,
        players = players,
        match = {
          id = "quota-room",
          ownerId = "p1",
          randomSeed = "00000000000000000000000000001f00",
          settings = { initialDealerSeat = 1 },
        },
      })
    end)
    local state = setup_result.state
    local projection = __within_quota(function()
      return view(state, {}, { viewer = { id = "p1", seat = 1, isOwner = true } })
    end)
    local drawn = state.drawnTile
    local action = __within_quota(function()
      return on_action(state, { type = "discard", tileId = drawn }, {
        serverTime = 1001,
        actor = { id = "p1", seat = 1, isOwner = true },
      })
    end)
    result = {
      canDiscard = projection.state.legalActions.canDiscard,
      hasLocalPreviewContext = type(projection.state.legalContext) == "table",
      actionAccepted = action.accepted == true,
    }
  `);

  assert.equal(result.canDiscard, true);
  assert.equal(result.hasLocalPreviewContext, true);
  assert.equal(result.actionAccepted, true);
});

test("a host-submitted AI riichi stays within the runtime instruction quota", async () => {
  const result = await runOnlineWithinRuntimeQuota(`
    local lobby = setup({
      keepLobby = true,
      protocolVersion = 1,
      serverTime = 1000,
      players = {
        { id = "p1", name = "East", seat = 1 },
        { id = "p2", name = "South", seat = 2 },
      },
      match = {
        id = "quota-ai-riichi",
        ownerId = "p1",
        randomSeed = "00000000000000000000000000001f00",
      },
    })
    local state = on_action(lobby.state, {
      type = "start_match", matchType = "east", rules = {},
    }, { actor = { id = "p1", isOwner = true } }).state
    local ai_id = "mahjong-ai-3"
    local ai_seat = __test_seat_of(state, ai_id)
    state.phase, state.turnIndex, state.drawnTile = "playing", ai_seat, 57
    state.wall = {}
    for index = 1, 23 do state.wall[index] = index end
    state.hands[ai_id] = { 5, 6, 9, 13, 17, 18, 21, 25, 49, 53, 81, 85, 89 }
    state.melds[ai_id], state.discards[ai_id] = {}, {}
    state.riichi[ai_id], state.tempFuriten[ai_id], state.riichiFuriten[ai_id] = false, false, false
    state.firstTurn[ai_id], state.doubleRiichi[ai_id], state.ippatsu[ai_id] = false, false, false
    local applied = __within_quota(function()
      return on_action(state, {
        type = "ai_turn",
        playerId = ai_id,
        action = { type = "riichi", tileId = 57 },
      }, {
        serverTime = 1001,
        actor = { id = "p1", seat = 1, isOwner = true },
      })
    end)
    result = applied.accepted == true
  `);

  assert.equal(result, true);
});

test("Mahjong settles a full exhaustive draw within the runtime instruction quota", async () => {
  const result = await runOnlineWithinRuntimeQuota(`
    local function json_copy(value)
      if type(value) ~= "table" then return value end
      local copied = {}
      for key, item in pairs(value) do
        copied[json_copy(key)] = json_copy(item)
      end
      return copied
    end
    local players = ${PLAYERS}
    local setup_result = __within_quota(function()
      return setup({
        protocolVersion = 1,
        serverTime = 1000,
        players = players,
        match = {
          id = "quota-exhaustive-draw",
          ownerId = "p1",
          randomSeed = "00000000000000000000000000001f00",
          settings = { initialDealerSeat = 1 },
        },
      })
    end)
    local state, version, action_count = setup_result.state, 0, 0
    while state.phase ~= "hand_ended" and action_count < 220 do
      local actor_id, action
      if state.phase == "playing" then
        actor_id = state.players[state.turnIndex]
        action = { type = "discard", tileId = state.drawnTile }
      elseif state.phase == "claiming" then
        local claimant = state.claimants[state.claimIndex]
        actor_id = claimant.playerId
        action = { type = "pass" }
      else
        error("unexpected phase " .. tostring(state.phase))
      end
      action_count = action_count + 1
      local applied = __within_quota(function()
        return on_action(state, action, {
          protocolVersion = 1,
          serverTime = 1000 + action_count,
          version = version,
          actor = { id = actor_id, isOwner = actor_id == "p1" },
        })
      end)
      -- The room runtime receives a new Lua table reconstructed from persisted
      -- JSON for every action.  Preserve that boundary here so the test cannot
      -- accidentally depend on a Lua-global cache surviving between discards.
      state, version = json_copy(applied.state), version + 1
    end
    result = {
      ended = state.phase == "hand_ended",
      exhaustive = state.draw == true,
      tenpaiSeats = #(state.result and state.result.tenpai or {}),
      actionCount = action_count,
    }
  `, 30_000);

  assert.equal(result.ended, true);
  assert.equal(result.exhaustive, true);
  assert.equal(result.tenpaiSeats, 4);
  assert.ok(result.actionCount > 50);
});

test("Mahjong consumes a late-wall declaration attached to the final discard", async () => {
  const result = await runOnlineMock(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local function report_key(hand)
      local hand_counts, meld_counts = {}, {}
      for kind = 1, 34 do hand_counts[kind], meld_counts[kind] = 0, 0 end
      for _, tile in ipairs(hand) do
        local kind = math.floor((tile - 1) / 4) + 1
        hand_counts[kind] = hand_counts[kind] + 1
      end
      return table.concat(hand_counts, ",") .. ":" .. table.concat(meld_counts, ",")
    end

    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = ${PLAYERS},
      match = { id = "late-wall-report", ownerId = "p1", randomSeed = "00000000000000000000000000000057" },
    })
    local state = setup_result.state
    local waiting_hand = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28 })
    state.phase, state.turnIndex, state.wall, state.drawnTile = "playing", 1, {}, 133
    state.rules.nagashiMangan = false
    state.hands.p1 = waiting_hand
    state.hands.p2, state.hands.p3, state.hands.p4 = {}, {}, {}
    state.melds.p1, state.melds.p2, state.melds.p3, state.melds.p4 = {}, {}, {}, {}
    local applied = on_action(state, {
      type = "discard",
      tileId = 133,
      tenpaiReport = { key = report_key(waiting_hand), tenpai = false },
    }, {
      protocolVersion = 1,
      serverTime = 1001,
      actor = { id = "p1", seat = 1, isOwner = true },
    })
    result = {
      accepted = applied.accepted == true,
      exhaustive = applied.state.draw == true,
      reportedNoten = applied.state.result.tenpai[1] == false,
    }
  `);

  assert.deepEqual(result, {
    accepted: true,
    exhaustive: true,
    reportedNoten: true,
  });
});

test("Mahjong stores a delayed player declaration without resetting the turn timer", async () => {
  const result = await runOnlineMock(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local function report_key(hand)
      local hand_counts, meld_counts = {}, {}
      for kind = 1, 34 do hand_counts[kind], meld_counts[kind] = 0, 0 end
      for _, tile in ipairs(hand) do
        local kind = math.floor((tile - 1) / 4) + 1
        hand_counts[kind] = hand_counts[kind] + 1
      end
      return table.concat(hand_counts, ",") .. ":" .. table.concat(meld_counts, ",")
    end

    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = ${PLAYERS},
      match = { id = "late-wall-supplement", ownerId = "p1", randomSeed = "00000000000000000000000000000058" },
    })
    local state = setup_result.state
    local waiting_hand = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28 })
    state.phase, state.turnIndex, state.drawnTile = "playing", 2, 0
    state.hands.p1 = waiting_hand
    state.melds.p1 = {}
    local applied = on_action(state, {
      type = "tenpai_report",
      tenpaiReport = { key = report_key(waiting_hand), tenpai = false },
    }, {
      protocolVersion = 1,
      serverTime = 1001,
      actor = { id = "p1", seat = 1, isOwner = true },
    })
    result = {
      accepted = applied.accepted == true,
      stored = applied.state.tenpaiReports.p1 and applied.state.tenpaiReports.p1.tenpai == false,
      turnUnchanged = applied.state.turnIndex == 2,
      hasTimerChange = type(applied.timerOps) == "table" and #applied.timerOps > 0,
    }
  `);

  assert.deepEqual(result, {
    accepted: true,
    stored: true,
    turnUnchanged: true,
    hasTimerChange: false,
  });
});

test("four-player room mock advances a complete Mahjong hand through the online entry", async () => {
  const result = await runOnlineMock(`
    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = ${PLAYERS},
      match = {
        id = "mock-room-1",
        ownerId = "p1",
        startedAt = 100,
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local state = setup_result.state
    local players = {}
    for seat, player_id in ipairs(state.players) do
      players[seat] = { id = player_id, seat = seat }
    end
    local setup_timer = setup_result.timerOps and setup_result.timerOps[1]
    local timerContractOk = setup_timer
      and setup_timer.op == "schedule"
      and setup_timer.id == "mahjong-turn"
      and setup_timer.afterMs == 20000
      and setup_timer.payload.phase == "playing"
    local version = 0
    local actionNumber = 0
    local acceptedCount = 0
    local allViewsPrivate = true
    local allActionIdsUnique = true
    local actionIds = {}

    local function viewer_context(player_id, seat)
      return {
        protocolVersion = 1,
        matchId = "mock-room-1",
        version = version,
        serverTime = 1000 + version,
        viewer = {
          id = player_id,
          role = "player",
          seat = seat,
          isOwner = player_id == "p1",
        },
      }
    end

    local function assert_views()
      for seat, player in ipairs(players) do
        local projection = view(state, {}, viewer_context(player.id, seat))
        if type(projection.state.ownHand) ~= "table" then
          allViewsPrivate = false
        end
        for other_seat, other_player in ipairs(players) do
          if other_seat ~= seat and projection.state.ownHand == state.hands[other_player.id] then
            allViewsPrivate = false
          end
        end
      end
    end

    local function submit(actor_seat, action)
      local actor = players[actor_seat]
      actionNumber = actionNumber + 1
      local action_id = "mock-action-" .. tostring(actionNumber)
      if actionIds[action_id] then allActionIdsUnique = false end
      actionIds[action_id] = true
      local result = on_action(state, action, {
        protocolVersion = 1,
        matchId = "mock-room-1",
        actionId = action_id,
        actionAt = 1000 + actionNumber,
        serverTime = 1000 + actionNumber,
        version = version,
        actor = {
          id = actor.id,
          role = "player",
          seat = actor_seat,
          isOwner = actor.id == "p1",
        },
      })
      if not result.accepted then return false end
      state = result.state
      version = version + 1
      acceptedCount = acceptedCount + 1
      assert_views()
      return true
    end

    assert_views()
    local steps = 0
    local allAccepted = true
    while state.phase ~= "hand_ended" and steps < 220 do
      steps = steps + 1
      local actor_seat
      local action
      if state.phase == "playing" then
        actor_seat = state.turnIndex
        action = { type = "discard", tileId = state.drawnTile }
      elseif state.phase == "claiming" then
        local claimant = state.claimants[state.claimIndex]
        actor_seat = claimant.playerIndex
        action = { type = "pass" }
      else
        allAccepted = false
        break
      end
      if not submit(actor_seat, action) then
        allAccepted = false
        break
      end
    end

    result = {
      ended = state.phase == "hand_ended",
      allAccepted = allAccepted,
      acceptedCount = acceptedCount,
      steps = steps,
      version = version,
      allViewsPrivate = allViewsPrivate,
      allActionIdsUnique = allActionIdsUnique,
      timerContractOk = timerContractOk,
      paipuRetained = state.paipu ~= nil and state.paipuTilePositions == nil,
    }
  `);

  assert.equal(result.ended, true);
  assert.equal(result.allAccepted, true);
  assert.equal(result.allViewsPrivate, true);
  assert.equal(result.allActionIdsUnique, true);
  assert.equal(result.timerContractOk, true);
  assert.equal(result.paipuRetained, true);
  assert.equal(result.version, result.acceptedCount);
  assert.ok(result.steps > 20 && result.steps <= 220);
});

test("short Mahjong rooms fill missing seats with AI controlled by the owner", async () => {
  const result = await runOnlineMock(`
    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = {
        { id = "host", name = "Host", seat = 1 },
        { id = "guest", name = "Guest", seat = 2 },
      },
      match = {
        id = "short-room",
        ownerId = "host",
        startedAt = 100,
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local state = setup_result.state
    local active_ai
    for player_id in pairs(state.aiPlayers or {}) do
      active_ai = player_id
      break
    end
    state.turnIndex = __test_seat_of(state, active_ai)
    local ai_count = 0
    for _ in pairs(state.aiPlayers or {}) do ai_count = ai_count + 1 end
    local owner_view = view(state, {}, {
      viewer = { id = "host", role = "player", isOwner = true },
    })
    local non_owner_view = view(state, {}, {
      viewer = { id = "guest", role = "player", isOwner = false },
    })
    local active_view = view(state, {}, {
      viewer = { id = state.players[state.turnIndex], role = "player", isOwner = false },
    })
    local inactive_view = view(state, {}, {
      viewer = { id = state.players[(state.turnIndex % 4) + 1], role = "player", isOwner = false },
    })
    local rejected = on_action(state, {
      type = "ai_turn",
      playerId = "mahjong-ai-3",
      action = { type = "discard", tileId = state.drawnTile },
    }, { actor = { id = "guest", isOwner = false } })
    local ai_context = owner_view.state.aiContext
    result = {
      player_count = #state.players,
      ai_count = ai_count,
      owner_has_context = ai_context ~= nil,
      guest_has_context = non_owner_view.state.aiContext ~= nil,
      context_actor = ai_context and ai_context.hands[state.players[state.turnIndex]] ~= nil,
      host_hand_hidden = ai_context and ai_context.hands.host == nil,
      guest_hand_hidden = ai_context and ai_context.hands.guest == nil,
      wall_is_count_only = ai_context and #ai_context.wall == #state.wall and ai_context.wall[1] == false,
      ura_hidden = ai_context and ai_context.deadWall[2] == false,
      seed_hidden = ai_context and ai_context.seed == nil,
      active_has_deadline = active_view.state.turnDeadlineAt ~= nil,
      inactive_has_deadline = inactive_view.state.turnDeadlineAt ~= nil,
      owner_flag = owner_view.state.roomIsOwner == true,
      guest_flag = non_owner_view.state.roomIsOwner == true,
      non_owner_rejected = rejected.accepted == false,
    }
  `);

  assert.equal(result.player_count, 4);
  assert.equal(result.ai_count, 2);
  assert.equal(result.owner_has_context, true);
  assert.equal(result.guest_has_context, false);
  assert.equal(result.context_actor, true);
  assert.equal(result.host_hand_hidden, true);
  assert.equal(result.guest_hand_hidden, true);
  assert.equal(result.wall_is_count_only, true);
  assert.equal(result.ura_hidden, true);
  assert.equal(result.seed_hidden, true);
  assert.equal(result.active_has_deadline, true);
  assert.equal(result.inactive_has_deadline, false);
  assert.equal(result.owner_flag, true);
  assert.equal(result.guest_flag, false);
  assert.equal(result.non_owner_rejected, true);
});

test("Mahjong room legal context includes the viewer's private furiten flags", async () => {
  const result = await runOnlineMock(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = ${PLAYERS},
      match = { id = "room-legal-preview", ownerId = "p1", randomSeed = "00000000000000000000000000000052" },
    })
    local state = setup_result.state
    local p1_seat = __test_seat_of(state, "p1")
    state.phase, state.turnIndex, state.wall = "playing", p1_seat, { 1, 2, 3, 4 }
    state.hands.p1 = ids({ 2,2,3,4,5,5,6,7, 13,14,15, 21,22 })
    state.drawnTile = ids({ 23 })[1]
    state.melds.p1, state.discards.p1 = {}, {}
    state.tempFuriten.p1, state.riichiFuriten.p1 = false, false
    local projection = view(state, {}, { viewer = { id = "p1", seat = p1_seat, isOwner = true } })
    local context = projection.state.legalContext
    result = {
      sentPrivateFuritenFlags = context.tempFuriten == false and context.riichiFuriten == false,
    }
  `);

  assert.deepEqual(result, {
    sentPrivateFuritenFlags: true,
  });
});

test("Mahjong rooms return a dense kuikae vector after a pon", async () => {
  const result = await runOnlineMock(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local started = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = ${PLAYERS},
      match = { id = "room-pon-serialization", ownerId = "p1", randomSeed = "00000000000000000000000000000047" },
    })
    local state = started.state
    local p1_seat = __test_seat_of(state, "p1")
    local p2_seat = __test_seat_of(state, "p2")
    state.phase, state.turnIndex, state.drawnTile = "claiming", p1_seat, 0
    state.hands.p2 = ids({ 1,1,2,3,4,5,6,7,8,9,10,28,29 })
    state.discards.p1 = { { tile = 1, claimed = false } }
    state.lastDiscard = { player = "p1", playerIndex = p1_seat, tile = 1, discardIndex = 1 }
    state.claimants = { {
      playerId = "p2", playerIndex = p2_seat, distance = 1,
      options = { { kind = "pon", tileIds = { 2, 3 } } },
    } }
    state.claimResponses, state.claimIndex = {}, 1
    local claimed = on_action(state, { type = "claim", option = 1 }, {
      serverTime = 1001,
      actor = { id = "p2", role = "player", seat = p2_seat },
    })
    local forbidden = claimed.state.kuikaeForbidden.p2
    local dense = #forbidden == 34
    for kind = 1, 34 do
      if forbidden[kind] == nil then dense = false break end
    end
    local projection = view(claimed.state, {}, {
      viewer = { id = "p2", role = "player", seat = p2_seat, isOwner = false },
    })
    result = {
      accepted = claimed.accepted == true,
      dense = dense,
      calledTypeForbidden = forbidden[1] == true,
      legalTypes = projection.state.legalActions.forbiddenDiscardTypes,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.dense, true);
  assert.equal(result.calledTypeForbidden, true);
  assert.deepEqual(result.legalTypes, [1]);
});

test("authoritative Mahjong timers auto-discard and auto-pass with stale protection", async () => {
  const result = await runOnlineMock(`
    local players = ${PLAYERS}
    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 5000,
      players = players,
      match = {
        id = "mock-timer-room",
        ownerId = "p1",
        startedAt = 100,
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local state = setup_result.state
    local first_timer = setup_result.timerOps[1]
    local initial_deadline = state.turnDeadlineAt
    local stale = on_timer(state, {
      id = "mahjong-turn",
      payload = {
        phase = "playing",
        turnIndex = state.turnIndex,
        claimIndex = state.claimIndex,
        moveCount = state.moveCount + 1,
        drawnTile = state.drawnTile,
      },
    }, { firedAt = 5001 })
    local stale_timer = stale.timerOps and stale.timerOps[1]
    local before_timeout_move = state.moveCount
    local timed_out = on_timer(state, first_timer, { firedAt = 25000 })
    local next_timer = timed_out.timerOps and timed_out.timerOps[1]
    local timeout_move = timed_out.state.moveCount
    state = timed_out.state
    local search_timer = next_timer
    local search_steps = 0
    while state.phase == "playing" and search_steps < 40 do
      search_steps = search_steps + 1
      local next_state = on_timer(state, search_timer, { firedAt = 25000 + search_steps * 20000 })
      state = next_state.state
      search_timer = next_state.timerOps and next_state.timerOps[1]
    end
    local found_claim_window = state.phase == "claiming" and search_timer ~= nil
    local claim_timeout
    local claim_before_index = state.claimIndex
    if found_claim_window then
      claim_timeout = on_timer(state, search_timer, { firedAt = 100000 })
    end
    result = {
      setupScheduled = first_timer.afterMs == 20000,
      deadline = initial_deadline == 25000,
      staleDidNotAdvance = stale.state.moveCount == state.moveCount,
      staleRescheduled = stale_timer and stale_timer.op == "schedule" and stale_timer.afterMs == 20000,
      timeoutAdvanced = timeout_move == before_timeout_move + 1,
      timeoutEvent = timed_out.events[#timed_out.events]
        and timed_out.events[#timed_out.events].type == "timer_timeout",
      nextTimerIsValid = next_timer and next_timer.op == "schedule"
        and (next_timer.afterMs == 8000 or next_timer.afterMs == 20000),
      foundClaimWindow = found_claim_window,
      claimTimeoutEvent = found_claim_window
        and claim_timeout.events[#claim_timeout.events]
        and claim_timeout.events[#claim_timeout.events].type == "timer_timeout",
      claimMoved = found_claim_window and (
        state.phase ~= "claiming" or state.claimIndex ~= claim_before_index
      ),
    }
  `);

  assert.equal(result.setupScheduled, true);
  assert.equal(result.deadline, true);
  assert.equal(result.staleDidNotAdvance, true);
  assert.equal(result.staleRescheduled, true);
  assert.equal(result.timeoutAdvanced, true);
  assert.equal(result.timeoutEvent, true);
  assert.equal(result.nextTimerIsValid, true);
  assert.equal(result.foundClaimWindow, true);
  assert.equal(result.claimTimeoutEvent, true);
  assert.equal(result.claimMoved, true);
});

test("Mahjong room timeouts take wins and promptly tsumogiri a forced riichi draw", async () => {
  const result = await runOnlineMock(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    local function scheduled(ops)
      for _, operation in ipairs(ops or {}) do
        if operation.op == "schedule" and operation.id == "mahjong-turn" then return operation end
      end
      return nil
    end

    local function room_state(seed)
      return setup({
        protocolVersion = 1,
        serverTime = 1000,
        players = ${PLAYERS},
        match = {
          id = "timeout-defaults-" .. seed,
          ownerId = "p1",
          randomSeed = seed,
        },
      }).state
    end

    local riichi_state = room_state("00000000000000000000000000000068")
    local riichi = {
      p1Seat = __test_seat_of(riichi_state, "p1"),
    }
    riichi.discarderSeat = (riichi.p1Seat + 2) % 4 + 1
    riichi.discarder = riichi_state.players[riichi.discarderSeat]
    riichi_state.phase, riichi_state.turnIndex, riichi_state.drawnTile = "claiming", riichi.discarderSeat, 0
    riichi_state.wall = { 53 }
    riichi_state.hands.p1 = { 1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49 }
    riichi_state.melds.p1, riichi_state.discards.p1 = {}, {}
    riichi_state.riichi.p1, riichi_state.firstTurn.p1 = true, false
    riichi_state.claimants = {
      { playerId = "p2", playerIndex = __test_seat_of(riichi_state, "p2"), distance = 1, options = { { kind = "pon", tileIds = { 1, 2 } } }, ronOpportunity = false },
    }
    riichi_state.claimResponses, riichi_state.claimIndex = {}, 1
    riichi_state.lastDiscard = { player = riichi.discarder, playerIndex = riichi.discarderSeat, tile = 1, discardIndex = 1 }
    riichi_state.discards[riichi.discarder] = { { tile = 1, claimed = false } }
    local riichi_started = on_action(riichi_state, { type = "pass" }, {
      serverTime = 1000,
      actor = { id = "p2", seat = __test_seat_of(riichi_state, "p2"), isOwner = false },
    })
    local riichi_timer = scheduled(riichi_started.timerOps)
    local riichi_timeout = on_timer(riichi_started.state, riichi_timer, { firedAt = 2000 })
    local riichi_discard = riichi_timeout.state.discards.p1[#riichi_timeout.state.discards.p1]

    local tsumo_state = room_state("00000000000000000000000000000069")
    tsumo_state.phase, tsumo_state.turnIndex, tsumo_state.drawnTile = "playing", __test_seat_of(tsumo_state, "p1"), 54
    tsumo_state.wall = { 1, 2, 3, 4 }
    tsumo_state.hands.p1 = ids({ 1,1,1, 2,3,4, 10,11,12, 19,20,21, 14 })
    tsumo_state.melds.p1, tsumo_state.discards.p1 = {}, {}
    local tsumo_timer = {
      id = "mahjong-turn",
      payload = {
        phase = "playing",
        turnIndex = __test_seat_of(tsumo_state, "p1"),
        claimIndex = tsumo_state.claimIndex,
        moveCount = tsumo_state.moveCount,
        drawnTile = tsumo_state.drawnTile,
      },
    }
    local tsumo_timeout = on_timer(tsumo_state, tsumo_timer, { firedAt = 22000 })
    local tsumo_won = false
    for _, event in ipairs(tsumo_timeout.events or {}) do
      if event.type == "won" and event.method == "tsumo" and event.player == "p1" then
        tsumo_won = true
      end
    end

    local ron_state = room_state("0000000000000000000000000000006a")
    ron_state.phase, ron_state.turnIndex, ron_state.drawnTile = "playing", __test_seat_of(ron_state, "p1"), 54
    ron_state.wall = { 1, 2, 3, 4 }
    ron_state.hands.p1 = { 1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49 }
    ron_state.hands.p2 = ids({ 1,2,3, 4,5,6, 10,11,12, 32,32,32, 14 })
    ron_state.hands.p3, ron_state.hands.p4 = {}, {}
    ron_state.melds.p1, ron_state.melds.p2, ron_state.melds.p3, ron_state.melds.p4 = {}, {}, {}, {}
    ron_state.discards.p1, ron_state.discards.p2, ron_state.discards.p3, ron_state.discards.p4 = {}, {}, {}, {}
    local discarded = on_action(ron_state, { type = "discard", tileId = 54 }, {
      serverTime = 1000,
      actor = { id = "p1", seat = __test_seat_of(ron_state, "p1"), isOwner = true },
    })
    local ron_timer = scheduled(discarded.timerOps)
    local ron_timeout = on_timer(discarded.state, ron_timer, { firedAt = 10000 })
    local ron_won = false
    for _, event in ipairs(ron_timeout.events or {}) do
      if event.type == "won" and event.method == "ron" and event.player == "p2" then
        ron_won = true
      end
    end

    result = {
      riichiUsesShortGrace = riichi_timer and riichi_timer.afterMs == 520,
      riichiDiscardedDraw = riichi_discard and riichi_discard.tsumogiri == true,
      tsumoWon = tsumo_won and tsumo_timeout.state.phase == "hand_ended",
      ronWon = ron_won and ron_timeout.state.phase == "hand_ended",
    }
  `);

  assert.deepEqual(result, {
    riichiUsesShortGrace: true,
    riichiDiscardedDraw: true,
    tsumoWon: true,
    ronWon: true,
  });
});

test("Mahjong room timeout win handling stays within the runtime instruction quota", async () => {
  const result = await runOnlineWithinRuntimeQuota(`
    local function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end

    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = ${PLAYERS},
      match = {
        id = "quota-timeout-win",
        ownerId = "p1",
        randomSeed = "0000000000000000000000000000006b",
      },
    })
    local state = setup_result.state
    local p1_seat = __test_seat_of(state, "p1")
    state.phase, state.turnIndex, state.drawnTile = "playing", p1_seat, 54
    state.wall = { 1, 2, 3, 4 }
    state.hands.p1 = ids({ 1,1,1, 2,3,4, 10,11,12, 19,20,21, 14 })
    state.melds.p1, state.discards.p1 = {}, {}
    local timed_out = __within_quota(function()
      return on_timer(state, {
        id = "mahjong-turn",
        payload = {
          phase = "playing",
          turnIndex = p1_seat,
          claimIndex = state.claimIndex,
          moveCount = state.moveCount,
          drawnTile = state.drawnTile,
        },
      }, { firedAt = 22000 })
    end)
    result = {
      accepted = timed_out.accepted == true,
      won = timed_out.state.phase == "hand_ended",
    }
  `);

  assert.deepEqual(result, { accepted: true, won: true });
});

test("authoritative Mahjong result pages wait for every player, time out safely, and stop on the final ranking", async () => {
  const result = await runOnlineMock(`
    local players = ${PLAYERS}

    local function action_context(seat, server_time)
      return {
        serverTime = server_time,
        actor = {
          id = players[seat].id,
          role = "player",
          seat = seat,
          isOwner = seat == 1,
        },
      }
    end

    local function viewer_context(seat, server_time)
      return {
        serverTime = server_time,
        viewer = {
          id = players[seat].id,
          role = "player",
          seat = seat,
          isOwner = seat == 1,
        },
      }
    end

    local function scheduled(ops, id)
      for _, operation in ipairs(ops or {}) do
        if operation.op == "schedule" and operation.id == id then return operation end
      end
      return nil
    end

    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = players,
      match = {
        id = "mock-result-room",
        ownerId = "p1",
        startedAt = 100,
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local state = setup_result.state
    state.phase = "hand_ended"
    state.draw = false
    state.matchEnded = false
    state.results = { { winnerIndex = 1, yaku = {} } }
    state.result = state.results[1]
    state.nextDealerIndex = state.dealerIndex
    state.nextHandNumber = state.handNumber + 1
    state.nextRoundWind = state.roundWind
    state.nextHonba = state.honba

    local ready_one = on_action(state, { type = "result_ready" }, action_context(1, 1000))
    state = ready_one.state
    local after_one = scheduled(ready_one.timerOps, "mahjong-result")
    local own_projection = view(state, {}, viewer_context(1, 1000))
    local other_projection = view(state, {}, viewer_context(2, 1000))
    local still_waiting = state.resultPage == 0

    for seat = 2, 4 do
      local ready = on_action(state, { type = "result_ready" }, action_context(seat, 1000 + seat))
      state = ready.state
      if seat == 4 then after_one = scheduled(ready.timerOps, "mahjong-result") end
    end
    local score_page_after_all_ready = state.resultPage == 1

    for seat = 1, 4 do
      local ready = on_action(state, { type = "result_ready" }, action_context(seat, 2000 + seat))
      state = ready.state
    end
    local next_hand_after_all_ready = state.phase == "playing"

    state.phase = "hand_ended"
    state.draw = false
    state.matchEnded = true
    state.results = { { winnerIndex = 1, yaku = {} } }
    state.result = state.results[1]
    state.resultPage = nil
    state.resultReadyPlayers = nil
    state.resultDeadlineAt = nil
    local terminal_ready = on_action(state, { type = "result_ready" }, action_context(1, 3000))
    state = terminal_ready.state
    local detail_timer = scheduled(terminal_ready.timerOps, "mahjong-result")
    local score_timeout = on_timer(state, detail_timer, { firedAt = 11000 })
    state = score_timeout.state
    local result_timeout_advanced = state.resultPage == 1
    local score_timer = scheduled(score_timeout.timerOps, "mahjong-result")
    local final_timeout = on_timer(state, score_timer, { firedAt = 19000 })
    state = final_timeout.state
    local final_projection = view(state, {}, viewer_context(1, 19000))

    result = {
      resultTimerScheduled = after_one and after_one.afterMs > 0,
      ownReadyOnly = own_projection.state.resultPageReady == true
        and other_projection.state.resultPageReady == false,
      stillWaiting = still_waiting,
      scorePageAfterAllReady = score_page_after_all_ready,
      nextHandAfterAllReady = next_hand_after_all_ready,
      resultTimeoutAdvanced = result_timeout_advanced,
      finalRankingVisible = final_projection.state.resultSummaryVisible == true,
      finalRankingHasPaipu = final_projection.state.paipu ~= nil
        and final_projection.state.paipu.status == "completed"
        and final_projection.state.paipu.game.mode == "room",
      finalRankingHasNoDeadline = final_projection.state.resultDeadlineAt == nil,
      finalRankingHasNoTimer = scheduled(final_timeout.timerOps, "mahjong-result") == nil,
    }
  `);

  assert.equal(result.resultTimerScheduled, true);
  assert.equal(result.ownReadyOnly, true);
  assert.equal(result.stillWaiting, true);
  assert.equal(result.scorePageAfterAllReady, true);
  assert.equal(result.nextHandAfterAllReady, true);
  assert.equal(result.resultTimeoutAdvanced, true);
  assert.equal(result.finalRankingVisible, true);
  assert.equal(result.finalRankingHasPaipu, true);
  assert.equal(result.finalRankingHasNoDeadline, true);
  assert.equal(result.finalRankingHasNoTimer, true);
});
