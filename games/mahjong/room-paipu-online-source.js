import luamin from "luamin";

import {
  buildMahjongOnlineSource as buildBaseMahjongOnlineSource,
  MAHJONG_ONLINE_SOURCE_LIMIT,
} from "./online-source.js";

export { MAHJONG_ONLINE_SOURCE_LIMIT };

// Room paipu history is streamed hand-by-hand. Keeping an entire hanchan in
// authoritative Lua state eventually violates Playweft's 64 KiB state limit.
// Use prefixed globals for this thin wrapper so it does not consume Lua's
// already-tight 200-local main-chunk budget.
const ROOM_PAIPU_ROLLING_GUARD = String.raw`
__mahjong_room_paipu_action = on_action
__mahjong_room_paipu_timer = on_timer
__mahjong_room_paipu_view = view

function __mahjong_room_paipu_current_hand(state)
  local hands = state and state.paipu and state.paipu.hands
  return hands and hands[#hands] or nil
end

function __mahjong_room_paipu_strip_private_reports(state)
  local hand = __mahjong_room_paipu_current_hand(state)
  if not hand then return end
  for _, command in ipairs(hand.commands or {}) do
    local action = command and command.action
    if type(action) == "table" then action.tenpaiReport = nil end
  end
end

function __mahjong_room_paipu_keep_current_hand(state)
  local paipu = state and state.paipu
  local hands = paipu and paipu.hands
  if not hands or #hands <= 1 then return end
  local previous = hands[#hands - 1]
  local current = hands[#hands]
  local previous_index = tonumber(previous and previous.index)
  if previous_index == nil then previous_index = #hands - 2 end
  current.index = previous_index + 1
  paipu.hands = { current }
end

-- A claim option number is only an ephemeral index into the current engine
-- state. Persist the exact concealed wall references consumed by chi/pon/kan
-- so replay can resolve the equivalent option even when identical physical
-- tile IDs were reconstructed differently.
function __mahjong_room_paipu_capture_claim(state, action, actor_id)
  if not state or state.phase ~= "claiming" or type(action) ~= "table" or action.type ~= "claim" then
    return
  end
  local selected_index = tonumber(action.option)
  if not selected_index then return end
  for _, claimant in ipairs(state.claimants or {}) do
    if claimant.playerId == actor_id then
      local option = claimant.options and claimant.options[selected_index]
      if not option then return end
      local tiles = {}
      for _, tile_id in ipairs(option.tileIds or {}) do
        local ref = state.paipuTilePositions and state.paipuTilePositions[tile_id]
        if ref ~= nil then tiles[#tiles + 1] = { ref = ref } end
      end
      action.paipuClaim = { kind = option.kind, tiles = tiles }
      return
    end
  end
end

function __mahjong_room_paipu_normalize_result(result)
  if not result or result.accepted ~= true or type(result.state) ~= "table" then return result end
  __mahjong_room_paipu_strip_private_reports(result.state)
  __mahjong_room_paipu_keep_current_hand(result.state)
  if result.state.phase == "hand_ended" then result.state.paipuTilePositions = nil end
  return result
end

function on_action(state, action, context)
  __mahjong_room_paipu_capture_claim(state, action, context and context.actor and context.actor.id)
  return __mahjong_room_paipu_normalize_result(__mahjong_room_paipu_action(state, action, context))
end

function on_timer(state, timer, context)
  return __mahjong_room_paipu_normalize_result(__mahjong_room_paipu_timer(state, timer, context))
end

function view(state, events, context)
  local projection = __mahjong_room_paipu_view(state, events, context)
  if projection and projection.state then
    if state.phase == "hand_ended" then
      projection.state.paipu = export_paipu(state, "room")
    else
      projection.state.paipu = nil
    end
  end
  return projection
end
`;

export function buildMahjongOnlineSource(source) {
  const base = buildBaseMahjongOnlineSource(source).trimEnd();
  const rollingGuard = luamin.minify(ROOM_PAIPU_ROLLING_GUARD);
  return `${base}\n${rollingGuard}\n`;
}

export async function readMahjongOnlineSource(readSource) {
  return buildMahjongOnlineSource(await readSource());
}
