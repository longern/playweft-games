local RANDOM_MODULUS = 2147483647
local RANDOM_MULTIPLIER = 48271

local function rejected(state, reason)
  state.lastEvent = { kind = "rejected", reason = reason }
  return { state = state, events = { { type = "rejected", reason = reason } } }
end

local function player_index(state, player_id)
  for index, id in ipairs(state.players) do
    if id == player_id then return index end
  end
  return nil
end

local function next_seed(seed)
  return (seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
end

local function role_deck(player_count)
  local deck = { "seer", "witch", "hunter", "white_god" }
  local wolf_count = math.max(2, math.floor(player_count / 3))
  for _ = 1, wolf_count do table.insert(deck, "werewolf") end
  while #deck < player_count do table.insert(deck, "villager") end
  return deck
end

local function shuffled_roles(player_count, seed)
  local deck = role_deck(player_count)
  for index = #deck, 2, -1 do
    seed = next_seed(seed)
    local swap_index = (seed % index) + 1
    deck[index], deck[swap_index] = deck[swap_index], deck[index]
  end
  return deck, seed
end

local function new_game(players, seed, round)
  local deck, next_round_seed = shuffled_roles(#players, seed)
  local roles, status = {}, {}
  for index, player_id in ipairs(players) do
    roles[player_id] = deck[index]
    status[player_id] = "alive"
  end
  return {
    players = players,
    roles = roles,
    status = status,
    votes = {},
    flips = {},
    seed = next_round_seed,
    round = round,
    voteRound = 1,
    lastEvent = { kind = "dealt", round = round },
  }
end

local function alive_players(state)
  local players = {}
  for _, player_id in ipairs(state.players) do
    if state.status[player_id] == "alive" then table.insert(players, player_id) end
  end
  return players
end

local function resolve_vote(state)
  local tally = {}
  local highest = 0
  for _, target in pairs(state.votes) do
    tally[target] = (tally[target] or 0) + 1
    if tally[target] > highest then highest = tally[target] end
  end

  local tied = {}
  for _, player_id in ipairs(alive_players(state)) do
    if tally[player_id] == highest then table.insert(tied, player_id) end
  end

  state.votes = {}
  if #tied ~= 1 then
    state.lastEvent = { kind = "tied", players = tied, voteRound = state.voteRound }
    state.voteRound = state.voteRound + 1
    return { state = state, events = { { type = "vote_tied", players = tied } } }
  end

  local eliminated = tied[1]
  local role = state.roles[eliminated]
  state.status[eliminated] = "eliminated"
  table.insert(state.flips, {
    player = eliminated,
    role = role,
    whiteGod = role == "white_god",
  })
  state.lastEvent = {
    kind = "eliminated",
    player = eliminated,
    role = role,
    whiteGod = role == "white_god",
    voteRound = state.voteRound,
  }
  state.voteRound = state.voteRound + 1
  return {
    state = state,
    events = { { type = "eliminated", player = eliminated, role = role } },
  }
end

function setup(context)
  return new_game(context.players, context.randomSeed, 1)
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected(state, "invalid_action") end
  local actor_index = player_index(state, context.playerId)
  if not actor_index then return rejected(state, "not_a_player") end

  if action.type == "rematch" then
    local next_state = new_game(state.players, state.seed, (state.round or 1) + 1)
    return { state = next_state, events = { { type = "redealt", player = context.playerId } } }
  end

  if action.type ~= "vote" then return rejected(state, "unknown_action") end
  if state.status[context.playerId] ~= "alive" then return rejected(state, "not_alive") end
  if type(action.target) ~= "string" or not player_index(state, action.target) then
    return rejected(state, "invalid_target")
  end
  if state.status[action.target] ~= "alive" then return rejected(state, "target_not_alive") end

  state.votes[context.playerId] = action.target
  local active_players = alive_players(state)
  local votes_cast = 0
  for _, player_id in ipairs(active_players) do
    if state.votes[player_id] then votes_cast = votes_cast + 1 end
  end
  if votes_cast < #active_players then
    state.lastEvent = {
      kind = "vote_cast",
      player = context.playerId,
      votesCast = votes_cast,
      voters = #active_players,
    }
    return { state = state, events = { { type = "vote_cast", player = context.playerId } } }
  end
  return resolve_vote(state)
end

function on_player_left(state, context)
  if not player_index(state, context.playerId) or state.status[context.playerId] ~= "alive" then
    return { state = state, events = {} }
  end
  state.status[context.playerId] = "left"
  state.votes = {}
  state.lastEvent = { kind = "left", player = context.playerId }
  return { state = state, events = { { type = "player_left", player = context.playerId } } }
end

function on_return_to_room(state, context)
  return true
end
