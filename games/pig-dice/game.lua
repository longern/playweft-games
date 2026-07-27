local TARGET_SCORE = 50
local RANDOM_MODULUS = 2147483647
local RANDOM_MULTIPLIER = 48271

local function setup_players(context)
  local players = {}
  for _, player in ipairs(context.players) do table.insert(players, player.id) end
  return players
end

local function player_index(state, player_id)
  for index, id in ipairs(state.players) do
    if id == player_id then return index end
  end
  return nil
end

local function rejected(state, reason)
  return {
    accepted = false,
    error = {
      code = string.upper(reason),
      message = string.gsub(reason, "_", " "),
    },
  }
end

local function next_roll(state)
  state.seed = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
  return (state.seed % 6) + 1
end

local function advance_turn(state)
  state.turnIndex = (state.turnIndex % #state.players) + 1
end

local function new_round(players, seed, round, starter)
  local scores = {}
  for _, player_id in ipairs(players) do scores[player_id] = 0 end
  return {
    players = players,
    scores = scores,
    turnIndex = starter,
    turnTotal = 0,
    lastRoll = 1,
    lastEvent = { kind = "ready", playerIndex = starter, value = 0 },
    winner = "",
    seed = seed,
    round = round,
    starter = starter,
  }
end

function setup(context)
  return new_round(setup_players(context), context.match.randomSeed, 1, 1)
end

function view(state, events, context)
  state.seed = nil
  return { state = state, events = events }
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected(state, "invalid_action") end
  local actor_id = context.actor.id
  local index = player_index(state, actor_id)
  if not index then return rejected(state, "not_a_player") end

  if action.type == "rematch" then
    if state.winner == "" then return rejected(state, "game_not_over") end
    local starter = ((state.starter or 1) % #state.players) + 1
    local next_state = new_round(
      state.players,
      state.seed,
      (state.round or 1) + 1,
      starter
    )
    return {
      accepted = true,
      state = next_state,
      events = { { type = "rematched", player = actor_id } },
    }
  end

  if state.winner ~= "" then return rejected(state, "game_over") end
  if index ~= state.turnIndex then return rejected(state, "not_your_turn") end

  if action.type == "roll" then
    local roll = next_roll(state)
    state.lastRoll = roll
    if roll == 1 then
      state.turnTotal = 0
      state.lastEvent = { kind = "bust", playerIndex = index, value = roll }
      advance_turn(state)
      return {
        accepted = true,
        state = state,
        events = { { type = "bust", player = actor_id, roll = roll } },
      }
    end
    state.turnTotal = state.turnTotal + roll
    state.lastEvent = { kind = "rolled", playerIndex = index, value = roll }
    return {
      accepted = true,
      state = state,
      events = { { type = "rolled", player = actor_id, roll = roll } },
    }
  end

  if action.type == "bank" then
    if state.turnTotal <= 0 then return rejected(state, "nothing_to_bank") end
    local banked = state.turnTotal
    state.scores[actor_id] = state.scores[actor_id] + banked
    state.turnTotal = 0
    if state.scores[actor_id] >= TARGET_SCORE then
      state.winner = actor_id
      state.lastEvent = { kind = "won", playerIndex = index, value = state.scores[actor_id] }
      return {
        accepted = true,
        state = state,
        events = { { type = "won", player = actor_id } },
      }
    end
    state.lastEvent = { kind = "banked", playerIndex = index, value = banked }
    advance_turn(state)
    return {
      accepted = true,
      state = state,
      events = { { type = "banked", player = actor_id, amount = banked } },
    }
  end

  return rejected(state, "unknown_action")
end

function on_player_left(state, context)
  local actor_id = context.actor.id
  local leaving_index = player_index(state, actor_id)
  if not leaving_index or state.winner ~= "" then
    return { state = state, events = {} }
  end
  local winner_index = leaving_index == 1 and 2 or 1
  state.winner = state.players[winner_index]
  state.turnTotal = 0
  state.lastEvent = { kind = "left", playerIndex = leaving_index, value = 0 }
  return { state = state, events = { { type = "player_left", player = actor_id } } }
end

function on_return_to_room(state, context)
  return true
end
