import { createIcons, ArrowDown } from "lucide";
import gameScript from "./game.lua?raw";
import { createPlayweftClient } from "../src/playweft-client.js";
import "../src/base.css";
import "./styles.css";

const ROWS = 6;
const COLUMNS = 7;
const elements = {
  connection: document.querySelector("#connection"),
  heading: document.querySelector("#turn-heading"),
  kicker: document.querySelector("#turn-kicker"),
  message: document.querySelector("#board-message"),
  board: document.querySelector("#board"),
  guides: document.querySelector("#column-guides"),
  players: [
    document.querySelector("#player-one"),
    document.querySelector("#player-two"),
  ],
};

let playerId;
let state;
let pending = false;
const columns = [];
const cells = [];

buildBoard();
createIcons({ icons: { ArrowDown } });

const preview = {
  players: ["preview-one", "preview-two"],
  board: Array.from({ length: ROWS }, () => Array(COLUMNS).fill(0)),
  current: 1,
  moves: 0,
  winner: "",
  winnerIndex: 0,
  draw: false,
  lastMove: { row: 0, column: 0 },
  winningCells: [],
};

const client = createPlayweftClient({
  descriptor: {
    name: "四子棋",
    icon: "/connect-four.svg",
    helpUrl: "./help.html",
  },
  script: gameScript,
  minPlayers: 2,
  maxPlayers: 2,
  onReady(message) {
    playerId = message.playerId;
    setConnection("waiting", "房间已连接");
    elements.kicker.textContent = "等待房主开始";
    elements.heading.textContent = "两位玩家就位后开局";
  },
  onState(message) {
    playerId = message.playerId;
    state = message.state;
    pending = false;
    setConnection("live", "实时对局");
    render(state);
  },
  onError(error) {
    pending = false;
    setConnection("error", "连接异常");
    elements.message.textContent = error;
    render(state ?? preview);
  },
});

window.addEventListener("pagehide", () => client.destroy());
render(preview);

function buildBoard() {
  for (let column = 1; column <= COLUMNS; column += 1) {
    const guide = document.createElement("span");
    guide.innerHTML = '<i data-lucide="arrow-down"></i>';
    elements.guides.append(guide);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-column";
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `在第 ${column} 列落子`);
    button.disabled = true;
    button.addEventListener("click", () => drop(column));
    const columnCells = [];
    for (let row = 1; row <= ROWS; row += 1) {
      const cell = document.createElement("span");
      cell.className = "board-cell";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      button.append(cell);
      columnCells.push(cell);
    }
    elements.board.append(button);
    columns.push(button);
    cells.push(columnCells);
  }
}

function drop(column) {
  if (pending || !state) return;
  pending = true;
  if (!client.sendAction({ type: "drop", column })) {
    pending = false;
    elements.message.textContent = "尚未连接 Playweft 平台";
  }
  render(state);
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const currentIndex = Number(nextState.current) - 1;
  const ended = Boolean(nextState.winner || nextState.draw);
  const winning = new Set(
    Array.isArray(nextState.winningCells)
      ? nextState.winningCells.map((cell) => `${cell.row}:${cell.column}`)
      : [],
  );

  players.slice(0, 2).forEach((id, index) => {
    const panel = elements.players[index];
    panel.querySelector("[data-player-name]").textContent =
      index === ownIndex ? `玩家 ${index + 1} · 你` : `玩家 ${index + 1}`;
    panel.classList.toggle("is-current", !ended && index === currentIndex);
    panel.classList.toggle("is-winner", Number(nextState.winnerIndex) === index + 1);
  });

  for (let column = 0; column < COLUMNS; column += 1) {
    let targetRow = -1;
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      if (Number(nextState.board?.[row]?.[column]) === 0) {
        targetRow = row;
        break;
      }
    }
    const canDrop =
      Boolean(state) &&
      ownIndex === currentIndex &&
      !ended &&
      !pending &&
      targetRow >= 0;
    columns[column].disabled = !canDrop;
    columns[column].dataset.piece = String(currentIndex + 1);

    for (let row = 0; row < ROWS; row += 1) {
      const value = Number(nextState.board?.[row]?.[column]) || 0;
      const cell = cells[column][row];
      cell.dataset.piece = String(value);
      cell.classList.toggle(
        "is-last",
        Number(nextState.lastMove?.row) === row + 1 &&
          Number(nextState.lastMove?.column) === column + 1,
      );
      cell.classList.toggle("is-winning", winning.has(`${row + 1}:${column + 1}`));
      cell.classList.toggle("is-target", canDrop && row === targetRow);
    }
  }

  if (!state) return;
  if (nextState.draw) {
    elements.kicker.textContent = "棋盘已满";
    elements.heading.textContent = "本局平手";
    elements.message.textContent = "双方都守住了自己的连线";
    return;
  }
  if (nextState.winner) {
    const won = Number(nextState.winnerIndex) - 1 === ownIndex;
    elements.kicker.textContent = "四子连线";
    elements.heading.textContent = won ? "你赢了" : "对手获胜";
    elements.message.textContent = `玩家 ${nextState.winnerIndex} 完成了四连`;
    return;
  }
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 正在思考`;
    elements.message.textContent = `已落 ${nextState.moves} 子`;
  } else if (ownIndex === currentIndex) {
    elements.kicker.textContent = "轮到你了";
    elements.heading.textContent = "选择一列落子";
    elements.message.textContent = `你是${ownIndex === 0 ? "红方" : "黄方"}`;
  } else {
    elements.kicker.textContent = "对手回合";
    elements.heading.textContent = "等待对手落子";
    elements.message.textContent = `已落 ${nextState.moves} 子`;
  }
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
