import { asArray } from "./game-format.js";

export function roomLegalStateKey(state) {
  return JSON.stringify([
    state?.phase,
    state?.turnIndex,
    state?.moveCount,
    state?.drawnTile,
    state?.ownHand,
    state?.legalContext?.kanCount,
    state?.legalContext?.tempFuriten,
    state?.legalContext?.riichiFuriten,
    state?.legalContext?.firstTurn,
  ]);
}

export function roomAutomaticKey(state) {
  return JSON.stringify([
    state?.phase,
    state?.turnIndex,
    state?.moveCount,
    state?.drawnTile,
    state?.ownHand,
  ]);
}

export function buildRoomTenpaiReportState(state, playerId) {
  return {
    players: asArray(state?.players),
    phase: state?.phase,
    turnIndex: Number(state?.turnIndex) || 0,
    drawnTile: Number(state?.drawnTile) || 0,
    hands: { [playerId]: asArray(state?.ownHand).map(Number) },
    melds: state?.melds || {},
  };
}

export function roomTenpaiStateKey(state) {
  const activePlayer = asArray(state?.players)[Number(state?.turnIndex) - 1];
  return JSON.stringify([
    state?.phase,
    activePlayer,
    state?.turnIndex,
    state?.moveCount,
    state?.wallCount,
    state?.drawnTile,
    state?.ownHand,
    state?.melds?.[activePlayer],
  ]);
}

export function roomPlayerHasFutureNormalDraw(state, playerId) {
  const players = asArray(state?.players);
  const remainingDraws = Math.max(0, Number(state?.wallCount) || 0);
  if (!players.length || remainingDraws === 0) return false;
  const firstDrawIndex = Number(state?.turnIndex) % players.length;
  for (let offset = 0; offset < remainingDraws; offset += 1) {
    if (players[(firstDrawIndex + offset) % players.length] === playerId) {
      return true;
    }
  }
  return false;
}

export function roomEarlyTenpaiStateKey(state, playerId) {
  return JSON.stringify([
    state?.moveCount,
    state?.phase,
    state?.turnIndex,
    state?.wallCount,
    state?.ownHand,
    state?.melds?.[playerId],
  ]);
}
