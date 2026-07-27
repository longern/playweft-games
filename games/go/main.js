import {
  CircleHelp,
  Flag,
  RotateCcw,
  Settings2,
  createIcons,
} from "lucide";
import gameScript from "./game.lua?raw";
import { createPlayweftClient } from "../../src/playweft-client.js";
import "../../src/base.css";
import "./styles.css";

const elements = {
  connection: document.querySelector("#connection"),
  heading: document.querySelector("#turn-heading"),
  kicker: document.querySelector("#turn-kicker"),
  message: document.querySelector("#board-message"),
  board: document.querySelector("#board"),
  table: document.querySelector("#table-layout"),
  setupPanel: document.querySelector("#setup-panel"),
  setupForm: document.querySelector("#setup-form"),
  setupNote: document.querySelector("#setup-note"),
  sizeSetting: document.querySelector("#size-setting"),
  rulesSetting: document.querySelector("#rules-setting"),
  komiSetting: document.querySelector("#komi-setting"),
  blackSetting: document.querySelector("#black-setting"),
  handicapSetting: document.querySelector("#handicap-setting"),
  setupFeedback: document.querySelector("#setup-feedback"),
  start: document.querySelector("#start-button"),
  startLabel: document.querySelector("#start-label"),
  pass: document.querySelector("#pass-button"),
  rematch: document.querySelector("#rematch-button"),
  settings: document.querySelector("#settings-button"),
  settingsSummary: document.querySelector("#settings-summary"),
  round: document.querySelector("#round-number"),
  moveCount: document.querySelector("#move-count"),
  players: [
    document.querySelector("#black-player"),
    document.querySelector("#white-player"),
  ],
};

let playerId;
let state;
let pendingActionId;
let settingsRequestId;
let queuedSettings;
let draftSettings;
const points = [];
let boardSize = 0;
let setupCloseTimer;

createIcons({ icons: { CircleHelp, Flag, RotateCcw, Settings2 } });

const preview = {
  players: ["preview-one", "preview-two"],
  phase: "playing",
  settings: {
    size: 9,
    rules: "chinese",
    komi: 6.5,
    handicap: 0,
    blackMode: "random",
  },
  board: Array.from({ length: 9 }, () => Array(9).fill(0)),
  current: 1,
  blackIndex: 1,
  captures: [0, 0],
  consecutivePasses: 0,
  moves: 0,
  ended: false,
  winner: "",
  winnerIndex: 0,
  scores: { black: 0, white: 0, komi: 6.5 },
  lastMove: { row: 0, column: 0 },
  lastEvent: { kind: "start", playerIndex: 1, captured: 0 },
  round: 1,
};

const client = createPlayweftClient({
  descriptor: {
    name: "Go",
    translations: {
      "zh-CN": { name: "围棋" },
    },
    icon: "/go.svg",
    helpUrl: "./help.html",
  },
  script: gameScript,
  minPlayers: 2,
  maxPlayers: 2,
  onReady(message) {
    playerId = message.playerId;
    setConnection("waiting", "房间已连接");
    elements.kicker.textContent = "等待房主开始";
    elements.heading.textContent = "两位棋手就位后开局";
  },
  onState(message) {
    playerId = message.playerId;
    state = message.state;
    if (
      state.phase === "setup" &&
      draftSettings &&
      sameSettings(state.settings, draftSettings)
    ) {
      draftSettings = undefined;
    } else if (state.phase !== "setup") {
      settingsRequestId = undefined;
      queuedSettings = undefined;
      draftSettings = undefined;
    }
    setConnection("live", "实时对局");
    render(state);
  },
  onActionResult(result) {
    if (result.requestId === settingsRequestId) {
      settingsRequestId = undefined;
      if (queuedSettings && state?.phase === "setup" && !pendingActionId) {
        sendSettingsUpdate(queuedSettings);
      }
      return;
    }
    if (result.requestId !== pendingActionId) return;
    pendingActionId = undefined;
    if (state?.phase === "setup") {
      showSetupFeedback("设置已确认，正在同步棋盘…", "pending");
      return;
    }
    render(state ?? preview);
  },
  onError(error, code, requestId) {
    if (requestId === settingsRequestId) {
      settingsRequestId = undefined;
      queuedSettings = undefined;
      draftSettings = undefined;
      if (!pendingActionId) {
        const message = translateError(error, code);
        render(state ?? preview, true);
        showSetupFeedback(message, "error");
      }
      return;
    }
    if (requestId === pendingActionId) pendingActionId = undefined;
    setConnection("error", "连接异常");
    const message = translateError(error, code);
    elements.message.textContent = message;
    render(state ?? preview, true);
    if (state?.phase === "setup") {
      showSetupFeedback(message, "error");
    }
  },
});

