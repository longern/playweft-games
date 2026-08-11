const ROWS = 10;
const COLUMNS = 9;
const DRAW_LIMIT = 120;

export function createSoloXiangqiState() {
  return newRound(1, 1);
}

export function applySoloXiangqiAction(sourceState, action) {
  const state = structuredClone(sourceState);
  if (!action || typeof action !== "object") return rejected("INVALID_ACTION");

  if (action.type === "rematch") {
    if (!state.winner && !state.draw) return rejected("GAME_NOT_OVER");
    return accepted(
      newRound((state.round ?? 1) + 1, state.redIndex === 1 ? 2 : 1),
      [{ type: "rematched", player: "solo-player-1" }],
    );
  }

  if (action.type !== "move") return rejected("INVALID_ACTION");
  if (state.winner || state.draw) return rejected("GAME_OVER");
  const coordinates = [
    action.fromRow,
    action.fromColumn,
    action.toRow,
    action.toColumn,
  ].map(Number);
  if (!coordinates.every(Number.isInteger)) return rejected("INVALID_COORDINATE");
  const [fromRow, fromColumn, toRow, toColumn] = coordinates;
  if (!inside(fromRow, fromColumn) || !inside(toRow, toColumn)) {
    return rejected("INVALID_COORDINATE");
  }

  const index = state.current;
  const color = index === state.redIndex ? "r" : "b";
  if (pieceColor(state.board[fromRow - 1][fromColumn - 1]) !== color) {
    return rejected("NOT_YOUR_PIECE");
  }
  if (!moveIsLegal(state.board, color, fromRow, fromColumn, toRow, toColumn)) {
    return rejected("ILLEGAL_MOVE");
  }

  const captured = state.board[toRow - 1][toColumn - 1];
  state.board[toRow - 1][toColumn - 1] = state.board[fromRow - 1][fromColumn - 1];
  state.board[fromRow - 1][fromColumn - 1] = "";
  state.moves = (state.moves ?? 0) + 1;
  state.noCaptureMoves = captured ? 0 : (state.noCaptureMoves ?? 0) + 1;
  state.lastMove = { fromRow, fromColumn, toRow, toColumn };

  const actor = state.players[index - 1];
  const opponentIndex = index === 1 ? 2 : 1;
  const opponentColor = color === "r" ? "b" : "r";
  if (captured === `${opponentColor}K`) {
    finishWin(state, actor, index, "general_captured");
    return accepted(state, [{ type: "won", player: actor, reason: state.endReason }]);
  }

  state.current = opponentIndex;
  state.inCheck = isInCheck(state.board, opponentColor);
  state.legalMoves = legalMoves(state.board, opponentColor);
  if (state.legalMoves.length === 0) {
    finishWin(state, actor, index, state.inCheck ? "checkmate" : "stalemate");
    return accepted(state, [{ type: "won", player: actor, reason: state.endReason }]);
  }
  if (state.noCaptureMoves >= DRAW_LIMIT) {
    state.draw = true;
    state.endReason = "no_capture_limit";
    state.legalMoves = [];
    state.lastEvent = { kind: "draw", playerIndex: index };
    return accepted(state, [{ type: "draw", reason: state.endReason }]);
  }

  state.lastEvent = {
    kind: captured ? "captured" : "moved",
    playerIndex: index,
    captured,
  };
  return accepted(state, [{ type: captured ? "captured" : "moved", player: actor, captured }]);
}

function newRound(round, redIndex) {
  const board = initialBoard();
  return {
    players: ["solo-player-1", "solo-player-2"],
    board,
    current: redIndex,
    redIndex,
    moves: 0,
    noCaptureMoves: 0,
    winner: "",
    winnerIndex: 0,
    draw: false,
    endReason: "",
    inCheck: false,
    lastMove: { fromRow: 0, fromColumn: 0, toRow: 0, toColumn: 0 },
    lastEvent: { kind: "start", playerIndex: redIndex },
    legalMoves: legalMoves(board, "r"),
    round,
  };
}

function initialBoard() {
  const board = Array.from({ length: ROWS }, () => Array(COLUMNS).fill(""));
  const backRank = ["R", "N", "E", "A", "K", "A", "E", "N", "R"];
  backRank.forEach((kind, column) => {
    board[0][column] = `b${kind}`;
    board[9][column] = `r${kind}`;
  });
  board[2][1] = board[2][7] = "bC";
  board[7][1] = board[7][7] = "rC";
  for (let column = 0; column < COLUMNS; column += 2) {
    board[3][column] = "bP";
    board[6][column] = "rP";
  }
  return board;
}

function legalMoves(board, color) {
  const moves = [];
  for (let fromRow = 1; fromRow <= ROWS; fromRow += 1) {
    for (let fromColumn = 1; fromColumn <= COLUMNS; fromColumn += 1) {
      if (pieceColor(board[fromRow - 1][fromColumn - 1]) !== color) continue;
      for (let toRow = 1; toRow <= ROWS; toRow += 1) {
        for (let toColumn = 1; toColumn <= COLUMNS; toColumn += 1) {
          if (moveIsLegal(board, color, fromRow, fromColumn, toRow, toColumn)) {
            moves.push({ fromRow, fromColumn, toRow, toColumn });
          }
        }
      }
    }
  }
  return moves;
}

