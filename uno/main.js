import { createIcons, RotateCcw } from "lucide";
import gameScript from "./game.lua?raw";
import { createPlayweftClient } from "../src/playweft-client.js";
import "../src/base.css";
import "./styles.css";

const COLORS = ["red", "yellow", "green", "blue"];
const elements = {
  connection: document.querySelector("#connection"),
  kicker: document.querySelector("#turn-kicker"),
  heading: document.querySelector("#turn-heading"),
  activity: document.querySelector("#activity"),
  drawPile: document.querySelector("#draw-pile"),
  discard: document.querySelector("#discard-pile"),
  activeColor: document.querySelector("#active-color-swatch"),
  opponent: document.querySelector("#opponent-hand"),
  opponentLabel: document.querySelector("#opponent-label"),
  hand: document.querySelector("#own-hand"),
  handCount: document.querySelector("#hand-count"),
  colorPicker: document.querySelector("#color-picker"),
  rematch: document.querySelector("#rematch-button"),
  players: document.querySelector("#players"),
};

let playerId;
let state;
let pendingActionId;
let selectedWildCard;
let notice;

const preview = {
  players: ["preview-one", "preview-two"],
  hands: {
    "preview-one": [
      card("red-5", "red", "5"),
      card("blue-skip", "blue", "skip"),
      card("wild-1", "wild", "wild"),
      card("yellow-2", "yellow", "2"),
      card("green-draw2", "green", "draw2"),
      card("red-9", "red", "9"),
      card("wild4-1", "wild", "wild4"),
    ],
    "preview-two": Array.from({ length: 7 }, (_, index) =>
      card(`preview-${index}`, "blue", String(index)),
    ),
  },
  discard: [card("opening", "red", "7")],
  activeColor: "red",
  current: 1,
  winner: "",
  lastEvent: { kind: "ready", playerIndex: 1, count: 0 },
};

createIcons({ icons: { RotateCcw } });

const client = createPlayweftClient({
  descriptor: {
    name: "UNO",
    icon: "/uno.svg",
    helpUrl: "./help.html",
  },
  script: gameScript,
  minPlayers: 2,
  maxPlayers: 4,
  onReady(message) {
    playerId = message.playerId;
    setConnection("waiting", "房间已连接");
    elements.kicker.textContent = "等待房主开始";
    elements.heading.textContent = "两位玩家就位后开局";
  },
  onState(message) {
    playerId = message.playerId;
    state = message.state;
    selectedWildCard = undefined;
    notice = undefined;
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
    selectedWildCard = undefined;
    notice = error;
    setConnection("error", "操作未完成");
    render(state ?? preview);
  },
});

window.addEventListener("pagehide", () => client.destroy());
elements.drawPile.addEventListener("click", () => sendAction({ type: "draw" }));
elements.rematch.addEventListener("click", () => sendAction({ type: "rematch" }));
elements.colorPicker.addEventListener("click", (event) => {
  const color = event.target.closest("button")?.dataset.colorChoice;
  if (!color || !selectedWildCard) return;
  sendAction({ type: "play", cardId: selectedWildCard.id, color });
});

render(preview);

function card(id, color, value) {
  return { id, color, value };
}

function sendAction(action) {
  if (pendingActionId || !state) return;
  const requestId = client.sendAction(action);
  if (!requestId) {
    notice = "尚未连接 Playweft 平台";
  } else {
    pendingActionId = requestId;
  }
  render(state);
}

function selectCard(nextCard) {
  if (!canAct()) return;
  if (nextCard.color === "wild") {
    selectedWildCard = nextCard;
    render(state);
    return;
  }
  sendAction({ type: "play", cardId: nextCard.id });
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const displayIndex = ownIndex >= 0 ? ownIndex : 0;
  const currentIndex = Number(nextState.current) - 1;
  const hasWinner = Boolean(nextState.winner);
  const ownId = players[displayIndex];
  const hand = Array.isArray(nextState.hands?.[ownId]) ? nextState.hands[ownId] : [];
  const opponentCards = players.reduce((total, id, index) => {
    if (index === displayIndex) return total;
    return total + (Array.isArray(nextState.hands?.[id]) ? nextState.hands[id].length : 0);
  }, 0);
  const topCard = nextState.discard?.at(-1);
  const ownTurn = Boolean(state) && ownIndex === currentIndex && !hasWinner;

  renderPlayers(players, nextState, ownIndex, currentIndex, hasWinner);

  elements.handCount.textContent = `${hand.length} 张`;
  elements.opponentLabel.textContent = ownIndex < 0 ? "玩家手牌" : `其他玩家手牌 · ${opponentCards} 张`;
  renderCardBacks(opponentCards || 1);
  renderHand(hand, ownTurn, nextState);
  elements.discard.replaceChildren(topCard ? buildCard(topCard, false) : document.createElement("span"));
  elements.activeColor.dataset.color = COLORS.includes(nextState.activeColor)
    ? nextState.activeColor
    : "red";

  elements.drawPile.disabled = !ownTurn || Boolean(pendingActionId);
  elements.drawPile.setAttribute("aria-label", ownTurn ? "从牌堆摸一张牌并结束回合" : "等待你的回合");
  elements.colorPicker.hidden = !selectedWildCard || Boolean(pendingActionId);
  elements.rematch.hidden = !state || !hasWinner || ownIndex < 0;
  elements.rematch.disabled = Boolean(pendingActionId);

  if (!state) return;
  if (notice) {
    elements.activity.textContent = notice;
    return;
  }
  renderCopy(nextState, ownIndex, currentIndex);
}

