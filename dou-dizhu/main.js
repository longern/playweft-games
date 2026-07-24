import { CircleOff, RotateCcw, Send, createIcons } from "lucide";
import gameScript from "./game.lua?raw";
import { createPlayweftClient } from "../src/playweft-client.js";
import "../src/base.css";
import "./styles.css";

createIcons({ icons: { CircleOff, RotateCcw, Send } });

const elements = {
  connection: document.querySelector("#connection"),
  kicker: document.querySelector("#turn-kicker"),
  heading: document.querySelector("#turn-heading"),
  multiplier: document.querySelector("#multiplier"),
  bottomCount: document.querySelector("#bottom-count"),
  message: document.querySelector("#table-message"),
  lastPlay: document.querySelector("#last-play"),
  hand: document.querySelector("#hand"),
  selectionCount: document.querySelector("#selection-count"),
  bidActions: document.querySelector("#bid-actions"),
  playActions: document.querySelector("#play-actions"),
  pass: document.querySelector("#pass-button"),
  play: document.querySelector("#play-button"),
  rematch: document.querySelector("#rematch-button"),
  bidButtons: [...document.querySelectorAll("[data-bid]")],
  players: [
    document.querySelector("#player-one"),
    document.querySelector("#player-two"),
    document.querySelector("#player-three"),
  ],
};

const preview = {
  players: ["preview-one", "preview-two", "preview-three"],
  phase: "bidding",
  turnIndex: 1,
  highestBid: 0,
  bids: {},
  hands: { "preview-one": [], "preview-two": [], "preview-three": [] },
  bottomCards: [],
  landlord: "",
  landlordIndex: 0,
  multiplier: 1,
  lastPlay: null,
  winner: "",
};

let playerId;
let state;
let pendingAction;
let selected = new Set();

const client = createPlayweftClient({
  descriptor: {
    name: "Dou Dizhu",
    translations: {
      "zh-CN": { name: "斗地主" },
    },
    icon: "/dou-dizhu.svg",
    helpUrl: "./help.html",
  },
  script: gameScript,
  minPlayers: 3,
  maxPlayers: 3,
  onReady(message) {
    playerId = message.playerId;
    setConnection("waiting", "房间已连接");
    elements.kicker.textContent = "等待房主开始";
    elements.heading.textContent = "三位玩家就位后开局";
  },
  onState(message) {
    playerId = message.playerId;
    state = message.state;
    setConnection("live", "实时对局");
    render(state);
  },
  onActionResult(result) {
    if (!pendingAction || result.requestId !== pendingAction.id) return;
    if (pendingAction.type === "play") selected.clear();
    pendingAction = undefined;
    render(state ?? preview);
  },
  onError(error, _code, requestId) {
    if (pendingAction?.id === requestId) pendingAction = undefined;
    setConnection("error", "连接异常");
    elements.message.textContent = error;
    render(state ?? preview);
  },
});

elements.bidButtons.forEach((button) => {
  button.addEventListener("click", () =>
    send({ type: "bid", score: Number(button.dataset.bid) }),
  );
});
elements.play.addEventListener("click", () =>
  send({ type: "play", cards: [...selected] }),
);
elements.pass.addEventListener("click", () => send({ type: "pass" }));
elements.rematch.addEventListener("click", () => send({ type: "rematch" }));
window.addEventListener("pagehide", () => client.destroy());

render(preview);

function send(action) {
  if (pendingAction || !state) return;
  const requestId = client.sendAction(action);
  if (!requestId) {
    elements.message.textContent = "尚未连接 Playweft 平台";
  } else {
    pendingAction = { id: requestId, type: action.type };
  }
  render(state);
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const currentIndex = Number(nextState.turnIndex) - 1;
  const ownHand = Array.isArray(nextState.hands?.[playerId])
    ? nextState.hands[playerId]
    : [];
  selected = new Set([...selected].filter((card) => ownHand.includes(card)));
  const live = Boolean(state);
  const isOwnTurn = ownIndex >= 0 && ownIndex === currentIndex;
  const ended = Boolean(nextState.winner);

  elements.multiplier.textContent = String(nextState.multiplier ?? 1);
  elements.bottomCount.textContent = String(nextState.bottomCards?.length ?? 3);
  players
    .slice(0, 3)
    .forEach((id, index) =>
      renderPlayer(nextState, id, index, ownIndex, currentIndex, ended),
    );
  renderCards(
    elements.lastPlay,
    nextState.lastPlay?.cards ?? [],
    "table-card",
    false,
  );
  renderHand(
    ownHand,
    live && !ended && nextState.phase === "playing" && isOwnTurn,
  );

  const bidding = live && !ended && nextState.phase === "bidding";
  elements.bidActions.hidden = !bidding;
  elements.playActions.hidden = !live || ended || nextState.phase !== "playing";
  elements.rematch.hidden = !live || !ended || ownIndex < 0;
  elements.rematch.disabled = Boolean(pendingAction);
  elements.bidButtons.forEach((button) => {
    const bid = Number(button.dataset.bid);
    button.disabled =
      !isOwnTurn ||
      Boolean(pendingAction) ||
      (bid > 0 && bid <= Number(nextState.highestBid));
  });
  elements.play.disabled =
    !isOwnTurn || Boolean(pendingAction) || selected.size === 0;
  elements.pass.disabled =
    !isOwnTurn ||
    Boolean(pendingAction) ||
    !nextState.lastPlay ||
    nextState.lastPlay.playerId === playerId;
  elements.selectionCount.textContent = `已选 ${selected.size} 张`;
  setCopy(nextState, ownIndex, currentIndex);
}