function moveIsLegal(board, color, fromRow, fromColumn, toRow, toColumn) {
  if (pieceColor(board[fromRow - 1]?.[fromColumn - 1]) !== color) return false;
  if (!rawMoveAllowed(board, fromRow, fromColumn, toRow, toColumn)) return false;
  const moving = board[fromRow - 1][fromColumn - 1];
  const captured = board[toRow - 1][toColumn - 1];
  board[toRow - 1][toColumn - 1] = moving;
  board[fromRow - 1][fromColumn - 1] = "";
  const legal = !isInCheck(board, color);
  board[fromRow - 1][fromColumn - 1] = moving;
  board[toRow - 1][toColumn - 1] = captured;
  return legal;
}

function rawMoveAllowed(board, fromRow, fromColumn, toRow, toColumn) {
  if (!inside(fromRow, fromColumn) || !inside(toRow, toColumn)) return false;
  if (fromRow === toRow && fromColumn === toColumn) return false;
  const piece = board[fromRow - 1][fromColumn - 1];
  const color = pieceColor(piece);
  const kind = pieceKind(piece);
  if (!color) return false;
  const target = board[toRow - 1][toColumn - 1];
  if (pieceColor(target) === color) return false;
  const rowDelta = toRow - fromRow;
  const columnDelta = toColumn - fromColumn;
  const absRow = Math.abs(rowDelta);
  const absColumn = Math.abs(columnDelta);

  if (kind === "R") {
    return (rowDelta === 0 || columnDelta === 0)
      && clearBetween(board, fromRow, fromColumn, toRow, toColumn) === 0;
  }
  if (kind === "C") {
    if (rowDelta !== 0 && columnDelta !== 0) return false;
    const screens = clearBetween(board, fromRow, fromColumn, toRow, toColumn);
    return target ? screens === 1 : screens === 0;
  }
  if (kind === "N") {
    if (!((absRow === 2 && absColumn === 1) || (absRow === 1 && absColumn === 2))) {
      return false;
    }
    const legRow = fromRow + (absRow === 2 ? rowDelta / 2 : 0);
    const legColumn = fromColumn + (absColumn === 2 ? columnDelta / 2 : 0);
    return board[legRow - 1][legColumn - 1] === "";
  }
  if (kind === "E") {
    if (absRow !== 2 || absColumn !== 2) return false;
    if ((color === "b" && toRow > 5) || (color === "r" && toRow < 6)) return false;
    return board[fromRow + rowDelta / 2 - 1][fromColumn + columnDelta / 2 - 1] === "";
  }
  if (kind === "A") {
    return absRow === 1 && absColumn === 1 && inPalace(color, toRow, toColumn);
  }
  if (kind === "K") {
    if (columnDelta === 0 && target && pieceKind(target) === "K") {
      return clearBetween(board, fromRow, fromColumn, toRow, toColumn) === 0;
    }
    return absRow + absColumn === 1 && inPalace(color, toRow, toColumn);
  }
  if (kind === "P") {
    const forward = color === "r" ? -1 : 1;
    if (rowDelta === forward && columnDelta === 0) return true;
    const crossed = color === "r" ? fromRow <= 5 : fromRow >= 6;
    return crossed && rowDelta === 0 && absColumn === 1;
  }
  return false;
}

function isInCheck(board, color) {
  const general = findGeneral(board, color);
  if (!general) return true;
  const enemy = color === "r" ? "b" : "r";
  for (let row = 1; row <= ROWS; row += 1) {
    for (let column = 1; column <= COLUMNS; column += 1) {
      if (
        pieceColor(board[row - 1][column - 1]) === enemy
        && rawMoveAllowed(board, row, column, general.row, general.column)
      ) return true;
    }
  }
  return false;
}

function findGeneral(board, color) {
  for (let row = 1; row <= ROWS; row += 1) {
    for (let column = 1; column <= COLUMNS; column += 1) {
      if (board[row - 1][column - 1] === `${color}K`) return { row, column };
    }
  }
  return undefined;
}

function clearBetween(board, fromRow, fromColumn, toRow, toColumn) {
  const rowStep = Math.sign(toRow - fromRow);
  const columnStep = Math.sign(toColumn - fromColumn);
  let row = fromRow + rowStep;
  let column = fromColumn + columnStep;
  let count = 0;
  while (row !== toRow || column !== toColumn) {
    if (board[row - 1][column - 1]) count += 1;
    row += rowStep;
    column += columnStep;
  }
  return count;
}

function inPalace(color, row, column) {
  if (column < 4 || column > 6) return false;
  return color === "b" ? row >= 1 && row <= 3 : row >= 8 && row <= 10;
}

function pieceColor(piece) {
  return piece?.[0] || undefined;
}

function pieceKind(piece) {
  return piece?.[1] || undefined;
}

function inside(row, column) {
  return row >= 1 && row <= ROWS && column >= 1 && column <= COLUMNS;
}

function finishWin(state, winner, winnerIndex, reason) {
  state.winner = winner;
  state.winnerIndex = winnerIndex;
  state.endReason = reason;
  state.legalMoves = [];
  state.lastEvent = { kind: "won", playerIndex: winnerIndex };
}

function accepted(state, events) {
  return { accepted: true, state, events };
}

function rejected(code) {
  return { accepted: false, error: { code, message: code.toLowerCase().replaceAll("_", " ") } };
}
