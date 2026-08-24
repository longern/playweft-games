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

async function runOnlineWithinRuntimeQuota(scenario) {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const source = buildMahjongOnlineSource(fullSource);
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`
      local __quota_fuel = 0
      local __quota_sethook = debug.sethook
      local function __quota_hook()
        __quota_fuel = __quota_fuel + 1000
        if __quota_fuel > 50000 then error("instruction quota exceeded", 0) end
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

test("Mahjong room entry stays below the Lua source limit and excludes solo AI", async () => {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const onlineSource = buildMahjongOnlineSource(fullSource);

  assert.ok(Buffer.byteLength(onlineSource) < MAHJONG_ONLINE_SOURCE_LIMIT);
  assert.match(onlineSource, /function setup\(/);
  assert.match(onlineSource, /function on_action\(/);
  assert.match(onlineSource, /function view\(/);
  assert.doesNotMatch(onlineSource, /function ai_action\(/);
  assert.doesNotMatch(onlineSource, /function choose_ai_discard\(/);
});

test("Mahjong rooms stay in a private game lobby until the owner starts the selected match", async () => {
  const result = await runOnlineMock(`
    local setup_result = setup({
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
    local state = setup_result.state
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

test("Mahjong settles a full exhaustive draw within the runtime instruction quota", async () => {
  const result = await runOnlineWithinRuntimeQuota(`
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
      state, version = applied.state, version + 1
    end
    result = {
      ended = state.phase == "hand_ended",
      exhaustive = state.draw == true,
      tenpaiSeats = #(state.result and state.result.tenpai or {}),
      actionCount = action_count,
    }
  `);

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
    local players = ${PLAYERS}
    local setup_result = setup({
      protocolVersion = 1,
      serverTime = 1000,
      players = players,
      match = {
        id = "mock-room-1",
        ownerId = "p1",
        startedAt = 100,
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local state = setup_result.state
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
          isOwner = seat == 1,
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
          isOwner = actor_seat == 1,
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
      paipuRemoved = state.paipu == nil and state.paipuTilePositions == nil,
    }
  `);

  assert.equal(result.ended, true);
  assert.equal(result.allAccepted, true);
  assert.equal(result.allViewsPrivate, true);
  assert.equal(result.allActionIdsUnique, true);
  assert.equal(result.timerContractOk, true);
  assert.equal(result.paipuRemoved, true);
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
      ura_hidden = ai_context and ai_context.deadWall[2] == nil,
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
    state.phase, state.turnIndex, state.wall = "playing", 1, { 1, 2, 3, 4 }
    state.hands.p1 = ids({ 2,2,3,4,5,5,6,7, 13,14,15, 21,22 })
    state.drawnTile = ids({ 23 })[1]
    state.melds.p1, state.discards.p1 = {}, {}
    state.tempFuriten.p1, state.riichiFuriten.p1 = false, false
    local projection = view(state, {}, { viewer = { id = "p1", seat = 1, isOwner = true } })
    local context = projection.state.legalContext
    result = {
      sentPrivateFuritenFlags = context.tempFuriten == false and context.riichiFuriten == false,
    }
  `);

  assert.deepEqual(result, {
    sentPrivateFuritenFlags: true,
  });
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
  assert.equal(result.finalRankingHasNoDeadline, true);
  assert.equal(result.finalRankingHasNoTimer, true);
});
