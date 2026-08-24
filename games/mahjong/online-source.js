import luamin from "luamin";

export const MAHJONG_ONLINE_SOURCE_LIMIT = 256 * 1024;

// Keep the authoritative room entry deliberately boring: rules, projection,
// and action validation only. AI and local paipu code stay in game.lua.
const AI_START = "local function standard_shanten_counts";
const PROTOCOL_START = "function setup(context)";
const AI_CLAIM_START = "local function copy_meld_list";
const OPTIONAL_CALLBACK_START = "function on_player_left";

const ONLINE_STATE_GUARD = String.raw`
local __mahjong_turn_timer_id = "mahjong-turn"
local __mahjong_result_timer_id = "mahjong-result"
local __mahjong_discard_timeout_ms = 20000
local __mahjong_claim_timeout_ms = 8000
local __mahjong_result_timeout_ms = 8000

local function __mahjong_now(context)
  return tonumber(context and (context.serverTime or context.firedAt)) or 0
end

local function __mahjong_clear_private_state(state)
  state.paipu = nil
  state.paipuTilePositions = nil
  state.replayWall = nil
end

local function __mahjong_stage_tenpai_report(state, action, player_id)
  if type(action) ~= "table" or type(player_id) ~= "string" then return end
  if (action.type == "discard" or action.type == "riichi") and type(action.tenpaiReport) == "table" then
    state.pendingTenpaiReport = { playerId = player_id, report = action.tenpaiReport }
  end
end

local function __mahjong_commit_tenpai_report(state)
  local pending = state.pendingTenpaiReport
  if not pending then return end
  state.pendingTenpaiReport = nil
  local player_id = pending.playerId
  if not (state.hands and state.melds and state.hands[player_id] and state.melds[player_id]) then return end
  local report = normalized_tenpai_report(pending.report, state.hands[player_id], state.melds[player_id])
  if report then
    state.tenpaiReports = state.tenpaiReports or {}
    state.tenpaiReports[player_id] = report
  end
end

-- The host's browser runs an AI worker, but it must receive only what the
-- active AI could know: public table data plus that AI's own concealed hand.
local function __mahjong_ai_context(state, actor_id)
  if not (state.aiPlayers and state.aiPlayers[actor_id]) then return nil end
  local hands = { [actor_id] = copy_array(state.hands and state.hands[actor_id]) }
  local wall = {}
  for index = 1, #(state.wall or {}) do wall[index] = false end
  local dead_wall = {}
  for index = 1, (tonumber(state.kanCount) or 0) + 1 do
    -- Dora indicators are public; ura indicators and the rest of the dead wall
    -- deliberately remain absent.
    dead_wall[(index - 1) * 2 + 1] = state.deadWall and state.deadWall[(index - 1) * 2 + 1] or nil
  end
  local claimants, claim_index = {}, 0
  if state.phase == "claiming" then
    local claimant = state.claimants and state.claimants[state.claimIndex]
    if not claimant or claimant.playerId ~= actor_id then return nil end
    claimants[1] = claimant
    claim_index = 1
  end
  return {
    players = copy_array(state.players),
    phase = state.phase,
    turnIndex = state.turnIndex,
    drawnTile = state.drawnTile,
    hands = hands,
    wall = wall,
    deadWall = dead_wall,
    kanCount = state.kanCount,
    callOccurred = state.callOccurred,
    lastDiscard = state.lastDiscard,
    claimants = claimants,
    claimIndex = claim_index,
    claimResponses = {},
    melds = state.melds,
    discards = state.discards,
    riichi = state.riichi,
    scores = state.scores,
    matchType = state.matchType,
    roundWind = state.roundWind,
    handNumber = state.handNumber,
    dealerIndex = state.dealerIndex,
    honba = state.honba,
    riichiSticks = state.riichiSticks,
    rules = state.rules,
    tempFuriten = { [actor_id] = state.tempFuriten and state.tempFuriten[actor_id] },
    riichiFuriten = { [actor_id] = state.riichiFuriten and state.riichiFuriten[actor_id] },
    kuikaeForbidden = { [actor_id] = state.kuikaeForbidden and state.kuikaeForbidden[actor_id] },
    firstTurn = { [actor_id] = state.firstTurn and state.firstTurn[actor_id] },
    doubleRiichi = { [actor_id] = state.doubleRiichi and state.doubleRiichi[actor_id] },
    ippatsu = { [actor_id] = state.ippatsu and state.ippatsu[actor_id] },
    rinshanWin = state.rinshanWin,
    chankanWin = state.chankanWin,
  }
end

-- Exact human-turn hints are calculated locally.  This contains only the
-- viewer's private flags and public tiles, never another human's concealed
-- hand or the hidden part of the wall.
local function __mahjong_legal_context(state, player_id)
  local dora_tiles = {}
  for index = 1, (tonumber(state.kanCount) or 0) + 1 do
    dora_tiles[index] = state.deadWall and state.deadWall[(index - 1) * 2 + 1] or nil
  end
  return {
    kanCount = state.kanCount,
    callOccurred = state.callOccurred,
    doraTiles = dora_tiles,
    discards = state.discards,
    melds = state.melds,
    kuikaeForbidden = state.kuikaeForbidden and state.kuikaeForbidden[player_id] or {},
    firstTurn = state.firstTurn and state.firstTurn[player_id] == true,
    doubleRiichi = state.doubleRiichi and state.doubleRiichi[player_id] == true,
    ippatsu = state.ippatsu and state.ippatsu[player_id] == true,
    rinshanWin = state.rinshanWin == true,
    chankanWin = state.chankanWin == true,
  }
end

local function __mahjong_timer_payload(state)
  local payload = {
    phase = state.phase,
    turnIndex = tonumber(state.turnIndex) or 0,
    claimIndex = tonumber(state.claimIndex) or 0,
    moveCount = tonumber(state.moveCount) or 0,
    drawnTile = tonumber(state.drawnTile) or 0,
  }
  if state.phase == "claiming" then
    local claimant = state.claimants and state.claimants[state.claimIndex]
    payload.player = claimant and claimant.playerId or nil
  elseif state.phase == "playing" then
    payload.player = state.players[state.turnIndex]
  end
  return payload
end

local function __mahjong_result_detail_page_count(state)
  if state.draw == true then return 0 end
  local results = state.results or {}
  if #results > 0 then return #results end
  return state.result and 1 or 0
end

local function __mahjong_result_page_count(state)
  if state.phase ~= "hand_ended" then return 0 end
  local pages = __mahjong_result_detail_page_count(state) + 1
  if state.matchEnded then pages = pages + 1 end
  return pages
end

local function __mahjong_result_summary_page(state)
  return __mahjong_result_detail_page_count(state) + 1
end

local function __mahjong_result_page_needs_confirmation(state)
  return state.phase == "hand_ended"
    and not (state.matchEnded and tonumber(state.resultPage) == __mahjong_result_summary_page(state))
end

local function __mahjong_start_result_page(state, context)
  if not __mahjong_result_page_needs_confirmation(state) then
    state.resultReadyPlayers = nil
    state.resultDeadlineAt = nil
    return
  end
  state.resultReadyPlayers = {}
  for player_id in pairs(state.aiPlayers or {}) do
    state.resultReadyPlayers[player_id] = true
  end
  local now = __mahjong_now(context)
  state.resultDeadlineAt = now > 0 and now + __mahjong_result_timeout_ms or nil
end

local function __mahjong_ensure_result_page(state, context)
  if state.phase ~= "hand_ended" then
    state.resultPage = nil
    state.resultReadyPlayers = nil
    state.resultDeadlineAt = nil
    return
  end
  state.turnDeadlineAt = nil
  local page_count = __mahjong_result_page_count(state)
  local page = tonumber(state.resultPage)
  if not page or page < 0 or page >= page_count then
    state.resultPage = 0
    __mahjong_start_result_page(state, context)
    return
  end
  if __mahjong_result_page_needs_confirmation(state)
    and type(state.resultReadyPlayers) ~= "table" then
    __mahjong_start_result_page(state, context)
  end
end

local function __mahjong_result_timer_payload(state)
  return {
    phase = state.phase,
    roundWind = tonumber(state.roundWind) or 0,
    handNumber = tonumber(state.handNumber) or 0,
    moveCount = tonumber(state.moveCount) or 0,
    resultPage = tonumber(state.resultPage) or 0,
  }
end

local function __mahjong_result_timer_matches(state, payload)
  return type(payload) == "table"
    and payload.phase == "hand_ended"
    and tonumber(payload.roundWind) == tonumber(state.roundWind)
    and tonumber(payload.handNumber) == tonumber(state.handNumber)
    and tonumber(payload.moveCount) == tonumber(state.moveCount)
    and tonumber(payload.resultPage) == tonumber(state.resultPage)
end

local function __mahjong_timeout_ms(state)
  if state.phase == "playing" then
    return __mahjong_discard_timeout_ms
  end
  if state.phase == "claiming" then
    return __mahjong_claim_timeout_ms
  end
  return nil
end

local function __mahjong_timer_ops(state, context)
  __mahjong_ensure_result_page(state, context)
  if __mahjong_result_page_needs_confirmation(state) then
    local now = __mahjong_now(context)
    local after_ms = __mahjong_result_timeout_ms
    if now > 0 and tonumber(state.resultDeadlineAt) then
      after_ms = math.max(1, tonumber(state.resultDeadlineAt) - now)
    end
    return {
      { op = "cancel", id = __mahjong_turn_timer_id },
      {
        op = "schedule",
        id = __mahjong_result_timer_id,
        afterMs = after_ms,
        payload = __mahjong_result_timer_payload(state),
      },
    }
  end
  local delay = __mahjong_timeout_ms(state)
  if not delay then
    state.turnDeadlineAt = nil
    return {
      { op = "cancel", id = __mahjong_turn_timer_id },
      { op = "cancel", id = __mahjong_result_timer_id },
    }
  end
  local now = __mahjong_now(context)
  state.turnDeadlineAt = now > 0 and now + delay or nil
  return {
    {
      op = "schedule",
      id = __mahjong_turn_timer_id,
      afterMs = delay,
      payload = __mahjong_timer_payload(state),
    },
    { op = "cancel", id = __mahjong_result_timer_id },
  }
end

local function __mahjong_timer_matches(state, payload)
  return type(payload) == "table"
    and payload.phase == state.phase
    and tonumber(payload.turnIndex) == tonumber(state.turnIndex)
    and tonumber(payload.claimIndex) == tonumber(state.claimIndex)
    and tonumber(payload.moveCount) == tonumber(state.moveCount)
    and tonumber(payload.drawnTile) == tonumber(state.drawnTile)
end

local function __mahjong_with_timeout_event(result, state, context, player_id, player_index)
  if not result or not result.accepted or not result.state then
    return result
  end
  local events = result.events or {}
  events[#events + 1] = {
    type = "timer_timeout",
    player = player_id,
    playerIndex = player_index,
  }
  result.timerOps = __mahjong_timer_ops(result.state, context)
  __mahjong_clear_private_state(result.state)
  return result
end

local __mahjong_online_setup = setup
function setup(context)
  local state = __mahjong_online_setup(context)
  __mahjong_clear_private_state(state)
  return {
    state = state,
    events = {},
    timerOps = __mahjong_timer_ops(state, context),
  }
end

local __mahjong_online_action = on_action
function on_action(state, action, context)
  if action and action.type == "ai_turn" then
    local actor = context and context.actor
    local player_id = action.playerId
    if not actor or actor.isOwner ~= true then
      return rejected("ai_turn_owner_only")
    end
    if type(player_id) ~= "string"
      or not (state.aiPlayers and state.aiPlayers[player_id]) then
      return rejected("not_an_ai_player")
    end
    if type(action.action) ~= "table" then
      return rejected("invalid_ai_action")
    end
    __mahjong_stage_tenpai_report(state, action.action, player_id)
    local result = __mahjong_online_action(state, action.action, {
      actor = { id = player_id, role = "player", seat = player_index(state, player_id) },
    })
    if not result or not result.accepted or not result.state then
      state.pendingTenpaiReport = nil
      return result
    end
    __mahjong_commit_tenpai_report(result.state)
    local events = result.events or {}
    events[#events + 1] = {
      type = "ai_action",
      player = player_id,
      playerIndex = player_index(state, player_id),
    }
    result.events = events
    __mahjong_clear_private_state(result.state)
    result.timerOps = __mahjong_timer_ops(result.state, context)
    return result
  end
  if action and action.type == "result_ready" then
    local actor_id = context and context.actor and context.actor.id
    if state.phase ~= "hand_ended" or state.matchEnded and tonumber(state.resultPage) == __mahjong_result_summary_page(state) then
      return rejected("result_ready_not_available")
    end
    if not actor_id or not state.players then
      return rejected("not_a_player")
    end
    local is_player = false
    for _, player_id in ipairs(state.players) do
      if player_id == actor_id then is_player = true break end
    end
    if not is_player then return rejected("not_a_player") end
    __mahjong_ensure_result_page(state, context)
    if type(state.resultReadyPlayers) ~= "table" then
      __mahjong_start_result_page(state, context)
    end
    if state.resultReadyPlayers[actor_id] then
      return rejected("result_already_ready")
    end
    state.resultReadyPlayers[actor_id] = true
    local all_ready = true
    for _, player_id in ipairs(state.players) do
      if not (state.aiPlayers and state.aiPlayers[player_id])
        and state.resultReadyPlayers[player_id] ~= true then
        all_ready = false
        break
      end
    end
    if all_ready then
      local current_page = tonumber(state.resultPage) or 0
      local last_interactive_page = __mahjong_result_detail_page_count(state)
      if current_page < last_interactive_page then
        state.resultPage = current_page + 1
        __mahjong_start_result_page(state, context)
        local result = accepted(state, { { type = "result_page_advanced", resultPage = state.resultPage } })
        __mahjong_clear_private_state(result.state)
        result.timerOps = __mahjong_timer_ops(result.state, context)
        return result
      end
      if state.matchEnded then
        state.resultPage = __mahjong_result_summary_page(state)
        __mahjong_start_result_page(state, context)
        local result = accepted(state, { { type = "result_page_advanced", resultPage = state.resultPage } })
        __mahjong_clear_private_state(result.state)
        result.timerOps = __mahjong_timer_ops(result.state, context)
        return result
      end
      action = { type = "next_hand" }
    else
      local result = accepted(state, { { type = "result_ready", player = actor_id } })
      __mahjong_clear_private_state(result.state)
      result.timerOps = __mahjong_timer_ops(result.state, context)
      return result
    end
  end
  if action and action.type == "tenpai_report" then
    local actor_id = context and context.actor and context.actor.id
    if not actor_id or not (state.hands and state.melds and state.hands[actor_id] and state.melds[actor_id]) then
      return rejected("not_a_player")
    end
    if state.phase ~= "playing" and state.phase ~= "claiming" then
      return rejected("tenpai_report_not_available")
    end
    if state.players[state.turnIndex] == actor_id and (tonumber(state.drawnTile) or 0) > 0 then
      return rejected("tenpai_report_before_discard")
    end
    local report = normalized_tenpai_report(action.tenpaiReport, state.hands[actor_id], state.melds[actor_id])
    if not report then return rejected("invalid_tenpai_report") end
    state.tenpaiReports = state.tenpaiReports or {}
    state.tenpaiReports[actor_id] = report
    local result = accepted(state, {})
    __mahjong_clear_private_state(result.state)
    return result
  end
  __mahjong_stage_tenpai_report(state, action, context and context.actor and context.actor.id)
  local result = __mahjong_online_action(state, action, context)
  if not result or not result.accepted or not result.state then
    state.pendingTenpaiReport = nil
    return result
  end
  __mahjong_commit_tenpai_report(result.state)
  __mahjong_clear_private_state(result.state)
  result.timerOps = __mahjong_timer_ops(result.state, context)
  return result
end

local __mahjong_online_view = view
function view(state, events, context)
  local view_context = {}
  for key, value in pairs(context or {}) do view_context[key] = value end
  view_context.fastLegalActions = true
  local projection = __mahjong_online_view(state, events, view_context)
  if projection and projection.state then
    local viewer_id = context.viewer.id
    local active_player = nil
    if state.phase == "playing" then
      active_player = state.players[state.turnIndex]
    elseif state.phase == "claiming" then
      local claimant = state.claimants and state.claimants[state.claimIndex]
      active_player = claimant and claimant.playerId or nil
    end
    projection.state.turnDeadlineAt = active_player == viewer_id
      and state.turnDeadlineAt
      or nil
    projection.state.roomIsOwner = context.viewer.isOwner == true
    projection.state.resultPage = tonumber(state.resultPage) or 0
    projection.state.resultDeadlineAt = state.resultDeadlineAt
    projection.state.resultPageReady = state.resultReadyPlayers
      and state.resultReadyPlayers[context.viewer.id] == true
      or false
    projection.state.resultSummaryVisible = state.matchEnded == true
      and tonumber(state.resultPage) == __mahjong_result_summary_page(state)
    projection.state.aiPlayers = state.aiPlayers
    local ai_actor = context.viewer.isOwner and active_player or nil
    projection.state.aiTurn = ai_actor and state.aiPlayers and state.aiPlayers[ai_actor] and {
      player = ai_actor,
      phase = state.phase,
    } or nil
    projection.state.aiContext = ai_actor and __mahjong_ai_context(state, ai_actor) or nil
    projection.state.legalContext = active_player == viewer_id
      and not (state.aiPlayers and state.aiPlayers[viewer_id])
      and __mahjong_legal_context(state, viewer_id)
      or nil
  end
  return projection
end

function on_timer(state, timer, context)
  local payload = timer and timer.payload
  if timer and timer.id == __mahjong_result_timer_id then
    if not __mahjong_result_page_needs_confirmation(state)
      or not __mahjong_result_timer_matches(state, payload) then
      return {
        state = state,
        events = {},
        timerOps = __mahjong_timer_ops(state, context),
      }
    end
    local current_page = tonumber(state.resultPage) or 0
    local last_interactive_page = __mahjong_result_detail_page_count(state)
    if current_page < last_interactive_page then
      state.resultPage = current_page + 1
      __mahjong_start_result_page(state, context)
      local result = accepted(state, { { type = "result_timeout", resultPage = state.resultPage } })
      __mahjong_clear_private_state(result.state)
      result.timerOps = __mahjong_timer_ops(result.state, context)
      return result
    end
    if state.matchEnded then
      state.resultPage = __mahjong_result_summary_page(state)
      __mahjong_start_result_page(state, context)
      local result = accepted(state, { { type = "result_timeout", resultPage = state.resultPage } })
      __mahjong_clear_private_state(result.state)
      result.timerOps = __mahjong_timer_ops(result.state, context)
      return result
    end
    local result = __mahjong_online_action(state, { type = "next_hand" }, {
      actor = { id = state.players[1] },
    })
    return __mahjong_with_timeout_event(result, state, context, nil, 0)
  end
  if not __mahjong_timer_matches(state, payload) then
    return {
      state = state,
      events = {},
      timerOps = __mahjong_timer_ops(state, context),
    }
  end
  local player_id, player_index
  if state.phase == "playing" then
    player_index = tonumber(state.turnIndex) or 0
    player_id = state.players[player_index]
    if not player_id or (tonumber(state.drawnTile) or 0) <= 0 then
      return {
        state = state,
        events = {},
        timerOps = __mahjong_timer_ops(state, context),
      }
    end
    local result = perform_discard(state, state.drawnTile, player_id, player_index, false)
    return __mahjong_with_timeout_event(result, state, context, player_id, player_index)
  end
  if state.phase == "claiming" then
    local claimant = state.claimants and state.claimants[state.claimIndex]
    if not claimant then
      return {
        state = state,
        events = {},
        timerOps = __mahjong_timer_ops(state, context),
      }
    end
    player_id, player_index = claimant.playerId, claimant.playerIndex
    local result = apply_claim_response(state, { type = "pass" }, player_id)
    return __mahjong_with_timeout_event(result, state, context, player_id, player_index)
  end
  return {
    state = state,
    events = {},
    timerOps = __mahjong_timer_ops(state, context),
  }
end
`;

export function buildMahjongOnlineSource(source) {
  const fullSource = String(source);
  const aiStart = fullSource.indexOf(AI_START);
  const protocolStart = fullSource.indexOf(PROTOCOL_START);
  const aiClaimStart = fullSource.indexOf(AI_CLAIM_START);
  const callbackStart = fullSource.indexOf(OPTIONAL_CALLBACK_START);
  if (
    aiStart < 0 ||
    protocolStart < 0 ||
    aiClaimStart < 0 ||
    callbackStart < 0 ||
    !(aiStart < protocolStart && protocolStart < aiClaimStart && aiClaimStart < callbackStart)
  ) {
    throw new Error("Mahjong Lua source markers are out of order");
  }
  const selected = [
    fullSource.slice(0, aiStart),
    fullSource.slice(protocolStart, aiClaimStart),
    fullSource.slice(callbackStart),
  ].join("\n");
  const minified = luamin.minify(`${selected}\n${ONLINE_STATE_GUARD}`);
  return `${minified}\n`;
}

export async function readMahjongOnlineSource(readSource) {
  return buildMahjongOnlineSource(await readSource());
}
