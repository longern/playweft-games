import { createIcons, Eye, EyeOff, RotateCcw, Vote } from "lucide";
import gameScript from "./game.lua?raw";
import { createPlayweftClient } from "../src/playweft-client.js";
import "../src/base.css";
import "./styles.css";

const ROLE_DETAILS = {
  werewolf: { name: "狼人", mark: "W", copy: "每晚与同伴确认目标。" },
  villager: { name: "平民", mark: "V", copy: "观察发言，在白天投票。" },
  seer: { name: "预言家", mark: "S", copy: "每晚可以查验一位玩家。" },
  witch: { name: "女巫", mark: "P", copy: "持有解药与毒药，各限一次。" },
  hunter: { name: "猎人", mark: "H", copy: "出局时可发动猎枪。" },
  white_god: { name: "白神", mark: "G", copy: "被投出后翻牌，立即离场。" },
};

const elements = {
  connection: document.querySelector("#connection"),
  kicker: document.querySelector("#round-kicker"),
  heading: document.querySelector("#round-heading"),
  message: document.querySelector("#round-message"),
  roleCard: document.querySelector("#role-card"),
  roleEmblem: document.querySelector("#role-emblem"),
  roleName: document.querySelector("#role-name"),
  roleCopy: document.querySelector("#role-copy"),
  roleReveal: document.querySelector("#role-reveal"),
  voteRound: document.querySelector("#vote-round"),
  activeCount: document.querySelector("#active-count"),
  playerField: document.querySelector("#player-field"),
  voteProgress: document.querySelector("#vote-progress"),
  redeal: document.querySelector("#redeal-button"),
  flipHeading: document.querySelector("#flip-heading"),
  flipLog: document.querySelector("#flip-log"),
};

let playerId;
let state;
let pendingActionId;
let roleVisible = false;
let visibleRound;

const preview = {
  players: [
    "preview-one",
    "preview-two",
    "preview-three",
    "preview-four",
    "preview-five",
    "preview-six",
  ],
  roles: {
    "preview-one": "seer",
    "preview-two": "witch",
    "preview-three": "hunter",
    "preview-four": "white_god",
    "preview-five": "werewolf",
    "preview-six": "werewolf",
  },
  status: {
    "preview-one": "alive",
    "preview-two": "alive",
    "preview-three": "alive",
    "preview-four": "alive",
    "preview-five": "alive",
    "preview-six": "alive",
  },
  votes: {},
  flips: [],
  round: 1,
  voteRound: 1,
  lastEvent: { kind: "dealt", round: 1 },
};

const client = createPlayweftClient({
  descriptor: {
    name: "Werewolf Dealer",
    translations: {
      "zh-CN": { name: "狼人杀发牌器" },
    },
    icon: "/werewolf-dealer.svg",
    helpUrl: "./help.html",
  },
  script: gameScript,
  minPlayers: 6,
  maxPlayers: 12,
  onReady(message) {
    playerId = message.playerId;
    setConnection("waiting", "房间已连接");
    elements.kicker.textContent = "等待房主开始";
    elements.heading.textContent = "6 至 12 位玩家就位后开局";
  },
  onState(message) {
    playerId = message.playerId;
    state = message.state;
    setConnection("live", "实时房间");
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
    elements.message.textContent = error;
    render(state ?? preview);
  },
});

elements.roleReveal.addEventListener("click", () => {
  if (!state || !state.roles?.[playerId]) return;
  roleVisible = !roleVisible;
  render(state);
});
elements.redeal.addEventListener("click", () => send({ type: "rematch" }));
window.addEventListener("pagehide", () => client.destroy());

render(preview);

function send(action) {
  if (pendingActionId || !state) return;
  const requestId = client.sendAction(action);
  if (!requestId) {
    elements.message.textContent = "尚未连接 Playweft 平台";
  } else {
    pendingActionId = requestId;
  }
  render(state);
}

function playerLabel(players, id) {
  const index = players.indexOf(id);
  return index >= 0 ? `玩家 ${index + 1}` : "玩家";
}

function isAlive(nextState, id) {
  return nextState.status?.[id] === "alive";
}

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const ownRole = nextState.roles?.[playerId];
  const live = Boolean(state);
  const activePlayers = players.filter((id) => isAlive(nextState, id));
  const ownAlive = isAlive(nextState, playerId);
  const votedFor = nextState.votes?.[playerId];

  if (visibleRound !== nextState.round) {
    visibleRound = nextState.round;
    roleVisible = false;
  }

  elements.voteRound.textContent = String(nextState.voteRound ?? 1);
  elements.activeCount.textContent = `${activePlayers.length} 在场`;
  renderOwnRole(ownRole, live);
  renderPlayers(nextState, players, ownIndex, ownAlive, votedFor, live);
  renderFlips(nextState, players);

  elements.redeal.disabled = !live || Boolean(pendingActionId) || ownIndex < 0;
  const votesCast = activePlayers.filter((id) => nextState.votes?.[id]).length;
  elements.voteProgress.textContent = activePlayers.length
    ? `已投 ${votesCast} / ${activePlayers.length}，所有在场玩家投票后自动翻牌`
    : "牌桌已空，可重新发牌开始下一局";

  if (!live) return;
  renderStatus(nextState, players, ownIndex, activePlayers.length, votedFor);
}

