import { createIcons, Eye, EyeOff, RotateCcw, Vote } from "lucide";
import { createPlayweftClient } from "../../src/playweft-client.js";
import { startDealer } from "./dealer.js";
import "../../src/base.css";
import "./styles.css";
import "./dealer.css";

const elements = {
  root: document.querySelector(".dealer-layout"),
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

const roomView = [...elements.root.children].filter(
  (element) => !(element instanceof HTMLTemplateElement),
);
const preview = {
  players: Array.from({ length: 6 }, (_, index) => `preview-${index}`),
  roles: {},
  status: {},
  votes: {},
  flips: [],
  round: 1,
  voteRound: 1,
  lastEvent: { kind: "setup" },
};

let playerId;
let state;
let pendingActionId;
let visibleRound;
let roleVisible = false;
let playMode = "room";
let localStarted = false;
let roomSetupController;

const isStandalone = window.parent === window;
const client = isStandalone
  ? undefined
  : createPlayweftClient({
      onReady(message) {
        playMode = message.mode ?? "room";
        if (playMode === "solo") {
          startLocalDealer();
          return;
        }
        playerId = message.playerId;
        setConnection("waiting", "房间已连接");
      },
      onState(message) {
        if (playMode === "solo") return;
        playerId = message.playerId;
        state = message.state;
        setConnection(
          "live",
          state.phase === "setup" ? "房间配置中" : "实时房间",
        );
        render(state);
      },
      onActionResult(result) {
        if (playMode === "solo" || result.requestId !== pendingActionId) return;
        pendingActionId = undefined;
        render(state ?? preview);
      },
      onError(error, _code, requestId) {
        if (requestId === pendingActionId) pendingActionId = undefined;
        setConnection("error", "操作失败");
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
window.addEventListener("pagehide", () => {
  roomSetupController?.destroy();
  client?.destroy();
});

if (isStandalone) startLocalDealer();
else render(preview);

function startLocalDealer() {
  if (localStarted) return;
  localStarted = true;
  playMode = "solo";
  startDealer({
    root: elements.root,
    setConnection,
    confirmAction: isStandalone
      ? (message) => Promise.resolve(window.confirm(message))
      : (message) => client.confirm(message),
  });
}

function send(action) {
  if (pendingActionId || !state || playMode !== "room") return false;
  const id = client?.sendAction(action);
  if (!id) {
    elements.message.textContent = "尚未连接 Playweft 平台";
    return false;
  }
  pendingActionId = id;
  render(state);
  return true;
}

function render(next) {
  if (playMode === "solo") return;
  if (next.phase === "setup") {
    renderRoomSetup(next);
    return;
  }

  restoreRoomView();
  const players = next.players ?? [];
  const ownIndex = players.indexOf(playerId);
  const ownRole = next.roles?.[playerId];
  const active = players.filter((id) => next.status?.[id] === "alive");
  const ownAlive = next.status?.[playerId] === "alive";
  const votedFor = next.votes?.[playerId];
  if (visibleRound !== next.round) {
    visibleRound = next.round;
    roleVisible = false;
  }
  elements.voteRound.textContent = String(next.voteRound ?? 1);
  elements.activeCount.textContent = `${active.length} 在场`;
  renderOwnRole(ownRole, Boolean(state));
  renderPlayers(next, players, ownIndex, ownAlive, votedFor, Boolean(state));
  renderFlips(next, players);
  elements.redeal.hidden = false;
  elements.redeal.disabled = !state || Boolean(pendingActionId) || ownIndex < 0;
  const votes = active.filter((id) => next.votes?.[id]).length;
  elements.voteProgress.textContent = `${next.config?.name ?? "当前版型"} · 已投 ${votes} / ${active.length}`;
  if (state) renderStatus(next, players, ownIndex, active.length, votedFor);
}

function renderRoomSetup(next) {
  const room = {
    canConfigure: Boolean(next.canConfigure),
    playerCount: next.players?.length ?? 6,
    config: next.config ?? null,
  };
  if (!roomSetupController) {
    roomSetupController = startDealer({
      root: elements.root,
      setConnection,
      confirmAction: (message) => client.confirm(message),
      room: {
        ...room,
        onConfigure(config) {
          send(
            config ? { type: "configure", config } : { type: "clear_config" },
          );
        },
        onDeal(config) {
          send({ type: "deal", config });
        },
      },
    });
    return;
  }
  roomSetupController.update(room);
}

function restoreRoomView() {
  if (!roomSetupController) return;
  roomSetupController.destroy();
  roomSetupController = undefined;
  elements.root.replaceChildren(...roomView);
}

function detail(role) {
  if (!role) return undefined;
  if (typeof role === "string")
    return { id: role, name: role, mark: "?", copy: "" };
  return role;
}

function renderOwnRole(role, live) {
  const roleDetail = roleVisible ? detail(role) : undefined;
  elements.roleCard.dataset.role = roleDetail?.id ?? "hidden";
  elements.roleEmblem.textContent = roleDetail?.mark ?? "?";
  elements.roleName.textContent =
    roleDetail?.name ?? (live ? "身份未翻开" : "等待发牌");
  elements.roleCopy.textContent =
    roleDetail?.copy ?? state?.config?.rules ?? "开局后由你自己翻开身份牌";
  elements.roleReveal.disabled = !live || !role || Boolean(pendingActionId);
  elements.roleReveal.innerHTML = roleVisible
    ? '<span class="icon-button-content"><i data-lucide="eye-off"></i><span>盖回身份</span></span>'
    : '<span class="icon-button-content"><i data-lucide="eye"></i><span>查看身份</span></span>';
  renderIcons();
}

function renderPlayers(next, players, ownIndex, ownAlive, votedFor, live) {
  const active = players.filter((id) => next.status?.[id] === "alive");
  elements.playerField.innerHTML = active
    .map((id) => {
      const index = players.indexOf(id);
      const self = index === ownIndex;
      const selected = votedFor === id;
      const canVote = live && ownAlive && !pendingActionId;
      return `<article class="player-seat${self ? " is-self" : ""}${selected ? " is-selected" : ""}">
        <div class="seat-number">${index + 1}</div>
        <div class="seat-copy"><strong>${self ? "你" : `玩家 ${index + 1}`}</strong><span>${next.votes?.[id] ? "已投票" : "等待投票"}</span></div>
        <button class="vote-action" data-target="${id}" ${canVote ? "" : "disabled"}><i data-lucide="vote"></i><span>${selected ? "已投" : "投票"}</span></button>
      </article>`;
    })
    .join("");
  elements.playerField.querySelectorAll("[data-target]").forEach((button) => {
    button.addEventListener("click", () =>
      send({ type: "vote", target: button.dataset.target }),
    );
  });
  renderIcons();
}

function renderFlips(next, players) {
  const flips = next.flips ?? [];
  elements.flipHeading.textContent = flips.length
    ? `已翻 ${flips.length} 张身份牌`
    : "尚无人出局";
  elements.flipLog.innerHTML = flips.length
    ? flips
        .map((flip) => {
          const role = detail(flip.role);
          return `<article class="flip-entry"><span class="flip-mark">${escapeHtml(role?.mark ?? "?")}</span><div><strong>${playerLabel(players, flip.player)} · ${escapeHtml(role?.name ?? "未知身份")}</strong><p>已翻牌并离场。</p></div></article>`;
        })
        .join("")
    : '<p class="empty-flips">投票结算后，出局玩家的身份会显示在这里。</p>';
}

function renderStatus(next, players, ownIndex, activeCount, votedFor) {
  const event = next.lastEvent ?? {};
  const player = event.player ? playerLabel(players, event.player) : "";
  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `${activeCount} 位玩家仍在场`;
    return;
  }
  if (next.status?.[playerId] !== "alive") {
    elements.kicker.textContent = "已离场";
    elements.heading.textContent = "等待本局其余投票";
    return;
  }
  if (event.kind === "eliminated") {
    elements.kicker.textContent = "翻牌结算";
    elements.heading.textContent = `${player} 是${detail(event.role)?.name ?? "未知身份"}`;
    elements.message.textContent = "下一轮投票已经开始。";
    return;
  }
  if (event.kind === "tied") {
    elements.kicker.textContent = "平票";
    elements.heading.textContent = "无人出局，重新投票";
    return;
  }
  elements.kicker.textContent = `第 ${next.round} 局 · ${next.config?.name ?? "狼人杀"}`;
  elements.heading.textContent = votedFor
    ? "你的票已提交"
    : "请选择本轮投票目标";
  elements.message.textContent =
    next.config?.rules || "全部在场玩家投票后，系统自动结算并翻牌。";
}

function playerLabel(players, id) {
  const index = players.indexOf(id);
  return index >= 0 ? `玩家 ${index + 1}` : "玩家";
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

function renderIcons() {
  createIcons({ icons: { Eye, EyeOff, RotateCcw, Vote } });
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
