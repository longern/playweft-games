import {
  CircleHelp,
  Flag,
  History,
  RotateCcw,
  Settings2,
  Trash2,
  X,
  createIcons,
} from "lucide";
import {
  createGoHistoryStore,
  goRecordToSgf,
  historyResultLabel,
  updateGoHistory,
} from "./history.js";
import {
  applySoloGoAction,
  calculateGoScore,
  createSoloGoState,
} from "./solo.js";
import { createPlayweftClient } from "../../src/playweft-client.js";
import "../../src/base.css";
import "./styles.css";

const elements = {
  connection: document.querySelector("#connection"),
  board: document.querySelector("#board"),
  boardShell: document.querySelector(".board-shell"),
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
  historyPanel: document.querySelector("#history-panel"),
  historyDialog: document.querySelector("#history-dialog"),
  historyNote: document.querySelector("#history-note"),
  historyList: document.querySelector("#history-list"),
  historyOpen: document.querySelector("#history-button"),
  historyClose: document.querySelector("#history-close"),
  historyClear: document.querySelector("#history-clear"),
  historyClearLabel: document.querySelector("#history-clear-label"),
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
  playerTimes: [...document.querySelectorAll("[data-player-time]")],
};

let playerId;
let state;
let pendingAction;
let settingsRequestId;
let queuedSettings;
let draftSettings;
let scoreRequestRound;
let playMode = "room";
let localMatchId;
let localVersion = 0;
const points = [];
let boardSize = 0;
let setupCloseTimer;
let historyCloseTimer;
let historyClearTimer;
let serverTimeAtSync;
let localTimeAtSync;

createIcons({
  icons: { CircleHelp, Flag, History, RotateCcw, Settings2, Trash2, X },
});
const clockTimer = window.setInterval(renderClocks, 1000);
const historyStore = createGoHistoryStore();

const preview = {
  players: ["preview-one", "preview-two"],
  phase: "playing",
  settings: {
    size: 19,
    rules: "chinese",
    komi: 6.5,
    handicap: 0,
    blackMode: "random",
  },
  board: Array.from({ length: 19 }, () => Array(19).fill(0)),
  current: 1,
  blackIndex: 1,
  captures: [0, 0],
  consecutivePasses: 0,
  moves: 0,
  ended: false,
  winner: "",
  winnerIndex: 0,
  scores: { black: 0, white: 0, komi: 6.5 },
  timeUsed: [0, 0],
  turnStartedAt: 0,
  scoreRound: 0,
  scoreSubmitted: [false, false],
  lastMove: { row: 0, column: 0 },
  lastEvent: { kind: "start", playerIndex: 1, captured: 0 },
  round: 1,
};

const client = createPlayweftClient({
  onReady: handleReady,
  onState: handleState,
  onActionResult: handleActionResult,
  onError: handleError,
});

function handleReady(message) {
  playMode = message.mode ?? "room";
  if (playMode === "solo") {
    playerId = "solo-player-1";
    localMatchId = `solo-${crypto.randomUUID()}`;
    localVersion = 0;
    const now = Date.now();
    handleState({
      playerId,
      state: createSoloGoState(),
      events: [],
      matchId: localMatchId,
      version: localVersion,
      serverTime: now,
    });
    return;
  }
  playerId = message.playerId;
  setConnection("waiting", "房间已连接");
}

function handleState(message) {
  playerId = playMode === "solo" ? "solo-player-1" : message.playerId;
  state = message.state;
  historyStore.save(updateGoHistory(historyStore.load(), message));
  if (!elements.historyPanel.hidden) renderHistory();
  serverTimeAtSync = Number.isFinite(Number(message.serverTime))
    ? Number(message.serverTime)
    : undefined;
  localTimeAtSync = Date.now();
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
  if (state.phase !== "scoring") {
    scoreRequestRound = undefined;
  } else if (
    scoreRequestRound !== undefined &&
    scoreRequestRound !== Number(state.scoreRound)
  ) {
    scoreRequestRound = undefined;
  }
  setConnection("live", playMode === "solo" ? "本机轮流对弈" : "实时对局");
  render(state);
  submitScoreIfNeeded();
}

