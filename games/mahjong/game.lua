local RANDOM_MODULUS = 2147483647
local RANDOM_MULTIPLIER = 48271
local PLAYER_COUNT = 4
local RED_FIVES = { [17] = true, [53] = true, [89] = true }
local finish_exhaustive_draw
local finish_abortive_draw
local cancel_ippatsu

local function rule_settings(settings)
  local supplied = settings and settings.rules or {}
  local function enabled(name, default)
    if supplied[name] == nil then return default end
    return supplied[name] == true
  end
  return {
    multipleRon = enabled("multipleRon", true),
    tripleRonAbort = enabled("tripleRonAbort", false),
    abortiveDraws = enabled("abortiveDraws", true),
    nagashiMangan = enabled("nagashiMangan", true),
    pao = enabled("pao", true),
    bankruptcy = enabled("bankruptcy", true),
    extensions = enabled("extensions", true),
    agariYame = enabled("agariYame", true),
  }
end

local function copy_array(source)
  local result = {}
  for _, value in ipairs(source or {}) do result[#result + 1] = value end
  return result
end

local function setup_players(context)
  local players, names = {}, {}
  for _, player in ipairs(context.players or {}) do
    players[#players + 1] = player.id
    names[#names + 1] = type(player.name) == "string" and player.name or ""
  end
  return players, names
end

local function player_index(state, player_id)
  for index, id in ipairs(state.players) do
    if id == player_id then return index end
  end
  return nil
end

local function rejected(reason)
  return { accepted = false, error = {
    code = string.upper(reason), message = string.gsub(reason, "_", " "),
  } }
end

local function accepted(state, events)
  return { accepted = true, state = state, events = events or {} }
end

local function tile_type(tile) return math.floor((tile - 1) / 4) + 1 end
local function is_honor(kind) return kind >= 28 end
local function is_terminal(kind)
  if kind > 27 then return false end
  local rank = ((kind - 1) % 9) + 1
  return rank == 1 or rank == 9
end
local function is_outside(kind) return is_honor(kind) or is_terminal(kind) end

local function sort_hand(hand)
  table.sort(hand, function(left, right)
    local a, b = tile_type(left), tile_type(right)
    return a == b and left < right or a < b
  end)
  return hand
end

local function next_random(state)
  state.seed = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
  return state.seed
end

local function shuffled_tiles(state)
  local tiles = {}
  for tile = 1, 136 do tiles[tile] = tile end
  for index = #tiles, 2, -1 do
    local other = (next_random(state) % index) + 1
    tiles[index], tiles[other] = tiles[other], tiles[index]
  end
  return tiles
end

local function type_counts(tiles)
  local counts = {}
  for kind = 1, 34 do counts[kind] = 0 end
  for _, tile in ipairs(tiles or {}) do
    local kind = tile_type(tile)
    counts[kind] = counts[kind] + 1
  end
  return counts
end

local function collect_sets(counts, needed, groups, results)
  if needed == 0 then
    for kind = 1, 34 do if counts[kind] ~= 0 then return end end
    local result = {}
    for _, group in ipairs(groups) do result[#result + 1] = group end
    results[#results + 1] = result
    return
  end
  local first
  for kind = 1, 34 do if counts[kind] > 0 then first = kind break end end
  if not first then return end
  if counts[first] >= 3 then
    counts[first] = counts[first] - 3
    groups[#groups + 1] = { kind = "triplet", tile = first, open = false }
    collect_sets(counts, needed - 1, groups, results)
    groups[#groups] = nil
    counts[first] = counts[first] + 3
  end
  local rank = ((first - 1) % 9) + 1
  if first <= 27 and rank <= 7 and counts[first + 1] > 0 and counts[first + 2] > 0 then
    counts[first], counts[first + 1], counts[first + 2] =
      counts[first] - 1, counts[first + 1] - 1, counts[first + 2] - 1
    groups[#groups + 1] = { kind = "sequence", tile = first, open = false }
    collect_sets(counts, needed - 1, groups, results)
    groups[#groups] = nil
    counts[first], counts[first + 1], counts[first + 2] =
      counts[first] + 1, counts[first + 1] + 1, counts[first + 2] + 1
  end
end

local function standard_decompositions(tiles, melds)
  local needed = 4 - #(melds or {})
  if #tiles ~= needed * 3 + 2 then return {} end
  local counts, results = type_counts(tiles), {}
  for pair = 1, 34 do
    if counts[pair] >= 2 then
      counts[pair] = counts[pair] - 2
      local sets = {}
      collect_sets(counts, needed, {}, sets)
      counts[pair] = counts[pair] + 2
      for _, groups in ipairs(sets) do
        results[#results + 1] = { pair = pair, groups = groups }
      end
    end
  end
  return results
end

local function is_seven_pairs(tiles, melds)
  if #(melds or {}) ~= 0 or #tiles ~= 14 then return false end
  local counts, pairs = type_counts(tiles), 0
  for kind = 1, 34 do
    if counts[kind] == 2 then pairs = pairs + 1
    elseif counts[kind] ~= 0 then return false end
  end
  return pairs == 7
end

local function is_thirteen_orphans(tiles, melds)
  if #(melds or {}) ~= 0 or #tiles ~= 14 then return false end
  local required = { 1, 9, 10, 18, 19, 27, 28, 29, 30, 31, 32, 33, 34 }
  local counts, pair_found = type_counts(tiles), false
  for _, kind in ipairs(required) do
    if counts[kind] == 0 then return false end
    if counts[kind] >= 2 then pair_found = true end
  end
  for kind = 1, 34 do
    if counts[kind] > 0 and not is_outside(kind) then return false end
  end
  return pair_found
end

local function is_structural_win(tiles, melds)
  return is_seven_pairs(tiles, melds) or is_thirteen_orphans(tiles, melds)
    or #standard_decompositions(tiles, melds) > 0
end

local function waiting_types(hand, melds)
  local result, counts = {}, type_counts(hand)
  for kind = 1, 34 do
    if counts[kind] < 4 then
      local candidate = copy_array(hand)
      candidate[#candidate + 1] = (kind - 1) * 4 + 1
      if is_structural_win(candidate, melds) then result[#result + 1] = kind end
    end
  end
  return result
end

local function remove_tile(hand, tile)
  for index, candidate in ipairs(hand) do
    if candidate == tile then table.remove(hand, index) return true end
  end
  return false
end

local function hand_with_drawn(state, player_id)
  local hand = copy_array(state.hands[player_id])
  if state.drawnTile and state.drawnTile > 0 and state.players[state.turnIndex] == player_id then
    hand[#hand + 1] = state.drawnTile
  end
  return hand
end

local function remove_concealed_tile(state, player_id, tile)
  if state.players[state.turnIndex] == player_id and state.drawnTile == tile then
    state.drawnTile = 0
    return true
  end
  return remove_tile(state.hands[player_id], tile)
end

local function tiles_of_type(hand, kind, maximum)
  local result = {}
  for _, tile in ipairs(hand) do
    if tile_type(tile) == kind then
      result[#result + 1] = tile
      if maximum and #result >= maximum then break end
    end
  end
  return result
end

local function next_dora(kind)
  if kind <= 27 then
    local first = math.floor((kind - 1) / 9) * 9 + 1
    return first + (((kind - first) + 1) % 9)
  end
  if kind <= 31 then return 28 + ((kind - 28 + 1) % 4) end
  return 32 + ((kind - 32 + 1) % 3)
end

local function round_up_100(value) return math.ceil(value / 100) * 100 end

local function all_tile_ids(hand, melds)
  local result = copy_array(hand)
  for _, meld in ipairs(melds or {}) do
    for _, tile in ipairs(meld.tiles) do result[#result + 1] = tile end
  end
  return result
end

local function add_yaku(yaku, name, han)
  yaku[#yaku + 1] = { name = name, han = han }
  return han
end

local function indicator_types(state, ura)
  local result = {}
  local offset = ura and 2 or 1
  for index = 1, state.kanCount + 1 do
    local tile = state.deadWall[(index - 1) * 2 + offset]
    if tile then result[#result + 1] = tile_type(tile) end
  end
  return result
end

local function visible_indicator_tiles(state)
  local result = {}
  for index = 1, state.kanCount + 1 do
    local tile = state.deadWall[(index - 1) * 2 + 1]
    if tile then
      result[#result + 1] = {
        type = tile_type(tile),
        red = RED_FIVES[tile] == true,
      }
    end
  end
  return result
end

local function count_dora(state, hand, melds, include_ura)
  local ids, count = all_tile_ids(hand, melds), 0
  local indicators = indicator_types(state, false)
  if include_ura then
    for _, kind in ipairs(indicator_types(state, true)) do indicators[#indicators + 1] = kind end
  end
  for _, tile in ipairs(ids) do
    if RED_FIVES[tile] then count = count + 1 end
    local kind = tile_type(tile)
    for _, indicator in ipairs(indicators) do
      if kind == next_dora(indicator) then count = count + 1 end
    end
  end
  return count
end

local function group_contains(group, kind)
  if group.kind == "sequence" then return kind >= group.tile and kind <= group.tile + 2 end
  return group.tile == kind
end

local function wait_kind(group, winning_kind)
  if not group then return "tanki" end
  if group.kind == "triplet" then return "shanpon" end
  local rank = ((group.tile - 1) % 9) + 1
  if winning_kind == group.tile + 1 then return "kanchan" end
  if rank == 1 and winning_kind == group.tile + 2 then return "penchan" end
  if rank == 7 and winning_kind == group.tile then return "penchan" end
  return "ryanmen"
end

local function full_groups(decomposition, melds)
  local groups = {}
  for _, group in ipairs(decomposition.groups) do groups[#groups + 1] = group end
  for _, meld in ipairs(melds or {}) do
    groups[#groups + 1] = {
      kind = meld.kind == "chi" and "sequence"
        or ((meld.kind == "kan" or meld.kind == "ankan" or meld.kind == "kakan") and "quad" or "triplet"),
      tile = tile_type(meld.tiles[1]), open = true,
    }
  end
  return groups
end

local function evaluate_standard(state, seat, hand, melds, decomposition, method, winning_kind, win_group)
  local closed = #melds == 0
  local groups = full_groups(decomposition, melds)
  local yaku, han, yakuman = {}, 0, 0
  local player_id = state.players[seat]
  local seat_wind = 28 + ((seat - state.dealerIndex + 4) % 4)
  local round_wind = 27 + state.roundWind
  local wait = win_group == 0 and "tanki" or wait_kind(decomposition.groups[win_group], winning_kind)

  if state.doubleRiichi[player_id] then han = han + add_yaku(yaku, "两立直", 2)
  elseif state.riichi[player_id] then han = han + add_yaku(yaku, "立直", 1) end
  if state.ippatsu[player_id] then han = han + add_yaku(yaku, "一发", 1) end
  if closed and method == "tsumo" then han = han + add_yaku(yaku, "门前清自摸和", 1) end
  if state.rinshanWin then han = han + add_yaku(yaku, "岭上开花", 1) end
  if state.chankanWin then han = han + add_yaku(yaku, "抢杠", 1) end
  if #state.wall == 0 then
    han = han + add_yaku(yaku, method == "tsumo" and "海底摸月" or "河底捞鱼", 1)
  end

  local all_ids = all_tile_ids(hand, melds)
  local simple = true
  for _, tile in ipairs(all_ids) do if is_outside(tile_type(tile)) then simple = false break end end
  if simple then han = han + add_yaku(yaku, "断幺九", 1) end

  local sequences, triplets, concealed_triplets = {}, {}, 0
  local sequence_count, outside_groups, terminal_only_groups = {}, true, true
  for index, group in ipairs(groups) do
    if group.kind == "sequence" then
      sequences[#sequences + 1] = group.tile
      sequence_count[group.tile] = (sequence_count[group.tile] or 0) + 1
      local rank = ((group.tile - 1) % 9) + 1
      if rank ~= 1 and rank ~= 7 then outside_groups = false end
      terminal_only_groups = false
    else
      triplets[#triplets + 1] = group.tile
      if not is_outside(group.tile) then outside_groups, terminal_only_groups = false, false end
      local concealed = not group.open
      if method == "ron" and index == win_group and group.kind == "triplet" then concealed = false end
      if concealed then concealed_triplets = concealed_triplets + 1 end
    end
  end
  if not is_outside(decomposition.pair) then outside_groups, terminal_only_groups = false, false end

  local value_pair = decomposition.pair >= 32 or decomposition.pair == seat_wind or decomposition.pair == round_wind
  if closed and #sequences == 4 and not value_pair and wait == "ryanmen" then
    han = han + add_yaku(yaku, "平和", 1)
  end
  if closed then
    local sequence_pairs = 0
    for _, count in pairs(sequence_count) do sequence_pairs = sequence_pairs + math.floor(count / 2) end
    if sequence_pairs >= 2 then han = han + add_yaku(yaku, "二杯口", 3)
    elseif sequence_pairs == 1 then han = han + add_yaku(yaku, "一杯口", 1) end
  end

  local dragon_triplets, wind_triplets = 0, 0
  for _, kind in ipairs(triplets) do
    if kind >= 32 then
      dragon_triplets = dragon_triplets + 1
      han = han + add_yaku(yaku, ({ [32] = "白", [33] = "发", [34] = "中" })[kind], 1)
    end
    if kind == seat_wind then han = han + add_yaku(yaku, "自风", 1) end
    if kind == round_wind then han = han + add_yaku(yaku, "场风", 1) end
    if kind >= 28 and kind <= 31 then wind_triplets = wind_triplets + 1 end
  end
  if dragon_triplets == 3 then yakuman = yakuman + 1; add_yaku(yaku, "大三元", 13) end
  if wind_triplets == 4 then yakuman = yakuman + 2; add_yaku(yaku, "大四喜", 26)
  elseif wind_triplets == 3 and decomposition.pair >= 28 and decomposition.pair <= 31 then
    yakuman = yakuman + 1; add_yaku(yaku, "小四喜", 13)
  end
  if dragon_triplets == 2 and decomposition.pair >= 32 then han = han + add_yaku(yaku, "小三元", 2) end

  if #triplets == 4 then han = han + add_yaku(yaku, "对对和", 2) end
  if concealed_triplets >= 3 then han = han + add_yaku(yaku, "三暗刻", 2) end
  if concealed_triplets == 4 and (method == "tsumo" or wait == "tanki") then
    yakuman = yakuman + 1; add_yaku(yaku, "四暗刻", 13)
  end
  local quads = 0
  for _, group in ipairs(groups) do if group.kind == "quad" then quads = quads + 1 end end
  if quads == 3 then han = han + add_yaku(yaku, "三杠子", 2) end
  if quads == 4 then yakuman = yakuman + 1; add_yaku(yaku, "四杠子", 13) end

  for start = 1, 7 do
    if sequence_count[start] and sequence_count[start + 9] and sequence_count[start + 18] then
      han = han + add_yaku(yaku, "三色同顺", closed and 2 or 1); break
    end
  end
  for suit = 0, 2 do
    local base = suit * 9 + 1
    if sequence_count[base] and sequence_count[base + 3] and sequence_count[base + 6] then
      han = han + add_yaku(yaku, "一气通贯", closed and 2 or 1); break
    end
  end
  for rank = 1, 9 do
    local found = {}
    for _, kind in ipairs(triplets) do found[kind] = true end
    if found[rank] and found[rank + 9] and found[rank + 18] then
      han = han + add_yaku(yaku, "三色同刻", 2); break
    end
  end

  local has_honor, suits = false, {}
  for _, tile in ipairs(all_ids) do
    local kind = tile_type(tile)
    if is_honor(kind) then has_honor = true else suits[math.floor((kind - 1) / 9)] = true end
  end
  local suit_count = 0
  for _ in pairs(suits) do suit_count = suit_count + 1 end
  if suit_count == 1 then
    if has_honor then han = han + add_yaku(yaku, "混一色", closed and 3 or 2)
    else han = han + add_yaku(yaku, "清一色", closed and 6 or 5) end
  end
  if outside_groups then
    if #sequences == 0 then han = han + add_yaku(yaku, "混老头", 2)
    elseif has_honor then han = han + add_yaku(yaku, "混全带幺九", closed and 2 or 1)
    else han = han + add_yaku(yaku, "纯全带幺九", closed and 3 or 2) end
  end

  local all_honors, all_terminals, all_green = true, true, true
  local green = { [20]=true, [21]=true, [22]=true, [24]=true, [26]=true, [33]=true }
  for _, tile in ipairs(all_ids) do
    local kind = tile_type(tile)
    if not is_honor(kind) then all_honors = false end
    if not is_terminal(kind) then all_terminals = false end
    if not green[kind] then all_green = false end
  end
  if all_honors then yakuman = yakuman + 1; add_yaku(yaku, "字一色", 13) end
  if all_terminals then yakuman = yakuman + 1; add_yaku(yaku, "清老头", 13) end
  if all_green then yakuman = yakuman + 1; add_yaku(yaku, "绿一色", 13) end

  local fu = 20
  if closed and method == "ron" then fu = fu + 10 end
  if method == "tsumo" and not (closed and #sequences == 4 and not value_pair and wait == "ryanmen") then fu = fu + 2 end
  if decomposition.pair >= 32 then fu = fu + 2 end
  if decomposition.pair == seat_wind then fu = fu + 2 end
  if decomposition.pair == round_wind then fu = fu + 2 end
  if wait == "tanki" or wait == "kanchan" or wait == "penchan" then fu = fu + 2 end
  for index, group in ipairs(groups) do
    if group.kind ~= "sequence" then
      local open = group.open or (method == "ron" and index == win_group and group.kind == "triplet")
      local value = group.kind == "quad" and (open and 8 or 16) or (open and 2 or 4)
      if is_outside(group.tile) then value = value * 2 end
      fu = fu + value
    end
  end
  if not closed and fu == 20 then fu = 30 end
  fu = math.ceil(fu / 10) * 10
  return { yaku = yaku, han = han, fu = fu, yakuman = yakuman }
end

local function finalize_score(state, seat, hand, melds, evaluation)
  if evaluation.yakuman > 0 then
    evaluation.han = evaluation.yakuman * 13
    evaluation.base = 8000 * evaluation.yakuman
    evaluation.limit = evaluation.yakuman > 1 and (tostring(evaluation.yakuman) .. "倍役满") or "役满"
    return evaluation
  end
  if evaluation.han <= 0 then return nil end
  local player_id = state.players[seat]
  local dora = count_dora(state, hand, melds, state.riichi[player_id] == true)
  if dora > 0 then evaluation.han = evaluation.han + add_yaku(evaluation.yaku, "宝牌", dora) end
  local raw = evaluation.fu * (2 ^ (evaluation.han + 2))
  if evaluation.han >= 13 then evaluation.base, evaluation.limit = 8000, "累计役满"
  elseif evaluation.han >= 11 then evaluation.base, evaluation.limit = 6000, "三倍满"
  elseif evaluation.han >= 8 then evaluation.base, evaluation.limit = 4000, "倍满"
  elseif evaluation.han >= 6 then evaluation.base, evaluation.limit = 3000, "跳满"
  elseif evaluation.han >= 5 or raw >= 2000 then evaluation.base, evaluation.limit = 2000, "满贯"
  else evaluation.base, evaluation.limit = raw, "" end
  return evaluation
end

local function special_score(state, seat, hand, melds, method)
  local player_id, yaku, han = state.players[seat], {}, 0
  if is_thirteen_orphans(hand, melds) then
    return { yaku = { { name = "国士无双", han = 13 } }, han = 13, fu = 0, yakuman = 1 }
  end
  if not is_seven_pairs(hand, melds) then return nil end
  if state.doubleRiichi[player_id] then han = han + add_yaku(yaku, "两立直", 2)
  elseif state.riichi[player_id] then han = han + add_yaku(yaku, "立直", 1) end
  if state.ippatsu[player_id] then han = han + add_yaku(yaku, "一发", 1) end
  if method == "tsumo" then han = han + add_yaku(yaku, "门前清自摸和", 1) end
  han = han + add_yaku(yaku, "七对子", 2)
  local all_ids, simple, outside = all_tile_ids(hand, melds), true, true
  local has_honor, suits = false, {}
  for _, tile in ipairs(all_ids) do
    local kind = tile_type(tile)
    if is_outside(kind) then simple = false else outside = false end
    if is_honor(kind) then has_honor = true else suits[math.floor((kind - 1) / 9)] = true end
  end
  if simple then han = han + add_yaku(yaku, "断幺九", 1) end
  if outside then han = han + add_yaku(yaku, "混老头", 2) end
  local suit_count = 0 for _ in pairs(suits) do suit_count = suit_count + 1 end
  if suit_count == 1 then
    if has_honor then han = han + add_yaku(yaku, "混一色", 3)
    else han = han + add_yaku(yaku, "清一色", 6) end
  end
  return { yaku = yaku, han = han, fu = 25, yakuman = 0 }
end

local function score_hand(state, seat, winning_tile, method)
  local player_id = state.players[seat]
  local hand, melds = copy_array(state.hands[player_id]), state.melds[player_id]
  if method == "ron" then hand[#hand + 1] = winning_tile
  elseif state.drawnTile and state.drawnTile > 0 then hand[#hand + 1] = state.drawnTile end
  local special = special_score(state, seat, hand, melds, method)
  if special then return finalize_score(state, seat, hand, melds, special) end
  local best, winning_kind = nil, tile_type(winning_tile)
  for _, decomposition in ipairs(standard_decompositions(hand, melds)) do
    local candidates = {}
    for index, group in ipairs(decomposition.groups) do
      if group_contains(group, winning_kind) then candidates[#candidates + 1] = index end
    end
    if decomposition.pair == winning_kind then candidates[#candidates + 1] = 0 end
    for _, win_group in ipairs(candidates) do
      local evaluated = evaluate_standard(state, seat, hand, melds, decomposition, method, winning_kind, win_group)
      evaluated = finalize_score(state, seat, hand, melds, evaluated)
      if evaluated and (not best or evaluated.base > best.base
        or (evaluated.base == best.base and evaluated.han > best.han)
        or (evaluated.base == best.base and evaluated.han == best.han and evaluated.fu > best.fu)) then
        best = evaluated
      end
    end
  end
  return best
end

local function is_furiten(state, player_id)
  if state.tempFuriten[player_id] or state.riichiFuriten[player_id] then return true end
  local waits, discarded = waiting_types(state.hands[player_id], state.melds[player_id]), {}
  for _, entry in ipairs(state.discards[player_id]) do discarded[tile_type(entry.tile)] = true end
  for _, kind in ipairs(waits) do if discarded[kind] then return true end end
  return false
end

local function clear_hand_state(state)
  state.hands, state.discards, state.melds = {}, {}, {}
  state.riichi, state.doubleRiichi, state.ippatsu = {}, {}, {}
  state.tempFuriten, state.riichiFuriten, state.firstTurn = {}, {}, {}
  state.pao, state.kanByPlayer, state.kuikaeForbidden = {}, {}, {}
  for _, player_id in ipairs(state.players) do
    state.hands[player_id], state.discards[player_id], state.melds[player_id] = {}, {}, {}
    state.riichi[player_id], state.doubleRiichi[player_id], state.ippatsu[player_id] = false, false, false
    state.tempFuriten[player_id], state.riichiFuriten[player_id], state.firstTurn[player_id] = false, false, true
    state.pao[player_id], state.kanByPlayer[player_id] = {}, 0
    state.kuikaeForbidden[player_id] = {}
  end
  state.drawnTile = 0
end

local function draw_tile(state, seat, rinshan)
  local tile
  if rinshan then
    tile = table.remove(state.rinshan)
    local replacement = table.remove(state.wall, 1)
    if replacement then state.deadWall[#state.deadWall + 1] = replacement end
  else tile = table.remove(state.wall) end
  if not tile then return nil end
  local player_id = state.players[seat]
  state.tempFuriten[player_id] = false
  state.drawnTile, state.rinshanWin = tile, rinshan == true
  return tile
end

local function deal(state)
  local tiles = shuffled_tiles(state)
  clear_hand_state(state)
  state.wall, state.deadWall, state.rinshan = tiles, {}, {}
  for _ = 1, 13 do
    for _, player_id in ipairs(state.players) do
      state.hands[player_id][#state.hands[player_id] + 1] = table.remove(state.wall)
    end
  end
  for _ = 1, 10 do state.deadWall[#state.deadWall + 1] = table.remove(state.wall) end
  for _ = 1, 4 do state.rinshan[#state.rinshan + 1] = table.remove(state.wall) end
  for _, player_id in ipairs(state.players) do sort_hand(state.hands[player_id]) end
  state.kanCount, state.callOccurred = 0, false
  state.pendingKan, state.pendingFourKans = nil, false
  state.claimants, state.claimResponses, state.claimIndex = {}, {}, 0
  state.lastDiscard, state.drawnTile, state.rinshanWin = nil, 0, false
  state.winner, state.winnerIndex, state.winType, state.winningTile = "", 0, "", 0
  state.winners, state.results, state.abortiveReason = {}, {}, ""
  state.abortivePlayerIndex, state.abortiveTile = 0, 0
  state.draw, state.result, state.moveCount = false, nil, 0
  state.chankanWin = false
  state.turnIndex, state.phase = state.dealerIndex, "playing"
  draw_tile(state, state.dealerIndex, false)
end

local function match_limit(state) return state.matchType == "hanchan" and 2 or 1 end

local function mark_next_hand(state, dealer_repeats, was_draw)
  state.nextDealerRepeats = dealer_repeats
  local dealer, hand, wind, honba = state.dealerIndex, state.handNumber, state.roundWind, state.honba
  if dealer_repeats then
    honba = honba + 1
  else
    dealer = (dealer % 4) + 1
    hand = hand + 1
    if hand > 4 then hand, wind = 1, wind + 1 end
    honba = was_draw and honba + 1 or 0
  end
  state.nextDealerIndex, state.nextHandNumber = dealer, hand
  state.nextRoundWind, state.nextHonba = wind, honba
  local top_seat, top_score = 1, state.scores[1]
  for seat = 2, 4 do
    if state.scores[seat] > top_score then top_seat, top_score = seat, state.scores[seat] end
  end
  state.matchEnded, state.endReason = false, ""
  if state.rules.bankruptcy then
    for seat = 1, 4 do
      if state.scores[seat] < 0 then state.matchEnded, state.endReason = true, "击飞结束" break end
    end
  end
  local limit = match_limit(state)
  local scheduled_final = state.roundWind == limit and state.handNumber == 4
  local extension_stage = state.roundWind > limit
  if not state.matchEnded and dealer_repeats and state.rules.agariYame
    and not (state.result and state.result.abortive)
    and (scheduled_final or extension_stage) and top_seat == state.dealerIndex and top_score >= 30000 then
    state.matchEnded, state.endReason = true, "庄家止和"
  end
  if not state.matchEnded and not dealer_repeats and (scheduled_final or extension_stage) then
    if not state.rules.extensions or top_score >= 30000 then
      state.matchEnded, state.endReason = true, "对局结束"
    elseif state.roundWind >= limit + 1 and state.handNumber == 4 then
      state.matchEnded, state.endReason = true, "延长赛结束"
    end
  end
  if not state.matchEnded and wind > limit + 1 then state.matchEnded, state.endReason = true, "延长赛结束" end
  if state.matchEnded and state.riichiSticks > 0 then
    local award = state.riichiSticks * 1000
    state.scores[top_seat], state.riichiSticks = state.scores[top_seat] + award, 0
    if state.result then
      state.result.endRiichiAward = award
      if state.result.deltas then state.result.deltas[top_seat] = state.result.deltas[top_seat] + award end
    end
  end
end

local function pao_seat_for_score(state, player_id, score)
  if not state.rules.pao then return nil end
  local liabilities = state.pao[player_id] or {}
  for _, yaku in ipairs(score.yaku or {}) do
    if yaku.name == "大三元" and liabilities.daisangen then return liabilities.daisangen end
    if yaku.name == "大四喜" and liabilities.daisuushii then return liabilities.daisuushii end
    if yaku.name == "四杠子" and liabilities.suukantsu then return liabilities.suukantsu end
  end
  return nil
end

local function settle_win(state, seat, method, from_seat, winning_tile)
  local score = score_hand(state, seat, winning_tile, method)
  if not score then return nil end
  local deltas = { 0, 0, 0, 0 }
  local dealer_win = seat == state.dealerIndex
  local pao_seat = pao_seat_for_score(state, state.players[seat], score)
  score.paoSeat = pao_seat or 0
  if method == "ron" then
    local amount = round_up_100(score.base * (dealer_win and 6 or 4)) + state.honba * 300
    if pao_seat and pao_seat ~= from_seat then
      local liability = math.floor(amount / 200) * 100
      deltas[pao_seat], deltas[from_seat] = -liability, -(amount - liability)
    else deltas[from_seat] = -amount end
    deltas[seat] = amount
    score.payment = tostring(amount) .. "点"
  else
    local parts = {}
    if pao_seat then
      local amount = round_up_100(score.base * (dealer_win and 6 or 4)) + state.honba * 300
      deltas[pao_seat], deltas[seat] = -amount, amount
      parts[1] = amount
    else
      for payer = 1, 4 do
        if payer ~= seat then
          local multiplier = dealer_win and 2 or (payer == state.dealerIndex and 2 or 1)
          local amount = round_up_100(score.base * multiplier) + state.honba * 100
          deltas[payer], deltas[seat] = -amount, deltas[seat] + amount
          parts[#parts + 1] = amount
        end
      end
    end
    score.payment = dealer_win and (tostring(parts[1]) .. "点∀")
      or (tostring(round_up_100(score.base)) .. "/" .. tostring(round_up_100(score.base * 2)) .. "点")
  end
  if state.riichiSticks > 0 then
    deltas[seat] = deltas[seat] + state.riichiSticks * 1000
    score.riichiAward = state.riichiSticks * 1000
    state.riichiSticks = 0
  end
  for index = 1, 4 do state.scores[index] = state.scores[index] + deltas[index] end
  score.deltas = deltas
  state.phase, state.winner, state.winnerIndex = "hand_ended", state.players[seat], seat
  state.winType, state.winningTile, state.draw = method, winning_tile, false
  state.winners, state.results, state.result = { state.players[seat] }, { score }, score
  mark_next_hand(state, dealer_win, false)
  return score
end

local function settle_multiple_ron(state, winners, from_seat, winning_tile)
  local total_deltas, results, winner_ids = { 0, 0, 0, 0 }, {}, {}
  local dealer_won = false
  for _, winner in ipairs(winners) do
    local seat = winner.playerIndex
    local score = score_hand(state, seat, winning_tile, "ron")
    if score then
      local amount = round_up_100(score.base * (seat == state.dealerIndex and 6 or 4)) + state.honba * 300
      local pao_seat = pao_seat_for_score(state, state.players[seat], score)
      if pao_seat and pao_seat ~= from_seat then
        local liability = math.floor(amount / 200) * 100
        total_deltas[pao_seat] = total_deltas[pao_seat] - liability
        total_deltas[from_seat] = total_deltas[from_seat] - (amount - liability)
      else total_deltas[from_seat] = total_deltas[from_seat] - amount end
      total_deltas[seat] = total_deltas[seat] + amount
      score.payment, score.paoSeat, score.winnerIndex = tostring(amount) .. "点", pao_seat or 0, seat
      results[#results + 1], winner_ids[#winner_ids + 1] = score, state.players[seat]
      if seat == state.dealerIndex then dealer_won = true end
    end
  end
  if #results == 0 then return false end
  if state.riichiSticks > 0 then
    local award = state.riichiSticks * 1000
    total_deltas[results[1].winnerIndex] = total_deltas[results[1].winnerIndex] + award
    results[1].riichiAward, state.riichiSticks = award, 0
  end
  for seat = 1, 4 do state.scores[seat] = state.scores[seat] + total_deltas[seat] end
  for _, score in ipairs(results) do score.deltas = total_deltas end
  state.phase, state.winType, state.winningTile, state.draw = "hand_ended", "ron", winning_tile, false
  state.winnerIndex, state.winner = results[1].winnerIndex, winner_ids[1]
  state.winners, state.results, state.result = winner_ids, results, results[1]
  mark_next_hand(state, dealer_won, false)
  return true
end

finish_exhaustive_draw = function(state)
  if state.rules.nagashiMangan then
    local winners = {}
    for seat, player_id in ipairs(state.players) do
      local eligible = #state.discards[player_id] > 0
      for _, discard in ipairs(state.discards[player_id]) do
        if discard.claimed or not is_outside(tile_type(discard.tile)) then eligible = false break end
      end
      if eligible then winners[#winners + 1] = seat end
    end
    if #winners > 0 then
      local deltas, results, dealer_won = { 0, 0, 0, 0 }, {}, false
      for _, seat in ipairs(winners) do
        local won = 0
        for payer = 1, 4 do
          if payer ~= seat then
            local multiplier = seat == state.dealerIndex and 2 or (payer == state.dealerIndex and 2 or 1)
            local amount = round_up_100(2000 * multiplier) + state.honba * 100
            deltas[payer], won = deltas[payer] - amount, won + amount
          end
        end
        deltas[seat] = deltas[seat] + won
        results[#results + 1] = { winnerIndex = seat, han = 5, fu = 0, limit = "满贯",
          payment = seat == state.dealerIndex and "4000点∀" or "2000/4000点",
          yaku = { { name = "流局满贯", han = 5 } } }
        if seat == state.dealerIndex then dealer_won = true end
      end
      if state.riichiSticks > 0 then
        local award = state.riichiSticks * 1000
        deltas[winners[1]], results[1].riichiAward, state.riichiSticks = deltas[winners[1]] + award, award, 0
      end
      for seat = 1, 4 do state.scores[seat] = state.scores[seat] + deltas[seat] end
      for _, result in ipairs(results) do result.deltas = deltas end
      state.phase, state.draw, state.winType = "hand_ended", false, "nagashi"
      state.winnerIndex, state.winner = winners[1], state.players[winners[1]]
      state.winners, state.results, state.result = {}, results, results[1]
      for _, seat in ipairs(winners) do state.winners[#state.winners + 1] = state.players[seat] end
      mark_next_hand(state, dealer_won, false)
      return
    end
  end
  local tenpai, count = {}, 0
  for seat, player_id in ipairs(state.players) do
    tenpai[seat] = #waiting_types(state.hands[player_id], state.melds[player_id]) > 0
    if tenpai[seat] then count = count + 1 end
  end
  local deltas = { 0, 0, 0, 0 }
  if count > 0 and count < 4 then
    local gain, loss = 3000 / count, 3000 / (4 - count)
    for seat = 1, 4 do deltas[seat] = tenpai[seat] and gain or -loss end
    for seat = 1, 4 do state.scores[seat] = state.scores[seat] + deltas[seat] end
  end
  state.phase, state.draw = "hand_ended", true
  state.result = { tenpai = tenpai, deltas = deltas, payment = count == 0 or count == 4 and "不听罚符 0点" or "不听罚符 3000点" }
  mark_next_hand(state, tenpai[state.dealerIndex], true)
end

finish_abortive_draw = function(state, reason, player_index)
  state.phase, state.draw = "hand_ended", true
  state.abortiveReason = reason
  state.abortivePlayerIndex = tonumber(player_index) or 0
  state.abortiveTile = state.abortivePlayerIndex > 0 and state.drawnTile or 0
  state.result = { abortive = true, reason = reason, deltas = { 0, 0, 0, 0 }, payment = "途中流局" }
  mark_next_hand(state, true, true)
end

local function new_match(players, names, seed, settings)
  seed = math.floor(math.abs(tonumber(seed) or 1)) % RANDOM_MODULUS
  if seed == 0 then seed = 1 end
  local state = {
    players = players, playerNames = names, seed = seed,
    matchType = settings and settings.matchType == "hanchan" and "hanchan" or "east",
    roundWind = 1, handNumber = 1, dealerIndex = 1,
    honba = 0, riichiSticks = 0, scores = { 25000, 25000, 25000, 25000 },
    matchEnded = false, rules = rule_settings(settings),
  }
  deal(state)
  return state
end

local function chi_tile_variants(hand, kind)
  local normal, red
  for _, tile in ipairs(hand) do
    if tile_type(tile) == kind then
      if RED_FIVES[tile] then red = red or tile else normal = normal or tile end
    end
  end
  local variants = {}
  if normal then variants[#variants + 1] = normal end
  if red then variants[#variants + 1] = red end
  return variants
end

local function chi_options(hand, discarded_type)
  if discarded_type > 27 then return {} end
  local rank = ((discarded_type - 1) % 9) + 1
  local candidates = {
    { discarded_type - 2, discarded_type - 1, rank >= 3 },
    { discarded_type - 1, discarded_type + 1, rank >= 2 and rank <= 8 },
    { discarded_type + 1, discarded_type + 2, rank <= 7 },
  }
  local options = {}
  for _, candidate in ipairs(candidates) do
    if candidate[3] then
      local first_variants = chi_tile_variants(hand, candidate[1])
      local second_variants = chi_tile_variants(hand, candidate[2])
      for _, first in ipairs(first_variants) do
        for _, second in ipairs(second_variants) do
          options[#options + 1] = { kind = "chi", tileIds = { first, second } }
        end
      end
    end
  end
  return options
end

local function same_kinds(left, right)
  if #left ~= #right then return false end
  local seen = {}
  for _, kind in ipairs(left) do seen[kind] = (seen[kind] or 0) + 1 end
  for _, kind in ipairs(right) do
    if not seen[kind] or seen[kind] == 0 then return false end
    seen[kind] = seen[kind] - 1
  end
  return true
end

local function self_kan_options(state, player_id)
  if state.drawnTile == 0 or state.kanCount >= 4 or #state.wall == 0 then return {} end
  local hand, options = hand_with_drawn(state, player_id), {}
  local counts = type_counts(hand)
  for kind = 1, 34 do
    if counts[kind] == 4 then
      local allowed = true
      if state.riichi[player_id] then
        local before = copy_array(state.hands[player_id])
        local after = copy_array(hand)
        for _ = 1, 4 do remove_tile(after, tiles_of_type(after, kind, 1)[1]) end
        local pseudo_melds = copy_array(state.melds[player_id])
        pseudo_melds[#pseudo_melds + 1] = { kind = "ankan", tiles = {} }
        allowed = same_kinds(waiting_types(before, state.melds[player_id]), waiting_types(after, pseudo_melds))
      end
      if allowed then options[#options + 1] = { kind = "ankan", tileType = kind } end
    end
  end
  if not state.riichi[player_id] then
    for index, meld in ipairs(state.melds[player_id]) do
      if meld.kind == "pon" then
        local kind = tile_type(meld.tiles[1])
        if counts[kind] > 0 then options[#options + 1] = { kind = "kakan", tileType = kind, meldIndex = index } end
      end
    end
  end
  return options
end

local function record_pao(state, player_id, source_seat)
  if not state.rules.pao or not source_seat or source_seat == 0 then return end
  if state.players[source_seat] == player_id then return end
  local dragons, winds, quads = 0, 0, 0
  for _, meld in ipairs(state.melds[player_id]) do
    local kind = tile_type(meld.tiles[1])
    if meld.kind ~= "chi" and kind >= 32 then dragons = dragons + 1 end
    if meld.kind ~= "chi" and kind >= 28 and kind <= 31 then winds = winds + 1 end
    if meld.kind == "kan" or meld.kind == "ankan" or meld.kind == "kakan" then quads = quads + 1 end
  end
  if dragons >= 3 and not state.pao[player_id].daisangen then state.pao[player_id].daisangen = source_seat end
  if winds >= 4 and not state.pao[player_id].daisuushii then state.pao[player_id].daisuushii = source_seat end
  if quads >= 4 and not state.pao[player_id].suukantsu then state.pao[player_id].suukantsu = source_seat end
end

local function draw_after_kan(state, seat, events)
  local player_id = state.players[seat]
  state.kanCount = state.kanCount + 1
  state.kanByPlayer[player_id] = state.kanByPlayer[player_id] + 1
  local owners = 0
  for _, count in pairs(state.kanByPlayer) do if count > 0 then owners = owners + 1 end end
  if state.kanCount >= 4 and owners > 1 then state.pendingFourKans = true end
  local tile = draw_tile(state, seat, true)
  if tile then events[#events + 1] = { type = "drew", player = player_id, playerIndex = seat, tile = tile }
  else finish_exhaustive_draw(state); events[#events + 1] = { type = "draw_game" } end
end

local function complete_pending_kan(state, events)
  local pending = state.pendingKan
  if not pending then return end
  local player_id = pending.playerId
  local hand = hand_with_drawn(state, player_id)
  if pending.kind == "ankan" then
    for _, tile in ipairs(pending.tiles) do remove_tile(hand, tile) end
    state.melds[player_id][#state.melds[player_id] + 1] = {
      kind = "ankan", tiles = pending.tiles, fromIndex = 0,
    }
  else
    remove_tile(hand, pending.tile)
    local meld = state.melds[player_id][pending.meldIndex]
    meld.kind = "kakan"
    meld.tiles[#meld.tiles + 1] = pending.tile
    meld.addedTile = pending.tile
  end
  sort_hand(hand)
  state.hands[player_id], state.drawnTile = hand, 0
  state.pendingKan, state.phase, state.lastDiscard = nil, "playing", nil
  cancel_ippatsu(state)
  record_pao(state, player_id, pending.playerIndex)
  events[#events + 1] = { type = "claimed", kind = pending.kind, player = player_id, playerIndex = pending.playerIndex }
  draw_after_kan(state, pending.playerIndex, events)
end

local function begin_chankan(state, seat, tile, meld_index, kan_kind, kan_tiles)
  state.claimants, state.claimResponses, state.claimIndex = {}, {}, 0
  state.chankanWin = true
  for distance = 1, 3 do
    local other = ((seat - 1 + distance) % 4) + 1
    local player_id = state.players[other]
    local can_ron = false
    if not is_furiten(state, player_id) then
      if kan_kind == "ankan" then
        local candidate = copy_array(state.hands[player_id])
        candidate[#candidate + 1] = tile
        can_ron = is_thirteen_orphans(candidate, state.melds[player_id])
      else can_ron = score_hand(state, other, tile, "ron") ~= nil end
    end
    if can_ron then
      state.claimants[#state.claimants + 1] = { playerId = player_id, playerIndex = other,
        distance = distance, options = { { kind = "ron", tileIds = {} } } }
    end
  end
  if #state.claimants == 0 then state.chankanWin = false return false end
  state.pendingKan = { playerId = state.players[seat], playerIndex = seat, tile = tile,
    meldIndex = meld_index, kind = kan_kind, tiles = kan_tiles }
  state.lastDiscard = { player = state.players[seat], playerIndex = seat, tile = tile, discardIndex = 0, chankan = true }
  state.phase, state.claimIndex = "claiming", 1
  return true
end

local function apply_self_kan(state, action, actor_id, seat)
  if state.phase ~= "playing" or state.turnIndex ~= seat or state.drawnTile == 0 then return rejected("not_your_turn") end
  local selected
  for _, option in ipairs(self_kan_options(state, actor_id)) do
    if option.kind == action.kind and option.tileType == action.tileType then selected = option break end
  end
  if not selected then return rejected("kan_not_allowed") end
  local events = {}
  if selected.kind == "kakan" then
    local tile = tiles_of_type(hand_with_drawn(state, actor_id), selected.tileType, 1)[1]
    if begin_chankan(state, seat, tile, selected.meldIndex, "kakan") then
      return accepted(state, { { type = "kan_declared", kind = "kakan", player = actor_id, playerIndex = seat } })
    end
    state.pendingKan = { playerId = actor_id, playerIndex = seat, tile = tile,
      meldIndex = selected.meldIndex, kind = "kakan" }
    complete_pending_kan(state, events)
    return accepted(state, events)
  end
  local tiles = tiles_of_type(hand_with_drawn(state, actor_id), selected.tileType, 4)
  if begin_chankan(state, seat, tiles[1], 0, "ankan", tiles) then
    return accepted(state, { { type = "kan_declared", kind = "ankan", player = actor_id, playerIndex = seat } })
  end
  state.pendingKan = { playerId = actor_id, playerIndex = seat, tile = tiles[1],
    meldIndex = 0, kind = "ankan", tiles = tiles }
  complete_pending_kan(state, events)
  return accepted(state, events)
end

local function claim_options(state, seat, discarder, tile)
  local player_id, options = state.players[seat], {}
  local hand, kind = state.hands[player_id], tile_type(tile)
  if not is_furiten(state, player_id) and score_hand(state, seat, tile, "ron") then
    options[#options + 1] = { kind = "ron", tileIds = {} }
  end
  if state.riichi[player_id] then return options end
  local same = tiles_of_type(hand, kind, 3)
  if #same >= 3 and #state.wall > 0 and state.kanCount < 4 then
    options[#options + 1] = { kind = "kan", tileIds = { same[1], same[2], same[3] } }
  end
  if #same >= 2 then options[#options + 1] = { kind = "pon", tileIds = { same[1], same[2] } } end
  if seat == (discarder % PLAYER_COUNT) + 1 then
    for _, option in ipairs(chi_options(hand, kind)) do options[#options + 1] = option end
  end
  return options
end

local function begin_claims(state, discarder, tile)
  state.claimants, state.claimResponses, state.claimIndex = {}, {}, 0
  for distance = 1, 3 do
    local seat = ((discarder - 1 + distance) % 4) + 1
    local options = claim_options(state, seat, discarder, tile)
    if #options > 0 then
      state.claimants[#state.claimants + 1] = {
        playerId = state.players[seat], playerIndex = seat, distance = distance, options = options,
      }
    end
  end
  if #state.claimants > 0 then state.phase, state.claimIndex = "claiming", 1 return true end
  return false
end

local function advance_after_discard(state, discarder, events)
  if state.rules.abortiveDraws then
    local reason
    if state.pendingFourKans then reason = "四杠散了" end
    local riichi_count = 0
    for _, player_id in ipairs(state.players) do if state.riichi[player_id] then riichi_count = riichi_count + 1 end end
    if riichi_count == 4 then reason = "四家立直" end
    if state.moveCount == 4 and not state.callOccurred then
      local first
      local same_wind = true
      for _, player_id in ipairs(state.players) do
        local discard = state.discards[player_id][1]
        local kind = discard and tile_type(discard.tile) or 0
        if kind < 28 or kind > 31 then same_wind = false break end
        if not first then first = kind elseif first ~= kind then same_wind = false break end
      end
      if same_wind then reason = "四风连打" end
    end
    if reason then
      finish_abortive_draw(state, reason)
      events[#events + 1] = { type = "abortive_draw", reason = reason }
      return
    end
  end
  state.turnIndex, state.phase, state.lastDiscard = (discarder % 4) + 1, "playing", nil
  local tile = draw_tile(state, state.turnIndex, false)
  if tile then
    events[#events + 1] = { type = "drew", player = state.players[state.turnIndex], playerIndex = state.turnIndex, tile = tile }
  else finish_exhaustive_draw(state); events[#events + 1] = { type = "draw_game" } end
end

local function option_priority(kind)
  if kind == "ron" then return 4 end
  if kind == "pon" or kind == "kan" then return 3 end
  if kind == "chi" then return 2 end
  return 0
end

local function kuikae_forbidden_types(option)
  local forbidden = {}
  if option.kind == "pon" or option.kind == "kan" then
    local tile = option.tileIds[1]
    if tile then forbidden[tile_type(tile)] = true end
    return forbidden
  end
  if option.kind ~= "chi" then return forbidden end
  local first, second = tile_type(option.tileIds[1]), tile_type(option.tileIds[2])
  for candidate = 1, 27 do
    local values = { first, second, candidate }
    table.sort(values)
    local same_suit = math.floor((values[1] - 1) / 9) == math.floor((values[3] - 1) / 9)
    if same_suit and values[2] == values[1] + 1 and values[3] == values[2] + 1 then
      forbidden[candidate] = true
    end
  end
  return forbidden
end

cancel_ippatsu = function(state)
  state.callOccurred = true
  for _, player_id in ipairs(state.players) do state.ippatsu[player_id] = false end
end

local function resolve_claims(state, events)
  local winner
  local ron_winners = {}
  for _, response in ipairs(state.claimResponses) do
    if response.option > 0 then
      local claimant = state.claimants[response.claimant]
      local option = claimant.options[response.option]
      if option and option.kind == "ron" then
        ron_winners[#ron_winners + 1] = claimant
      elseif option and (not winner or option_priority(option.kind) > option_priority(winner.option.kind)
        or (option_priority(option.kind) == option_priority(winner.option.kind) and claimant.distance < winner.claimant.distance)) then
        winner = { claimant = claimant, option = option }
      end
    end
  end
  local discard = state.lastDiscard
  if #ron_winners > 0 then
    table.sort(ron_winners, function(a, b) return a.distance < b.distance end)
    if state.rules.tripleRonAbort and #ron_winners == 3 then
      state.pendingKan, state.chankanWin = nil, false
      finish_abortive_draw(state, "三家和")
      events[#events + 1] = { type = "abortive_draw", reason = "三家和" }
      return
    end
    if not state.rules.multipleRon then ron_winners = { ron_winners[1] } end
    if state.pendingKan then
      remove_concealed_tile(state, state.pendingKan.playerId, state.pendingKan.tile)
    end
    settle_multiple_ron(state, ron_winners, discard.playerIndex, discard.tile)
    state.pendingKan, state.chankanWin = nil, false
    for _, claimant in ipairs(ron_winners) do
      events[#events + 1] = { type = "won", method = "ron", player = claimant.playerId,
        playerIndex = claimant.playerIndex, fromIndex = discard.playerIndex, tile = discard.tile }
    end
    return
  end
  if state.pendingKan then complete_pending_kan(state, events); state.chankanWin = false return end
  if not winner then advance_after_discard(state, discard.playerIndex, events) return end
  local claimant, option = winner.claimant, winner.option
  cancel_ippatsu(state)
  local hand, meld_tiles = state.hands[claimant.playerId], { discard.tile }
  for _, tile in ipairs(option.tileIds) do remove_tile(hand, tile); meld_tiles[#meld_tiles + 1] = tile end
  sort_hand(hand)
  table.sort(meld_tiles, function(a, b) return tile_type(a) < tile_type(b) end)
  state.melds[claimant.playerId][#state.melds[claimant.playerId] + 1] = {
    kind = option.kind, tiles = meld_tiles, fromIndex = discard.playerIndex,
    calledTile = discard.tile,
  }
  state.kuikaeForbidden = state.kuikaeForbidden or {}
  state.kuikaeForbidden[claimant.playerId] = kuikae_forbidden_types(option)
  state.discards[state.players[discard.playerIndex]][discard.discardIndex].claimed = true
  state.turnIndex, state.phase, state.lastDiscard, state.drawnTile = claimant.playerIndex, "playing", nil, 0
  events[#events + 1] = { type = "claimed", kind = option.kind, player = claimant.playerId,
    playerIndex = claimant.playerIndex, fromIndex = discard.playerIndex, tile = discard.tile }
  record_pao(state, claimant.playerId, discard.playerIndex)
  if option.kind == "kan" then draw_after_kan(state, claimant.playerIndex, events) end
end

local function perform_discard(state, tile_id, actor_id, seat, riichi_declared)
  local hand = state.hands[actor_id]
  local drawn = state.drawnTile or 0
  if state.riichi[actor_id] and not riichi_declared and tile_id ~= drawn then return rejected("riichi_tsumogiri_required") end
  local forbidden = state.kuikaeForbidden and state.kuikaeForbidden[actor_id] or {}
  if forbidden[tile_type(tile_id)] then return rejected("kuikae_forbidden") end
  local from_drawn = drawn and drawn > 0 and tile_id == drawn
  local in_hand = false
  for _, tile in ipairs(hand) do if tile == tile_id then in_hand = true break end end
  if not from_drawn and not in_hand then return rejected("tile_not_in_hand") end
  local next_count = #hand - (in_hand and 1 or 0) + (not from_drawn and drawn > 0 and 1 or 0)
  if next_count % 3 ~= 1 then return rejected("discard_not_allowed") end
  if from_drawn then
    state.drawnTile = 0
  else
    remove_tile(hand, tile_id)
    if drawn > 0 then hand[#hand + 1] = drawn end
    sort_hand(hand)
    state.drawnTile = 0
  end
  state.kuikaeForbidden = state.kuikaeForbidden or {}
  state.kuikaeForbidden[actor_id] = {}
  state.discards[actor_id][#state.discards[actor_id] + 1] = {
    tile = tile_id, claimed = false, riichi = riichi_declared == true,
  }
  state.firstTurn[actor_id] = false
  if state.riichi[actor_id] and not riichi_declared then state.ippatsu[actor_id] = false end
  state.moveCount = state.moveCount + 1
  state.rinshanWin = false
  state.lastDiscard = { player = actor_id, playerIndex = seat, tile = tile_id,
    discardIndex = #state.discards[actor_id] }
  local events = { { type = riichi_declared and "riichi" or "discarded", player = actor_id,
    playerIndex = seat, tile = tile_id, fromDrawn = from_drawn } }
  if not begin_claims(state, seat, tile_id) then advance_after_discard(state, seat, events) end
  return accepted(state, events)
end

local function riichi_discards(state, player_id)
  if state.riichi[player_id] or #state.melds[player_id] > 0 or state.scores[player_index(state, player_id)] < 1000
    or #state.wall < 4 then return {} end
  local hand, result = hand_with_drawn(state, player_id), {}
  for index, tile in ipairs(hand) do
    local candidate = copy_array(hand)
    table.remove(candidate, index)
    if #waiting_types(candidate, state.melds[player_id]) > 0 then result[#result + 1] = tile end
  end
  return result
end

local function apply_riichi(state, action, actor_id, seat)
  if state.phase ~= "playing" or seat ~= state.turnIndex then return rejected("not_your_turn") end
  local allowed = {}
  for _, tile in ipairs(riichi_discards(state, actor_id)) do allowed[tile] = true end
  if not allowed[action.tileId] then return rejected("riichi_not_allowed") end
  state.scores[seat], state.riichiSticks = state.scores[seat] - 1000, state.riichiSticks + 1
  state.riichi[actor_id], state.ippatsu[actor_id] = true, true
  state.doubleRiichi[actor_id] = state.firstTurn[actor_id] and not state.callOccurred
  return perform_discard(state, action.tileId, actor_id, seat, true)
end

local function apply_discard(state, action, actor_id, seat)
  if state.phase ~= "playing" then return rejected("claim_response_required") end
  if seat ~= state.turnIndex then return rejected("not_your_turn") end
  if action.type ~= "discard" or type(action.tileId) ~= "number" then return rejected("invalid_discard") end
  return perform_discard(state, action.tileId, actor_id, seat, false)
end

local function apply_claim_response(state, action, actor_id)
  if state.phase ~= "claiming" then return rejected("not_claiming") end
  local claimant = state.claimants[state.claimIndex]
  if not claimant or claimant.playerId ~= actor_id then return rejected("not_your_response") end
  local option = 0
  if action.type == "claim" then
    option = tonumber(action.option) or 0
    if option % 1 ~= 0 or option < 1 or option > #claimant.options then return rejected("invalid_claim") end
  elseif action.type ~= "pass" then return rejected("claim_response_required") end
  if option == 0 then
    local passed_ron = false
    for _, candidate in ipairs(claimant.options) do if candidate.kind == "ron" then passed_ron = true end end
    if passed_ron then
      if state.riichi[actor_id] then state.riichiFuriten[actor_id] = true else state.tempFuriten[actor_id] = true end
    end
  end
  state.claimResponses[#state.claimResponses + 1] = { claimant = state.claimIndex, option = option }
  local events = { { type = option == 0 and "claim_passed" or "claim_declared",
    player = actor_id, playerIndex = claimant.playerIndex } }
  state.claimIndex = state.claimIndex + 1
  if state.claimIndex > #state.claimants then resolve_claims(state, events) end
  return accepted(state, events)
end

local function apply_tsumo(state, actor_id, seat)
  if state.phase ~= "playing" or state.turnIndex ~= seat then return rejected("not_your_turn") end
  if state.drawnTile == 0 then return rejected("draw_required") end
  if not settle_win(state, seat, "tsumo", 0, state.drawnTile) then return rejected("no_yaku") end
  return accepted(state, { { type = "won", method = "tsumo", player = actor_id,
    playerIndex = seat, tile = state.winningTile } })
end

local function can_abort_nine(state, player_id)
  if not state.rules.abortiveDraws or state.callOccurred or not state.firstTurn[player_id] or state.drawnTile == 0 then return false end
  local distinct = {}
  for _, tile in ipairs(hand_with_drawn(state, player_id)) do
    local kind = tile_type(tile)
    if is_outside(kind) then distinct[kind] = true end
  end
  local count = 0 for _ in pairs(distinct) do count = count + 1 end
  return count >= 9
end

local function apply_abort_nine(state, actor_id, seat)
  if state.phase ~= "playing" or state.turnIndex ~= seat or not can_abort_nine(state, actor_id) then
    return rejected("nine_terminals_not_allowed")
  end
  finish_abortive_draw(state, "九种九牌", seat)
  return accepted(state, { { type = "abortive_draw", reason = "九种九牌", player = actor_id, playerIndex = seat } })
end

local function visible_melds(state)
  local result = {}
  for _, player_id in ipairs(state.players) do
    result[player_id] = {}
    for _, meld in ipairs(state.melds[player_id]) do
      local tiles, red = {}, {}
      local called_tile_index, added_tile_index = -1, -1
      for index, tile in ipairs(meld.tiles) do
        tiles[#tiles + 1], red[#red + 1] = tile_type(tile), RED_FIVES[tile] == true
        if tile == meld.calledTile then called_tile_index = index - 1 end
        if tile == meld.addedTile then added_tile_index = index - 1 end
      end
      result[player_id][#result[player_id] + 1] = {
        kind = meld.kind, tiles = tiles, red = red, fromIndex = meld.fromIndex,
        calledTileIndex = called_tile_index, addedTileIndex = added_tile_index,
      }
    end
  end
  return result
end

local function visible_discards(state)
  local result = {}
  for _, player_id in ipairs(state.players) do
    result[player_id] = {}
    for _, discard in ipairs(state.discards[player_id]) do
      result[player_id][#result[player_id] + 1] = { type = tile_type(discard.tile),
        red = RED_FIVES[discard.tile] == true,
        claimed = discard.claimed == true, riichi = discard.riichi == true }
    end
  end
  return result
end

local function visible_events(events, viewer_id)
  local result = {}
  for _, event in ipairs(events or {}) do
    local copy = {}
    for key, value in pairs(event) do
      if key ~= "tile" or event.type ~= "drew" or event.player == viewer_id then
        copy[key] = key == "tile" and tile_type(value) or value
      end
    end
    result[#result + 1] = copy
  end
  return result
end

local function legal_actions(state, viewer_id)
  local seat = player_index(state, viewer_id)
  local legal = { canDiscard = false, canTsumo = false, canRiichi = false,
    canAbortNine = false, riichiTiles = {}, selfKans = {}, claims = {},
    forbiddenDiscardTypes = {} }
  if not seat or state.phase == "hand_ended" then return legal end
  if state.phase == "playing" and state.turnIndex == seat then
    legal.canDiscard = true
    for kind in pairs(state.kuikaeForbidden and state.kuikaeForbidden[viewer_id] or {}) do
      legal.forbiddenDiscardTypes[#legal.forbiddenDiscardTypes + 1] = kind
    end
    table.sort(legal.forbiddenDiscardTypes)
    legal.canTsumo = state.drawnTile > 0 and score_hand(state, seat, state.drawnTile, "tsumo") ~= nil
    legal.riichiTiles = riichi_discards(state, viewer_id)
    legal.canRiichi = #legal.riichiTiles > 0
    legal.canAbortNine = can_abort_nine(state, viewer_id)
    legal.selfKans = self_kan_options(state, viewer_id)
  elseif state.phase == "claiming" then
    local claimant = state.claimants[state.claimIndex]
    if claimant and claimant.playerId == viewer_id then
      for index, option in ipairs(claimant.options) do
        local types, red = {}, {}
        for _, tile in ipairs(option.tileIds) do
          types[#types + 1], red[#red + 1] = tile_type(tile), RED_FIVES[tile] == true
        end
        legal.claims[#legal.claims + 1] = {
          option = index, kind = option.kind, tileTypes = types, red = red,
        }
      end
    end
  end
  return legal
end

local function hand_value_after_discard(hand, discard_index)
  local counts = {} for kind = 1, 34 do counts[kind] = 0 end
  for index, tile in ipairs(hand) do if index ~= discard_index then counts[tile_type(tile)] = counts[tile_type(tile)] + 1 end end
  local score = 0
  for kind = 1, 34 do
    local count = counts[kind]
    if count >= 2 then score = score + 4 end if count >= 3 then score = score + 7 end
    if kind <= 27 and count > 0 then
      local rank = ((kind - 1) % 9) + 1
      if rank < 9 and counts[kind + 1] > 0 then score = score + 3 end
      if rank < 8 and counts[kind + 2] > 0 then score = score + 1 end
    end
  end
  return score
end

local function choose_discard(hand, allowed, forbidden)
  local best_index, best_score, best_throw = nil, -1, -1
  local allow = nil
  if allowed and #allowed > 0 then allow = {} for _, tile in ipairs(allowed) do allow[tile] = true end end
  for index, tile in ipairs(hand) do
    if (not allow or allow[tile]) and not (forbidden and forbidden[tile_type(tile)]) then
      local kind, score = tile_type(tile), hand_value_after_discard(hand, index)
      local rank = kind <= 27 and (((kind - 1) % 9) + 1) or 0
      local throw = kind >= 28 and 3 or (rank == 1 or rank == 9) and 2 or 1
      if score > best_score or (score == best_score and throw > best_throw) then
        best_index, best_score, best_throw = index, score, throw
      end
    end
  end
  return best_index and hand[best_index] or nil
end

function setup(context)
  local players, names = setup_players(context)
  if #players ~= PLAYER_COUNT then error("Mahjong requires exactly four players") end
  local settings = context.match and context.match.settings or {}
  return new_match(players, names, context.match.randomSeed, settings)
end

function view(state, events, context)
  local viewer_id, own_hand = context.viewer.id, {}
  for _, tile in ipairs(state.hands[viewer_id] or {}) do own_hand[#own_hand + 1] = tile end
  local hand_counts, revealed = {}, {}
  for _, player_id in ipairs(state.players) do
    hand_counts[player_id] = #(state.hands[player_id] or {})
    if state.phase == "hand_ended" then
      revealed[player_id] = {}
      for _, tile in ipairs(state.hands[player_id]) do
        revealed[player_id][#revealed[player_id] + 1] = {
          type = tile_type(tile), red = RED_FIVES[tile] == true,
        }
      end
    end
  end
  local response_index = 0
  if state.phase == "claiming" and state.claimants[state.claimIndex] then response_index = state.claimants[state.claimIndex].playerIndex end
  local indicators = {} for _, kind in ipairs(indicator_types(state, false)) do indicators[#indicators + 1] = kind end
  local indicator_tiles = visible_indicator_tiles(state)
  return { state = {
    players = state.players, playerNames = state.playerNames, matchType = state.matchType,
    roundWind = state.roundWind, handNumber = state.handNumber, dealerIndex = state.dealerIndex,
    honba = state.honba, riichiSticks = state.riichiSticks, scores = state.scores,
    turnIndex = state.turnIndex, responseIndex = response_index, phase = state.phase,
    drawnPlayerIndex = state.drawnTile > 0 and state.turnIndex or 0,
    wallCount = #state.wall, doraIndicators = indicators, doraIndicatorTiles = indicator_tiles,
    ownHand = own_hand,
    handCounts = hand_counts, discards = visible_discards(state), melds = visible_melds(state),
    legalActions = legal_actions(state, viewer_id),
    drawnTile = state.turnIndex == player_index(state, viewer_id) and state.drawnTile or 0,
    riichi = state.riichi, furiten = is_furiten(state, viewer_id), winner = state.winner,
    winnerIndex = state.winnerIndex, winType = state.winType,
    winningTile = state.winningTile > 0 and tile_type(state.winningTile) or 0,
    winningTileRed = RED_FIVES[state.winningTile] == true,
    draw = state.draw, moveCount = state.moveCount, result = state.result,
    results = state.results, winners = state.winners, abortiveReason = state.abortiveReason,
    abortivePlayerIndex = tonumber(state.abortivePlayerIndex) or 0,
    abortiveTile = (tonumber(state.abortiveTile) or 0) > 0 and tile_type(state.abortiveTile) or 0,
    abortiveTileRed = RED_FIVES[state.abortiveTile] == true,
    matchEnded = state.matchEnded, endReason = state.endReason, rules = state.rules,
    revealedHands = revealed,
  }, events = visible_events(events, viewer_id) }
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected("invalid_action") end
  local actor_id, seat = context.actor.id, player_index(state, context.actor.id)
  if not seat then return rejected("not_a_player") end
  if action.type == "next_hand" then
    if state.phase ~= "hand_ended" or state.matchEnded then return rejected("next_hand_not_available") end
    state.dealerIndex, state.handNumber = state.nextDealerIndex, state.nextHandNumber
    state.roundWind, state.honba = state.nextRoundWind, state.nextHonba
    deal(state)
    return accepted(state, { { type = "next_hand", player = actor_id, playerIndex = seat } })
  end
  if action.type == "new_match" then
    if state.phase ~= "hand_ended" then return rejected("game_not_over") end
    return accepted(new_match(state.players, state.playerNames, state.seed, {
      matchType = state.matchType, rules = state.rules,
    }),
      { { type = "new_match", player = actor_id, playerIndex = seat } })
  end
  if state.phase == "hand_ended" then return rejected("game_over") end
  if state.phase == "claiming" then return apply_claim_response(state, action, actor_id) end
  if action.type == "tsumo" then return apply_tsumo(state, actor_id, seat) end
  if action.type == "abort_nine" then return apply_abort_nine(state, actor_id, seat) end
  if action.type == "kan" then return apply_self_kan(state, action, actor_id, seat) end
  if action.type == "riichi" and type(action.tileId) == "number" then return apply_riichi(state, action, actor_id, seat) end
  return apply_discard(state, action, actor_id, seat)
end

function ai_action(state, actor_id)
  local seat = player_index(state, actor_id)
  if not seat or state.phase == "hand_ended" then return nil end
  if state.phase == "claiming" then
    local claimant = state.claimants[state.claimIndex]
    if not claimant or claimant.playerId ~= actor_id then return nil end
    for index, option in ipairs(claimant.options) do if option.kind == "ron" then return { type = "claim", option = index } end end
    for index, option in ipairs(claimant.options) do
      if option.kind == "kan" then return { type = "claim", option = index } end
      if option.kind == "pon" and (tile_type(state.lastDiscard.tile) >= 28 or (#state.wall + seat) % 3 == 0) then
        return { type = "claim", option = index }
      end
    end
    return { type = "pass" }
  end
  if state.phase ~= "playing" or state.turnIndex ~= seat then return nil end
  if state.drawnTile > 0 and score_hand(state, seat, state.drawnTile, "tsumo") then return { type = "tsumo" } end
  if can_abort_nine(state, actor_id) then return { type = "abort_nine" } end
  local kans = self_kan_options(state, actor_id)
  if #kans > 0 and (#state.wall + seat) % 3 == 0 then
    return { type = "kan", kind = kans[1].kind, tileType = kans[1].tileType }
  end
  if state.riichi[actor_id] then return { type = "discard", tileId = state.drawnTile } end
  local riichi_tiles = riichi_discards(state, actor_id)
  local concealed = hand_with_drawn(state, actor_id)
  if #riichi_tiles > 0 then return { type = "riichi", tileId = choose_discard(concealed, riichi_tiles) } end
  return { type = "discard", tileId = choose_discard(
    concealed, nil, state.kuikaeForbidden and state.kuikaeForbidden[actor_id]
  ) }
end

function on_player_left(state, context)
  return { state = state, events = { { type = "player_left", player = context.actor.id } } }
end

function on_return_to_room(state, context) return true end
