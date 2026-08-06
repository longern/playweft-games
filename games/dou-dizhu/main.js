import { CircleOff, Lightbulb, RotateCcw, Send, createIcons } from "lucide";
import "@fontsource/roboto-slab/latin-700.css";
import { createPlayweftClient } from "../../src/playweft-client.js";
import {
  SOLO_AI_IDS,
  SOLO_PLAYER_ID,
  applySoloDouDizhuAction,
  classifySoloDouDizhuCards,
  chooseSoloDouDizhuAiAction,
  createSoloDouDizhuState,
  findSoloDouDizhuLegalPlay,
  soloDouDizhuCardsBeat,
  sortSoloDouDizhuCardsDescending,
} from "./solo.js";
import "../../src/base.css";
import "./styles.css";

createIcons({ icons: { CircleOff, Lightbulb, RotateCcw, Send } });

const SOLO_AI_TURN_DELAY_MS = 1200;
const TRICK_CHANGE_HOLD_MS = 900;
const BOTTOM_CARD_FLIP_SEQUENCE_MS = 700;
const BOTTOM_CARD_READ_MS = 2200;
const BOTTOM_CARD_COLLECT_MS = 750;

const elements = {
  layout: document.querySelector(".landlord-layout"),
  kicker: document.querySelector("#turn-kicker"),
  heading: document.querySelector("#turn-heading"),
  multiplier: document.querySelector("#multiplier"),
  message: document.querySelector("#table-message"),
  tablePlays: document.querySelector("#table-plays"),
  passMarkers: document.querySelector("#pass-markers"),
  bottomCards: document.querySelector("#bottom-cards"),
  hand: document.querySelector("#hand"),
  bidActions: document.querySelector("#bid-actions"),
  playActions: document.querySelector("#play-actions"),
  pass: document.querySelector("#pass-button"),
  hint: document.querySelector("#hint-button"),
  play: document.querySelector("#play-button"),
  playHint: document.querySelector("#play-hint"),
  resultPanel: document.querySelector("#result-panel"),
  resultTitle: document.querySelector("#result-title"),
  resultSummary: document.querySelector("#result-summary"),
  rematch: document.querySelector("#rematch-button"),
  bidButtons: [...document.querySelectorAll("[data-bid]")],
  playerPanels: {
    self: document.querySelector("#player-self"),
    left: document.querySelector("#player-left"),
    right: document.querySelector("#player-right"),
  },
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
let playerName = "";
let state;
let pendingAction;
let selected = new Set();
let playMode = "room";
let localMatchId;
let localVersion = 0;
let aiTurnTimer;
let trickChangeTimer;
let bottomCardCeremonyTimer;
let bottomCardCeremonyActive = false;
let bottomCardCeremonyEndsAt = 0;
let renderedPhase;
const tablePlayHistory = new Map();
const tablePassHistory = new Set();
let tableActivityAwaitingLead = false;
let tableActivityActivePlayer = "";
let lastRenderedTurnIndex = 0;

const isStandalone = window.parent === window;
const client = isStandalone
  ? undefined
  : createPlayweftClient({
      onReady: handleReady,
      onState: handleState,
      onActionResult: handleActionResult,
      onError: handleError,
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
elements.hint.addEventListener("click", selectHintedPlay);
elements.rematch.addEventListener("click", () => send({ type: "rematch" }));
window.addEventListener("pagehide", () => {
  window.clearTimeout(aiTurnTimer);
  window.clearTimeout(trickChangeTimer);
  window.clearTimeout(bottomCardCeremonyTimer);
  client?.destroy();
});

if (isStandalone) handleReady({ mode: "solo" });
else render(preview);

function handleReady(message) {
  playMode = message.mode ?? "room";
  playerName = typeof message.player?.name === "string"
    ? message.player.name.trim()
    : "";
  if (playMode === "solo") {
    playerId = SOLO_PLAYER_ID;
    localMatchId = `solo-${crypto.randomUUID()}`;
    localVersion = 0;
    handleState({
      playerId,
      state: createSoloDouDizhuState(),
      events: [],
      matchId: localMatchId,
      version: localVersion,
      serverTime: Date.now(),
    });
    scheduleSoloAiTurn();
    return;
  }
  playerId = message.playerId;
  setConnection("waiting", "房间已连接");
  elements.kicker.textContent = "等待房主开始";
  elements.heading.textContent = "三位玩家就位后开局";
}

function handleState(message) {
  playerId = playMode === "solo" ? SOLO_PLAYER_ID : message.playerId;
  state = message.state;
  setConnection("live", playMode === "solo" ? "本地 AI 对局" : "实时对局");
  render(state);
}

function handleActionResult(result) {
  if (!pendingAction || result.requestId !== pendingAction.id) return;
  if (pendingAction.type === "play") selected.clear();
  pendingAction = undefined;
  render(state ?? preview);
}

function handleError(error, _code, requestId) {
  if (pendingAction?.id === requestId) pendingAction = undefined;
  setConnection("error", playMode === "solo" ? "本地对局异常" : "连接异常");
  elements.message.textContent = error;
  render(state ?? preview);
}

function send(action) {
  if (pendingAction || !state) return;
  const requestId = dispatchAction(action);
  if (!requestId) {
    elements.message.textContent = "尚未连接 Playweft 平台";
  } else {
    pendingAction = { id: requestId, type: action.type };
  }
  render(state);
}

function selectHintedPlay() {
  if (!state || pendingAction || state.phase !== "playing") return;
  const ownIndex = state.players.indexOf(playerId);
  if (ownIndex !== Number(state.turnIndex) - 1) return;
  const target = state.lastPlay?.playerId === playerId ? null : state.lastPlay;
  const cards = findSoloDouDizhuLegalPlay(state.hands?.[playerId] ?? [], target);
  if (!cards) return;
  selected = new Set(cards);
  syncHandSelection();
}

function dispatchAction(action) {
  if (playMode !== "solo") return client?.sendAction(action);
  const requestId = crypto.randomUUID();
  window.queueMicrotask(() => {
    const result = applySoloDouDizhuAction(state, action, SOLO_PLAYER_ID);
    if (!result.accepted) {
      handleError(
        result.error?.message ?? "Action rejected",
        result.error?.code ?? "ACTION_REJECTED",
        requestId,
      );
      return;
    }
    publishLocalState(result.state, result.events);
    handleActionResult({ requestId, accepted: true });
    scheduleSoloAiTurn();
  });
  return requestId;
}

function scheduleSoloAiTurn() {
  window.clearTimeout(aiTurnTimer);
  if (playMode !== "solo" || !state || state.winner) return;
  const actorId = state.players[state.turnIndex - 1];
  if (!SOLO_AI_IDS.includes(actorId)) return;
  if (bottomCardCeremonyActive) {
    aiTurnTimer = window.setTimeout(
      scheduleSoloAiTurn,
      Math.max(0, bottomCardCeremonyEndsAt - performance.now()),
    );
    return;
  }
  const delay = state.lastEvent?.kind === "new_trick"
    ? TRICK_CHANGE_HOLD_MS + 700
    : SOLO_AI_TURN_DELAY_MS;
  aiTurnTimer = window.setTimeout(() => {
    const action = chooseSoloDouDizhuAiAction(state, actorId);
    if (!action) {
      handleError("电脑无法选择动作", "AI_ACTION_UNAVAILABLE");
      return;
    }
    const result = applySoloDouDizhuAction(state, action, actorId);
    if (!result.accepted) {
      handleError(
        result.error?.message ?? "Computer action rejected",
        result.error?.code ?? "AI_ACTION_REJECTED",
      );
      return;
    }
    publishLocalState(result.state, result.events);
    scheduleSoloAiTurn();
  }, delay);
}

function publishLocalState(nextState, events) {
  localVersion += 1;
  handleState({
    playerId: SOLO_PLAYER_ID,
    state: nextState,
    events,
    matchId: localMatchId,
    version: localVersion,
    serverTime: Date.now(),
  });
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
  const playing = live && !ended && nextState.phase === "playing";
  const responseTarget = nextState.lastPlay?.playerId === playerId
    ? null
    : nextState.lastPlay;
  const legalPlay = playing && isOwnTurn
    ? findSoloDouDizhuLegalPlay(ownHand, responseTarget)
    : undefined;
  const noLegalPlay = Boolean(playing && isOwnTurn && responseTarget && !legalPlay);
  const selectionIsLegal = selectedPlayIsLegal(nextState);
  const startedPlaying =
    renderedPhase === "bidding" && nextState.phase === "playing";

  elements.layout.classList.toggle("is-ended", ended);
  elements.multiplier.textContent = String(nextState.multiplier ?? 1);
  renderBottomCards(nextState, ownIndex, startedPlaying);
  players
    .slice(0, 3)
    .forEach((id, index) =>
      renderPlayer(nextState, id, index, ownIndex, currentIndex, ended),
    );
  renderTableActivity(nextState, ownIndex);
  const displayedOwnHand =
    bottomCardCeremonyActive && nextState.landlord === playerId
      ? ownHand.filter((card) => !nextState.bottomCards.includes(card))
      : ownHand;
  renderHand(
    displayedOwnHand,
    playing && isOwnTurn && !noLegalPlay && !bottomCardCeremonyActive,
  );

  const bidding = live && !ended && nextState.phase === "bidding";
  elements.bidActions.hidden = !bidding;
  elements.playActions.hidden = !playing;
  renderResult(nextState, ownIndex, live, ended);
  elements.rematch.hidden = !live || !ended || ownIndex < 0;
  elements.rematch.disabled = Boolean(pendingAction) || bottomCardCeremonyActive;
  elements.bidButtons.forEach((button) => {
    const bid = Number(button.dataset.bid);
    button.disabled =
      !isOwnTurn ||
      Boolean(pendingAction) ||
      bottomCardCeremonyActive ||
      (bid > 0 && bid <= Number(nextState.highestBid));
  });
  elements.play.disabled =
    !isOwnTurn ||
    Boolean(pendingAction) ||
    bottomCardCeremonyActive ||
    !selectionIsLegal;
  elements.hint.disabled =
    !isOwnTurn ||
    Boolean(pendingAction) ||
    bottomCardCeremonyActive ||
    noLegalPlay;
  elements.pass.disabled =
    !isOwnTurn ||
    Boolean(pendingAction) ||
    bottomCardCeremonyActive ||
    !nextState.lastPlay ||
    nextState.lastPlay.playerId === playerId;
  renderPlayHint({
    playing,
    isOwnTurn,
    noLegalPlay,
  });
  setCopy(nextState, ownIndex, currentIndex);
  renderedPhase = nextState.phase;
}

function renderBottomCards(nextState, ownIndex, startedPlaying) {
  const cards = Array.isArray(nextState.bottomCards)
    ? nextState.bottomCards
    : [];
  const revealed =
    nextState.phase === "playing" &&
    cards.length === 3 &&
    cards.every((card) => Number.isInteger(card));
  if (bottomCardCeremonyActive) return;

  if (nextState.phase === "bidding") {
    cancelBottomCardCeremony();
    elements.bottomCards.hidden = false;
    elements.bottomCards.classList.remove("is-revealing", "is-collecting");
    elements.bottomCards.removeAttribute("data-target");
    elements.bottomCards.style.removeProperty("--collect-x");
    elements.bottomCards.style.removeProperty("--collect-y");
    elements.bottomCards.replaceChildren();
    const count = Math.max(cards.length, 3);
    for (let index = 0; index < count; index += 1) {
      const back = document.createElement("span");
      back.className = "bottom-card-back";
      elements.bottomCards.append(back);
    }
    elements.bottomCards.setAttribute("aria-label", "三张未翻开的底牌");
    return;
  }

  if (revealed && startedPlaying) {
    startBottomCardCeremony(nextState, cards, ownIndex);
    return;
  }

  elements.bottomCards.hidden = true;
}

function startBottomCardCeremony(nextState, cards, ownIndex) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealHold = reducedMotion
    ? BOTTOM_CARD_READ_MS
    : BOTTOM_CARD_FLIP_SEQUENCE_MS + BOTTOM_CARD_READ_MS;
  const collectDuration = reducedMotion ? 0 : BOTTOM_CARD_COLLECT_MS;
  const landlordIndex = nextState.players.indexOf(nextState.landlord);
  const targetPosition = relativeSeatPosition(landlordIndex, ownIndex);

  window.clearTimeout(bottomCardCeremonyTimer);
  bottomCardCeremonyActive = true;
  bottomCardCeremonyEndsAt = performance.now() + revealHold + collectDuration;
  elements.bottomCards.replaceChildren();
  cards.forEach((card, index) => {
    const face = cardElement(card, "bottom-card", false);
    face.style.setProperty("--reveal-index", String(index));
    elements.bottomCards.append(face);
  });
  elements.bottomCards.hidden = false;
  elements.bottomCards.dataset.target = targetPosition;
  elements.bottomCards.classList.remove("is-collecting");
  elements.bottomCards.classList.add("is-revealing");
  elements.bottomCards.setAttribute("aria-label", "本局底牌");

  bottomCardCeremonyTimer = window.setTimeout(() => {
    setBottomCardCollectOffset(targetPosition);
    elements.bottomCards.classList.add("is-collecting");
    bottomCardCeremonyTimer = window.setTimeout(() => {
      bottomCardCeremonyActive = false;
      bottomCardCeremonyEndsAt = 0;
      elements.bottomCards.hidden = true;
      elements.bottomCards.classList.remove("is-revealing", "is-collecting");
      elements.bottomCards.style.removeProperty("--collect-x");
      elements.bottomCards.style.removeProperty("--collect-y");
      render(state ?? nextState);
    }, collectDuration);
  }, revealHold);
}

function setBottomCardCollectOffset(targetPosition) {
  const target = elements.playerPanels[targetPosition]?.querySelector(
    ".seat-marker",
  );
  if (!target) return;
  const cardsRect = elements.bottomCards.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const collectX =
    targetRect.left + targetRect.width / 2 -
    (cardsRect.left + cardsRect.width / 2);
  const collectY =
    targetRect.top + targetRect.height / 2 -
    (cardsRect.top + cardsRect.height / 2);
  elements.bottomCards.style.setProperty("--collect-x", `${collectX * 0.7}px`);
  elements.bottomCards.style.setProperty("--collect-y", `${collectY * 0.7}px`);
}

function cancelBottomCardCeremony() {
  window.clearTimeout(bottomCardCeremonyTimer);
  bottomCardCeremonyActive = false;
  bottomCardCeremonyEndsAt = 0;
}

function renderTableActivity(nextState, ownIndex) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const eventKind = nextState.lastEvent?.kind;

  if (nextState.phase === "bidding") {
    window.clearTimeout(trickChangeTimer);
    tablePlayHistory.clear();
    tablePassHistory.clear();
    tableActivityAwaitingLead = false;
    tableActivityActivePlayer = "";
  } else if (nextState.phase === "playing") {
    const currentId = players[Number(nextState.turnIndex) - 1];
    if (eventKind === "landlord") {
      window.clearTimeout(trickChangeTimer);
      tablePlayHistory.clear();
      tablePassHistory.clear();
      tableActivityAwaitingLead = false;
      tableActivityActivePlayer = bottomCardCeremonyActive ? "" : currentId;
      renderTableActivityElements(players, ownIndex);
      lastRenderedTurnIndex = Number(nextState.turnIndex) || 0;
      return;
    }
    if (!nextState.winner && currentId && eventKind !== "new_trick") {
      clearSeatActivity(currentId);
    }

    const actorIndex = Number(nextState.lastEvent?.playerIndex) - 1;
    const actorId = players[actorIndex];
    if ((eventKind === "play" || eventKind === "won") && actorId) {
      window.clearTimeout(trickChangeTimer);
      if (tableActivityAwaitingLead) {
        tablePlayHistory.clear();
        tablePassHistory.clear();
      } else {
        clearSeatActivity(actorId);
      }
      tableActivityAwaitingLead = false;
      tablePlayHistory.set(actorId, [...(nextState.lastPlay?.cards ?? [])]);
      tableActivityActivePlayer = nextState.winner ? "" : currentId;
    } else if (eventKind === "pass" && actorId) {
      clearSeatActivity(actorId);
      tablePassHistory.add(actorId);
      tableActivityActivePlayer = currentId;
    } else if (eventKind === "new_trick" && !tableActivityAwaitingLead) {
      const leaderId = players[Number(nextState.turnIndex) - 1];
      const finalPasserId = players[lastRenderedTurnIndex - 1];
      if (finalPasserId && finalPasserId !== leaderId) {
        clearSeatActivity(finalPasserId);
        tablePassHistory.add(finalPasserId);
      }
      tableActivityAwaitingLead = true;
      tableActivityActivePlayer = "";
      trickChangeTimer = window.setTimeout(() => {
        tablePlayHistory.clear();
        tableActivityActivePlayer = leaderId;
        renderTableActivityElements(players, ownIndex);
      }, TRICK_CHANGE_HOLD_MS);
    }
  }

  renderTableActivityElements(players, ownIndex);
  lastRenderedTurnIndex = Number(nextState.turnIndex) || 0;
}

function renderTableActivityElements(players, ownIndex) {
  elements.tablePlays.replaceChildren();
  elements.passMarkers.replaceChildren();
  players.forEach((id, index) => {
    const cards = tablePlayHistory.get(id) ?? [];
    if (cards.length > 0) {
      const play = document.createElement("div");
      play.className = "last-play";
      play.dataset.position = relativeSeatPosition(index, ownIndex);
      if (
        cards.length > 6 &&
        classifySoloDouDizhuCards(cards)?.type === "straight"
      ) {
        play.classList.add("is-two-row");
        const firstRowLength = Math.ceil(cards.length / 2);
        [cards.slice(0, firstRowLength), cards.slice(firstRowLength)].forEach(
          (rowCards) => {
            const row = document.createElement("div");
            row.className = "table-card-row";
            renderCards(row, rowCards, "table-card", false);
            play.append(row);
          },
        );
      } else {
        renderCards(play, cards, "table-card", false);
      }
      elements.tablePlays.append(play);
    }
    if (tablePassHistory.has(id)) {
      const marker = document.createElement("span");
      marker.className = "pass-marker";
      marker.dataset.position = relativeSeatPosition(index, ownIndex);
      marker.setAttribute("role", "status");
      marker.setAttribute("aria-label", "不出");
      const label = document.createElement("span");
      label.textContent = "不出";
      marker.append(label);
      elements.passMarkers.append(marker);
    }
  });
  if (tableActivityActivePlayer) {
    const activeIndex = players.indexOf(tableActivityActivePlayer);
    if (activeIndex >= 0) {
      const spinner = document.createElement("span");
      spinner.className = "turn-spinner";
      spinner.dataset.position = relativeSeatPosition(activeIndex, ownIndex);
      spinner.setAttribute("role", "status");
      spinner.setAttribute("aria-label", "正在出牌");
      elements.tablePlays.append(spinner);
    }
  }
}

function clearSeatActivity(player) {
  tablePlayHistory.delete(player);
  tablePassHistory.delete(player);
}

function relativeSeatPosition(index, ownIndex) {
  const relative = (index - Math.max(ownIndex, 0) + 3) % 3;
  return ["self", "left", "right"][relative];
}

function renderPlayHint({ playing, isOwnTurn, noLegalPlay }) {
  const message = playing && isOwnTurn && !pendingAction && noLegalPlay
    ? "没有能压过的牌"
    : "";
  elements.playHint.hidden = !message;
  elements.playHint.textContent = message;
  elements.pass.classList.toggle("is-recommended", noLegalPlay);
}

function renderResult(nextState, ownIndex, live, ended) {
  elements.resultPanel.hidden = !live || !ended;
  if (!live || !ended) return;
  const winnerLabel = nextState.winnerTeam === "landlord" ? "地主" : "农民";
  const ownWon = didOwnTeamWin(nextState, ownIndex);
  elements.resultPanel.dataset.outcome = ownIndex < 0
    ? "spectator"
    : ownWon
      ? "win"
      : "loss";
  elements.resultTitle.textContent = ownIndex < 0
    ? `${winnerLabel}获胜`
    : ownWon
      ? "你方获胜"
      : "你输了";
  elements.resultSummary.textContent =
    `${winnerLabel}获胜 · 倍数 ×${nextState.multiplier ?? 1}`;
}

function didOwnTeamWin(nextState, ownIndex) {
  if (ownIndex < 0) return false;
  const ownTeam = nextState.landlord === playerId ? "landlord" : "farmers";
  return nextState.winnerTeam === ownTeam;
}

function renderPlayer(nextState, id, index, ownIndex, currentIndex, ended) {
  const position = relativeSeatPosition(index, ownIndex);
  const panel = elements.playerPanels[position];
  const hand = nextState.hands?.[id] ?? [];
  const isLandlord = nextState.landlord === id;
  const displayedHandCount = Math.max(
    0,
    hand.length - (bottomCardCeremonyActive && isLandlord ? 3 : 0),
  );
  const opponentHand = panel.querySelector(".opponent-hand");
  const bidStatus = panel.querySelector("[data-bid-status]");
  const emptiedHand = ended && hand.length === 0;
  panel.querySelector("[data-player-name]").textContent =
    playerDisplayName(nextState, id, index, ownIndex);
  panel.querySelector("[data-role]").textContent = nextState.phase === "bidding"
    ? ""
    : isLandlord
      ? "地主"
      : "农民";
  panel.querySelector("[data-hand-count]").textContent = emptiedHand
    ? "已出完"
    : String(displayedHandCount);
  opponentHand.classList.toggle("is-empty", emptiedHand);
  opponentHand.setAttribute(
    "aria-label",
    emptiedHand ? "已出完手牌" : `剩余 ${displayedHandCount} 张牌`,
  );
  const hasBid =
    nextState.phase === "bidding" && Object.hasOwn(nextState.bids ?? {}, id);
  const bid = Number(nextState.bids?.[id]);
  bidStatus.hidden = !hasBid;
  bidStatus.textContent = bid > 0 ? `叫 ${bid} 分` : "不叫";
  bidStatus.classList.toggle("is-pass", hasBid && bid === 0);
  panel.dataset.position = position;
  panel.classList.toggle("is-current", !ended && index === currentIndex);
  panel.classList.toggle("is-landlord", isLandlord);
  panel.classList.toggle("is-winner", nextState.winner === id);
}

function playerDisplayName(nextState, id, index, ownIndex) {
  const savedName = nextState.playerNames?.[index];
  if (typeof savedName === "string" && savedName.trim()) {
    return savedName.trim();
  }
  if (index === ownIndex && playerName) return playerName;
  if (playMode === "solo" && SOLO_AI_IDS.includes(id)) {
    return `电脑 ${SOLO_AI_IDS.indexOf(id) + 1}`;
  }
  return `玩家 ${index + 1}`;
}

function renderHand(cards, enabled) {
  elements.hand.replaceChildren();
  sortSoloDouDizhuCardsDescending(cards).forEach((card, index) => {
    const button = cardElement(card, "hand-card", true);
    button.dataset.card = String(card);
    button.style.setProperty("--card-index", String(index + 1));
    button.disabled = !enabled || Boolean(pendingAction);
    setHandCardSelected(button, selected.has(card));
    button.addEventListener("click", () => {
      if (selected.has(card)) selected.delete(card);
      else selected.add(card);
      syncHandSelection();
    });
    elements.hand.append(button);
  });
}

function syncHandSelection() {
  elements.hand.querySelectorAll(".hand-card").forEach((button) => {
    setHandCardSelected(button, selected.has(Number(button.dataset.card)));
  });
  elements.play.disabled = !selectedPlayIsLegal(state);
}

function setHandCardSelected(button, isSelected) {
  button.classList.toggle("is-selected", isSelected);
  button.setAttribute("aria-pressed", String(isSelected));
}

function selectedPlayIsLegal(nextState) {
  if (!nextState || nextState.phase !== "playing") return false;
  const selectedCards = [...selected];
  const selectedCombo = selectedCards.length
    ? classifySoloDouDizhuCards(selectedCards)
    : undefined;
  const responseTarget = nextState.lastPlay?.playerId === playerId
    ? null
    : nextState.lastPlay;
  return Boolean(
    selectedCombo && soloDouDizhuCardsBeat(selectedCombo, responseTarget),
  );
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
  element.className = `${className}${red ? " is-red" : ""}${joker ? " is-joker" : ""}${rank === "10" ? " is-ten" : ""}`;
  element.innerHTML = joker
    ? '<span class="card-face"><span class="joker-word" aria-hidden="true"><span>J</span><span>O</span><span>K</span><span>E</span><span>R</span></span></span>'
    : `<span class="card-face"><span class="card-corner" aria-hidden="true"><span class="card-rank">${rank}</span><span class="card-suit">${suit}</span></span></span>`;
  element.setAttribute("aria-label", `${rank}${suit}`);
  return element;
}

function cardFace(card) {
  if (card === 53) return { rank: "小王", suit: "", red: false, joker: true };
  if (card === 54) return { rank: "大王", suit: "", red: true, joker: true };
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
  const currentPlayerName = playerDisplayName(
    nextState,
    players[currentIndex],
    currentIndex,
    ownIndex,
  );
  elements.message.hidden = false;
  if (nextState.winner) {
    const won = didOwnTeamWin(nextState, ownIndex);
    elements.kicker.textContent = `本局倍数 ${nextState.multiplier ?? 1}`;
    elements.heading.textContent = ownIndex < 0
      ? "本局结束"
      : won
        ? "你方获胜"
        : "你输了";
    elements.message.textContent =
      nextState.winnerTeam === "landlord" ? "地主获胜" : "农民获胜";
    return;
  }
  if (nextState.phase === "bidding") {
    if (ownIndex < 0) {
      elements.kicker.textContent = "观战中";
      elements.heading.textContent = `${currentPlayerName} 正在叫分`;
    } else if (ownIndex === currentIndex) {
      elements.kicker.textContent = "轮到你叫分";
      elements.heading.textContent = "选择本局叫分";
    } else {
      elements.kicker.textContent = "叫分阶段";
      elements.heading.textContent = "等待其他玩家叫分";
    }
    elements.message.hidden = true;
    elements.message.textContent = "";
    return;
  }
  const landlordIndex = players.indexOf(nextState.landlord);
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `${currentPlayerName} 的回合`;
  } else if (ownIndex === currentIndex) {
    elements.kicker.textContent = "轮到你出牌";
    elements.heading.textContent = nextState.lastPlay
      ? "选择能压过桌面的牌"
      : "请先出牌";
  } else {
    elements.kicker.textContent = "等待对手";
    elements.heading.textContent = `${currentPlayerName} 正在出牌`;
  }
  if (nextState.lastPlay) {
    elements.message.hidden = true;
    elements.message.textContent = comboLabel(nextState.lastPlay.type);
  } else if (nextState.lastEvent?.kind === "new_trick") {
    elements.message.hidden = true;
    elements.message.textContent = "";
  } else if (landlordIndex >= 0) {
    elements.message.textContent = `${playerDisplayName(
      nextState,
      players[landlordIndex],
      landlordIndex,
      ownIndex,
    )} 是地主，先出牌`;
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
  if (!elements.connection) return;
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
