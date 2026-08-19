local STARTING_STACK = 100
local SMALL_BLIND = 1
local BIG_BLIND = 2
local RAISE_SIZE = 2
local MAX_RAISES = 3
local RANDOM_MODULUS = 2147483647
local RANDOM_MULTIPLIER = 48271

local function normalize_random_seed(value)
  local seed = 0
  local text = tostring(value or "")
  for index = 1, #text do
    local digit = tonumber(string.sub(text, index, index), 16)
    if digit then seed = (seed * 16 + digit) % RANDOM_MODULUS end
  end
  return seed == 0 and 1 or seed
end

local function setup_players(context)
  local players = {}
  for _, player in ipairs(context.players) do table.insert(players, player.id) end
  return players
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

local function next_random(seed)
  return (seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
end

local function shuffled_deck(seed)
  local deck = {}
  for card = 0, 51 do table.insert(deck, card) end
  for index = #deck, 2, -1 do
    seed = next_random(seed)
    local swap_index = (seed % index) + 1
    deck[index], deck[swap_index] = deck[swap_index], deck[index]
  end
  return deck, seed
end

local function rank(card)
  return (card % 13) + 2
end

local function suit(card)
  return math.floor(card / 13) + 1
end

local function compare_scores(left, right)
  for index = 1, math.max(#left, #right) do
    local a, b = left[index] or 0, right[index] or 0
    if a > b then return 1 end
    if a < b then return -1 end
  end
  return 0
end

local function five_card_score(cards)
  local counts = {}
  local flush = true
  local first_suit = suit(cards[1])
  for _, card in ipairs(cards) do
    local value = rank(card)
    counts[value] = (counts[value] or 0) + 1
    if suit(card) ~= first_suit then flush = false end
  end

  local straight_high = 0
  local unique = 0
  for value = 2, 14 do
    if counts[value] then unique = unique + 1 end
  end
  if unique == 5 then
    if counts[14] and counts[5] and counts[4] and counts[3] and counts[2] then
      straight_high = 5
    else
      for high = 14, 6, -1 do
        if counts[high] and counts[high - 1] and counts[high - 2]
          and counts[high - 3] and counts[high - 4] then
          straight_high = high
          break
        end
      end
    end
  end
  if flush and straight_high > 0 then return { 8, straight_high } end

  local quads, trips, pairs, singles = 0, {}, {}, {}
  for value = 14, 2, -1 do
    local count = counts[value] or 0
    if count == 4 then quads = value
    elseif count == 3 then table.insert(trips, value)
    elseif count == 2 then table.insert(pairs, value)
    elseif count == 1 then table.insert(singles, value) end
  end
  if quads > 0 then return { 7, quads, singles[1] } end
  if #trips > 0 and (#pairs > 0 or #trips > 1) then
    return { 6, trips[1], pairs[1] or trips[2] }
  end
  if flush then
    local result = { 5 }
    for value = 14, 2, -1 do if counts[value] then table.insert(result, value) end end
    return result
  end
  if straight_high > 0 then return { 4, straight_high } end
  if #trips > 0 then return { 3, trips[1], singles[1], singles[2] } end
  if #pairs >= 2 then return { 2, pairs[1], pairs[2], singles[1] } end
  if #pairs == 1 then return { 1, pairs[1], singles[1], singles[2], singles[3] } end
  local result = { 0 }
  for value = 14, 2, -1 do if counts[value] then table.insert(result, value) end end
  return result
end

local function best_score(cards)
  local best = nil
  for a = 1, #cards - 4 do
    for b = a + 1, #cards - 3 do
      for c = b + 1, #cards - 2 do
        for d = c + 1, #cards - 1 do
          for e = d + 1, #cards do
            local score = five_card_score({ cards[a], cards[b], cards[c], cards[d], cards[e] })
            if not best or compare_scores(score, best) > 0 then best = score end
          end
        end
      end
    end
  end
  return best
end

local HAND_NAMES = {
  [0] = "high_card",
  [1] = "one_pair",
  [2] = "two_pair",
  [3] = "three_of_a_kind",
  [4] = "straight",
  [5] = "flush",
  [6] = "full_house",
  [7] = "four_of_a_kind",
  [8] = "straight_flush",
}

local function active_seats(state)
  local seats = {}
  for index, id in ipairs(state.players) do
    if state.inHand[id] and not state.folded[id] then table.insert(seats, index) end
  end
  return seats
end

local function betting_seats(state)
  local seats = {}
  for index, id in ipairs(state.players) do
    if state.inHand[id] and not state.folded[id] and not state.allIn[id] then
      table.insert(seats, index)
    end
  end
  return seats
end

local function next_seat(state, from_index, predicate)
  for offset = 1, #state.players do
    local index = ((from_index - 1 + offset) % #state.players) + 1
    if predicate(index, state.players[index]) then return index end
  end
  return nil
end

local function next_in_hand(state, from_index)
  return next_seat(state, from_index, function(_, id) return state.inHand[id] end)
end

local function next_betting_seat(state, from_index)
  return next_seat(state, from_index, function(_, id)
    return state.inHand[id] and not state.folded[id] and not state.allIn[id]
  end)
end

local function sum_contributions(state)
  local total = 0
  for _, id in ipairs(state.players) do total = total + (state.contributions[id] or 0) end
  return total
end

local function contribute(state, index, amount)
  local id = state.players[index]
  state.chips[id] = state.chips[id] - amount
  state.contributions[id] = state.contributions[id] + amount
  state.streetBets[id] = state.streetBets[id] + amount
  state.pot = sum_contributions(state)
  if state.chips[id] == 0 then state.allIn[id] = true end
end

local function reset_acted_after_raise(state, actor_id)
  for _, id in ipairs(state.players) do
    if state.inHand[id] and not state.folded[id] and not state.allIn[id] then
      state.acted[id] = id == actor_id
    end
  end
end

local function betting_done(state)
  local seats = betting_seats(state)
  if #seats <= 1 then return true end
  for _, index in ipairs(seats) do
    local id = state.players[index]
    if not state.acted[id] or state.streetBets[id] ~= state.currentBet then return false end
  end
  return true
end

local function complete_hand(state, event)
  state.ended = true
  state.current = 0
  state.lastEvent = event
  local remaining = {}
  for _, id in ipairs(state.players) do
    if state.chips[id] > 0 then table.insert(remaining, id) end
  end
  if #remaining == 1 then state.matchWinner = remaining[1] end
end

local function award_fold(state)
  local winner_index = active_seats(state)[1]
  local winner = state.players[winner_index]
  local amount = state.pot
  state.chips[winner] = state.chips[winner] + amount
  state.payouts[winner] = amount
  state.winners = { winner }
  state.lastPot = amount
  state.pot = 0
  complete_hand(state, { kind = "fold", playerIndex = winner_index, value = amount })
end

local function append_once(items, item)
  for _, existing in ipairs(items) do if existing == item then return end end
  table.insert(items, item)
end

local function finish_showdown(state)
  state.revealed = 5
  local total_pot = state.pot
  local scores, hand_names = {}, {}
  for _, index in ipairs(active_seats(state)) do
    local id = state.players[index]
    local cards = { state.hands[id][1], state.hands[id][2] }
    for _, card in ipairs(state.board) do table.insert(cards, card) end
    scores[id] = best_score(cards)
    hand_names[id] = HAND_NAMES[scores[id][1]]
  end

  local levels = {}
  for _, id in ipairs(state.players) do
    local amount = state.contributions[id] or 0
    if amount > 0 then append_once(levels, amount) end
  end
  table.sort(levels)
  state.payouts = {}
  state.winners = {}
  state.showdownRanks = hand_names
  local previous = 0
  for _, level in ipairs(levels) do
    local contributors, contenders = 0, {}
    for _, id in ipairs(state.players) do
      if (state.contributions[id] or 0) >= level then
        contributors = contributors + 1
        if state.inHand[id] and not state.folded[id] then table.insert(contenders, id) end
      end
    end
    local amount = (level - previous) * contributors
    local best, pot_winners = nil, {}
    for _, id in ipairs(contenders) do
      if not best or compare_scores(scores[id], best) > 0 then
        best, pot_winners = scores[id], { id }
      elseif compare_scores(scores[id], best) == 0 then
        table.insert(pot_winners, id)
      end
    end
    if #pot_winners > 0 then
      local share = math.floor(amount / #pot_winners)
      local remainder = amount % #pot_winners
      for _, id in ipairs(pot_winners) do
        local payout = share
        if remainder > 0 then
          payout = payout + 1
          remainder = remainder - 1
        end
        state.chips[id] = state.chips[id] + payout
        state.payouts[id] = (state.payouts[id] or 0) + payout
        append_once(state.winners, id)
      end
    end
    previous = level
  end
  state.lastPot = total_pot
  state.pot = 0
  complete_hand(state, { kind = "showdown", playerIndex = 0, value = total_pot })
end

local advance_street
local progress

advance_street = function(state)
  if state.street >= 3 then
    finish_showdown(state)
    return
  end
  state.street = state.street + 1
  state.revealed = ({ 3, 4, 5 })[state.street]
  state.streetBets = {}
  state.acted = {}
  for _, id in ipairs(state.players) do
    state.streetBets[id] = 0
    state.acted[id] = false
  end
  state.currentBet = 0
  state.raises = 0
  progress(state, state.dealer)
end

progress = function(state, from_index)
  if state.ended then return end
  if #active_seats(state) == 1 then
    award_fold(state)
    return
  end
  local bettors = betting_seats(state)
  if #bettors == 0 then
    advance_street(state)
    return
  end
  if #bettors == 1 then
    local only_index = bettors[1]
    local only_id = state.players[only_index]
    if state.streetBets[only_id] < state.currentBet then
      state.current = only_index
      return
    end
    advance_street(state)
    return
  end
  if betting_done(state) then
    advance_street(state)
    return
  end
  state.current = next_betting_seat(state, from_index)
end

local function post_blind(state, index, amount)
  local id = state.players[index]
  contribute(state, index, math.min(amount, state.chips[id]))
end

local function make_hand(players, chips, seed, dealer, round)
  local deck
  deck, seed = shuffled_deck(seed)
  local state = {
    players = players,
    chips = chips,
    seed = seed,
    dealer = dealer,
    smallBlind = 0,
    bigBlind = 0,
    current = 0,
    round = round,
    street = 0,
    revealed = 0,
    board = { deck[1], deck[2], deck[3], deck[4], deck[5] },
    hands = {},
    inHand = {},
    folded = {},
    allIn = {},
    contributions = {},
    streetBets = {},
    acted = {},
    currentBet = 0,
    raises = 0,
    pot = 0,
    lastPot = 0,
    ended = false,
    matchWinner = "",
    winners = {},
    payouts = {},
    showdownRanks = {},
    lastEvent = { kind = "dealt", playerIndex = dealer, value = 0 },
  }
  local deal_index = 6
  local seated = {}
  for index, id in ipairs(players) do
    local playing = chips[id] > 0
    state.inHand[id] = playing
    state.folded[id] = false
    state.allIn[id] = false
    state.contributions[id] = 0
    state.streetBets[id] = 0
    state.acted[id] = false
    if playing then table.insert(seated, index) end
  end
  for _ = 1, 2 do
    for _, index in ipairs(seated) do
      local id = players[index]
      state.hands[id] = state.hands[id] or {}
      table.insert(state.hands[id], deck[deal_index])
      deal_index = deal_index + 1
    end
  end
  if #seated == 2 then
    state.smallBlind = dealer
  else
    state.smallBlind = next_in_hand(state, dealer)
  end
  state.bigBlind = next_in_hand(state, state.smallBlind)
  post_blind(state, state.smallBlind, SMALL_BLIND)
  post_blind(state, state.bigBlind, BIG_BLIND)
  state.currentBet = state.streetBets[players[state.bigBlind]]
  progress(state, state.bigBlind)
  return state
end

local function next_dealer(state)
  return next_seat(state, state.dealer, function(_, id) return state.chips[id] > 0 end)
end

local function new_match(players, seed, dealer, round)
  local chips = {}
  for _, id in ipairs(players) do chips[id] = STARTING_STACK end
  return make_hand(players, chips, seed, dealer, round)
end

function setup(context)
  return new_match(setup_players(context), normalize_random_seed(context.match.randomSeed), 1, 1)
end

function view(state, events, context)
  state.seed = nil
  local revealed = math.max(0, math.min(#state.board, state.revealed or 0))
  for index = revealed + 1, #state.board do state.board[index] = false end

  local showdown = state.ended
    and state.lastEvent
    and state.lastEvent.kind == "showdown"
  for _, player_id in ipairs(state.players) do
    local public_hand = showdown and not state.folded[player_id]
    if player_id ~= context.viewer.id and not public_hand then
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

  if action.type == "next_hand" then
    if not state.ended or state.matchWinner ~= "" then return rejected(state, "hand_not_ready") end
    return {
      accepted = true,
      state = make_hand(state.players, state.chips, state.seed, next_dealer(state), state.round + 1),
      events = { { type = "next_hand", player = actor_id } },
    }
  end
  if action.type == "rematch" then
    if state.matchWinner == "" then return rejected(state, "match_not_over") end
    local dealer = ((state.dealer) % #state.players) + 1
    return {
      accepted = true,
      state = new_match(state.players, state.seed, dealer, state.round + 1),
      events = { { type = "rematched", player = actor_id } },
    }
  end
  if state.ended then return rejected(state, "hand_over") end
  if index ~= state.current then return rejected(state, "not_your_turn") end
  local id = actor_id
  local deficit = state.currentBet - state.streetBets[id]

  if action.type == "fold" then
    state.folded[id] = true
    state.lastEvent = { kind = "folded", playerIndex = index, value = 0 }
  elseif action.type == "check" then
    if deficit ~= 0 then return rejected(state, "must_call_or_fold") end
    state.acted[id] = true
    state.lastEvent = { kind = "checked", playerIndex = index, value = 0 }
  elseif action.type == "call" then
    if deficit <= 0 then return rejected(state, "nothing_to_call") end
    if state.chips[id] < deficit then return rejected(state, "insufficient_chips") end
    contribute(state, index, deficit)
    state.acted[id] = true
    state.lastEvent = { kind = "called", playerIndex = index, value = deficit }
  elseif action.type == "raise" then
    if state.raises >= MAX_RAISES then return rejected(state, "raise_limit") end
    local amount = deficit + RAISE_SIZE
    if state.chips[id] < amount then return rejected(state, "insufficient_chips") end
    contribute(state, index, amount)
    state.currentBet = state.streetBets[id]
    state.raises = state.raises + 1
    reset_acted_after_raise(state, id)
    state.lastEvent = { kind = "raised", playerIndex = index, value = state.currentBet }
  elseif action.type == "all_in" then
    if state.chips[id] <= 0 then return rejected(state, "already_all_in") end
    local amount = state.chips[id]
    contribute(state, index, amount)
    if state.streetBets[id] > state.currentBet then
      state.currentBet = state.streetBets[id]
      state.raises = state.raises + 1
      reset_acted_after_raise(state, id)
    else
      state.acted[id] = true
    end
    state.lastEvent = { kind = "all_in", playerIndex = index, value = state.streetBets[id] }
  else
    return rejected(state, "unknown_action")
  end

  progress(state, index)
  return {
    accepted = true,
    state = state,
    events = { { type = state.lastEvent.kind, player = actor_id } },
  }
end

function on_player_left(state, context)
  local actor_id = context.actor.id
  local index = player_index(state, actor_id)
  if not index or state.matchWinner ~= "" then return { state = state, events = {} } end
  local id = actor_id
  state.chips[id] = 0
  if not state.ended and state.inHand[id] and not state.folded[id] then
    state.folded[id] = true
    state.lastEvent = { kind = "left", playerIndex = index, value = 0 }
    progress(state, index)
  elseif state.ended then
    complete_hand(state, { kind = "left", playerIndex = index, value = 0 })
  end
  return { state = state, events = { { type = "player_left", player = id } } }
end

function on_return_to_room(state, context)
  return state.ended
end