window.addEventListener("pagehide", () => client.destroy());
elements.setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearSetupFeedback();
  queuedSettings = undefined;
  draftSettings = undefined;
  const sent = sendAction({
    type: "start",
    ...readSetupSettings(),
  }, false);
  if (!sent) {
    showSetupFeedback("尚未连接 Playweft 房间", "error");
    return;
  }
  showSetupFeedback("正在创建对局…", "pending");
  elements.kicker.textContent = "正在开局";
  elements.heading.textContent = "同步对局设置";
  setSetupOpen(false);
});
elements.setupForm.addEventListener("input", (event) => {
  if (!isSettingControl(event.target)) return;
  updateHandicapControls();
  syncSetupSettings();
});
elements.pass.addEventListener("click", () => sendAction({ type: "pass" }));
elements.rematch.addEventListener("click", () => sendAction({ type: "rematch" }));
elements.settings.addEventListener("click", () => sendAction({ type: "configure" }));
render(preview);

function buildBoard(size) {
  elements.board.replaceChildren();
  points.length = 0;
  boardSize = size;
  elements.board.style.setProperty("--edge", `${50 / size}%`);
  elements.board.style.setProperty("--point-size", `${90 / size}%`);
  elements.board.style.setProperty("--line-step", `${100 / (size - 1)}%`);
  const star = size === 9 ? [3, 5, 7] : size === 13 ? [4, 7, 10] : [4, 10, 16];

  for (let row = 1; row <= size; row += 1) {
    for (let column = 1; column <= size; column += 1) {
      const point = document.createElement("button");
      point.type = "button";
      point.className = "go-point";
      point.style.top = `${(row - 0.5) * (100 / size)}%`;
      point.style.left = `${(column - 0.5) * (100 / size)}%`;
      point.setAttribute("role", "gridcell");
      point.setAttribute("aria-label", `第 ${row} 行，第 ${column} 列`);
      point.disabled = true;
      if (
        star.includes(row) &&
        star.includes(column)
      ) {
        point.classList.add("is-star");
      }
      point.addEventListener("click", () =>
        sendAction({ type: "play", row, column }),
      );
      elements.board.append(point);
      points.push(point);
    }
  }
}

function sendAction(action, renderPendingState = true) {
  if (pendingActionId || !state) return;
  const requestId = client.sendAction(action);
  if (!requestId) {
    elements.message.textContent = "尚未连接 Playweft 平台";
    return false;
  } else {
    pendingActionId = requestId;
  }
  if (renderPendingState) render(state);
  return true;
}

