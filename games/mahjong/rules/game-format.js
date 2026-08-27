import {
  CLAIM_LABELS,
  DORA_INDICATOR_SLOT_COUNT,
  PLAYERS,
  RED_FIVE_IDS,
  WINDS,
} from "./constants.js";

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function clearedTableState(state) {
  const players = asArray(state?.players);
  const emptyPlayerCollections = () =>
    Object.fromEntries(players.map((playerId) => [playerId, []]));
  const clearedRiichi = Object.fromEntries(
    players.map((playerId) => [playerId, false]),
  );
  return {
    ...state,
    ownHand: [],
    drawnTile: 0,
    drawnPlayerIndex: 0,
    handCounts: Object.fromEntries(
      players.map((playerId) => [playerId, 0]),
    ),
    discards: emptyPlayerCollections(),
    melds: emptyPlayerCollections(),
    riichi: clearedRiichi,
    revealedHands: {},
    doraIndicators: [],
    doraIndicatorTiles: [],
    uraDoraIndicatorTiles: [],
    legalActions: {},
    winners: [],
    winningTile: 0,
    winningTileRed: false,
    winType: "",
    draw: false,
  };
}

export function riverDisplayEntries(river) {
  return asArray(river)
    .map((discard, sourceIndex) => ({ discard, sourceIndex }))
    .filter(({ discard }) => !discard?.claimed)
    .map((entry, displayIndex) => ({ ...entry, displayIndex }));
}

export function partitionClaimActions(claims) {
  const chi = [];
  const pon = [];
  const immediate = [];
  for (const claim of asArray(claims)) {
    if (claim?.kind === "chi") chi.push(claim);
    else if (claim?.kind === "pon") pon.push(claim);
    else immediate.push(claim);
  }
  const priority = { kan: 0, ron: 1 };
  immediate.sort((left, right) =>
    (priority[left?.kind] ?? Number.MAX_SAFE_INTEGER)
      - (priority[right?.kind] ?? Number.MAX_SAFE_INTEGER));
  return { chi, pon, immediate };
}

export function claimPreviewTiles(claim) {
  const red = asArray(claim?.red);
  const tiles = asArray(claim?.tileTypes).map((type, index) => ({
    type: Number(type),
    red: red[index] === true,
  }));
  return tiles.sort((left, right) => left.type - right.type);
}

function tenpaiDiscardOption(legalActions, tileId) {
  const selectedTileId = Number(tileId) || 0;
  if (!selectedTileId) return null;
  return asArray(legalActions?.tenpaiDiscards).find(
    (candidate) => Number(candidate?.tileId) === selectedTileId,
  );
}

export function tenpaiDiscardFuriten(legalActions, tileId) {
  return tenpaiDiscardOption(legalActions, tileId)?.furiten === true;
}

export function tenpaiWaitsForDiscard(legalActions, tileId) {
  const option = tenpaiDiscardOption(legalActions, tileId);
  return asArray(option?.waits)
    .map((wait) => ({
      type: Number(wait?.type) || 0,
      remaining: Math.max(0, Math.min(4, Math.trunc(Number(wait?.remaining) || 0))),
      noYaku: wait?.noYaku === true,
    }))
    .filter((wait) => wait.type >= 1 && wait.type <= 34);
}

export function canDiscardHandTile({
  canDiscard = false,
  riichiDeclared = false,
  drawnTile = 0,
  tileId = 0,
} = {}) {
  const selectedTileId = Number(tileId) || 0;
  if (!canDiscard || selectedTileId <= 0) return false;
  return !riichiDeclared || selectedTileId === (Number(drawnTile) || 0);
}

export function activeSeat(state) {
  return Number(state.phase === "claiming" ? state.responseIndex : state.turnIndex);
}

export function blankDoubleClickAction({
  doubleClickPassEnabled = false,
  passAvailable = false,
  doubleClickTsumogiriEnabled = false,
  riichiMode = false,
  canDiscard = false,
  drawnTile = 0,
} = {}) {
  if (doubleClickPassEnabled && passAvailable) return { type: "pass" };
  const tileId = Number(drawnTile) || 0;
  if (
    doubleClickTsumogiriEnabled
    && !riichiMode
    && canDiscard
    && tileId > 0
  ) {
    return { type: "discard", tileId };
  }
  return null;
}

export function tileType(tileId) {
  return Math.floor((Number(tileId) - 1) / 4) + 1;
}

export function isRedFive(tileId) {
  return RED_FIVE_IDS.has(Number(tileId));
}

