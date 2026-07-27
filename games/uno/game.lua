local COLORS = { "red", "yellow", "green", "blue" }
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

local function hidden_cards(cards)
  local hidden = {}
  if not cards then return hidden end
  for _ = 1, #cards do table.insert(hidden, false) end
  return hidden
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

local function next_random(state, upper_bound)
  state.seed = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
  return (state.seed % upper_bound) + 1
end

local function add_card(deck, id, color, value)
  table.insert(deck, { id = id, color = color, value = value })
end

local function new_deck()
  local deck = {}
  for _, color in ipairs(COLORS) do
    add_card(deck, color .. "-0", color, "0")
    for number = 1, 9 do
      add_card(deck, color .. "-" .. number .. "-a", color, tostring(number))
      add_card(deck, color .. "-" .. number .. "-b", color, tostring(number))
    end
    for _, action in ipairs({ "skip", "reverse", "draw2" }) do
      add_card(deck, color .. "-" .. action .. "-a", color, action)
      add_card(deck, color .. "-" .. action .. "-b", color, action)
    end
  end
  for index = 1, 4 do
    add_card(deck, "wild-" .. index, "wild", "wild")
    add_card(deck, "wild4-" .. index, "wild", "wild4")
  end
  return deck
end

local function shuffle(state, deck)
  for index = #deck, 2, -1 do
    local other = next_random(state, index)
    deck[index], deck[other] = deck[other], deck[index]
  end
end

local function replenish_deck(state)
  if #state.deck > 0 or #state.discard <= 1 then return end
  local top = table.remove(state.discard)
  state.deck = state.discard
  state.discard = { top }
  shuffle(state, state.deck)
end

local function draw_one(state, player_id)
  replenish_deck(state)
  local card = table.remove(state.deck)
  if card then table.insert(state.hands[player_id], card) end
  return card
end

local function next_player(state, index, steps)
  local direction = state.direction or 1
  return ((index - 1 + direction * steps) % #state.players) + 1
end

local function advance_turn(state, steps)
  state.current = next_player(state, state.current, steps or 1)
end

local function find_card(hand, card_id)
  for index, card in ipairs(hand) do
    if card.id == card_id then return index, card end
  end
  return nil, nil
end

local function is_color(value)
  for _, color in ipairs(COLORS) do
    if color == value then return true end
  end
  return false
end

local function has_active_color(hand, active_color, excluding_id)
  for _, card in ipairs(hand) do
    if card.id ~= excluding_id and card.color == active_color then return true end
  end
  return false
end

local function can_play(state, card, hand)
  local top = state.discard[#state.discard]
  if card.color == "wild" then
    if card.value == "wild4" and has_active_color(hand, state.activeColor, card.id) then
      return false
    end
    return true
  end
  return card.color == state.activeColor or card.value == top.value
end

local function new_round(players, seed, round, starter)
  local state = {
    players = players,
    hands = {},
    deck = new_deck(),
    discard = {},
    activeColor = "red",
    current = starter,
    direction = 1,
    winner = "",
    round = round,
    starter = starter,
    seed = seed,
    lastEvent = { kind = "ready", playerIndex = starter, count = 0 },
  }
  for _, player_id in ipairs(players) do state.hands[player_id] = {} end
  shuffle(state, state.deck)
  for _ = 1, 7 do
    for _, player_id in ipairs(players) do draw_one(state, player_id) end
  end

  -- A coloured opening card gives the first turn a clear matching rule.
  while state.deck[#state.deck].color == "wild" do
    table.insert(state.deck, 1, table.remove(state.deck))
  end
  local opening = table.remove(state.deck)
  table.insert(state.discard, opening)
  state.activeColor = opening.color
  return state
end

function setup(context)
  return new_round(setup_players(context), context.match.randomSeed, 1, 1)
end

function view(state, events, context)
  state.seed = nil
  state.deck = nil
  for _, player_id in ipairs(state.players) do
    if player_id ~= context.viewer.id then
      state.hands[player_id] = hidden_cards(state.hands[player_id])
    end
  end
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
    local next_state = new_round(state.players, state.seed, (state.round or 1) + 1, starter)
    return {
      accepted = true,
      state = next_state,
      events = { { type = "rematched", player = actor_id } },
    }
  end

  if state.winner ~= "" then return rejected(state, "game_over") end
  if index ~= state.current then return rejected(state, "not_your_turn") end

  if action.type == "draw" then
    local card = draw_one(state, actor_id)
    if not card then return rejected(state, "deck_empty") end
    state.lastEvent = { kind = "draw", playerIndex = index, count = 1 }
    advance_turn(state, 1)
    return {
      accepted = true,
      state = state,
      events = { { type = "drew", player = actor_id } },
    }
  end

  if action.type ~= "play" or type(action.cardId) ~= "string" then
    return rejected(state, "invalid_action")
  end

  local hand = state.hands[actor_id]
  local card_index, card = find_card(hand, action.cardId)
  if not card_index then return rejected(state, "card_not_in_hand") end
  if not can_play(state, card, hand) then return rejected(state, "card_not_playable") end
  if card.color == "wild" and not is_color(action.color) then
    return rejected(state, "choose_color")
  end

  table.remove(hand, card_index)
  table.insert(state.discard, card)
  state.activeColor = card.color == "wild" and action.color or card.color

  if #hand == 0 then
    state.winner = actor_id
    state.lastEvent = { kind = "won", playerIndex = index, card = card, count = 0 }
    return {
      accepted = true,
      state = state,
      events = { { type = "won", player = actor_id } },
    }
  end

  local draw_count = card.value == "draw2" and 2 or (card.value == "wild4" and 4 or 0)
  if draw_count > 0 then
    local target_index = next_player(state, index, 1)
    local target_id = state.players[target_index]
    local drawn = 0
    for _ = 1, draw_count do
      if draw_one(state, target_id) then drawn = drawn + 1 end
    end
    state.lastEvent = {
      kind = "penalty",
      playerIndex = index,
      targetIndex = target_index,
      card = card,
      count = drawn,
    }
    advance_turn(state, 2)
    return {
      accepted = true,
      state = state,
      events = { { type = "penalty", player = actor_id, count = drawn } },
    }
  end

  if card.value == "reverse" then
    state.direction = -state.direction
    local steps = #state.players == 2 and 2 or 1
    state.lastEvent = { kind = "reverse", playerIndex = index, card = card, count = 0 }
    advance_turn(state, steps)
    return {
      accepted = true,
      state = state,
      events = { { type = "reversed", player = actor_id } },
    }
  end

  local skipped = card.value == "skip"
  state.lastEvent = { kind = skipped and "skip" or "play", playerIndex = index, card = card, count = 0 }
  advance_turn(state, skipped and 2 or 1)
  return {
    accepted = true,
    state = state,
    events = { { type = "played", player = actor_id, card = card.value } },
  }
end

function on_player_left(state, context)
  local actor_id = context.actor.id
  local leaving_index = player_index(state, actor_id)
  if not leaving_index or state.winner ~= "" then
    return { state = state, events = {} }
  end
  local winner_index = next_player(state, leaving_index, 1)
  state.winner = state.players[winner_index]
  state.lastEvent = { kind = "left", playerIndex = leaving_index, count = 0 }
  return { state = state, events = { { type = "player_left", player = actor_id } } }
end

function on_return_to_room(state, context)
  return true
end
