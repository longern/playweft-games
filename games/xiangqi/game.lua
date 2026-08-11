local ROWS = 10
local COLUMNS = 9
local DRAW_LIMIT = 120

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

local function rejected(reason)
  return {
    accepted = false,
    error = {
      code = string.upper(reason),
      message = string.gsub(reason, "_", " "),
    },
  }
end

local function inside(row, column)
  return row >= 1 and row <= ROWS and column >= 1 and column <= COLUMNS
end

local function piece_color(piece)
  if type(piece) ~= "string" or piece == "" then return nil end
  return string.sub(piece, 1, 1)
end

local function piece_kind(piece)
  if type(piece) ~= "string" or piece == "" then return nil end
  return string.sub(piece, 2, 2)
end

local function empty_board()
  local board = {}
  for row = 1, ROWS do
    board[row] = {}
    for column = 1, COLUMNS do board[row][column] = "" end
  end
  return board
end

local function initial_board()
  local board = empty_board()
  local back_rank = { "R", "N", "E", "A", "K", "A", "E", "N", "R" }
  for column, kind in ipairs(back_rank) do
    board[1][column] = "b" .. kind
    board[10][column] = "r" .. kind
  end
  board[3][2], board[3][8] = "bC", "bC"
  board[8][2], board[8][8] = "rC", "rC"
  for column = 1, COLUMNS, 2 do
    board[4][column] = "bP"
    board[7][column] = "rP"
  end
  return board
end

local function in_palace(color, row, column)
  if column < 4 or column > 6 then return false end
  if color == "b" then return row >= 1 and row <= 3 end
  return row >= 8 and row <= 10
end

local function clear_between(board, from_row, from_column, to_row, to_column)
  local row_step = to_row == from_row and 0 or (to_row > from_row and 1 or -1)
  local column_step = to_column == from_column and 0
    or (to_column > from_column and 1 or -1)
  local row, column = from_row + row_step, from_column + column_step
  local count = 0
  while row ~= to_row or column ~= to_column do
    if board[row][column] ~= "" then count = count + 1 end
    row, column = row + row_step, column + column_step
  end
  return count
end

local function raw_move_allowed(board, from_row, from_column, to_row, to_column)
  if not inside(from_row, from_column) or not inside(to_row, to_column) then
    return false
  end
  if from_row == to_row and from_column == to_column then return false end

  local piece = board[from_row][from_column]
  local color, kind = piece_color(piece), piece_kind(piece)
  if not color then return false end
  local target = board[to_row][to_column]
  if piece_color(target) == color then return false end

  local row_delta = to_row - from_row
  local column_delta = to_column - from_column
  local abs_row, abs_column = math.abs(row_delta), math.abs(column_delta)

  if kind == "R" then
    return (row_delta == 0 or column_delta == 0)
      and clear_between(board, from_row, from_column, to_row, to_column) == 0
  end

  if kind == "C" then
    if row_delta ~= 0 and column_delta ~= 0 then return false end
    local screens = clear_between(board, from_row, from_column, to_row, to_column)
    if target == "" then return screens == 0 end
    return screens == 1
  end

  if kind == "N" then
    if not ((abs_row == 2 and abs_column == 1)
      or (abs_row == 1 and abs_column == 2)) then
      return false
    end
    local leg_row = from_row + (abs_row == 2 and row_delta / 2 or 0)
    local leg_column = from_column + (abs_column == 2 and column_delta / 2 or 0)
    return board[leg_row][leg_column] == ""
  end

  if kind == "E" then
    if abs_row ~= 2 or abs_column ~= 2 then return false end
    if color == "b" and to_row > 5 then return false end
    if color == "r" and to_row < 6 then return false end
    return board[from_row + row_delta / 2][from_column + column_delta / 2] == ""
  end

  if kind == "A" then
    return abs_row == 1 and abs_column == 1
      and in_palace(color, to_row, to_column)
  end

  if kind == "K" then
    if column_delta == 0 and target ~= "" and piece_kind(target) == "K" then
      return clear_between(board, from_row, from_column, to_row, to_column) == 0
    end
    return abs_row + abs_column == 1
      and in_palace(color, to_row, to_column)
  end

  if kind == "P" then
    local forward = color == "r" and -1 or 1
    if row_delta == forward and column_delta == 0 then return true end
    local crossed = (color == "r" and from_row <= 5)
      or (color == "b" and from_row >= 6)
    return crossed and row_delta == 0 and abs_column == 1
  end

  return false
end

local function find_general(board, color)
  for row = 1, ROWS do
    for column = 1, COLUMNS do
      if board[row][column] == color .. "K" then return row, column end
    end
  end
  return nil, nil
end

local function is_square_attacked(board, row, column, attacker_color)
  for from_row = 1, ROWS do
    for from_column = 1, COLUMNS do
      if piece_color(board[from_row][from_column]) == attacker_color
        and raw_move_allowed(board, from_row, from_column, row, column) then
        return true
      end
    end
  end
  return false
end

local function is_in_check(board, color)
  local row, column = find_general(board, color)
  if not row then return true end
  local enemy = color == "r" and "b" or "r"
  return is_square_attacked(board, row, column, enemy)
end

local function move_is_legal(board, color, from_row, from_column, to_row, to_column)
  if piece_color(board[from_row][from_column]) ~= color then return false end
  if not raw_move_allowed(board, from_row, from_column, to_row, to_column) then
    return false
  end
  local moving, captured = board[from_row][from_column], board[to_row][to_column]
  board[to_row][to_column], board[from_row][from_column] = moving, ""
  local legal = not is_in_check(board, color)
  board[from_row][from_column], board[to_row][to_column] = moving, captured
  return legal