export function orderedHand(hand, drawnTile) {
  const rack = [...asArray(hand)];
  const drawn = Number(drawnTile) || 0;
  return drawn ? [...rack, drawn] : rack;
}

export function deferredHandInsertion(previousState, events, {
  ownDiscardedTile = 0,
  random = Math.random,
} = {}) {
  const discard = asArray(events).find((event) =>
    (event?.type === "discarded" || event?.type === "riichi")
      && event.fromDrawn === false);
  const seat = Number(discard?.playerIndex) || 0;
  if (!seat || Number(previousState?.drawnPlayerIndex) !== seat) return null;
  if (seat !== 1) {
    const playerId = asArray(previousState?.players)[seat - 1];
    const rackCount = Math.max(0, Number(previousState?.handCounts?.[playerId]) || 0);
    if (!rackCount) return null;
    const randomValue = Math.max(0, Math.min(0.999999, Number(random()) || 0));
    return { seat, rackIndex: Math.floor(randomValue * rackCount) };
  }

  const drawnTile = Number(previousState?.drawnTile) || 0;
  const discardedTile = Number(ownDiscardedTile) || 0;
  const ownHand = asArray(previousState?.ownHand).map(Number);
  const discardIndex = ownHand.indexOf(discardedTile);
  if (!drawnTile || discardIndex < 0) return null;
  ownHand.splice(discardIndex, 1);
  return { seat, ownHand, drawnTile, rackIndex: discardIndex };
}

export function exhaustiveDrawPresentation(state) {
  if (state?.phase !== "hand_ended"
    || state.draw !== true
    || state.result?.abortive === true) {
    return { revealed: [], covered: [] };
  }
  const tenpai = asArray(state.result?.tenpai);
  const revealed = [];
  const covered = [];
  for (let seat = 1; seat <= 4; seat += 1) {
    (tenpai[seat - 1] === true ? revealed : covered).push(seat);
  }
  return { revealed, covered };
}

export function splitRevealedHand(state, playerId, seat) {
  const rack = asArray(state.revealedHands?.[playerId]).map((tile) =>
    tile && typeof tile === "object"
      ? { type: Number(tile.type), red: tile.red === true }
      : { type: Number(tile), red: false });
  const abortiveReveal = state.abortiveReason === "九种九牌"
    && Number(state.abortivePlayerIndex) === Number(seat);
  const drawnType = abortiveReveal
    ? Number(state.abortiveTile)
    : state.winType === "tsumo"
      ? Number(state.winningTile)
      : 0;
  if (!drawnType) return { rack, drawn: null };
  return {
    rack,
    drawn: {
      type: drawnType,
      red: abortiveReveal
        ? state.abortiveTileRed === true
        : state.winningTileRed === true,
    },
  };
}

export function opponentHandLayout(handCount, meldCount, hasDrawnTile) {
  const visibleCount = Math.max(0, Math.trunc(Number(handCount) || 0));
  const visibleMelds = Math.max(0, Math.min(4, Math.trunc(Number(meldCount) || 0)));
  const normalRackCapacity = 13 - visibleMelds * 3;
  const hasDrawn = hasDrawnTile === true;
  return {
    rackCapacity: hasDrawn ? normalRackCapacity : visibleCount,
    rackCount: visibleCount,
    hasDrawn,
  };
}

export function automaticRiichiDiscard(state, playerId) {
  const legal = state?.legalActions ?? {};
  if (!state?.riichi?.[playerId] || !legal.canDiscard) return 0;
  if (legal.canTsumo || legal.canAbortNine || asArray(legal.selfKans).length > 0) return 0;
  return Number(state.drawnTile) || 0;
}

export function doraIndicatorSlots(state) {
  const visualIndicators = asArray(state?.doraIndicatorTiles);
  const indicators = visualIndicators.length > 0
    ? visualIndicators.map((indicator) => ({
      type: Number(indicator?.type),
      red: indicator?.red === true,
    }))
    : asArray(state?.doraIndicators).map((type) => ({ type: Number(type), red: false }));

  return Array.from(
    { length: DORA_INDICATOR_SLOT_COUNT },
    (_, index) => indicators[index] ?? null,
  );
}

export function resultIndicatorSlots(state, playerId) {
  const uraIndicators = state?.winType !== "nagashi" && state?.riichi?.[playerId] === true
    ? asArray(state?.uraDoraIndicatorTiles).map((indicator) => ({
      type: Number(indicator?.type),
      red: indicator?.red === true,
    }))
    : [];
  return {
    dora: doraIndicatorSlots(state),
    ura: Array.from(
      { length: DORA_INDICATOR_SLOT_COUNT },
      (_, index) => uraIndicators[index] ?? null,
    ),
  };
}

