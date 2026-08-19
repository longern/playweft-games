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
  local players, player_names = {}, {}
  for _, player in ipairs(context.players) do
    table.insert(players, player.id)
    table.insert(
      player_names,
      type(player.name) == "string" and player.name or ""
    )
  end
  return players, player_names
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

local function next_random(state)
  state.seed = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
  return state.seed
end

local function card_rank(card)
  if card == 53 then return 16 end
  if card == 54 then return 17 end
  return math.floor((card - 1) / 4) + 3
end

local function sort_cards(cards)
  table.sort(cards, function(left, right)
    local left_rank, right_rank = card_rank(left), card_rank(right)
    if left_rank == right_rank then return left < right end
    return left_rank < right_rank
  end)
  return cards
end

local function shuffled_deck(state)
  local deck = {}
  for card = 1, 54 do deck[card] = card end
  for index = 54, 2, -1 do
    local other = (next_random(state) % index) + 1
    deck[index], deck[other] = deck[other], deck[index]
  end
  return deck
end

local function advance_turn(state)
  state.turnIndex = (state.turnIndex % #state.players) + 1
end

local function deal(state)
  local deck = shuffled_deck(state)
  state.hands = {}
  for player_index_value, player_id in ipairs(state.players) do
    local hand = {}
    local start = (player_index_value - 1) * 17 + 1
    for offset = 0, 16 do hand[#hand + 1] = deck[start + offset] end
    state.hands[player_id] = sort_cards(hand)
  end
  state.bottomCards = { deck[52], deck[53], deck[54] }
end

local function new_round(players, player_names, seed, round, starter)
  seed = math.floor(math.abs(tonumber(seed) or 1)) % RANDOM_MODULUS
  if seed == 0 then seed = 1 end
  local state = {
    players = players,
    playerNames = player_names,
    seed = seed,
    round = round,
    starter = starter,
    phase = "bidding",
    turnIndex = starter,
    bidCount = 0,
    highestBid = 0,
    lastBidIndex = 0,
    bids = {},
    landlord = "",
    landlordIndex = 0,
    multiplier = 1,
    passCount = 0,
    lastPlay = nil,
    winner = "",
    winnerIndex = 0,
    winnerTeam = "",
    lastEvent = { kind = "dealt", playerIndex = starter, count = 0 },
  }
  deal(state)
  return state
end

local function start_playing(state)
  state.landlordIndex = state.lastBidIndex
  state.landlord = state.players[state.landlordIndex]
  local hand = state.hands[state.landlord]
  for _, card in ipairs(state.bottomCards) do hand[#hand + 1] = card end
  sort_cards(hand)
  state.phase = "playing"
  state.turnIndex = state.landlordIndex
  state.multiplier = math.max(state.highestBid, 1)
  state.lastPlay = nil
  state.passCount = 0
  state.lastEvent = {
    kind = "landlord",
    playerIndex = state.landlordIndex,
    count = state.highestBid,
  }
end

local function redeal(state)
  state.starter = (state.starter % #state.players) + 1
  state.phase = "bidding"
  state.turnIndex = state.starter
  state.bidCount = 0
  state.highestBid = 0
  state.lastBidIndex = 0
  state.bids = {}
  state.landlord = ""
  state.landlordIndex = 0
  state.multiplier = 1
  state.passCount = 0
  state.lastPlay = nil
  state.lastEvent = { kind = "redealt", playerIndex = state.starter, count = 0 }
  deal(state)
end

local function ranks_in_sequence(ranks)
  if #ranks == 0 or ranks[#ranks] > 14 then return false end
  for index = 2, #ranks do
    if ranks[index] ~= ranks[index - 1] + 1 then return false end
  end
  return true
end

local function all_groups_are(counts, expected)
  local ranks = {}
  for rank = 3, 17 do
    if counts[rank] > 0 then
      if counts[rank] ~= expected then return nil end
      ranks[#ranks + 1] = rank
    end
  end
  return ranks
end

local function classify(cards)
  local count = #cards
  local counts = {}
  for rank = 3, 17 do counts[rank] = 0 end
  for _, card in ipairs(cards) do counts[card_rank(card)] = counts[card_rank(card)] + 1 end

  if count == 2 and counts[16] == 1 and counts[17] == 1 then
    return { type = "rocket", rank = 17 }
  end

  local four_rank, triple_rank = nil, nil
  for rank = 3, 17 do
    if counts[rank] == 4 then four_rank = rank end
    if counts[rank] == 3 then triple_rank = rank end
  end
  if count == 4 and four_rank then return { type = "bomb", rank = four_rank } end
  if count == 1 then return { type = "single", rank = card_rank(cards[1]) } end
  if count == 2 then
    local pairs = all_groups_are(counts, 2)
    if pairs and #pairs == 1 then return { type = "pair", rank = pairs[1] } end
  end
  if count == 3 and triple_rank then return { type = "triple", rank = triple_rank } end
  if count == 4 and triple_rank then return { type = "triple_single", rank = triple_rank } end
  if count == 5 and triple_rank then
    for rank = 3, 17 do
      if rank ~= triple_rank and counts[rank] == 2 then
        return { type = "triple_pair", rank = triple_rank }
      end
    end
  end

  if count == 6 and four_rank then
    return { type = "four_two_single", rank = four_rank }
  end
  if count == 8 and four_rank then
    local pair_count = 0
    for rank = 3, 17 do
      if rank ~= four_rank and counts[rank] > 0 then
        if counts[rank] ~= 2 then return nil end
        pair_count = pair_count + 1
      end
    end
    if pair_count == 2 then return { type = "four_two_pair", rank = four_rank } end
  end

  local single_ranks = all_groups_are(counts, 1)
  if count >= 5 and single_ranks and ranks_in_sequence(single_ranks) then
    return { type = "straight", rank = single_ranks[#single_ranks], size = count }
  end
  local pair_ranks = all_groups_are(counts, 2)
  if count >= 6 and pair_ranks and #pair_ranks >= 3 and ranks_in_sequence(pair_ranks) then
    return { type = "pair_straight", rank = pair_ranks[#pair_ranks], size = count }
  end

  local triple_ranks = {}
  for rank = 3, 17 do
    if counts[rank] == 3 then
      if rank > 14 then return nil end
      triple_ranks[#triple_ranks + 1] = rank
    end
  end
  local triple_count = #triple_ranks
  if triple_count >= 2 and ranks_in_sequence(triple_ranks) then
    local triple_cards = triple_count * 3
    if count == triple_cards then
      return { type = "airplane", rank = triple_ranks[#triple_ranks], size = count }
    end
    if count == triple_cards + triple_count then
      return { type = "airplane_single", rank = triple_ranks[#triple_ranks], size = count }
    end
    if count == triple_cards + triple_count * 2 then
      local pair_wings = true
      for rank = 3, 17 do
        if counts[rank] > 0 and counts[rank] ~= 3 and counts[rank] ~= 2 then
          pair_wings = false
        end
      end
      if pair_wings then
        return { type = "airplane_pair", rank = triple_ranks[#triple_ranks], size = count }
      end
    end
  end
  return nil
end

local function beats(candidate, previous)
  if not previous then return true end
  if candidate.type == "rocket" then return previous.type ~= "rocket" end
  if previous.type == "rocket" then return false end
  if candidate.type == "bomb" then
    if previous.type ~= "bomb" then return true end
    return candidate.rank > previous.rank
  end
  if previous.type == "bomb" or candidate.type ~= previous.type then return false end
  if candidate.size ~= previous.size then return false end
  return candidate.rank > previous.rank
end

local function selected_cards(state, player_id, cards)
  if type(cards) ~= "table" or #cards == 0 then return nil end
  local owned = {}
  for _, card in ipairs(state.hands[player_id]) do owned[card] = true end
  local seen, result = {}, {}
  for _, card in ipairs(cards) do
    if type(card) ~= "number" or card % 1 ~= 0 or card < 1 or card > 54
      or seen[card] or not owned[card] then
      return nil
    end
    seen[card] = true
    result[#result + 1] = card
  end
  return sort_cards(result)
end

local function remove_cards(hand, cards)
  local selected = {}
  for _, card in ipairs(cards) do selected[card] = true end
  local remaining = {}
  for _, card in ipairs(hand) do
    if not selected[card] then remaining[#remaining + 1] = card end
  end
  return remaining
end

function setup(context)
  local players, player_names = setup_players(context)
  return new_round(players, player_names, normalize_random_seed(context.match.randomSeed), 1, 1)
end

function view(state, events, context)
  state.seed = nil
  for _, player_id in ipairs(state.players) do
    if player_id ~= context.viewer.id then
      state.hands[player_id] = hidden_cards(state.hands[player_id])
    end
  end
  if state.phase == "bidding" then
    state.bottomCards = hidden_cards(state.bottomCards)
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
    local next_state = new_round(
      state.players,
      state.playerNames or {},
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

  if state.phase == "bidding" then
    if action.type ~= "bid" then return rejected(state, "bid_required") end
    local score = action.score
    if type(score) ~= "number" or score % 1 ~= 0 or score < 0 or score > 3 then
      return rejected(state, "invalid_bid")
    end
    if score > 0 and score <= state.highestBid then return rejected(state, "bid_too_low") end

    state.bids[actor_id] = score
    state.bidCount = state.bidCount + 1
    if score > state.highestBid then
      state.highestBid = score
      state.lastBidIndex = index
    end
    if score == 3 then
      start_playing(state)
      return {
        accepted = true,
        state = state,
        events = { { type = "landlord", player = actor_id } },
      }
    end
    if state.bidCount == #state.players then
      if state.highestBid == 0 then
        redeal(state)
        return { accepted = true, state = state, events = { { type = "redealt" } } }
      end
      start_playing(state)
      return {
        accepted = true,
        state = state,
        events = { { type = "landlord", player = state.landlord } },
      }
    end
    advance_turn(state)
    state.lastEvent = { kind = score == 0 and "pass_bid" or "bid", playerIndex = index, count = score }
    return {
      accepted = true,
      state = state,
      events = { { type = "bid", player = actor_id, score = score } },
    }
  end

  if state.phase ~= "playing" then return rejected(state, "invalid_phase") end
  if action.type == "pass" then
    if not state.lastPlay or state.lastPlay.playerId == actor_id then
      return rejected(state, "cannot_pass")
    end
    state.passCount = state.passCount + 1
    if state.passCount >= #state.players - 1 then
      local leader = state.lastPlay.playerIndex
      state.turnIndex = leader
      state.lastPlay = nil
      state.passCount = 0
      state.lastEvent = { kind = "new_trick", playerIndex = leader, count = 0 }
      return {
        accepted = true,
        state = state,
        events = { { type = "new_trick", player = state.players[leader] } },
      }
    end
    state.lastEvent = { kind = "pass", playerIndex = index, count = 0 }
    advance_turn(state)
    return {
      accepted = true,
      state = state,
      events = { { type = "pass", player = actor_id } },
    }
  end

  if action.type ~= "play" then return rejected(state, "invalid_action") end
  local cards = selected_cards(state, actor_id, action.cards)
  if not cards then return rejected(state, "invalid_cards") end
  local combo = classify(cards)
  if not combo then return rejected(state, "invalid_combo") end
  if not beats(combo, state.lastPlay) then return rejected(state, "does_not_beat") end

  state.hands[actor_id] = remove_cards(state.hands[actor_id], cards)
  state.lastPlay = {
    playerId = actor_id,
    playerIndex = index,
    cards = cards,
    type = combo.type,
    rank = combo.rank,
    size = combo.size or #cards,
  }
  state.passCount = 0
  if combo.type == "bomb" or combo.type == "rocket" then state.multiplier = state.multiplier * 2 end
  if #state.hands[actor_id] == 0 then
    state.winner = actor_id
    state.winnerIndex = index
    state.winnerTeam = actor_id == state.landlord and "landlord" or "farmers"
    state.lastEvent = { kind = "won", playerIndex = index, count = state.multiplier }
    return {
      accepted = true,
      state = state,
      events = { { type = "won", player = actor_id } },
    }
  end
  state.lastEvent = { kind = "play", playerIndex = index, count = #cards, combo = combo.type }
  advance_turn(state)
  return {
    accepted = true,
    state = state,
    events = { { type = "played", player = actor_id, cards = #cards } },
  }
end

function on_player_left(state, context)
  local actor_id = context.actor.id
  local leaving_index = player_index(state, actor_id)
  if not leaving_index or state.winner ~= "" then
    return { state = state, events = {} }
  end
  if state.landlord ~= "" and actor_id ~= state.landlord then
    state.winner = state.landlord
    state.winnerIndex = state.landlordIndex
    state.winnerTeam = "landlord"
  else
    for index, player_id in ipairs(state.players) do
      if player_id ~= actor_id then
        state.winner = player_id
        state.winnerIndex = index
        break
      end
    end
    state.winnerTeam = "farmers"
  end
  state.lastEvent = { kind = "left", playerIndex = leaving_index, count = 0 }
  return { state = state, events = { { type = "player_left", player = actor_id } } }
end

function on_return_to_room(state, context)
  return true
end
