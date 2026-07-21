local ROWS = 6
local COLUMNS = 7

local function player_index(state, player_id)
  for index, id in ipairs(state.players) do
    if id == player_id then return index end
  end
  return nil
end

local function rejected(state, reason)
  return { state = state, events = { { type = "rejected", reason = reason } } }
end

local function inside(row, column)
  return row >= 1 and row <= ROWS and column >= 1 and column <= COLUMNS
end

local function winning_line(board, row, column, piece)
  local directions = { { 0, 1 }, { 1, 0 }, { 1, 1 }, { 1, -1 } }
  for _, direction in ipairs(directions) do
    local row_step, column_step = direction[1], direction[2]
    local start_row, start_column = row, column
    while inside(start_row - row_step, start_column - column_step)
      and board[start_row - row_step][start_column - column_step] == piece do
      start_row = start_row - row_step
      start_column = start_column - column_step
    end

    local cells = {}
    local check_row, check_column = start_row, start_column
    while inside(check_row, check_column) and board[check_row][check_column] == piece do
      table.insert(cells, { row = check_row, column = check_column })
      check_row = check_row + row_step
      check_column = check_column + column_step
    end
    if #cells >= 4 then return cells end
  end
  return nil
end

function setup(context)
  local board = {}
  for row = 1, ROWS do
    board[row] = {}
    for column = 1, COLUMNS do board[row][column] = 0 end
  end
  return {
    players = context.players,
    board = board,
    current = 1,
    moves = 0,
    winner = "",
    winnerIndex = 0,
    draw = false,
    lastMove = { row = 0, column = 0 },
    winningCells = {},
  }
end

function on_action(state, action, context)
  if type(action) ~= "table" or action.type ~= "drop" then
    return rejected(state, "invalid_action")
  end
  local index = player_index(state, context.playerId)
  if not index then return rejected(state, "not_a_player") end
  if state.winner ~= "" or state.draw then return rejected(state, "game_over") end
  if index ~= state.current then return rejected(state, "not_your_turn") end
  if type(action.column) ~= "number" or action.column % 1 ~= 0
    or action.column < 1 or action.column > COLUMNS then
    return rejected(state, "invalid_column")
  end

  local landing_row = nil
  for row = ROWS, 1, -1 do
    if state.board[row][action.column] == 0 then
      landing_row = row
      break
    end
  end
  if not landing_row then return rejected(state, "column_full") end

  state.board[landing_row][action.column] = index
  state.moves = state.moves + 1
  state.lastMove = { row = landing_row, column = action.column }
  local line = winning_line(state.board, landing_row, action.column, index)
  if line then
    state.winner = context.playerId
    state.winnerIndex = index
    state.winningCells = line
    return { state = state, events = { { type = "won", player = context.playerId } } }
  end
  if state.moves == ROWS * COLUMNS then
    state.draw = true
    return { state = state, events = { { type = "draw" } } }
  end

  state.current = (state.current % #state.players) + 1
  return {
    state = state,
    events = { { type = "dropped", player = context.playerId, row = landing_row, column = action.column } },
  }
end

function on_player_left(state, context)
  local leaving_index = player_index(state, context.playerId)
  if not leaving_index or state.winner ~= "" or state.draw then
    return { state = state, events = {} }
  end
  state.winnerIndex = leaving_index == 1 and 2 or 1
  state.winner = state.players[state.winnerIndex]
  return { state = state, events = { { type = "player_left", player = context.playerId } } }
end

function on_return_to_room(state, context)
  return true
end
