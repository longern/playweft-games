local DEFAULT_SIZE = 9
local DEFAULT_KOMI = 6.5
local DIRECTIONS = { { -1, 0 }, { 1, 0 }, { 0, -1 }, { 0, 1 } }

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

local function point_key(row, column)
  return row .. ":" .. column
end

local function inside(board, row, column)
  local size = #board
  return row >= 1 and row <= size and column >= 1 and column <= size
end

local function empty_board(size)
  local board = {}
  for row = 1, size do
    board[row] = {}
    for column = 1, size do board[row][column] = 0 end
  end
  return board
end

local function copy_board(board)
  local copy = {}
  for row = 1, #board do
    copy[row] = {}
    for column = 1, #board do copy[row][column] = board[row][column] end
  end
  return copy
end

local function board_signature(board)
  local parts = {}
  for row = 1, #board do
    for column = 1, #board do
      parts[#parts + 1] = tostring(board[row][column])
    end
  end
  return table.concat(parts)
end

local function collect_group(board, start_row, start_column)
  local color = board[start_row][start_column]
  local group, liberties = {}, {}
  local visited = { [point_key(start_row, start_column)] = true }
  local stack = { { row = start_row, column = start_column } }

  while #stack > 0 do
    local point = table.remove(stack)
    group[#group + 1] = point
    for _, direction in ipairs(DIRECTIONS) do
      local row = point.row + direction[1]
      local column = point.column + direction[2]
      if inside(board, row, column) then
        local value = board[row][column]
        local key = point_key(row, column)
        if value == 0 then
          liberties[key] = true
        elseif value == color and not visited[key] then
          visited[key] = true
          stack[#stack + 1] = { row = row, column = column }
        end
      end
    end
  end

  local liberty_count = 0
  for _ in pairs(liberties) do liberty_count = liberty_count + 1 end
  return group, liberty_count
end

local function remove_group(board, group)
  for _, point in ipairs(group) do board[point.row][point.column] = 0 end
end

local function color_for_player(state, index)
  return index == state.blackIndex and 1 or 2
end

local function next_seed(seed)
  return (math.floor(math.abs(seed or 1)) * 48271) % 2147483647
end

local function normalized_settings(action)
  local size = tonumber(action.size)
  local rules = action.rules
  local komi = tonumber(action.komi)
  local handicap = tonumber(action.handicap)
  local black_mode = action.blackMode

  if size ~= 9 and size ~= 13 and size ~= 19 then return nil, "invalid_size" end
  if rules ~= "chinese" and rules ~= "japanese" then return nil, "invalid_rules" end
  if not komi or komi ~= komi or komi < 0 or komi > 20 then
    return nil, "invalid_komi"
  end
  if handicap ~= 0 and (not handicap or handicap % 1 ~= 0 or handicap < 2 or handicap > 9) then
    return nil, "invalid_handicap"
  end
  if black_mode ~= "random" and black_mode ~= "player1" and black_mode ~= "player2" then
    return nil, "invalid_black_mode"
  end
  if handicap > 0 and black_mode == "random" then
    return nil, "handicap_requires_fixed_black"
  end

  return {
    size = size,
    rules = rules,
    komi = komi,
    handicap = handicap,
    blackMode = black_mode,
  }
end

local function choose_black(settings, seed)
  if settings.blackMode == "player1" then return 1, seed end
  if settings.blackMode == "player2" then return 2, seed end
  local updated_seed = next_seed(seed)
  return (updated_seed % 2) + 1, updated_seed
end

local function handicap_points(size)
  local low = size == 9 and 3 or 4
  local high = size - low + 1
  local center = (size + 1) / 2
  return {
    { low, high },
    { high, low },
    { high, high },
    { low, low },
    { center, center },
    { low, center },
    { high, center },
    { center, low },
    { center, high },
  }
end

local function place_handicap(board, count)
  if count <= 0 then return end
  local points = handicap_points(#board)
  local indexes
  if count <= 4 then
    indexes = {}
    for index = 1, count do indexes[#indexes + 1] = index end
  elseif count == 5 then
    indexes = { 1, 2, 3, 4, 5 }
  elseif count == 6 then
    indexes = { 1, 2, 3, 4, 6, 7 }
  elseif count == 7 then
    indexes = { 1, 2, 3, 4, 6, 7, 5 }
  elseif count == 8 then
    indexes = { 1, 2, 3, 4, 6, 7, 8, 9 }
  else
    indexes = { 1, 2, 3, 4, 6, 7, 8, 9, 5 }
  end
  for _, index in ipairs(indexes) do
    local point = points[index]
    board[point[1]][point[2]] = 1
  end
end

local function score_board(state)
  local board = state.board
  local black_stones, white_stones = 0, 0
  local black_territory, white_territory, neutral = 0, 0, 0
  local visited = {}

  for row = 1, #board do
    for column = 1, #board do
      local value = board[row][column]
      if value == 1 then
        black_stones = black_stones + 1
      elseif value == 2 then
        white_stones = white_stones + 1
      elseif not visited[point_key(row, column)] then
        local region, borders = {}, {}
        local stack = { { row = row, column = column } }
        visited[point_key(row, column)] = true

        while #stack > 0 do
          local point = table.remove(stack)
          region[#region + 1] = point
          for _, direction in ipairs(DIRECTIONS) do
            local next_row = point.row + direction[1]
            local next_column = point.column + direction[2]
            if inside(board, next_row, next_column) then
              local neighbor = board[next_row][next_column]
              local key = point_key(next_row, next_column)
              if neighbor == 0 and not visited[key] then
                visited[key] = true
                stack[#stack + 1] = { row = next_row, column = next_column }
              elseif neighbor ~= 0 then
                borders[neighbor] = true
              end
            end
          end
        end

        if borders[1] and not borders[2] then
          black_territory = black_territory + #region
        elseif borders[2] and not borders[1] then
          white_territory = white_territory + #region
        else
          neutral = neutral + #region
        end
      end
    end
  end

  local black, white
  if state.settings.rules == "japanese" then
    local white_index = (state.blackIndex % #state.players) + 1
    black = black_territory + (state.captures[state.blackIndex] or 0)
    white = white_territory + (state.captures[white_index] or 0) + state.settings.komi
  else
    black = black_stones + black_territory
    white = white_stones + white_territory + state.settings.komi
  end

  return {
    black = black,
    white = white,
    blackStones = black_stones,
    whiteStones = white_stones,
    blackTerritory = black_territory,
    whiteTerritory = white_territory,
    neutral = neutral,
    komi = state.settings.komi,
    rules = state.settings.rules,
  }
end

local function new_round(players, round, settings, seed, host_id)
  local black_index, updated_seed = choose_black(settings, seed)
  local board = empty_board(settings.size)
  place_handicap(board, settings.handicap)
  local white_index = (black_index % #players) + 1
  return {
    players = players,
    hostId = host_id,
    phase = "playing",
    settings = settings,
    board = board,
    current = settings.handicap > 0 and white_index or black_index,
    blackIndex = black_index,
    captures = { 0, 0 },
    consecutivePasses = 0,
    moves = 0,
    ended = false,
    winner = "",
    winnerIndex = 0,
    scores = {
      black = 0,
      white = 0,
      blackStones = settings.handicap,
      whiteStones = 0,
      blackTerritory = 0,
      whiteTerritory = 0,
      neutral = 0,
      komi = settings.komi,
      rules = settings.rules,
    },
    previousBoard = "",
    lastMove = { row = 0, column = 0 },
    lastEvent = {
      kind = settings.handicap > 0 and "handicap" or "start",
      playerIndex = black_index,
      captured = 0,
    },
    round = round,
    seed = updated_seed,
  }
end

local function setup_state(players, round, settings, seed, host_id)
  return {
    players = players,
    hostId = host_id,
    phase = "setup",
    settings = settings,
    board = empty_board(settings.size),
    current = 0,
    blackIndex = 1,
    captures = { 0, 0 },
    consecutivePasses = 0,
    moves = 0,
    ended = false,
    winner = "",
    winnerIndex = 0,
    scores = {
      black = 0,
      white = 0,
      komi = settings.komi,
      rules = settings.rules,
    },
    previousBoard = "",
    lastMove = { row = 0, column = 0 },
    lastEvent = { kind = "setup", playerIndex = 1, captured = 0 },
    round = round,
    seed = seed,
  }
end

function setup(context)
  local players = setup_players(context)
  local settings = {
    size = DEFAULT_SIZE,
    rules = "chinese",
    komi = DEFAULT_KOMI,
    handicap = 0,
    blackMode = "random",
  }
  return setup_state(
    players,
    1,
    settings,
    math.floor(math.abs(context.match.randomSeed or 1)),
    context.match.ownerId
  )
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected(state, "invalid_action") end
  local actor_id = context.actor.id
  local index = player_index(state, actor_id)
  if not index then return rejected(state, "not_a_player") end

  if state.phase == "setup" then
    if actor_id ~= state.hostId then return rejected(state, "only_host_can_setup") end
    if action.type == "update_settings" then
      local settings, reason = normalized_settings(action)
      if not settings then return rejected(state, reason) end
      local next_state = setup_state(
        state.players,
        state.round or 1,
        settings,
        state.seed,
        state.hostId
      )
      return {
        accepted = true,
        state = next_state,
        events = { { type = "settings_updated", player = actor_id } },
      }
    end
    if action.type ~= "start" then return rejected(state, "setup_required") end
    local settings, reason = normalized_settings(action)
    if not settings then return rejected(state, reason) end
    local next_state = new_round(
      state.players,
      state.round or 1,
      settings,
      state.seed,
      state.hostId
    )
    return {
      accepted = true,
      state = next_state,
      events = { { type = "started", player = actor_id } },
    }
  end

  if action.type == "rematch" then
    if not state.ended then return rejected(state, "game_not_over") end
    local next_state = new_round(
      state.players,
      (state.round or 1) + 1,
      state.settings,
      state.seed,
      state.hostId
    )
    return {
      accepted = true,
      state = next_state,
      events = { { type = "rematched", player = actor_id } },
    }
  end

  if action.type == "configure" then
    if not state.ended then return rejected(state, "game_not_over") end
    local next_state = setup_state(
      state.players,
      (state.round or 1) + 1,
      state.settings,
      state.seed,
      state.hostId
    )
    return {
      accepted = true,
      state = next_state,
      events = { { type = "configuration_opened", player = actor_id } },
    }
  end

  if state.ended then return rejected(state, "game_over") end
  if index ~= state.current then return rejected(state, "not_your_turn") end

  if action.type == "pass" then
    state.consecutivePasses = state.consecutivePasses + 1
    state.lastMove = { row = 0, column = 0 }
    state.lastEvent = { kind = "pass", playerIndex = index, captured = 0 }
    if state.consecutivePasses >= 2 then
      state.ended = true
      state.scores = score_board(state)
      if state.scores.black > state.scores.white then
        state.winnerIndex = state.blackIndex
      else
        state.winnerIndex = (state.blackIndex % #state.players) + 1
      end
      state.winner = state.players[state.winnerIndex]
      state.lastEvent = { kind = "scored", playerIndex = index, captured = 0 }
      return {
        accepted = true,
        state = state,
        events = { { type = "scored", winner = state.winner } },
      }
    end
    state.previousBoard = board_signature(state.board)
    state.current = (state.current % #state.players) + 1
    return {
      accepted = true,
      state = state,
      events = { { type = "passed", player = actor_id } },
    }
  end

  if action.type ~= "play" then return rejected(state, "invalid_action") end
  if type(action.row) ~= "number" or action.row % 1 ~= 0
    or type(action.column) ~= "number" or action.column % 1 ~= 0
    or not inside(state.board, action.row, action.column) then
    return rejected(state, "invalid_point")
  end
  if state.board[action.row][action.column] ~= 0 then
    return rejected(state, "occupied")
  end

  local color = color_for_player(state, index)
  local opponent = color == 1 and 2 or 1
  local candidate = copy_board(state.board)
  candidate[action.row][action.column] = color
  local captured = 0
  local checked = {}

  for _, direction in ipairs(DIRECTIONS) do
    local row = action.row + direction[1]
    local column = action.column + direction[2]
    local key = point_key(row, column)
    if inside(candidate, row, column)
      and candidate[row][column] == opponent and not checked[key] then
      local group, liberties = collect_group(candidate, row, column)
      for _, point in ipairs(group) do checked[point_key(point.row, point.column)] = true end
      if liberties == 0 then
        captured = captured + #group
        remove_group(candidate, group)
      end
    end
  end

  local _, own_liberties = collect_group(candidate, action.row, action.column)
  if own_liberties == 0 then return rejected(state, "suicide") end

  local signature = board_signature(candidate)
  if state.previousBoard ~= "" and signature == state.previousBoard then
    return rejected(state, "ko")
  end

  state.previousBoard = board_signature(state.board)
  state.board = candidate
  state.captures[index] = (state.captures[index] or 0) + captured
  state.consecutivePasses = 0
  state.moves = state.moves + 1
  state.lastMove = { row = action.row, column = action.column }
  state.lastEvent = { kind = "play", playerIndex = index, captured = captured }
  state.current = (state.current % #state.players) + 1

  return {
    accepted = true,
    state = state,
    events = {
      {
        type = "played",
        player = actor_id,
        row = action.row,
        column = action.column,
        captured = captured,
      },
    },
  }
end

function on_player_left(state, context)
  local actor_id = context.actor.id
  local leaving_index = player_index(state, actor_id)
  if not leaving_index or state.ended or state.phase == "setup" then
    return { state = state, events = {} }
  end
  state.ended = true
  state.winnerIndex = (leaving_index % #state.players) + 1
  state.winner = state.players[state.winnerIndex]
  state.lastEvent = { kind = "player_left", playerIndex = leaving_index, captured = 0 }
  return {
    state = state,
    events = { { type = "player_left", player = actor_id } },
  }
end

function view(state, events, context)
  local visible = {}
  for key, value in pairs(state) do
    if key ~= "seed" then visible[key] = value end
  end
  return { state = visible, events = events }
end

function on_return_to_room(state, context)
  return true
end
