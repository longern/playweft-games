const STORAGE_KEY = "playweft:go-history:v1";
const HISTORY_LIMIT = 50;

export function createGoHistoryStore(getStorage = () => window.localStorage) {
  let memory = [];
  let persistent = true;

  return {
    load() {
      try {
        const value = getStorage().getItem(STORAGE_KEY);
        if (value) {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) memory = parsed;
        }
      } catch {
        persistent = false;
      }
      return memory;
    },
    save(records) {
      memory = records;
      try {
        getStorage().setItem(STORAGE_KEY, JSON.stringify(records));
      } catch {
        persistent = false;
      }
    },
    get persistent() {
      return persistent;
    },
  };
}

export function updateGoHistory(records, snapshot, recordedAt = Date.now()) {
  const { matchId, version, state, events = [] } = snapshot;
  if (!matchId || !state || state.phase === "setup") return records;

  const id = `${matchId}:${state.round ?? 1}`;
  const nextRecords = records.map((record) => ({
    ...record,
    settings: { ...record.settings },
    initialBlack: [...(record.initialBlack ?? [])],
    moves: [...(record.moves ?? [])],
    captures: [...(record.captures ?? [])],
    timeUsed: [...(record.timeUsed ?? [])],
  }));
  let record = nextRecords.find((entry) => entry.id === id);
  const versionNumber = Number(version);
  const hasVersion = Number.isFinite(versionNumber);
  if (
    record &&
    hasVersion &&
    Number.isFinite(Number(record.lastVersion)) &&
    versionNumber <= Number(record.lastVersion)
  ) {
    return records;
  }

  if (!record) {
    const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
    const whiteIndex = blackIndex === 0 ? 1 : 0;
    record = {
      id,
      matchId,
      round: Number(state.round) || 1,
      createdAt: recordedAt,
      updatedAt: recordedAt,
      status: state.phase,
      settings: { ...state.settings },
      blackPlayer: `玩家 ${blackIndex + 1}`,
      whitePlayer: `玩家 ${whiteIndex + 1}`,
      initialBlack: Number(state.moves) === 0
        ? collectInitialBlack(state.board)
        : [],
      partial: Number(state.moves) > 0,
      moves: [],
      timeUsed: [0, 0],
    };
    nextRecords.push(record);
  }

  const moveEvents = events.filter(
    (event) => event?.type === "played" || event?.type === "passed",
  );
  if (moveEvents.length === 0) {
    const fallback = fallbackMoveEvent(state);
    if (fallback) moveEvents.push(fallback);
  }
  for (const event of moveEvents) {
    appendMove(record, event, state, hasVersion ? versionNumber : undefined);
  }

  record.updatedAt = recordedAt;
  record.status = state.ended ? "ended" : state.phase;
  record.settings = { ...state.settings };
  record.captures = [...(state.captures ?? [0, 0])];
  record.timeUsed = [...(state.timeUsed ?? [0, 0])];
  if (hasVersion) record.lastVersion = versionNumber;
  if (state.ended) {
    const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
    record.endedAt ??= recordedAt;
    record.result = {
      winnerColor: Number(state.winnerIndex) - 1 === blackIndex ? "B" : "W",
      black: Number(state.scores?.black) || 0,
      white: Number(state.scores?.white) || 0,
      reason:
        state.lastEvent?.kind === "player_left" ||
        state.lastEvent?.kind === "resigned"
          ? "resign"
          : "score",
    };
  }

  return nextRecords
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, HISTORY_LIMIT);
}

export function goRecordToSgf(record) {
  const settings = record.settings ?? {};
  const properties = [
    "GM[1]",
    "FF[4]",
    "CA[UTF-8]",
    "AP[Playweft]",
    `SZ[${settings.size ?? 19}]`,
    `KM[${settings.komi ?? 0}]`,
    `RU[${settings.rules === "japanese" ? "Japanese" : "Chinese"}]`,
    `PB[${escapeSgf(record.blackPlayer ?? "黑方")}]`,
    `PW[${escapeSgf(record.whitePlayer ?? "白方")}]`,
    `DT[${new Date(record.createdAt).toISOString().slice(0, 10)}]`,
  ];
  const handicap = Number(settings.handicap) || 0;
  if (handicap > 0) properties.push(`HA[${handicap}]`);
  if (record.initialBlack?.length) {
    properties.push(
      `AB${record.initialBlack.map((point) => `[${toSgfPoint(point)}]`).join("")}`,
    );
  }
  const result = formatSgfResult(record.result);
  if (result) properties.push(`RE[${result}]`);

  const moves = (record.moves ?? []).map((move) => {
    const point = move.pass ? "" : toSgfPoint(move);
    return `;${move.color}[${point}]`;
  });
  return `(;${properties.join("")}${moves.join("")})`;
}

export function historyResultLabel(record) {
  if (record.status === "scoring") return "计分确认中";
  if (!record.result) return "进行中";
  if (record.result.reason === "resign") {
    return `${record.result.winnerColor === "B" ? "黑方" : "白方"}胜`;
  }
  const difference = Math.abs(record.result.black - record.result.white);
  return `${record.result.winnerColor === "B" ? "黑方" : "白方"}胜 ${formatNumber(difference)} 目`;
}

function appendMove(record, event, state, version) {
  if (
    version !== undefined &&
    record.moves.some((move) => move.version === version)
  ) {
    return;
  }
  const playerIndex = state.players?.indexOf(event.player) ?? -1;
  const blackIndex = Math.max(0, Number(state.blackIndex) - 1);
  const color = playerIndex === blackIndex ? "B" : "W";
  const cumulativeMs = Math.max(
    0,
    Number(state.timeUsed?.[playerIndex]) || 0,
  );
  const previous = [...record.moves]
    .reverse()
    .find((move) => move.color === color);
  record.moves.push({
    color,
    pass: event.type === "passed",
    row: Number(event.row) || 0,
    column: Number(event.column) || 0,
    elapsedMs: Math.max(0, cumulativeMs - (previous?.cumulativeMs ?? 0)),
    cumulativeMs,
    ...(version === undefined ? {} : { version }),
  });
}

function fallbackMoveEvent(state) {
  const kind = state.lastEvent?.kind;
  if (kind !== "play" && kind !== "pass") return undefined;
  const playerIndex = Number(state.lastEvent.playerIndex) - 1;
  return {
    type: kind === "play" ? "played" : "passed",
    player: state.players?.[playerIndex],
    row: state.lastMove?.row,
    column: state.lastMove?.column,
  };
}

function collectInitialBlack(board = []) {
  const points = [];
  board.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (Number(value) === 1) {
        points.push({ row: rowIndex + 1, column: columnIndex + 1 });
      }
    });
  });
  return points;
}

function toSgfPoint(point) {
  return `${String.fromCharCode(96 + point.column)}${String.fromCharCode(96 + point.row)}`;
}

function formatSgfResult(result) {
  if (!result?.winnerColor) return "";
  if (result.reason === "resign") return `${result.winnerColor}+R`;
  return `${result.winnerColor}+${formatNumber(Math.abs(result.black - result.white))}`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function escapeSgf(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}