function renderOwnRole(role, live) {
  const detail = roleVisible && role ? ROLE_DETAILS[role] : undefined;
  elements.roleCard.dataset.role = detail ? role : "hidden";
  elements.roleEmblem.textContent = detail?.mark ?? "?";
  elements.roleName.textContent =
    detail?.name ?? (live ? "身份未翻开" : "等待发牌");
  elements.roleCopy.textContent = detail?.copy ?? "开局后由你自己翻开身份牌";
  elements.roleReveal.disabled = !live || !role || Boolean(pendingActionId);
  elements.roleReveal.innerHTML = roleVisible
    ? '<span class="icon-button-content"><i data-lucide="eye-off"></i><span>盖回身份</span></span>'
    : '<span class="icon-button-content"><i data-lucide="eye"></i><span>查看身份</span></span>';
}

function renderPlayers(nextState, players, ownIndex, ownAlive, votedFor, live) {
  const active = players.filter((id) => isAlive(nextState, id));
  elements.playerField.innerHTML = active
    .map((id) => {
      const index = players.indexOf(id);
      const self = index === ownIndex;
      const selected = votedFor === id;
      const canVote = live && ownAlive && !pendingActionId;
      return `
        <article class="player-seat${self ? " is-self" : ""}${selected ? " is-selected" : ""}">
          <div class="seat-number">${index + 1}</div>
          <div class="seat-copy">
            <strong>${self ? "你" : `玩家 ${index + 1}`}</strong>
            <span>${nextState.votes?.[id] ? "已投票" : "等待投票"}</span>
          </div>
          <button class="vote-action" type="button" data-target="${id}" ${canVote ? "" : "disabled"} aria-label="投票给玩家 ${index + 1}">
            <i data-lucide="vote"></i><span>${selected ? "已投" : "投票"}</span>
          </button>
        </article>`;
    })
    .join("");
  elements.playerField.querySelectorAll("[data-target]").forEach((button) => {
    button.addEventListener("click", () =>
      send({ type: "vote", target: button.dataset.target }),
    );
  });
  createIcons({ icons: { Eye, EyeOff, RotateCcw, Vote } });
}

function renderFlips(nextState, players) {
  const flips = Array.isArray(nextState.flips) ? nextState.flips : [];
  elements.flipHeading.textContent = flips.length
    ? `已翻 ${flips.length} 张身份牌`
    : "尚无人出局";
  elements.flipLog.innerHTML = flips.length
    ? flips
        .map((flip) => {
          const detail = ROLE_DETAILS[flip.role] ?? {
            name: "未知身份",
            mark: "?",
          };
          return `<article class="flip-entry" data-role="${flip.role}">
            <span class="flip-mark">${detail.mark}</span>
            <div><strong>${playerLabel(players, flip.player)} · ${detail.name}</strong><p>${flip.whiteGod ? "白神已翻牌并离场，不保留在场上。" : "已翻牌并离场。"}</p></div>
          </article>`;
        })
        .join("")
    : '<p class="empty-flips">投票结算后，出局玩家的身份会显示在这里。</p>';
}

function renderStatus(nextState, players, ownIndex, activeCount, votedFor) {
  const event = nextState.lastEvent ?? {};
  const player = event.player ? playerLabel(players, event.player) : "";
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `${activeCount} 位玩家仍在场`;
    elements.message.textContent = "身份牌仅由入座玩家查看";
    return;
  }
  if (!isAlive(nextState, playerId)) {
    elements.kicker.textContent = "已离场";
    elements.heading.textContent = "等待本局其余投票";
    elements.message.textContent = "你不能再参与投票，但可以查看翻牌记录";
    return;
  }
  if (event.kind === "eliminated") {
    const detail = ROLE_DETAILS[event.role];
    elements.kicker.textContent = "翻牌结算";
    elements.heading.textContent = `${player} 是${detail?.name ?? "未知身份"}`;
    elements.message.textContent = event.whiteGod
      ? "白神翻牌后立即离场，未保留在场上。"
      : "下一轮投票已经开始。";
    return;
  }
  if (event.kind === "tied") {
    elements.kicker.textContent = "平票";
    elements.heading.textContent = "无人出局，重新投票";
    elements.message.textContent = "本轮票数相同，所有在场玩家重新选择。";
    return;
  }
  if (event.kind === "rejected") {
    elements.kicker.textContent = "操作未生效";
    elements.heading.textContent = "请等待牌桌更新";
    elements.message.textContent = rejectionText(event.reason);
    return;
  }
  if (event.kind === "left") {
    elements.kicker.textContent = "玩家离开";
    elements.heading.textContent = `${player} 已离场`;
    elements.message.textContent = "本轮投票已重置。";
    return;
  }
  elements.kicker.textContent = `第 ${nextState.round} 局 · 投票中`;
  elements.heading.textContent = votedFor
    ? "你的票已提交"
    : "请选择本轮投票目标";
  elements.message.textContent =
    event.kind === "vote_cast"
      ? `${player} 已投票，等待其他玩家。`
      : "全部在场玩家投票后，系统自动结算并翻牌。";
}

function rejectionText(reason) {
  return (
    {
      not_alive: "离场玩家不能投票。",
      target_not_alive: "该玩家已经离场。",
      invalid_target: "请选择一位仍在场的玩家。",
    }[reason] ?? "该操作目前不能执行。"
  );
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
