import { createIcons, Dices, Landmark, RotateCcw } from "lucide";
import gameScript from "./game.lua?raw";
import { createPlayweftClient } from "../../src/playweft-client.js";
import "../../src/base.css";
import "./styles.css";

createIcons({ icons: { Dices, Landmark, RotateCcw } });

const TARGET_SCORE = 50;
const elements = {
  connection: document.querySelector("#connection"),
  heading: document.querySelector("#turn-heading"),
  kicker: document.querySelector("#turn-kicker"),
  activity: document.querySelector("#activity"),
  die: document.querySelector("#dice"),
  turnTotal: document.querySelector("#turn-total"),
  players: [
    document.querySelector("#player-one"),
    document.querySelector("#player-two"),
  ],
  roll: document.querySelector("#roll-button"),
  bank: document.querySelector("#bank-button"),
  rematch: document.querySelector("#rematch-button"),
};

let playerId;
let state;
let pendingActionId;

const preview = {
  players: ["preview-one", "preview-two"],
  scores: { "preview-one": 0, "preview-two": 0 },
  turnIndex: 1,
  turnTotal: 0,
  lastRoll: 5,
  winner: "",
  lastEvent: { kind: "ready", playerIndex: 1, value: 0 },
};

const client = createPlayweftClient({
  descriptor: {
    name: "Pig Dice",
    translations: {
      "zh-CN": { name: "贪心骰子" },
    },
    icon: "/pig-dice.svg",
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
    setConnection("live", "实时对局");
    render(state);
  },
  onActionResult(result) {
    if (result.requestId !== pendingActionId) return;
    pendingActionId = undefined;
    render(state ?? preview);
  },
  onError(error, _code, requestId) {
    if (requestId === pendingActionId) pendingActionId = undefined;
    setConnection("error", "连接异常");
    elements.activity.textContent = error;
    render(state ?? preview);
  },
});

elements.roll.addEventListener("click", () => send({ type: "roll" }));
elements.bank.addEventListener("click", () => send({ type: "bank" }));
elements.rematch.addEventListener("click", () => send({ type: "rematch" }));
window.addEventListener("pagehide", () => client.destroy());

render(preview);

function send(action) {
  if (pendingActionId || !state) return;
  const requestId = client.sendAction(action);
  if (!requestId) {
    elements.activity.textContent = "尚未连接 Playweft 平台";
  } else {
    pendingActionId = requestId;
  }
  render(state);
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const currentIndex = Number(nextState.turnIndex) - 1;
  const winnerIndex = players.indexOf(nextState.winner);

  players.slice(0, 2).forEach((id, index) => {
    const panel = elements.players[index];
    panel.querySelector("[data-player-name]").textContent =
      index === ownIndex ? `玩家 ${index + 1} · 你` : `玩家 ${index + 1}`;
    panel.querySelector("[data-score]").textContent = String(
      nextState.scores?.[id] ?? 0,
    );
    panel.classList.toggle(
      "is-current",
      !nextState.winner && index === currentIndex,
    );
    panel.classList.toggle("is-winner", index === winnerIndex);
  });

  elements.turnTotal.textContent = String(nextState.turnTotal ?? 0);
  setDie(Number(nextState.lastRoll) || 1);

  const isLive = Boolean(state);
  const isOwnTurn = ownIndex >= 0 && ownIndex === currentIndex;
  const hasWinner = Boolean(nextState.winner);
  elements.rematch.hidden = !isLive || !hasWinner || ownIndex < 0;
  elements.rematch.disabled = Boolean(pendingActionId);
  elements.roll.disabled =
    !isLive || !isOwnTurn || hasWinner || Boolean(pendingActionId);
  elements.bank.disabled =
    !isLive ||
    !isOwnTurn ||
    hasWinner ||
    Boolean(pendingActionId) ||
    Number(nextState.turnTotal) <= 0;

  if (!isLive) return;
  if (hasWinner) {
    elements.kicker.textContent = `最终比分 · 目标 ${TARGET_SCORE}`;
    elements.heading.textContent =
      winnerIndex === ownIndex ? "你赢了" : "对手获胜";
    elements.activity.textContent = "本局已经结束";
    return;
  }
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 的回合`;
  } else if (isOwnTurn) {
    elements.kicker.textContent = "轮到你了";
    elements.heading.textContent =
      nextState.turnTotal > 0 ? "继续冒险，还是收分？" : "掷出你的第一颗骰子";
  } else {
    elements.kicker.textContent = "对手回合";
    elements.heading.textContent = "等待对手行动";
  }
  elements.activity.textContent = activityText(nextState, ownIndex);
}

function activityText(nextState, ownIndex) {
  const event = nextState.lastEvent;
  if (!event || event.kind === "ready") return "掷到 1 会失去本回合全部暂存分";
  const actor =
    Number(event.playerIndex) - 1 === ownIndex
      ? "你"
      : `玩家 ${event.playerIndex}`;
  if (event.kind === "rolled") return `${actor}掷出了 ${event.value} 点`;
  if (event.kind === "bust") return `${actor}掷到 1，本回合暂存归零`;
  if (event.kind === "banked") return `${actor}收下了 ${event.value} 分`;
  if (event.kind === "won") return `${actor}以 ${event.value} 分结束对局`;
  if (event.kind === "left") return `${actor}已离开对局`;
  return "等待下一步行动";
}

function setDie(value) {
  const activePips = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  }[value] ?? [4];
  [...elements.die.children].forEach((pip, index) => {
    pip.classList.toggle("is-visible", activePips.includes(index));
  });
  elements.die.dataset.value = String(value);
  elements.die.setAttribute("aria-label", `骰子点数 ${value}`);
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
