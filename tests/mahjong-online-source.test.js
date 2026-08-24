import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";
import { buildMahjongOnlineSource } from "../games/mahjong/online-source.js";

const PLAYERS = `{
  { id = "p1", name = "East", seat = 1 },
  { id = "p2", name = "South", seat = 2 },
  { id = "p3", name = "West", seat = 3 },
  { id = "p4", name = "North", seat = 4 }
}`;

async function runOnlineMock(scenario) {
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

test("Mahjong room entry stays below the Lua source limit and excludes solo AI", async () => {
  const fullSource = await readFile("games/mahjong/game.lua", "utf8");
  const onlineSource = buildMahjongOnlineSource(fullSource);

  assert.ok(Buffer.byteLength(onlineSource) < 64 * 1024);
  assert.match(onlineSource, /function setup\(/);
  assert.match(onlineSource, /function on_action\(/);
  assert.match(onlineSource, /function view\(/);
  assert.doesNotMatch(onlineSource, /function ai_action\(/);
  assert.doesNotMatch(onlineSource, /function choose_ai_discard\(/);
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