end

local function legal_moves(board, color)
  local moves = {}
  for from_row = 1, ROWS do
    for from_column = 1, COLUMNS do
      if piece_color(board[from_row][from_column]) == color then
        for to_row = 1, ROWS do
          for to_column = 1, COLUMNS do
            if move_is_legal(
              board,
              color,
              from_row,
              from_column,
              to_row,
              to_column
            ) then
              moves[#moves + 1] = {
                fromRow = from_row,
                fromColumn = from_column,
                toRow = to_row,
                toColumn = to_column,
              }
            end
          end
        end
      end
    end
  end
  return moves
end

local function color_for_player(state, index)
  if index == state.redIndex then return "r" end
  return "b"
end

local function new_round(players, round, red_index)
  local board = initial_board()
  return {
    players = players,
    board = board,
    current = red_index,
    redIndex = red_index,
    moves = 0,
    noCaptureMoves = 0,
    winner = "",
    winnerIndex = 0,
    draw = false,
    endReason = "",
    inCheck = false,
    lastMove = { fromRow = 0, fromColumn = 0, toRow = 0, toColumn = 0 },
    legalMoves = legal_moves(board, "r"),
    round = round,
  }
end

function setup(context)
  return new_round(setup_players(context), 1, 1)
end

function view(state, events, context)
  return { state = state, events = events }
end

function on_action(state, action, context)
  if type(action) ~= "table" then return rejected("invalid_action") end
  local actor_id = context.actor.id
  local index = player_index(state, actor_id)
  if not index then return rejected("not_a_player") end

  if action.type == "rematch" then
    if state.winner == "" and not state.draw then return rejected("game_not_over") end
    local red_index = state.redIndex == 1 and 2 or 1
    return {
      accepted = true,
      state = new_round(state.players, (state.round or 1) + 1, red_index),
      events = { { type = "rematched", player = actor_id } },
    }
  end

  if action.type ~= "move" then return rejected("invalid_action") end
  if state.winner ~= "" or state.draw then return rejected("game_over") end
  if index ~= state.current then return rejected("not_your_turn") end

  local coordinates = {
    action.fromRow,
    action.fromColumn,
    action.toRow,
    action.toColumn,
  }
  for _, value in ipairs(coordinates) do
    if type(value) ~= "number" or value % 1 ~= 0 then
      return rejected("invalid_coordinate")
    end
  end
  if not inside(action.fromRow, action.fromColumn)
    or not inside(action.toRow, action.toColumn) then
    return rejected("invalid_coordinate")
  end

  local color = color_for_player(state, index)
  if piece_color(state.board[action.fromRow][action.fromColumn]) ~= color then
    return rejected("not_your_piece")
  end
  if not move_is_legal(
    state.board,
    color,
    action.fromRow,
    action.fromColumn,
    action.toRow,
    action.toColumn
  ) then
    return rejected("illegal_move")
  end

  local captured = state.board[action.toRow][action.toColumn]
  state.board[action.toRow][action.toColumn] =
    state.board[action.fromRow][action.fromColumn]
  state.board[action.fromRow][action.fromColumn] = ""
  state.moves = (state.moves or 0) + 1
  state.noCaptureMoves = captured == "" and ((state.noCaptureMoves or 0) + 1) or 0
  state.lastMove = {
    fromRow = action.fromRow,
    fromColumn = action.fromColumn,
    toRow = action.toRow,
    toColumn = action.toColumn,
  }

  local opponent_index = index == 1 and 2 or 1
  local opponent_color = color == "r" and "b" or "r"
  if captured == opponent_color .. "K" then
    state.winner, state.winnerIndex = actor_id, index
    state.endReason, state.inCheck, state.legalMoves = "general_captured", true, {}
    return {
      accepted = true,
      state = state,
      events = { { type = "won", player = actor_id, reason = state.endReason } },
    }
  end

  state.current = opponent_index
  state.inCheck = is_in_check(state.board, opponent_color)
  state.legalMoves = legal_moves(state.board, opponent_color)
  if #state.legalMoves == 0 then
    state.winner, state.winnerIndex = actor_id, index
    state.endReason = state.inCheck and "checkmate" or "stalemate"
    return {
      accepted = true,
      state = state,
      events = { { type = "won", player = actor_id, reason = state.endReason } },
    }
  end

  if state.noCaptureMoves >= DRAW_LIMIT then
    state.draw, state.endReason, state.legalMoves = true, "no_capture_limit", {}
    return {
      accepted = true,
      state = state,
      events = { { type = "draw", reason = state.endReason } },
    }
  end

  return {
    accepted = true,
    state = state,
    events = {
      {
        type = captured == "" and "moved" or "captured",
        player = actor_id,
        captured = captured,
      },
    },
  }
end

function on_player_left(state, context)
  local actor_id = context.actor.id
  local leaving_index = player_index(state, actor_id)
  if not leaving_index or state.winner ~= "" or state.draw then
    return { state = state, events = {} }
  end
  state.winnerIndex = leaving_index == 1 and 2 or 1
  state.winner = state.players[state.winnerIndex]
  state.endReason = "player_left"
  state.legalMoves = {}
  return { state = state, events = { { type = "player_left", player = actor_id } } }
end

function on_return_to_room(state, context)
  return true
end