function render(nextState, preserveMessage = false) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const isSetup = nextState.phase === "setup";
  const size = Number(nextState.settings?.size) || nextState.board?.length || 9;
  if (boardSize !== size) buildBoard(size);

  if (isSetup) {
    renderSetup(nextState, ownIndex);
    renderSetupBoard(nextState, size);
    setSetupOpen(!pendingActionId);
    return;
  }
  setSetupOpen(false);
  clearSetupFeedback();

  const currentIndex = Number(nextState.current) - 1;
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const whiteIndex = blackIndex === 0 ? 1 : 0;
  const ended = Boolean(nextState.ended);
  elements.board.dataset.turnColor =
    currentIndex === blackIndex ? "black" : "white";
  const canAct =
    Boolean(state) && !ended && ownIndex === currentIndex && !pendingActionId;

  elements.round.textContent = String(nextState.round ?? 1);
  elements.moveCount.textContent = `已落 ${nextState.moves ?? 0} 子`;
  elements.pass.disabled = !canAct;
  elements.pass.hidden = ended;
  elements.rematch.hidden = !state || !ended || ownIndex < 0;
  elements.rematch.disabled = Boolean(pendingActionId);
  elements.settings.hidden = !state || !ended || ownIndex < 0;
  elements.settings.disabled = Boolean(pendingActionId);
  elements.settingsSummary.textContent = settingSummary(nextState.settings);

  const colorPlayers = [
    { playerIndex: blackIndex, label: "黑方", color: 1 },
    { playerIndex: whiteIndex, label: "白方", color: 2 },
  ];
  colorPlayers.forEach(({ playerIndex, label, color }, panelIndex) => {
    const panel = elements.players[panelIndex];
    const name = playerIndex === ownIndex ? `${label} · 你` : `${label} · 玩家 ${playerIndex + 1}`;
    panel.querySelector("[data-player-name]").textContent = name;
    const detail = panel.querySelector("[data-player-detail]");
    if (ended && nextState.scores) {
      const score = color === 1 ? nextState.scores.black : nextState.scores.white;
      detail.textContent = `${formatScore(score)} 目${color === 2 ? " · 含贴 6.5" : ""}`;
    } else {
      const captures = Number(nextState.captures?.[playerIndex]) || 0;
      detail.textContent = `提子 ${captures}${color === 2 ? " · 贴 6.5 目" : ""}`;
    }
    panel.classList.toggle(
      "is-current",
      !ended && playerIndex === currentIndex,
    );
    panel.classList.toggle(
      "is-winner",
      ended && Number(nextState.winnerIndex) - 1 === playerIndex,
    );
  });

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const point = points[row * size + column];
      const value = Number(nextState.board?.[row]?.[column]) || 0;
      point.dataset.piece = String(value);
      point.disabled = !canAct || value !== 0;
      point.classList.toggle(
        "is-last",
        value !== 0 &&
          Number(nextState.lastMove?.row) === row + 1 &&
          Number(nextState.lastMove?.column) === column + 1,
      );
      const pieceName = value === 1 ? "黑子" : value === 2 ? "白子" : "空位";
      point.setAttribute(
        "aria-label",
        `第 ${row + 1} 行，第 ${column + 1} 列，${pieceName}`,
      );
    }
  }

  if (!state) return;
  if (ended) {
    const won = Number(nextState.winnerIndex) - 1 === ownIndex;
    const left = nextState.lastEvent?.kind === "player_left";
    elements.kicker.textContent = left ? "对手离开" : "双方停一手";
    elements.heading.textContent = ownIndex < 0
      ? `玩家 ${nextState.winnerIndex} 获胜`
      : won ? "你赢了" : "对手获胜";
    if (!preserveMessage) {
      elements.message.textContent = left
        ? "对局提前结束"
        : `黑 ${formatScore(nextState.scores?.black)} · 白 ${formatScore(nextState.scores?.white)}`;
    }
    return;
  }

  if (ownIndex < 0) {
    elements.kicker.textContent = "观战中";
    elements.heading.textContent = `玩家 ${currentIndex + 1} 正在思考`;
  } else if (ownIndex === currentIndex) {
    elements.kicker.textContent = "轮到你了";
    elements.heading.textContent = "选择交叉点落子";
  } else {
    elements.kicker.textContent = "对手回合";
    elements.heading.textContent = "等待对手落子";
  }

  if (preserveMessage) return;
  if (Number(nextState.consecutivePasses) === 1) {
    elements.message.textContent = "对手刚刚停一手；你也停一手将立即计分";
  } else if (Number(nextState.lastEvent?.captured) > 0) {
    elements.message.textContent = `刚刚提掉 ${nextState.lastEvent.captured} 颗棋子`;
  } else {
    elements.message.textContent =
      ownIndex === currentIndex ? "落子，或选择停一手" : "已同步最新棋盘";
  }
}

function formatScore(score) {
  const value = Number(score);
  return Number.isFinite(value) ? value.toFixed(value % 1 === 0 ? 0 : 1) : "0";
}

function renderSetup(nextState, ownIndex) {
  const ownPlayer = ownIndex >= 0 ? nextState.players?.[ownIndex] : undefined;
  const hostId = nextState.hostId ?? nextState.players?.[0];
  const isHost = Boolean(state) && ownPlayer === hostId;
  const canConfigure = isHost && !pendingActionId;
  const settings =
    (isHost && draftSettings) || nextState.settings || preview.settings;
  elements.kicker.textContent = nextState.round > 1 ? "准备下一局" : "等待开局";
  elements.heading.textContent = "棋盘已就绪";
  elements.setupNote.textContent = canConfigure
    ? "调整会立即同步给另一方，确认后开始"
    : "设置会随房主调整实时更新";
  elements.sizeSetting.value = String(settings.size ?? 9);
  elements.rulesSetting.value = settings.rules ?? "chinese";
  elements.komiSetting.value = String(settings.komi ?? 6.5);
  elements.blackSetting.value = settings.blackMode ?? "random";
  elements.handicapSetting.value = String(settings.handicap ?? 0);
  const controls = [
    elements.sizeSetting,
    elements.rulesSetting,
    elements.komiSetting,
    elements.blackSetting,
    elements.handicapSetting,
    elements.start,
  ];
  for (const control of controls) {
    control.disabled = !canConfigure;
  }
  elements.start.disabled = !canConfigure;
  elements.startLabel.textContent = pendingActionId ? "正在开始…" : "开始对局";
  updateHandicapControls();
}

function renderSetupBoard(nextState, size) {
  elements.round.textContent = String(nextState.round ?? 1);
  elements.moveCount.textContent = "已落 0 子";
  elements.settingsSummary.textContent = settingSummary(nextState.settings);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const point = points[row * size + column];
      point.dataset.piece = String(
        Number(nextState.board?.[row]?.[column]) || 0,
      );
      point.disabled = true;
      point.classList.remove("is-last");
    }
  }
}