function handleActionResult(result) {
  if (result.requestId === settingsRequestId) {
    settingsRequestId = undefined;
    if (queuedSettings && state?.phase === "setup" && !pendingAction) {
      sendSettingsUpdate(queuedSettings);
    }
    return;
  }
  if (result.requestId !== pendingAction?.requestId) return;
  const completedAction = pendingAction;
  pendingAction = undefined;
  if (state?.phase === "setup") {
    if (completedAction.type === "configure") {
      render(state);
      return;
    }
    showSetupFeedback("设置已确认，正在同步棋盘…", "pending");
    return;
  }
  render(state ?? preview);
  submitScoreIfNeeded();
}

function handleError(error, code, requestId) {
  if (requestId === settingsRequestId) {
    settingsRequestId = undefined;
    queuedSettings = undefined;
    draftSettings = undefined;
    if (!pendingAction) {
      const message = translateError(error, code);
      render(state ?? preview);
      showSetupFeedback(message, "error");
    }
    return;
  }
  if (requestId === pendingAction?.requestId) {
    pendingAction = undefined;
    if (
      state?.phase === "scoring" &&
      scoreRequestRound === Number(state.scoreRound)
    ) {
      scoreRequestRound = undefined;
    }
  }
  const message = translateError(error, code);
  setConnection("error", message);
  render(state ?? preview);
  if (state?.phase === "setup") {
    showSetupFeedback(message, "error");
  }
}

window.addEventListener("pagehide", () => {
  window.clearInterval(clockTimer);
  window.clearTimeout(historyClearTimer);
  client.destroy();
});
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
elements.historyOpen.addEventListener("click", () => setHistoryOpen(true));
elements.historyClose.addEventListener("click", () => setHistoryOpen(false));
elements.historyPanel.addEventListener("click", (event) => {
  if (event.target === elements.historyPanel) setHistoryOpen(false);
});
elements.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-history-export]");
  if (button) exportHistoryRecord(button.dataset.historyExport);
});
elements.historyClear.addEventListener("click", () => {
  if (elements.historyClear.dataset.confirm !== "true") {
    elements.historyClear.dataset.confirm = "true";
    elements.historyClearLabel.textContent = "再次点击确认清空";
    window.clearTimeout(historyClearTimer);
    historyClearTimer = window.setTimeout(resetHistoryClear, 3000);
    return;
  }
  historyStore.save([]);
  resetHistoryClear();
  renderHistory();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.historyPanel.hidden) {
    setHistoryOpen(false);
  }
});
render(preview);

function buildBoard(size) {
  elements.board.replaceChildren();
  elements.boardShell.setAttribute("aria-label", `${size} × ${size} 围棋棋盘`);
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
  if (pendingAction || !state) return;
  const requestId = dispatchAction(action);
  if (!requestId) {
    setConnection("error", "尚未连接 Playweft 平台");
    return false;
  }
  pendingAction = { requestId, type: action.type };
  if (renderPendingState) render(state);
  return true;
}

