import { CircleHelp, RotateCcw, X, createIcons } from "lucide";
import {
  applySoloXiangqiAction,
  createSoloXiangqiState,
} from "./solo.js";
import { createPlayweftClient } from "../../src/playweft-client.js";
import "../../src/base.css";
import "./styles.css";

const ROWS = 10;
const COLUMNS = 9;
const PIECE_LABELS = {
  rK: "帅", rA: "仕", rE: "相", rN: "马", rR: "车", rC: "炮", rP: "兵",
  bK: "将", bA: "士", bE: "象", bN: "马", bR: "车", bC: "炮", bP: "卒",
};
const PIECE_NAMES = {
  K: "将帅", A: "士", E: "象", N: "马", R: "车", C: "炮", P: "兵卒",
};

const elements = {
  connection: document.querySelector("#connection"),
  board: document.querySelector("#board"),
  round: document.querySelector("#round-number"),
  moveCount: document.querySelector("#move-count"),
  statusKicker: document.querySelector("#status-kicker"),
  statusTitle: document.querySelector("#status-title"),
  statusDetail: document.querySelector("#status-detail"),
  selectionLabel: document.querySelector("#selection-label"),
  cancel: document.querySelector("#cancel-button"),
  rematch: document.querySelector("#rematch-button"),
  players: {
    black: document.querySelector("#black-player"),
    red: document.querySelector("#red-player"),
  },
};

let playerId;
let state;
let pendingActionId;
let selected;
let playMode = "room";
let localMatchId;
let localVersion = 0;
const squares = [];

const preview = {
  players: ["preview-one", "preview-two"],
  board: createPreviewBoard(),
  current: 1,
  redIndex: 1,
  moves: 0,
  winner: "",
  winnerIndex: 0,
  draw: false,
  endReason: "",
  inCheck: false,
  lastMove: { fromRow: 0, fromColumn: 0, toRow: 0, toColumn: 0 },
  legalMoves: [],
  round: 1,
};

buildBoard();
createIcons({ icons: { CircleHelp, RotateCcw, X } });

const isStandalone = window.parent === window;
const client = isStandalone
  ? undefined
  : createPlayweftClient({
      onReady: handleReady,
      onState: handleState,
      onActionResult: handleActionResult,
      onError: handleError,
    });

function handleReady(message) {
  playMode = message.mode ?? "room";
  document.body.dataset.playMode = playMode;
  if (playMode === "solo") {
    playerId = "solo-player-1";
    localMatchId = `solo-${crypto.randomUUID()}`;
    localVersion = 0;
    handleState({
      playerId,
      state: createSoloXiangqiState(),
      events: [],
      matchId: localMatchId,
      version: localVersion,
      serverTime: Date.now(),
    });
    return;
  }
  playerId = message.playerId;
  setConnection("waiting", "房间已连接");
}

function handleState(message) {
  playerId = playMode === "solo" ? "solo-player-1" : message.playerId;
  state = message.state;
  pendingActionId = undefined;
  selected = undefined;
  setConnection(
    "live",
    state.winner || state.draw
      ? "对局已结束"
      : playMode === "solo"
        ? "已就绪"
        : "实时对局",
  );
  render(state);
}

function handleActionResult(result) {
  if (result.requestId !== pendingActionId) return;
  pendingActionId = undefined;
  render(state ?? preview);
}

function handleError(error, code, requestId) {
  if (requestId === pendingActionId) pendingActionId = undefined;
  setConnection("error", translateError(error, code));
  render(state ?? preview);
}

window.addEventListener("pagehide", () => client?.destroy());
elements.cancel.addEventListener("click", () => {
  selected = undefined;
  render(state ?? preview);
});
elements.rematch.addEventListener("click", () => sendAction({ type: "rematch" }));
if (isStandalone) handleReady({ mode: "solo" });
else render(preview);