function setSetupOpen(open) {
  window.clearTimeout(setupCloseTimer);
  document.body.classList.toggle("has-setup-modal", open);
  elements.table.inert = open;
  elements.table.setAttribute("aria-hidden", String(open));

  if (open) {
    if (elements.setupPanel.dataset.state === "open") return;
    elements.setupPanel.hidden = false;
    elements.setupPanel.dataset.state = "opening";
    window.requestAnimationFrame(() => {
      elements.setupPanel.dataset.state = "open";
      const focusTarget = elements.sizeSetting.disabled
        ? elements.setupForm
        : elements.sizeSetting;
      focusTarget.focus({ preventScroll: true });
    });
    return;
  }

  if (elements.setupPanel.hidden) return;
  elements.setupPanel.dataset.state = "closing";
  setupCloseTimer = window.setTimeout(() => {
    elements.setupPanel.hidden = true;
    delete elements.setupPanel.dataset.state;
  }, 220);
}

function showSetupFeedback(message, mode) {
  elements.setupFeedback.hidden = false;
  elements.setupFeedback.dataset.mode = mode;
  elements.setupFeedback.textContent = message;
  elements.startLabel.textContent = mode === "pending" ? "正在开始…" : "开始对局";
}

function clearSetupFeedback() {
  elements.setupFeedback.hidden = true;
  elements.setupFeedback.removeAttribute("data-mode");
  elements.setupFeedback.textContent = "";
  elements.startLabel.textContent = "开始对局";
}

function updateHandicapControls() {
  const hasHandicap = Number(elements.handicapSetting.value) > 0;
  const randomOption = elements.blackSetting.querySelector('option[value="random"]');
  randomOption.disabled = hasHandicap;
  if (hasHandicap && elements.blackSetting.value === "random") {
    elements.blackSetting.value = "player1";
  }
}

function isSettingControl(target) {
  return [
    elements.sizeSetting,
    elements.rulesSetting,
    elements.komiSetting,
    elements.blackSetting,
    elements.handicapSetting,
  ].includes(target);
}

function readSetupSettings() {
  return {
    size: Number(elements.sizeSetting.value),
    rules: elements.rulesSetting.value,
    komi: Number(elements.komiSetting.value),
    blackMode: elements.blackSetting.value,
    handicap: Number(elements.handicapSetting.value),
  };
}

function syncSetupSettings() {
  if (
    state?.phase !== "setup" ||
    elements.start.disabled ||
    !elements.komiSetting.value ||
    !elements.komiSetting.validity.valid
  ) {
    return;
  }
  const settings = readSetupSettings();
  draftSettings = settings;
  clearSetupFeedback();
  if (settingsRequestId) {
    queuedSettings = settings;
    return;
  }
  sendSettingsUpdate(settings);
}

function sendSettingsUpdate(settings) {
  queuedSettings = undefined;
  const requestId = client.sendAction({
    type: "update_settings",
    ...settings,
  });
  if (!requestId) {
    draftSettings = undefined;
    showSetupFeedback("尚未连接 Playweft 房间", "error");
    return;
  }
  settingsRequestId = requestId;
}

function sameSettings(left = {}, right = {}) {
  return (
    Number(left.size) === Number(right.size) &&
    left.rules === right.rules &&
    Number(left.komi) === Number(right.komi) &&
    left.blackMode === right.blackMode &&
    Number(left.handicap) === Number(right.handicap)
  );
}

function settingSummary(settings = {}) {
  const rules = settings.rules === "japanese" ? "日本规则" : "中国规则";
  const handicap = Number(settings.handicap) > 0 ? ` · 让 ${settings.handicap} 子` : "";
  return `${settings.size ?? 9} × ${settings.size ?? 9} · ${rules} · 贴 ${formatScore(settings.komi)} 目${handicap}`;
}

function translateError(error, code) {
  const messages = {
    occupied: "这个交叉点已经有棋子",
    OCCUPIED: "这个交叉点已经有棋子",
    suicide: "这里不能落子：棋子将没有气",
    SUICIDE: "这里不能落子：棋子将没有气",
    ko: "劫争：不能立即还原上一手棋盘",
    KO: "劫争：不能立即还原上一手棋盘",
    not_your_turn: "还没轮到你",
    NOT_YOUR_TURN: "还没轮到你",
    game_over: "本局已经结束",
    GAME_OVER: "本局已经结束",
    handicap_requires_fixed_black: "让子时需要指定一位玩家执黑",
    HANDICAP_REQUIRES_FIXED_BLACK: "让子时需要指定一位玩家执黑",
    only_host_can_setup: "只有房主可以调整并确认对局设置",
    ONLY_HOST_CAN_SETUP: "只有房主可以调整并确认对局设置",
  };
  return messages[code] ?? messages[error] ?? error;
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