function renderPlayer(nextState, id, index, ownIndex, currentIndex, ended) {
  const panel = elements.players[index];
  const hand = nextState.hands?.[id] ?? [];
  const isLandlord = nextState.landlord === id;
  panel.querySelector("[data-player-name]").textContent =
    index === ownIndex ? `玩家 ${index + 1} · 你` : `玩家 ${index + 1}`;
  panel.querySelector("[data-role]").textContent = isLandlord ? "地主" : "农民";
  panel.querySelector("[data-hand-count]").textContent = `${hand.length} 张`;
  panel.classList.toggle("is-current", !ended && index === currentIndex);
  panel.classList.toggle("is-landlord", isLandlord);
  panel.classList.toggle("is-winner", nextState.winner === id);
}

function renderHand(cards, enabled) {
  elements.hand.replaceChildren();
  cards.forEach((card) => {
    const button = cardElement(card, "hand-card", true);
    button.disabled = !enabled || Boolean(pendingAction);
    button.classList.toggle("is-selected", selected.has(card));
    button.addEventListener("click", () => {
      if (selected.has(card)) selected.delete(card);
      else selected.add(card);
      render(state);
    });
    elements.hand.append(button);
  });
}

function renderCards(container, cards, className, interactive) {
  container.replaceChildren();
  cards.forEach((card) =>
    container.append(cardElement(card, className, interactive)),
  );
}

function cardElement(card, className, interactive) {
  const element = document.createElement(interactive ? "button" : "span");
  if (interactive) element.type = "button";
  const { rank, suit, red, joker } = cardFace(card);
  element.className = `${className}${red ? " is-red" : ""}${joker ? " is-joker" : ""}`;
  element.innerHTML = `<span class="card-rank">${rank}</span><span class="card-suit">${suit}</span>`;
  element.setAttribute("aria-label", `${rank}${suit}`);
  return element;
}

function cardFace(card) {
  if (card === 53) return { rank: "小王", suit: "J", red: false, joker: true };
  if (card === 54) return { rank: "大王", suit: "J", red: true, joker: true };
  const ranks = [
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
    "2",
  ];
  const suits = ["♣", "♦", "♥", "♠"];
  const suitIndex = (card - 1) % 4;
  return {
    rank: ranks[Math.floor((card - 1) / 4)],
    suit: suits[suitIndex],
    red: suitIndex === 1 || suitIndex === 2,
    joker: false,
  };
}

function setCopy(nextState, ownIndex, currentIndex) {
  const players = nextState.players ?? [];
  if (!state) return;
  if (nextState.winner) {
    const won = nextState.winner === playerId;
    elements.kicker.textContent = `本局倍数 ${nextState.multiplier ?? 1}`;
    elements.heading.textContent = won ? "你赢了" : "本局结束";
    elements.message.textContent =
      nextState.winnerTeam === "landlord" ? "地主获胜" : "农民获胜";
    return;
  }
  if (nextState.phase === "bidding") {
    if (ownIndex < 0) {
      elements.kicker.textContent = "观战中";
      elements.heading.textContent = `玩家 ${currentIndex + 1} 正在叫分`;
    } else if (ownIndex === currentIndex) {
      elements.kicker.textContent = "轮到你叫分";
      elements.heading.textContent = "选择本局叫分";
    } else {
      elements.kicker.textContent = "叫分阶段";
      elements.heading.textContent = "等待其他玩家叫分";
    }
    elements.message.textContent =
      nextState.highestBid > 0
        ? `当前最高 ${nextState.highestBid} 分`
        : "尚未有人叫分";
    return;
  }
  const landlordIndex = players.indexOf(nextState.landlord);
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 的回合`;
  } else if (ownIndex === currentIndex) {
    elements.kicker.textContent = "轮到你出牌";
    elements.heading.textContent = nextState.lastPlay
      ? "选择能压过桌面的牌"
      : "请先出牌";
  } else {
    elements.kicker.textContent = "等待对手";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 正在出牌`;
  }
  if (nextState.lastPlay) {
    const actor =
      nextState.lastPlay.playerIndex === ownIndex + 1
        ? "你"
        : `玩家 ${nextState.lastPlay.playerIndex}`;
    elements.message.textContent = `${actor}出了${comboLabel(nextState.lastPlay.type)}`;
  } else if (landlordIndex >= 0) {
    elements.message.textContent = `玩家 ${landlordIndex + 1} 是地主，先出牌`;
  }
}

function comboLabel(type) {
  return (
    {
      single: "单张",
      pair: "对子",
      triple: "三张",
      triple_single: "三带一",
      triple_pair: "三带二",
      straight: "顺子",
      pair_straight: "连对",
      airplane: "飞机",
      airplane_single: "飞机带单",
      airplane_pair: "飞机带对",
      four_two_single: "四带二",
      four_two_pair: "四带两对",
      bomb: "炸弹",
      rocket: "王炸",
    }[type] ?? "牌"
  );
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