export function nextDoraType(indicatorType) {
  const type = Number(indicatorType) || 0;
  if (type >= 1 && type <= 27) {
    const first = Math.floor((type - 1) / 9) * 9 + 1;
    return first + ((type - first + 1) % 9);
  }
  if (type >= 28 && type <= 31) return 28 + ((type - 28 + 1) % 4);
  if (type >= 32 && type <= 34) return 32 + ((type - 32 + 1) % 3);
  return 0;
}

export function doraTypeCounts(state) {
  const canonical = asArray(state?.doraIndicators).map(Number).filter(Boolean);
  const indicators = canonical.length
    ? canonical
    : doraIndicatorSlots(state).filter(Boolean).map((indicator) => Number(indicator.type));
  const counts = new Map();
  for (const indicator of indicators) {
    const type = nextDoraType(indicator);
    if (type) counts.set(type, (counts.get(type) || 0) + 1);
  }
  return counts;
}

export function tileFace(type) {
  const number = ((type - 1) % 9) + 1;
  const chinese = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (type <= 9) return {
    suit: "man",
    rank: chinese[number - 1],
    mark: "萬",
    label: `${chinese[number - 1]}万`,
  };
  if (type <= 18) return {
    suit: "pin",
    rank: String(number),
    mark: "筒",
    label: `${number}筒`,
  };
  if (type <= 27) return {
    suit: "sou",
    rank: String(number),
    mark: "索",
    label: `${number}索`,
  };
  const honors = [
    ["東", "风", "东风"],
    ["南", "风", "南风"],
    ["西", "风", "西风"],
    ["北", "风", "北风"],
    ["白", "", "白板"],
    ["發", "", "发财"],
    ["中", "", "红中"],
  ];
  const [rank, mark, label] = honors[type - 28];
  return {
    suit: type === 33 ? "green" : type === 34 ? "red" : "honor",
    rank,
    mark,
    label,
  };
}

export function seatWind(state, seat) {
  return WINDS[(seat - Number(state.dealerIndex) + 4) % 4];
}

export function roundLabel(roundWind, handNumber) {
  const roundWinds = ["東", "南", "西", "北"];
  return `${roundWinds[Number(roundWind) - 1] ?? "東"}${["一", "二", "三", "四"][Number(handNumber) - 1] ?? "一"}局`;
}

const DEFAULT_NAME_SLOTS = ["self", "right", "opposite", "left"];

export function playerDisplayName(
  state,
  seat,
  {
    playerName = "你",
    defaultNames = {},
    playerNameIsAuthoritative = true,
  } = {},
) {
  const index = Number(seat) - 1;
  if (index < 0 || index >= PLAYERS.length) return `玩家${seat}`;
  if (index === 0 && playerNameIsAuthoritative && playerName) {
    return playerName;
  }
  const stateName = state?.playerNames?.[index];
  const builtInName = PLAYERS[index]?.name;
  const packName = defaultNames?.[DEFAULT_NAME_SLOTS[index]];
  if (stateName && stateName !== builtInName) return stateName;
  return packName || stateName || builtInName || `玩家${seat}`;
}

export function playerDisplayNames(
  state,
  { playerName = "你", defaultNames = {}, playerNameIsAuthoritative = true } = {},
) {
  return PLAYERS.map((_, index) =>
    playerDisplayName(state, index + 1, {
      playerName,
      defaultNames,
      playerNameIsAuthoritative,
    }),
  );
}

export function eventMessage(
  state,
  event,
  playerName,
  { defaultNames = {}, playerNameIsAuthoritative = true } = {},
) {
  const name = playerDisplayName(state, event.playerIndex, {
    playerName,
    defaultNames,
    playerNameIsAuthoritative,
  });
  if (event.type === "discarded") return `${name} 打出 ${tileFace(event.tile).label}`;
  if (event.type === "claimed") return `${name} ${CLAIM_LABELS[event.kind] ?? "鸣牌"}`;
  if (event.type === "drew") return event.playerIndex === 1 ? "你摸了一张牌" : `${name} 摸牌`;
  if (event.type === "won") return `${name} ${event.method === "tsumo" ? "自摸" : "荣和"}`;
  if (event.type === "riichi") return `${name} 宣言立直`;
  if (event.type === "draw_game") return "牌山摸尽，本局流局";
  if (event.type === "abortive_draw") return `${event.reason}，本局途中流局`;
  if (event.type === "next_hand" || event.type === "new_match") return "新的一局开始了";
  return "牌局进行中";
}