function createPreviewBoard() {
  const board = Array.from({ length: ROWS }, () => Array(COLUMNS).fill(""));
  const rank = ["R", "N", "E", "A", "K", "A", "E", "N", "R"];
  rank.forEach((kind, column) => {
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

function buildBoard() {
  for (let row = 1; row <= ROWS; row += 1) {
    for (let column = 1; column <= COLUMNS; column += 1) {
      const square = document.createElement("button");
      square.type = "button";
      square.className = "board-square";
      square.style.setProperty("--row", row - 1);
      square.style.setProperty("--column", column - 1);
      square.setAttribute("role", "gridcell");
      square.disabled = true;
      square.addEventListener("click", () => chooseSquare(row, column));
      elements.board.append(square);
      squares.push(square);
    }
  }
}

function chooseSquare(row, column) {
  if (!state || pendingActionId || state.winner || state.draw) return;
  const ownIndex = state.players?.indexOf(playerId) ?? -1;
  if (playMode !== "solo" && ownIndex !== Number(state.current) - 1) return;
  const ownColor = playMode === "solo"
    ? Number(state.current) === Number(state.redIndex) ? "r" : "b"
    : ownIndex === Number(state.redIndex) - 1 ? "r" : "b";
  const piece = state.board?.[row - 1]?.[column - 1] ?? "";

  if (piece.startsWith(ownColor)) {
    const hasMove = legalMovesFrom(row, column).length > 0;
    selected = hasMove ? { row, column } : undefined;
    render(state);
    return;
  }

  if (!selected || !isLegalTarget(row, column)) return;
  sendAction({
    type: "move",
    fromRow: selected.row,
    fromColumn: selected.column,
    toRow: row,
    toColumn: column,
  });
}

function sendAction(action) {
  if (!state || pendingActionId) return;
  const requestId = dispatchAction(action);
  if (!requestId) {
    setConnection("error", "尚未连接 Playweft 平台");
    return;
  }
  pendingActionId = requestId;
  render(state);
}

function dispatchAction(action) {
  if (playMode !== "solo") return client?.sendAction(action);
  const requestId = crypto.randomUUID();
  window.queueMicrotask(() => {
    const result = applySoloXiangqiAction(state, action);
    if (!result.accepted) {
      handleError(
        result.error?.message ?? "Action rejected",
        result.error?.code ?? "ACTION_REJECTED",
        requestId,
      );
      return;
    }
    localVersion += 1;
    handleState({
      playerId: "solo-player-1",
      state: result.state,
      events: result.events,
      matchId: localMatchId,
      version: localVersion,
      serverTime: Date.now(),
    });
    handleActionResult({ requestId, accepted: true });
  });
  return requestId;
}

function legalMovesFrom(row, column, nextState = state) {
  return (nextState?.legalMoves ?? []).filter(
    (move) => Number(move.fromRow) === row && Number(move.fromColumn) === column,
  );
}

function isLegalTarget(row, column, nextState = state) {
  if (!selected) return false;
  return legalMovesFrom(selected.row, selected.column, nextState).some(
    (move) => Number(move.toRow) === row && Number(move.toColumn) === column,
  );
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const currentIndex = Number(nextState.current) - 1;
  const redIndex = Number(nextState.redIndex) - 1;
  const blackIndex = redIndex === 0 ? 1 : 0;
  const ended = Boolean(nextState.winner || nextState.draw);
  const canAct = Boolean(state)
    && (playMode === "solo" || ownIndex === currentIndex)
    && !ended
    && !pendingActionId;

  elements.round.textContent = String(nextState.round ?? 1);
  elements.moveCount.textContent = `${nextState.moves ?? 0} 回合`;
  elements.cancel.hidden = !selected || ended;
  elements.cancel.disabled = Boolean(pendingActionId);
  elements.rematch.hidden = !state || !ended || (playMode !== "solo" && ownIndex < 0);
  elements.rematch.disabled = Boolean(pendingActionId);

  renderPlayer("red", redIndex, ownIndex, currentIndex, nextState);
  renderPlayer("black", blackIndex, ownIndex, currentIndex, nextState);

  for (let row = 1; row <= ROWS; row += 1) {
    for (let column = 1; column <= COLUMNS; column += 1) {
      const square = squares[(row - 1) * COLUMNS + column - 1];
      const piece = nextState.board?.[row - 1]?.[column - 1] ?? "";
      const isSelected = selected?.row === row && selected?.column === column;
      const legalTarget = canAct && isLegalTarget(row, column, nextState);
      const movable = canAct && legalMovesFrom(row, column, nextState).length > 0;
      const isLastFrom = Number(nextState.lastMove?.fromRow) === row
        && Number(nextState.lastMove?.fromColumn) === column;
      const isLastTo = Number(nextState.lastMove?.toRow) === row
        && Number(nextState.lastMove?.toColumn) === column;

      square.textContent = PIECE_LABELS[piece] ?? "";
      square.dataset.piece = piece;
      square.classList.toggle("is-selected", isSelected);
      square.classList.toggle("is-target", legalTarget);
      square.classList.toggle("is-capture", legalTarget && Boolean(piece));
      square.classList.toggle("is-movable", movable && !selected);
      square.classList.toggle("is-last-from", isLastFrom);
      square.classList.toggle("is-last-to", isLastTo);
      square.disabled = !canAct || (!movable && !legalTarget);
      const pieceName = piece ? `${piece[0] === "r" ? "红方" : "黑方"}${PIECE_NAMES[piece[1]]}` : "空位";
      square.setAttribute("aria-label", `第 ${row} 行第 ${column} 列，${pieceName}${legalTarget ? "，可到达" : ""}`);
    }
  }

  if (selected) {
    const piece = nextState.board?.[selected.row - 1]?.[selected.column - 1] ?? "";
    elements.selectionLabel.textContent = `${PIECE_LABELS[piece] ?? "棋子"} · ${legalMovesFrom(selected.row, selected.column, nextState).length} 个走法`;
  } else {
    elements.selectionLabel.textContent = canAct ? "点击己方棋子" : "尚未选择棋子";
  }
  renderStatus(nextState, ownIndex, currentIndex, redIndex);
}

function renderPlayer(color, playerIndex, ownIndex, currentIndex, nextState) {
  const panel = elements.players[color];
  const colorLabel = color === "red" ? "红方" : "黑方";
  panel.querySelector("[data-player-name]").textContent = playMode === "solo"
    ? `${colorLabel} · 本机`
    : playerIndex === ownIndex
      ? `${colorLabel} · 你`
      : `${colorLabel} · 玩家 ${playerIndex + 1}`;
  panel.querySelector("[data-player-detail]").textContent = color === "red" ? "先手" : "后手";
  panel.classList.toggle("is-current", !nextState.winner && !nextState.draw && playerIndex === currentIndex);
  panel.classList.toggle("is-winner", Number(nextState.winnerIndex) - 1 === playerIndex);
}

function renderStatus(nextState, ownIndex, currentIndex, redIndex) {
  const currentColor = currentIndex === redIndex ? "红方" : "黑方";
  if (!state) {
    elements.statusKicker.textContent = "红方先行";
    elements.statusTitle.textContent = "准备开局";
    elements.statusDetail.textContent = "选择棋子，再选择它要到达的位置";
    return;
  }
  if (nextState.draw) {
    elements.statusKicker.textContent = "本局结束";
    elements.statusTitle.textContent = "双方和棋";
    elements.statusDetail.textContent = "连续 120 步未吃子，自动判和";
    return;
  }
  if (nextState.winner) {
    if (playMode === "solo") {
      const winnerColor = Number(nextState.winnerIndex) - 1 === redIndex
        ? "红方"
        : "黑方";
      elements.statusKicker.textContent = endReasonLabel(nextState.endReason);
      elements.statusTitle.textContent = `${winnerColor}获胜`;
      elements.statusDetail.textContent = "再来一局将交换红黑方";
      return;
    }
    const won = Number(nextState.winnerIndex) - 1 === ownIndex;
    elements.statusKicker.textContent = endReasonLabel(nextState.endReason);
    elements.statusTitle.textContent = won ? "你赢了" : "对手获胜";
    elements.statusDetail.textContent = "再来一局将交换红黑方";
    return;
  }
  if (nextState.inCheck) {
    elements.statusKicker.textContent = `${currentColor}被将军`;
    elements.statusTitle.textContent = playMode === "solo" || ownIndex === currentIndex
      ? "请应将"
      : "等待对手应将";
    elements.statusDetail.textContent = "必须解除将军，不能走其他棋";
    return;
  }
  if (playMode === "solo") {
    elements.statusKicker.textContent = "";
    elements.statusTitle.textContent = "";
    elements.statusDetail.textContent = "";
    return;
  }
  if (ownIndex < 0) {
    elements.statusKicker.textContent = "观战中";
    elements.statusTitle.textContent = `${currentColor}行棋`;
    elements.statusDetail.textContent = `已行 ${nextState.moves ?? 0} 步`;
  } else if (ownIndex === currentIndex) {
    elements.statusKicker.textContent = "轮到你了";
    elements.statusTitle.textContent = "请选择棋子";
    elements.statusDetail.textContent = `你执${currentColor.slice(0, 1)}，可走位置会高亮显示`;
  } else {
    elements.statusKicker.textContent = "对手回合";
    elements.statusTitle.textContent = `等待${currentColor}行棋`;
    elements.statusDetail.textContent = `已行 ${nextState.moves ?? 0} 步`;
  }
}

function endReasonLabel(reason) {
  return ({ checkmate: "将死", stalemate: "困毙", general_captured: "将帅被吃", player_left: "对手离开" })[reason] ?? "本局结束";
}

function translateError(error, code) {
  return ({
    NOT_YOUR_TURN: "还没轮到你",
    NOT_YOUR_PIECE: "请选择自己的棋子",
    ILLEGAL_MOVE: "这个走法不符合规则",
    GAME_OVER: "本局已经结束",
  })[code] ?? error ?? "连接异常";
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
