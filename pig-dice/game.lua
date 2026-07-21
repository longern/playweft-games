local TARGET_SCORE = 50
local RANDOM_MODULUS = 2147483647
local RANDOM_MULTIPLIER = 48271

local function player_index(state, player_id)
  for index, id in ipairs(state.players) do
    if id == player_id then return index end
  end
  return nil
end

local function rejected(state, reason)
  return { state = state, events = { { type = "rejected", reason = reason } } }
end

local function next_roll(state)
  state.seed = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
  return (state.seed % 6) + 1
end

local function advance_turn(state)
  state.turnIndex = (state.turnIndex % #state.players) + 1
end

function setup(context)
  local scores = {}
  for _, player_id in ipairs(context.players) do scores[player_id] = 0 end
  return {
    players = context.players,
    scores = scores,
    turnIndex = 1,
    turnTotal = 0,
    lastRoll = 1,
    lastEvent = { kind = "ready", playerIndex = 1, value = 0 },
    winner = "",
    seed = context.randomSeed,
  }
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected(state, "invalid_action") end
  local index = player_index(state, context.playerId)
  if not index then return rejected(state, "not_a_player") end
  if state.winner ~= "" then return rejected(state, "game_over") end
  if index ~= state.turnIndex then return rejected(state, "not_your_turn") end

  if action.type == "roll" then
    local roll = next_roll(state)
    state.lastRoll = roll
    if roll == 1 then
      state.turnTotal = 0
      state.lastEvent = { kind = "bust", playerIndex = index, value = roll }
      advance_turn(state)
      return { state = state, events = { { type = "bust", player = context.playerId, roll = roll } } }
    end
    state.turnTotal = state.turnTotal + roll
    state.lastEvent = { kind = "rolled", playerIndex = index, value = roll }
    return { state = state, events = { { type = "rolled", player = context.playerId, roll = roll } } }
  end

  if action.type == "bank" then
    if state.turnTotal <= 0 then return rejected(state, "nothing_to_bank") end
    local banked = state.turnTotal
    state.scores[context.playerId] = state.scores[context.playerId] + banked
    state.turnTotal = 0
    if state.scores[context.playerId] >= TARGET_SCORE then
      state.winner = context.playerId
      state.lastEvent = { kind = "won", playerIndex = index, value = state.scores[context.playerId] }
      return { state = state, events = { { type = "won", player = context.playerId } } }
    end
    state.lastEvent = { kind = "banked", playerIndex = index, value = banked }
    advance_turn(state)
    return { state = state, events = { { type = "banked", player = context.playerId, amount = banked } } }
  end

  return rejected(state, "unknown_action")
end

function on_player_left(state, context)
  local leaving_index = player_index(state, context.playerId)
  if not leaving_index or state.winner ~= "" then
    return { state = state, events = {} }
  end
  local winner_index = leaving_index == 1 and 2 or 1
  state.winner = state.players[winner_index]
  state.turnTotal = 0
  state.lastEvent = { kind = "left", playerIndex = leaving_index, value = 0 }
  return { state = state, events = { { type = "player_left", player = context.playerId } } }
end

function on_return_to_room(state, context)
  return true
end