function dispatchAction(action) {
  if (playMode !== "solo") return client.sendAction(action);
  const requestId = crypto.randomUUID();
  window.queueMicrotask(() => {
    const result = applySoloGoAction(state, action, { now: Date.now() });
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

function render(nextState) {
  const players = Array.isArray(nextState.players) ? nextState.players : [];
  const ownIndex = players.indexOf(playerId);
  const isSetup = nextState.phase === "setup";
  const actionPending = Boolean(pendingAction);
  const size = Number(nextState.settings?.size) || nextState.board?.length || 19;
  if (boardSize !== size) buildBoard(size);

  if (isSetup) {
    renderSetup(nextState, ownIndex);
    renderSetupBoard(nextState, size);
    setSetupOpen(!actionPending);
    return;
  }
  setSetupOpen(false);
  clearSetupFeedback();

  const currentIndex = Number(nextState.current) - 1;
  const blackIndex = Math.max(0, Number(nextState.blackIndex) - 1);
  const whiteIndex = blackIndex === 0 ? 1 : 0;
  const ended = Boolean(nextState.ended);
  const isScoring = nextState.phase === "scoring";
  elements.board.dataset.turnColor =
    currentIndex === blackIndex ? "black" : "white";
  const canAct =
    Boolean(state) &&
    !ended &&
    !isScoring &&
    (playMode === "solo" || ownIndex === currentIndex) &&
    !actionPending;

  elements.round.textContent = String(nextState.round ?? 1);
  elements.moveCount.textContent = `已落 ${nextState.moves ?? 0} 子`;
  elements.pass.disabled = !canAct;
  elements.pass.hidden = ended || isScoring;
  elements.rematch.hidden = !state || !ended || ownIndex < 0;
  elements.rematch.disabled = actionPending;
  elements.settings.hidden = !state || !ended || ownIndex < 0;
  elements.settings.disabled = actionPending;
  elements.settingsSummary.textContent = settingSummary(nextState.settings);
  renderClocks();

  const colorPlayers = [
    { playerIndex: blackIndex, label: "黑方", color: 1 },
    { playerIndex: whiteIndex, label: "白方", color: 2 },
  ];
  colorPlayers.forEach(({ playerIndex, label, color }, panelIndex) => {
    const panel = elements.players[panelIndex];
    const name = playMode === "solo"
      ? `${label} · 本机`
      : playerIndex === ownIndex
        ? `${label} · 你`
        : `${label} · 玩家 ${playerIndex + 1}`;
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
  if (isScoring) {
    const submitted = Boolean(nextState.scoreSubmitted?.[ownIndex]);
    setConnection(
      "live",
      submitted ? "已提交，等待对方确认" : "双方确认计分中",
    );
    return;
  }
  if (ended) {
    const left = nextState.lastEvent?.kind === "player_left";
    setConnection("live", left ? "对局提前结束" : "对局已结束");
    return;
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
  const canConfigure = isHost && !pendingAction;
  const settings =
    (isHost && draftSettings) || nextState.settings || preview.settings;
  elements.setupNote.textContent = canConfigure
    ? playMode === "solo"
      ? "本机控制黑白双方轮流落子"
      : "调整会立即同步给另一方，确认后开始"
    : "设置会随房主调整实时更新";
  elements.sizeSetting.value = String(settings.size ?? 19);
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
  elements.startLabel.textContent = pendingAction ? "正在开始…" : "开始对局";
  updateHandicapControls();
}

function renderSetupBoard(nextState, size) {
  elements.round.textContent = String(nextState.round ?? 1);
  elements.moveCount.textContent = "已落 0 子";
  elements.settingsSummary.textContent = settingSummary(nextState.settings);
  renderClocks();
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

function setHistoryOpen(open) {
  window.clearTimeout(historyCloseTimer);
  document.body.classList.toggle("has-history-modal", open);
  elements.table.inert = open;
  elements.table.setAttribute("aria-hidden", String(open));

  if (open) {
    renderHistory();
    elements.historyPanel.hidden = false;
    elements.historyPanel.dataset.state = "opening";
    window.requestAnimationFrame(() => {
      elements.historyPanel.dataset.state = "open";
      elements.historyDialog.focus({ preventScroll: true });
    });
    return;
  }

  if (elements.historyPanel.hidden) return;
  resetHistoryClear();
  elements.historyPanel.dataset.state = "closing";
  historyCloseTimer = window.setTimeout(() => {
    elements.historyPanel.hidden = true;
    delete elements.historyPanel.dataset.state;
    elements.historyOpen.focus({ preventScroll: true });
  }, 220);
}

function resetHistoryClear() {
  window.clearTimeout(historyClearTimer);
  delete elements.historyClear.dataset.confirm;
  elements.historyClearLabel.textContent = "清空全部";
}

function renderHistory() {
  const records = historyStore.load();
  elements.historyNote.textContent = historyStore.persistent
    ? "最近 50 局，仅保存在此浏览器"
    : "本地存储不可用，仅保留当前页面会话";
  elements.historyClear.disabled = records.length === 0;
  elements.historyList.replaceChildren();

  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "完成或进行中的棋局会自动出现在这里";
    elements.historyList.append(empty);
    return;
  }

  for (const record of records) {
    const entry = document.createElement("article");
    entry.className = "history-entry";

    const main = document.createElement("div");
    main.className = "history-entry-main";
    const title = document.createElement("p");
    title.className = "history-entry-title";
    title.textContent =
      `第 ${record.round} 局 · 黑方 ${record.blackPlayer} 对 白方 ${record.whitePlayer}`;
    const meta = document.createElement("p");
    meta.className = "history-entry-meta";
    const settings = record.settings ?? {};
    meta.textContent = [
      new Date(record.createdAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      `${settings.size ?? 19} × ${settings.size ?? 19}`,
      settings.rules === "japanese" ? "日本规则" : "中国规则",
      `${record.moves?.length ?? 0} 手`,
      record.partial ? "部分记录" : "",
    ].filter(Boolean).join(" · ");
    main.append(title, meta);

    const result = document.createElement("p");
    result.className = "history-entry-result";
    result.textContent = historyResultLabel(record);

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "history-export";
    exportButton.dataset.historyExport = record.id;
    exportButton.textContent = "导出 SGF";

    entry.append(main, result, exportButton);
    elements.historyList.append(entry);
  }
}

function exportHistoryRecord(recordId) {
  const record = historyStore.load().find((entry) => entry.id === recordId);
  if (!record) return;
  const content = goRecordToSgf(record);
  const blob = new Blob([content], { type: "application/x-go-sgf;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date(record.createdAt).toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `go-${date}-round-${record.round}.sgf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
  const requestId = dispatchAction({
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

function submitScoreIfNeeded() {
  if (
    state?.phase !== "scoring" ||
    pendingAction ||
    scoreRequestRound === Number(state.scoreRound)
  ) {
    return;
  }
  const ownIndex = state.players?.indexOf(playerId) ?? -1;
  if (ownIndex < 0 || state.scoreSubmitted?.[ownIndex]) return;

  const round = Number(state.scoreRound);
  scoreRequestRound = round;
  const sent = sendAction({
    type: "score",
    scoreRound: round,
    score: calculateGoScore(state),
  }, false);
  if (!sent) {
    scoreRequestRound = undefined;
    return;
  }
  setConnection("live", "正在提交计分确认");
}

function renderClocks() {
  if (!state || state.phase === "setup") {
    for (const time of elements.playerTimes) {
      time.textContent = "00:00";
      time.dateTime = "PT0S";
    }
    return;
  }
  const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
  const playerIndexes = [blackIndex, blackIndex === 0 ? 1 : 0];
  const currentIndex = Number(state.current) - 1;
  const estimatedServerTime = Number.isFinite(serverTimeAtSync)
    ? serverTimeAtSync + (Date.now() - localTimeAtSync)
    : Number(state.turnStartedAt);

  playerIndexes.forEach((playerIndex, colorIndex) => {
    let milliseconds = Math.max(0, Number(state.timeUsed?.[playerIndex]) || 0);
    if (!state.ended && playerIndex === currentIndex) {
      milliseconds += Math.max(
        0,
        estimatedServerTime - (Number(state.turnStartedAt) || estimatedServerTime),
      );
    }
    const seconds = Math.floor(milliseconds / 1000);
    elements.playerTimes[colorIndex].textContent = formatDuration(seconds);
    elements.playerTimes[colorIndex].dateTime = `PT${seconds}S`;
  });
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function settingSummary(settings = {}) {
  const rules = settings.rules === "japanese" ? "日本规则" : "中国规则";
  const handicap = Number(settings.handicap) > 0 ? ` · 让 ${settings.handicap} 子` : "";
  return `${settings.size ?? 19} × ${settings.size ?? 19} · ${rules} · 贴 ${formatScore(settings.komi)} 目${handicap}`;
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
    invalid_score: "计分结果无效",
    INVALID_SCORE: "计分结果无效",
    scoring_required: "当前正在等待双方确认计分",
    SCORING_REQUIRED: "当前正在等待双方确认计分",
    stale_score_round: "计分状态已更新，请重新确认",
    STALE_SCORE_ROUND: "计分状态已更新，请重新确认",
    score_already_submitted: "你已经提交了本轮计分结果",
    SCORE_ALREADY_SUBMITTED: "你已经提交了本轮计分结果",
  };
  return messages[code] ?? messages[error] ?? error;
}

function setConnection(mode, label) {
  elements.connection.dataset.mode = mode;
  elements.connection.querySelector("span").textContent = label;
}
