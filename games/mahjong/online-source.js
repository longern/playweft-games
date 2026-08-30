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
local __mahjong_min_timer_delay_ms = 100
local __mahjong_riichi_tsumogiri_delay_ms = 520

local function __mahjong_now(context)
  return tonumber(context and (context.serverTime or context.firedAt)) or 0
end

local function __mahjong_timer_delay(delay)
  return math.max(
    __mahjong_min_timer_delay_ms,
    math.min(3600000, math.floor(tonumber(delay) or __mahjong_min_timer_delay_ms))
  )
end

local function __mahjong_clear_private_state(state)
  -- The tile-reference map is needed only while recording the active hand.
  -- Once a hand is closed, every replay reference is already embedded in its
  -- authoritative paipu log, so release the map before serializing the state.
  if state.phase == "hand_ended" then state.paipuTilePositions = nil end
  state.replayWall = nil
  state.autoPassClaimsApplying = nil
end

function __mahjong_record_action(result, action, actor_id)
  if not result or not result.accepted or not result.state then return result end
  if type(record_paipu_action) == "function" and type(action) == "table" then
    record_paipu_action(result.state, action, actor_id, result.events)
  end
  return result
end

local function __mahjong_is_room_player(state, player_id)
  for _, candidate in ipairs(state.players or {}) do
    if candidate == player_id then return true end
  end
  return false
end

local function __mahjong_sanitize_character_reference(value)
  if type(value) ~= "table" then return nil end
  if type(value.packId) ~= "string" or type(value.characterId) ~= "string" then
    return nil
  end
  if #value.packId == 0 or #value.packId > 120
    or #value.characterId == 0 or #value.characterId > 120 then
    return nil
  end
  return { packId = value.packId, characterId = value.characterId }
end

local function __mahjong_sanitize_player_presentation(value)
  if type(value) ~= "table" then return nil end
  local result = {}
  if value.avatarPreference == "theme" then result.avatarPreference = "theme"
  else result.avatarPreference = "auto" end
  if value.portraitMode == "platform" then result.portraitMode = "platform"
  else result.portraitMode = "character" end
  local theme_character = __mahjong_sanitize_character_reference(value.themeCharacter)
  if theme_character then result.themeCharacter = theme_character end
  if type(value.builtinCharacterId) == "string"
    and #value.builtinCharacterId > 0 and #value.builtinCharacterId <= 120 then
    result.builtinCharacterId = value.builtinCharacterId
  else
    return nil
  end
  if type(value.displayName) == "string"
    and #value.displayName > 0 and #value.displayName <= 120 then
    result.displayName = value.displayName
  end
  return result
end

local function __mahjong_sanitize_ai_presentations(value, ai_players)
  local result = {}
  if type(value) ~= "table" then return result end
  for player_id in pairs(ai_players or {}) do
    local presentation = __mahjong_sanitize_player_presentation(value[player_id])
    if presentation then result[player_id] = presentation end
  end
  return result
end

local function __mahjong_has_ron_option(claimant)
  for _, option in ipairs(claimant and claimant.options or {}) do
    if option.kind == "ron" then return true end
  end
  return false
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
    -- stay false.  This must remain a dense vector for room serialization.
    dead_wall[(index - 1) * 2 + 1] = state.deadWall and state.deadWall[(index - 1) * 2 + 1] or false
    dead_wall[index * 2] = false
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
    tempFuriten = state.tempFuriten and state.tempFuriten[player_id] == true,
    riichiFuriten = state.riichiFuriten and state.riichiFuriten[player_id] == true,
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

-- Once a player has declared riichi, the drawn tile normally has to be
-- discarded. Keep the normal turn window only when there is a meaningful
-- choice left (win, abortive draw, or a legal post-riichi concealed kan).
local function __mahjong_should_auto_riichi_tsumogiri(state, player_id, player_index)
  if state.phase ~= "playing"
    or state.riichi[player_id] ~= true
    or (tonumber(state.drawnTile) or 0) <= 0 then
    return false
  end
  if score_hand(state, player_index, state.drawnTile, "tsumo") then return false end
  if can_abort_nine(state, player_id) then return false end
  return #self_kan_options(state, player_id) == 0
end

local function __mahjong_timeout_ms(state)
  if state.phase == "playing" then
    local player_index = tonumber(state.turnIndex) or 0
    local player_id = state.players and state.players[player_index]
    if player_id and __mahjong_should_auto_riichi_tsumogiri(state, player_id, player_index) then
      return __mahjong_riichi_tsumogiri_delay_ms
    end
    return __mahjong_discard_timeout_ms
  end
  if state.phase == "claiming" then
    return __mahjong_claim_timeout_ms
  end
  return nil
end