export function errorMessage(code) {
  const messages = {
    NOT_YOUR_TURN: "还没有轮到你",
    TILE_NOT_IN_HAND: "这张牌已不在手中",
    CLAIM_RESPONSE_REQUIRED: "请先选择是否鸣牌",
    HAND_NOT_COMPLETE: "当前牌型还不能和牌",
    NO_YAKU: "牌型完成，但没有役，不能和牌",
    RIICHI_NOT_ALLOWED: "请选择标记出的听牌打出项",
    RIICHI_TSUMOGIRI_REQUIRED: "立直后只能摸切",
    KUIKAE_FORBIDDEN: "鸣牌后不能立即打出食替牌",
    KAN_NOT_ALLOWED: "当前不能进行这个杠",
    NINE_TERMINALS_NOT_ALLOWED: "当前不能宣告九种九牌",
  };
  return messages[code] ?? `动作未通过规则校验${code ? `（${code}）` : ""}`;
}

export function resultDetailPageCount(state) {
  if (state?.phase !== "hand_ended" || state.draw === true) return 0;
  const results = asArray(state.results);
  return results.length || (state.result ? 1 : 0);
}

export function resultScoreRows(
  state,
  playerName,
  { defaultNames = {}, playerNameIsAuthoritative = true } = {},
) {
  const scores = asArray(state?.scores);
  const deltas = asArray(state?.result?.deltas);
  return scores.map((score, index) => {
    const after = Number(score) || 0;
    const delta = Number(deltas[index]) || 0;
    const name = playerDisplayName(state, index + 1, {
      playerName,
      defaultNames,
      playerNameIsAuthoritative,
    });
    return { name, before: after - delta, delta, after };
  });
}

export function matchResultRows(
  state,
  playerName,
  { defaultNames = {}, playerNameIsAuthoritative = true } = {},
) {
  return asArray(state?.scores)
    .slice(0, 4)
    .map((score, index) => ({
      seat: index + 1,
      name: playerDisplayName(state, index + 1, {
        playerName,
        defaultNames,
        playerNameIsAuthoritative,
      }),
      score: Number(score) || 0,
    }))
    .sort((left, right) => right.score - left.score || left.seat - right.seat)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function resultScoreSheetRows(state) {
  const seatOrder = initialWindSeatOrder(state);
  const history = asArray(state?.scoreHistory)
    .map((entry) => ({
      roundWind: Number(entry?.roundWind) || 1,
      handNumber: Number(entry?.handNumber) || 1,
      honba: Math.max(0, Number(entry?.honba) || 0),
      scores: asArray(entry?.scores)
        .slice(0, 4)
        .map((score) => Number(score) || 0),
    }))
    .filter((entry) => entry.scores.length === 4);
  return history
    .map((entry, index) => {
      const previous = history[index - 1];
      return {
        round: scoreSheetRoundLabel(entry.roundWind, entry.handNumber),
        honba: entry.honba,
        scores: seatOrder.map((seat) => entry.scores[seat - 1]),
        deltas: seatOrder.map((seat) => {
          const score = entry.scores[seat - 1];
          return previous ? score - previous.scores[seat - 1] : 0;
        }),
      };
    })
    .slice(1);
}

export function initialWindSeatOrder(state) {
  const eastSeat = Math.max(
    1,
    Math.min(4, Number(state?.initialDealerIndex) || Number(state?.dealerIndex) || 1),
  );
  return Array.from({ length: 4 }, (_, offset) => ((eastSeat - 1 + offset) % 4) + 1);
}

export function visibleScoreSheetRows(rows, maxRows) {
  const limit = Math.max(0, Math.trunc(Number(maxRows) || 0));
  return limit > 0 ? asArray(rows).slice(-limit) : [];
}

function scoreSheetRoundLabel(roundWind, handNumber) {
  const wind = ["東", "南", "西", "北"][roundWind - 1] ?? "東";
  return `${wind}${Math.max(1, Math.min(4, handNumber))}`;
}

export function resultBasePaymentTotal(state, result) {
  const exact = Number(result?.basePaymentTotal);
  if (Number.isFinite(exact) && exact >= 0) return String(Math.round(exact));

  const amounts = String(result?.payment ?? "")
    .match(/\d+/g)
    ?.map(Number) ?? [];
  if (amounts.length >= 2) return String(amounts[0] * 2 + amounts[1]);
  if (amounts.length !== 1) return "";

  const honba = Math.max(0, Number(state?.honba) || 0);
  if (result?.paoSeat > 0 || state?.winType === "ron") {
    return String(Math.max(0, amounts[0] - honba * 300));
  }
  return String(amounts[0] * 3);
}
