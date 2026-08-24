import luamin from "luamin";

export const MAHJONG_ONLINE_SOURCE_LIMIT = 64 * 1024;

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
      if state.resultReadyPlayers[player_id] ~= true then
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
  local result = __mahjong_online_action(state, action, context)
  if not result or not result.accepted or not result.state then
    return result
  end
  __mahjong_clear_private_state(result.state)
  result.timerOps = __mahjong_timer_ops(result.state, context)
  return result
end

local __mahjong_online_view = view
function view(state, events, context)
  local projection = __mahjong_online_view(state, events, context)
  if projection and projection.state then
    projection.state.turnDeadlineAt = state.turnDeadlineAt
    projection.state.resultPage = tonumber(state.resultPage) or 0
    projection.state.resultDeadlineAt = state.resultDeadlineAt
    projection.state.resultPageReady = state.resultReadyPlayers
      and state.resultReadyPlayers[context.viewer.id] == true
      or false
    projection.state.resultSummaryVisible = state.matchEnded == true
      and tonumber(state.resultPage) == __mahjong_result_summary_page(state)
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
