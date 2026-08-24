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
local __mahjong_discard_timeout_ms = 20000
local __mahjong_claim_timeout_ms = 8000

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
  local delay = __mahjong_timeout_ms(state)
  if not delay then
    state.turnDeadlineAt = nil
    return { { op = "cancel", id = __mahjong_turn_timer_id } }
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
  end
  return projection
end

function on_timer(state, timer, context)
  local payload = timer and timer.payload
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
