import {
  ChevronsRight,
  CircleDollarSign,
  createIcons,
  Eye,
  HandCoins,
  RotateCcw,
  ShieldQuestion,
} from "lucide";
import gameScript from "./game.lua?raw";
import { createPlayweftClient } from "../src/playweft-client.js";
import "../src/base.css";
import "./styles.css";

const STARTING_STACK = 100;
const elements = {
  connection: document.querySelector("#connection"),
  heading: document.querySelector("#turn-heading"),
  kicker: document.querySelector("#turn-kicker"),
  activity: document.querySelector("#activity"),
  pot: document.querySelector("#pot-value"),
  bet: document.querySelector("#bet-value"),
  street: document.querySelector("#street-label"),
  community: document.querySelector("#community-cards"),
  seats: document.querySelector("#table-seats"),
  fold: document.querySelector("#fold-button"),
  check: document.querySelector("#check-button"),
  call: document.querySelector("#call-button"),
  raise: document.querySelector("#raise-button"),
  allIn: document.querySelector("#all-in-button"),
  nextHand: document.querySelector("#next-hand-button"),
  rematch: document.querySelector("#rematch-button"),
};

let playerId;
let state;
let pendingActionId;

const previewPlayers = Array.from({ length: 6 }, (_, index) => `preview-${index + 1}`);
const preview = {
  players: previewPlayers,
  chips: Object.fromEntries(previewPlayers.map((id) => [id, STARTING_STACK])),
  hands: Object.fromEntries(
    previewPlayers.map((id, index) => [id, [index * 2, index * 2 + 1]]),
  ),
  inHand: Object.fromEntries(previewPlayers.map((id) => [id, true])),
  folded: {},
  allIn: {},
  contributions: Object.fromEntries(previewPlayers.map((id) => [id, 0])),
  streetBets: Object.fromEntries(previewPlayers.map((id) => [id, 0])),
  board: [12, 24, 35, 43, 51],
  revealed: 0,
  street: 0,
  dealer: 1,
  smallBlind: 2,
  bigBlind: 3,
  current: 4,
  currentBet: 2,
  raises: 0,
  pot: 3,
  ended: false,
  matchWinner: "",
  winners: [],
  payouts: {},
  showdownRanks: {},
  lastPot: 0,
  lastEvent: { kind: "dealt", playerIndex: 1, value: 0 },
};

createIcons({
  icons: {
    ChevronsRight,
    CircleDollarSign,
    Eye,
    HandCoins,
    RotateCcw,
    ShieldQuestion,
  },
});

