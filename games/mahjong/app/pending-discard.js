import { asArray, isRedFive, tileType } from "../rules/game-format.js";

/**
 * A room discard may be shown locally before the authoritative room snapshot
 * returns. This record contains only enough information for that reversible
 * visual projection; it never advances turn, claims, scores, or wall state.
 */
export function createMahjongPendingDiscard(state, action) {
  if (
    !state ||
    !["discard", "riichi"].includes(action?.type) ||
    !state?.legalActions?.canDiscard
  ) {
    return null;
  }
  const tileId = Number(action.tileId) || 0;
  const ownHand = asArray(state.ownHand).map(Number);
  const drawnTile = Number(state.drawnTile) || 0;
  const fromDrawn = tileId === drawnTile;
  if (!tileId || (!fromDrawn && !ownHand.includes(tileId))) return null;
  const playerId = String(state.players?.[0] || "");
  if (!playerId) return null;
  const riverSourceIndex = asArray(state.discards?.[playerId]).length;
  const moveCount = Number(state.moveCount) || 0;
  return {
    key: [
      Number(state.roundWind) || 0,
      Number(state.handNumber) || 0,
      Number(state.honba) || 0,
      moveCount,
      action.type,
      tileId,
    ].join(":"),
    playerId,
    tileId,
    type: tileType(tileId),
    red: isRedFive(tileId),
    riichi: action.type === "riichi",
    fromDrawn,
    riverSourceIndex,
    moveCount,
  };
}

export function applyMahjongPendingDiscard(state, pendingDiscard) {
  if (!state || !pendingDiscard) return state;
  const ownHand = asArray(state.ownHand).map(Number);
  const drawnTile = Number(state.drawnTile) || 0;
  const handIndex = ownHand.indexOf(pendingDiscard.tileId);
  if (!pendingDiscard.fromDrawn && handIndex < 0) return state;
  if (pendingDiscard.fromDrawn && drawnTile !== pendingDiscard.tileId)
    return state;

  const nextHand = [...ownHand];
  if (handIndex >= 0) nextHand.splice(handIndex, 1);
  // A tedashi folds the current draw into the rack just as the authoritative
  // state will. Keeping it as a separate draw here would create a temporary
  // visual gap that does not exist after confirmation.
  if (!pendingDiscard.fromDrawn && drawnTile) nextHand.push(drawnTile);
  const playerDiscards = asArray(state.discards?.[pendingDiscard.playerId]);
  return {
    ...state,
    ownHand: nextHand,
    drawnTile: 0,
    drawnPlayerIndex: 0,
    legalActions: {},
    discards: {
      ...(state.discards || {}),
      [pendingDiscard.playerId]: [
        ...playerDiscards,
        {
          type: pendingDiscard.type,
          red: pendingDiscard.red,
          riichi: pendingDiscard.riichi,
          tsumogiri: pendingDiscard.fromDrawn,
        },
      ],
    },
  };
}

export function pendingDiscardState(state, pendingDiscard) {
  if (!pendingDiscard) return "none";
  const moveCount = Number(state?.moveCount) || 0;
  if (moveCount <= pendingDiscard.moveCount) return "pending";
  const latest = asArray(state?.discards?.[pendingDiscard.playerId]).at(-1);
  return Number(latest?.type) === pendingDiscard.type &&
    Boolean(latest?.red) === pendingDiscard.red
    ? "confirmed"
    : "rejected";
}