local function __mahjong_timeout_playing_action(state, player_id, player_index)
  local tsumo_action = { type = "tsumo" }
  local won = apply_tsumo(state, player_id, player_index)
  if won and won.accepted then return won, tsumo_action end
  local discard_action = { type = "discard", tileId = state.drawnTile }
  return perform_discard(state, discard_action.tileId, player_id, player_index, false), discard_action
end

local function __mahjong_timeout_claim_action(state, claimant)
  for option_index, option in ipairs(claimant.options or {}) do
    if option.kind == "ron" then
      local action = { type = "claim", option = option_index }
      return apply_claim_response(state, action, claimant.playerId), action
    end
  end
  local action = { type = "pass" }
  return apply_claim_response(state, action, claimant.playerId), action
end

local function __mahjong_timer_ops(state, context)
  __mahjong_ensure_result_page(state, context)
  if __mahjong_result_page_needs_confirmation(state) then
    local now = __mahjong_now(context)
    local after_ms = __mahjong_result_timeout_ms
    if now > 0 and tonumber(state.resultDeadlineAt) then
      after_ms = tonumber(state.resultDeadlineAt) - now
    end
    return {
      { op = "cancel", id = __mahjong_turn_timer_id },
      {
        op = "schedule",
        id = __mahjong_result_timer_id,
        afterMs = __mahjong_timer_delay(after_ms),
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
      afterMs = __mahjong_timer_delay(delay),
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

local function __mahjong_with_timeout_event(result, state, context, player_id, player_index, action)
  if not result or not result.accepted or not result.state then
    return result
  end
  __mahjong_record_action(result, action, player_id)
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

function setup(context)
  local players, names, ai_players = setup_players(context)
  if #players ~= PLAYER_COUNT then
    error("Mahjong requires exactly four players")
  end
  local state = {
    phase = "lobby",
    players = players,
    playerNames = names,
    aiPlayers = ai_players,
    lobbySeed = normalize_random_seed(context.match and context.match.randomSeed),
    roomOwnerId = context.match and context.match.ownerId,
    aiPresentations = {},
    playerPresentations = {},
    autoPassClaims = {},
  }
  return {
    state = state,
    events = {},
    timerOps = __mahjong_timer_ops(state, context),
  }
end

local __mahjong_online_action = on_action
function on_action(state, action, context)
  if action and action.type == "set_player_presentation" then
    local actor_id = context and context.actor and context.actor.id
    if not actor_id or not __mahjong_is_room_player(state, actor_id) then
      return rejected("not_a_player")
    end
    local presentation = __mahjong_sanitize_player_presentation(
      action.playerPresentation
    )
    if not presentation then return rejected("invalid_player_presentation") end
    state.playerPresentations = state.playerPresentations or {}
    state.playerPresentations[actor_id] = presentation
    local result = accepted(state, {
      { type = "player_presentation_changed", player = actor_id },
    })
    __mahjong_clear_private_state(result.state)
    result.timerOps = __mahjong_timer_ops(result.state, context)
    return result
  end
  if action and action.type == "set_pass_claims" then
    local actor_id = context and context.actor and context.actor.id
    if not actor_id or not __mahjong_is_room_player(state, actor_id) then
      return rejected("not_a_player")
    end
    if type(action.enabled) ~= "boolean" then
      return rejected("invalid_pass_claims_setting")
    end
    state.autoPassClaims = state.autoPassClaims or {}
    state.autoPassClaims[actor_id] = action.enabled
    if action.enabled and state.phase == "claiming" then
      local claimant = state.claimants and state.claimants[state.claimIndex]
      if claimant and claimant.playerId == actor_id and not __mahjong_has_ron_option(claimant) then
        state.autoPassClaimsApplying = actor_id
        local pass_action = { type = "pass" }
        local passed = __mahjong_online_action(state, pass_action, context)
        state.autoPassClaimsApplying = nil
        if passed and passed.accepted and passed.state then
          __mahjong_record_action(passed, pass_action, actor_id)
          __mahjong_clear_private_state(passed.state)
          passed.timerOps = __mahjong_timer_ops(passed.state, context)
        end
        return passed
      end
    end
    local result = accepted(state, {})
    __mahjong_clear_private_state(result.state)
    result.timerOps = __mahjong_timer_ops(result.state, context)
    return result
  end
  if state.phase == "lobby" then
    if not action or action.type ~= "start_match" then
      return rejected("match_not_started")
    end
    local actor = context and context.actor
    if not actor or actor.isOwner ~= true or actor.id ~= state.roomOwnerId then
      return rejected("start_match_owner_only")
    end
    if action.matchType ~= "east" and action.matchType ~= "hanchan" then
      return rejected("invalid_match_type")
    end
    local settings = {
      matchType = action.matchType,
      rules = type(action.rules) == "table" and action.rules or {},
      -- The shuffled seat at index 1 is East. Dealer selection remains
      -- deterministic and independent from wall shuffling.
      initialDealerSeat = 1,
      canonicalMatchSeats = true,
    }
    local seated_players, seated_names = mahjong_shuffle_match_players(
      state.players,
      state.playerNames,
      state.lobbySeed
    )
    local started = new_match(
      seated_players,
      seated_names,
      state.lobbySeed,
      settings,
      state.aiPlayers
    )
    started.roomOwnerId = state.roomOwnerId
    started.aiPresentations = __mahjong_sanitize_ai_presentations(
      action.aiPresentations,
      state.aiPlayers
    )
    for seat, player_id in ipairs(started.players or {}) do
      local presentation = started.aiPresentations[player_id]
      if presentation and presentation.displayName then
        started.playerNames[seat] = presentation.displayName
      end
    end
    started.playerPresentations = state.playerPresentations or {}
    -- Match starts are the first hand of a fresh game.  Match-local
    -- automatic claim settings must not leak into it from the lobby.
    started.autoPassClaims = {}
    local result = accepted(started, { { type = "match_started", player = actor.id } })
    __mahjong_clear_private_state(result.state)
    result.timerOps = __mahjong_timer_ops(result.state, context)
    return result
  end
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
    __mahjong_record_action(result, action.action, player_id)
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
  __mahjong_record_action(result, action, context and context.actor and context.actor.id)
  if action and (action.type == "next_hand" or action.type == "new_match") then
    -- Keep the private setting aligned with the solo client: every newly
    -- dealt hand (and every fresh match) starts with automatic calls disabled.
    result.state.autoPassClaims = {}
    result.state.aiPresentations = state.aiPresentations or {}
  else
    result.state.autoPassClaims = state.autoPassClaims or {}
    result.state.aiPresentations = state.aiPresentations or result.state.aiPresentations or {}
  end
  __mahjong_commit_tenpai_report(result.state)
  __mahjong_clear_private_state(result.state)
  result.timerOps = __mahjong_timer_ops(result.state, context)
  return result
end

local __mahjong_online_view = view
function view(state, events, context)
  if state.phase == "lobby" then
    return {
      state = {
        phase = "lobby",
        players = state.players,
        playerNames = state.playerNames,
        aiPlayers = state.aiPlayers,
        aiPresentations = state.aiPresentations or {},
        playerPresentations = state.playerPresentations or {},
        portraitSeed = state.lobbySeed,
        roomIsOwner = context.viewer.isOwner == true,
        passClaimsEnabled = state.autoPassClaims and state.autoPassClaims[context.viewer.id] == true or false,
      },
      events = {},
    }
  end
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
    projection.state.passClaimsEnabled = state.autoPassClaims
      and state.autoPassClaims[viewer_id] == true
      or false
    projection.state.resultPage = tonumber(state.resultPage) or 0
    projection.state.resultDeadlineAt = state.resultDeadlineAt
    projection.state.resultPageReady = state.resultReadyPlayers
      and state.resultReadyPlayers[context.viewer.id] == true
      or false
    projection.state.resultSummaryVisible = state.matchEnded == true
      and tonumber(state.resultPage) == __mahjong_result_summary_page(state)
    -- Completed hand fragments are already streamed to every client at
    -- hand_ended.  Re-exporting the hand paipu here would deep-copy the full
    -- command/event log inside a single view() call and can exceed the host's
    -- 50k Lua instruction quota on long hands.  The final summary carries only
    -- match metadata; clients assemble the durable paipu from saved fragments.
    projection.state.aiPlayers = state.aiPlayers
    projection.state.aiPresentations = state.aiPresentations or {}
    projection.state.playerPresentations = state.playerPresentations or {}
    projection.state.portraitSeed = state.seed or state.lobbySeed
    -- This is viewer-private state. It lets a reconnecting riichi player keep
    -- the correct furiten badge without exposing any other player's claim
    -- history or concealed-hand information.
    projection.state.selfRiichiFuriten = state.riichiFuriten
      and state.riichiFuriten[viewer_id] == true
      or false
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
    local next_hand_action = { type = "next_hand" }
    local result = __mahjong_online_action(state, next_hand_action, {
      actor = { id = state.players[1] },
    })
    return __mahjong_with_timeout_event(result, state, context, nil, 0, next_hand_action)
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
    local result, action = __mahjong_timeout_playing_action(state, player_id, player_index)
    return __mahjong_with_timeout_event(result, state, context, player_id, player_index, action)
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
    local result, action = __mahjong_timeout_claim_action(state, claimant)
    return __mahjong_with_timeout_event(result, state, context, player_id, player_index, action)
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
    !(
      aiStart < protocolStart &&
      protocolStart < aiClaimStart &&
      aiClaimStart < callbackStart
    )
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