const client = createPlayweftClient({
  descriptor: {
    name: "德州扑克",
    icon: "/texas-holdem.svg",
    helpUrl: "./help.html",
  },
  script: gameScript,
  minPlayers: 2,
  maxPlayers: 6,
  onReady(message) {
    playerId = message.playerId;
    setConnection("waiting", "房间已连接");
    elements.kicker.textContent = "等待房主开始";
    elements.heading.textContent = "2 至 6 位玩家就位后开局";
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

for (const [element, type] of [
  [elements.fold, "fold"],
  [elements.check, "check"],
  [elements.call, "call"],
  [elements.raise, "raise"],
  [elements.allIn, "all_in"],
  [elements.nextHand, "next_hand"],
  [elements.rematch, "rematch"],
]) {
  element.addEventListener("click", () => send({ type }));
}
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
  const currentIndex = Number(nextState.current) - 1;
  const ownId = ownIndex >= 0 ? players[ownIndex] : undefined;
  const ownBet = Number(nextState.streetBets?.[ownId]) || 0;
  const callAmount = Math.max(0, Number(nextState.currentBet) - ownBet);
  const ownChips = Number(nextState.chips?.[ownId]) || 0;
  const isLive = Boolean(state);
  const isOwnTurn = isLive && ownIndex === currentIndex && !nextState.ended;
  const canAct = isOwnTurn && !pendingActionId;

  elements.pot.textContent = String(nextState.ended ? nextState.lastPot || 0 : nextState.pot || 0);
  elements.bet.textContent = String(nextState.currentBet || 0);
  elements.street.textContent = streetName(nextState.street, nextState.ended);
  elements.call.querySelector("span span").textContent = callAmount > 0 ? `跟注 ${callAmount}` : "跟注";
  elements.fold.disabled = !canAct;
  elements.check.disabled = !canAct || callAmount !== 0;
  elements.call.disabled = !canAct || callAmount <= 0 || ownChips < callAmount;
  elements.raise.disabled =
    !canAct ||
    Number(nextState.raises) >= 3 ||
    ownChips < callAmount + 2;
  elements.allIn.disabled = !canAct || ownChips <= 0;
  elements.nextHand.hidden = !isLive || !nextState.ended || Boolean(nextState.matchWinner);
  elements.nextHand.disabled = Boolean(pendingActionId);
  elements.rematch.hidden = !isLive || !nextState.matchWinner;
  elements.rematch.disabled = Boolean(pendingActionId);

  renderCommunity(nextState);
  renderSeats(nextState, ownIndex);
  renderStatus(nextState, ownIndex, currentIndex);
}

function renderCommunity(nextState) {
  const revealed = Math.max(0, Math.min(5, Number(nextState.revealed) || 0));
  elements.community.replaceChildren(
    ...Array.from({ length: 5 }, (_, index) => cardElement(nextState.board?.[index], index < revealed)),
  );
}

function renderSeats(nextState, ownIndex) {
  const revealAll = nextState.ended && nextState.lastEvent?.kind === "showdown";
  const players = nextState.players;
  const positions = seatPositions(players.length);
  const ownSeat = positions.indexOf("bottom");
  const visualOwnIndex =
    ownIndex >= 0
      ? ownIndex
      : !state && players.length >= 2
        ? Math.floor(players.length / 2)
        : -1;
  const offset = visualOwnIndex >= 0 ? visualOwnIndex - ownSeat : 0;
  const displayPlayers = players.map(
    (_id, visualIndex) =>
      players[(offset + visualIndex + players.length) % players.length],
  );
  const opponentCards = [];
  const seats = displayPlayers.map((id, visualIndex) => {
    const index = players.indexOf(id);
    const seat = document.createElement("article");
    const isOwn = index === visualOwnIndex;
    const folded = Boolean(nextState.folded?.[id]);
    const inHand = Boolean(nextState.inHand?.[id]);
    const isWinner = Array.isArray(nextState.winners) && nextState.winners.includes(id);
    const position = positions[visualIndex];
    seat.className = "table-seat";
    seat.dataset.position = position;
    seat.dataset.hasCards = String(!isOwn);
    seat.classList.toggle("is-current", !nextState.ended && index === Number(nextState.current) - 1);
    seat.classList.toggle("is-own", isOwn);
    seat.classList.toggle("is-folded", folded || !inHand);
    seat.classList.toggle("is-winner", isWinner);
    const badges = [];
    if (Number(nextState.dealer) === index + 1) badges.push("庄");
    if (Number(nextState.smallBlind) === index + 1) badges.push("小盲");
    if (Number(nextState.bigBlind) === index + 1) badges.push("大盲");
    if (nextState.allIn?.[id]) badges.push("全下");
    const stake = Number(nextState.streetBets?.[id]) || 0;
    const payout = Number(nextState.payouts?.[id]) || 0;
    const handName = handLabel(nextState.showdownRanks?.[id]);
    const cards = nextState.hands?.[id] ?? [];
    const showCards = isOwn || (revealAll && !folded);
    const cardNodes = cards.map((card) => cardElement(card, showCards));
    seat.innerHTML = `
      <div class="seat-heading">
        <span class="seat-name">${isOwn ? `玩家 ${index + 1} · 你` : `玩家 ${index + 1}`}</span>
        <span class="seat-badges">${badges.map((badge) => `<b>${badge}</b>`).join("")}</span>
      </div>
      <strong class="seat-chips">${Number(nextState.chips?.[id]) || 0}</strong>
      <span class="seat-meta">${folded ? "已弃牌" : payout > 0 ? `赢得 ${payout}` : stake > 0 ? `本轮 ${stake}` : handName || "等待行动"}</span>
    `;
    if (isOwn) {
      const cardsElement = document.createElement("div");
      cardsElement.className = "hole-cards";
      cardsElement.append(...cardNodes);
      seat.append(cardsElement);
    } else {
      const cardsElement = document.createElement("div");
      cardsElement.className = "opponent-cards";
      cardsElement.dataset.position = position;
      cardsElement.classList.toggle("is-folded", folded || !inHand);
      cardsElement.append(...cardNodes);
      opponentCards.push(cardsElement);
    }
    return seat;
  });
  elements.seats.replaceChildren(
    ...opponentCards,
    ...seats,
  );
}

function seatPositions(count) {
  return {
    2: ["top", "bottom"],
    3: ["upper-right", "bottom", "upper-left"],
    4: ["top", "right", "bottom", "left"],
    5: ["top", "upper-right", "lower-right", "bottom", "left"],
    6: ["top", "upper-right", "lower-right", "bottom", "lower-left", "upper-left"],
  }[count] ?? ["top", "bottom"];
}

function renderStatus(nextState, ownIndex, currentIndex) {
  if (!state) return;
  if (nextState.matchWinner) {
    const won = nextState.players.indexOf(nextState.matchWinner) === ownIndex;
    elements.kicker.textContent = "筹码赛结束";
    elements.heading.textContent = won ? "你赢下整桌" : `玩家 ${nextState.players.indexOf(nextState.matchWinner) + 1} 获胜`;
    elements.activity.textContent = "所有筹码已归一位玩家";
    return;
  }
  if (nextState.ended) {
    const won = Array.isArray(nextState.winners) && nextState.winners.includes(playerId);
    elements.kicker.textContent = nextState.lastEvent?.kind === "fold" ? "本手结束" : "摊牌";
    elements.heading.textContent = won ? "你赢得底池" : "等待下一手";
    elements.activity.textContent = resultText(nextState, ownIndex);
    return;
  }
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 正在行动`;
  } else if (ownIndex === currentIndex) {
    elements.kicker.textContent = "轮到你了";
    elements.heading.textContent = actionPrompt(nextState, playerId);
  } else {
    elements.kicker.textContent = "其他玩家行动中";
    elements.heading.textContent = `等待玩家 ${currentIndex + 1}`;
  }
  elements.activity.textContent = eventText(nextState, ownIndex);
}

function actionPrompt(nextState, id) {
  const amount = Math.max(0, Number(nextState.currentBet) - (Number(nextState.streetBets?.[id]) || 0));
  return amount > 0 ? `需要跟注 ${amount}，或选择加注` : "可以过牌，或主动下注";
}

function eventText(nextState, ownIndex) {
  const event = nextState.lastEvent;
  if (!event || event.kind === "dealt") return "庄家按钮每手顺时针移动，盲注为 1 / 2";
  const actor = Number(event.playerIndex) - 1 === ownIndex ? "你" : `玩家 ${event.playerIndex}`;
  const text = {
    checked: "过牌",
    called: `跟注 ${event.value}`,
    raised: `加注至 ${event.value}`,
    folded: "弃牌",
    all_in: "全下",
    left: "离开牌桌",
  }[event.kind];
  return text ? `${actor}${text}` : "等待下一步行动";
}

function resultText(nextState, ownIndex) {
  const winners = Array.isArray(nextState.winners) ? nextState.winners : [];
  if (nextState.lastEvent?.kind === "fold") {
    const winnerIndex = nextState.players.indexOf(winners[0]);
    return winnerIndex === ownIndex ? `对手弃牌，你收下 ${nextState.lastPot}` : `玩家 ${winnerIndex + 1} 收下 ${nextState.lastPot}`;
  }
  const ownRank = handLabel(nextState.showdownRanks?.[playerId]);
  if (ownRank) return `你的牌型：${ownRank}`;
  return winners.length > 1 ? "底池已按同牌型分配" : "公共牌和底牌已亮出";
}

function cardElement(card, faceUp) {
  const element = document.createElement("span");
  element.className = "playing-card";
  if (!faceUp || typeof card !== "number") {
    element.dataset.back = "true";
    element.setAttribute("aria-label", "未亮出的牌");
    return element;
  }
  const rank = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"][card % 13];
  const suit = ["♠", "♥", "♦", "♣"][Math.floor(card / 13)];
  const red = suit === "♥" || suit === "♦";
  element.dataset.red = String(red);
  element.innerHTML = `<b>${rank}</b><i>${suit}</i>`;
  element.setAttribute("aria-label", `${rank}${suit}`);
  return element;
}

function streetName(street, ended) {
  if (ended) return "摊牌";
  return ["翻牌前", "翻牌", "转牌", "河牌"][Number(street)] ?? "翻牌前";
}

function handLabel(name) {
  return {
    high_card: "高牌",
    one_pair: "一对",
    two_pair: "两对",
    three_of_a_kind: "三条",
    straight: "顺子",
    flush: "同花",
    full_house: "葫芦",
    four_of_a_kind: "四条",
    straight_flush: "同花顺",
  }[name] ?? "";
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