function renderPlayers(players, nextState, ownIndex, currentIndex, hasWinner) {
  elements.players.replaceChildren(
    ...players.map((id, index) => {
      const panel = document.createElement("div");
      const count = Array.isArray(nextState.hands?.[id]) ? nextState.hands[id].length : 0;
      panel.className = "player-chip";
      panel.classList.toggle("is-current", !hasWinner && index === currentIndex);
      panel.classList.toggle("is-winner", nextState.winner === id);
      panel.innerHTML = `
        <span class="player-dot player-dot-${index % 4}"></span>
        <span>玩家 ${index + 1}${index === ownIndex ? " · 你" : ""}</span>
        <strong>${count} 张</strong>
      `;
      return panel;
    }),
  );
}

function renderCardBacks(count) {
  const shown = Math.min(Math.max(count, 1), 12);
  elements.opponent.replaceChildren(
    ...Array.from({ length: shown }, () => {
      const back = document.createElement("span");
      back.className = "mini-card-back";
      back.innerHTML = "<b>UNO</b>";
      return back;
    }),
  );
  elements.opponent.style.setProperty("--card-count", String(shown));
}

function renderHand(hand, ownTurn, nextState) {
  elements.hand.replaceChildren(
    ...hand.map((nextCard) => {
      const playable = isPlayable(nextCard, hand, nextState);
      const button = buildCard(nextCard, true);
      button.classList.toggle("is-playable", ownTurn && playable);
      button.classList.toggle("is-selected", selectedWildCard?.id === nextCard.id);
      button.disabled = !ownTurn || !playable || Boolean(pendingActionId);
      button.addEventListener("click", () => selectCard(nextCard));
      return button;
    }),
  );
}

function buildCard(nextCard, interactive) {
  const element = document.createElement(interactive ? "button" : "div");
  if (interactive) element.type = "button";
  element.className = "uno-card";
  element.dataset.color = nextCard.color;
  element.dataset.value = nextCard.value;
  element.setAttribute("role", interactive ? "listitem" : "img");
  element.setAttribute("aria-label", cardLabel(nextCard));
  const symbol = cardSymbol(nextCard.value);
  element.innerHTML = `
    <span class="card-corner">${symbol}</span>
    <span class="card-main">${symbol}</span>
    <span class="card-corner card-corner-bottom">${symbol}</span>
  `;
  return element;
}

function cardSymbol(value) {
  if (value === "skip") return "⊘";
  if (value === "reverse") return "↺";
  if (value === "draw2") return "+2";
  if (value === "wild") return "W";
  if (value === "wild4") return "+4";
  return value;
}

function cardLabel(nextCard) {
  const color = { red: "红色", yellow: "黄色", green: "绿色", blue: "蓝色", wild: "万能" }[nextCard.color];
  const value = { skip: "跳过", reverse: "反转", draw2: "加二", wild: "变色", wild4: "加四" }[
    nextCard.value
  ] ?? nextCard.value;
  return `${color}${value}`;
}

function isPlayable(nextCard, hand, nextState) {
  if (nextCard.color === "wild") {
    return (
      nextCard.value !== "wild4" ||
      !hand.some((cardInHand) => cardInHand.id !== nextCard.id && cardInHand.color === nextState.activeColor)
    );
  }
  return (
    nextCard.color === nextState.activeColor ||
    nextCard.value === nextState.discard?.at(-1)?.value
  );
}

function canAct() {
  const ownIndex = state?.players?.indexOf(playerId) ?? -1;
  return ownIndex >= 0 && ownIndex === Number(state.current) - 1 && !state.winner && !pendingActionId;
}

function renderCopy(nextState, ownIndex, currentIndex) {
  if (nextState.winner) {
    elements.kicker.textContent = "本局结束";
    elements.heading.textContent = nextState.winner === playerId ? "你赢了" : "对手获胜";
    elements.activity.textContent = eventText(nextState.lastEvent, ownIndex);
    return;
  }
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 的回合`;
  } else if (ownIndex === currentIndex) {
    elements.kicker.textContent = "轮到你了";
    elements.heading.textContent = "打出匹配颜色或数字的牌";
  } else {
    elements.kicker.textContent = "对手回合";
    elements.heading.textContent = "等待对手出牌";
  }
  elements.activity.textContent = eventText(nextState.lastEvent, ownIndex);
}

function eventText(event, ownIndex) {
  if (!event || event.kind === "ready") return "首张牌决定本局的起始颜色";
  const actor = Number(event.playerIndex) - 1 === ownIndex ? "你" : `玩家 ${event.playerIndex}`;
  if (event.kind === "draw") return `${actor}摸了一张牌并结束回合`;
  if (event.kind === "penalty") return `${actor}打出${cardLabel(event.card)}，玩家 ${event.targetIndex} 摸了 ${event.count} 张`;
  if (event.kind === "skip") return `${actor}打出${cardLabel(event.card)}，下一位玩家被跳过`;
  if (event.kind === "reverse") return `${actor}打出反转牌，出牌方向已改变`;
  if (event.kind === "play") return `${actor}打出${cardLabel(event.card)}`;
  if (event.kind === "won") return `${actor}打完了最后一张牌`;
  if (event.kind === "left") return `${actor}离开了对局`;
  return "等待下一步行动";
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
