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

export function partitionClaimActions(claims) {
  const chi = [];
  const immediate = [];
  for (const claim of asArray(claims)) {
    (claim?.kind === "chi" ? chi : immediate).push(claim);
  }
  return { chi, immediate };
}

export function claimPreviewTiles(claim) {
  const red = asArray(claim?.red);
  const tiles = asArray(claim?.tileTypes).map((type, index) => ({
    type: Number(type),
    red: red[index] === true,
  }));
  return tiles.sort((left, right) => left.type - right.type);
}

export function activeSeat(state) {
  return Number(state.phase === "claiming" ? state.responseIndex : state.turnIndex);
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
  return `${WINDS[Number(roundWind) - 1] ?? "东"}${["一", "二", "三", "四"][Number(handNumber) - 1] ?? "一"}局`;
}

export function eventMessage(state, event, playerName) {
  const name = event.playerIndex === 1
    ? playerName
    : state.playerNames?.[event.playerIndex - 1] || PLAYERS[event.playerIndex - 1]?.name;
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

export function scoreDeltaSummary(state, playerName) {
  return asArray(state.result?.deltas)
    .map((delta, index) => {
      const name = index === 0
        ? playerName
        : state.playerNames?.[index] ?? PLAYERS[index].name;
      return `${name} ${delta >= 0 ? "+" : ""}${delta}`;
    })
    .join("　");
}
