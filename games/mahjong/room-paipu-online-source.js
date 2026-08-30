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
    if type(action) == "table" then
      -- tenpaiReport is an authoritative validation witness. It can be large
      -- and is not needed for replay once the action has been accepted.
      action.tenpaiReport = nil
    end
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

function __mahjong_room_paipu_normalize_result(result)
  if not result or result.accepted ~= true or type(result.state) ~= "table" then
    return result
  end
  __mahjong_room_paipu_strip_private_reports(result.state)
  __mahjong_room_paipu_keep_current_hand(result.state)
  -- The tile-reference map is needed only while recording the active hand.
  -- Once that hand is closed, every reference is already embedded in its log.
  if result.state.phase == "hand_ended" then
    result.state.paipuTilePositions = nil
  end
  return result
end

function on_action(state, action, context)
  return __mahjong_room_paipu_normalize_result(
    __mahjong_room_paipu_action(state, action, context)
  )
end

function on_timer(state, timer, context)
  return __mahjong_room_paipu_normalize_result(
    __mahjong_room_paipu_timer(state, timer, context)
  )
end

function view(state, events, context)
  local projection = __mahjong_room_paipu_view(state, events, context)
  if projection and projection.state then
    -- A completed hand is immutable, so every result-page snapshot can safely
    -- carry it. Reconnects during the result pages receive the same fragment.
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
