import { asArray } from "./game-format.js";

// Translate the room projection into the private state the local rules worker
// needs while it is the viewer's turn. The authoritative room still decides
// whether an action is accepted; this only drives immediate local analysis.
export function buildRoomSelfActionState(state, playerId) {
  const context = state?.legalContext;
  const doraTiles = asArray(context?.doraTiles);
  const deadWall = Array.from({ length: doraTiles.length * 2 }, () => 0);
  doraTiles.forEach((tile, index) => {
    deadWall[index * 2] = Number(tile) || 0;
  });
  return {
    players: asArray(state?.players),
    phase: state?.phase,
    turnIndex: Number(state?.turnIndex) || 0,
    drawnTile: Number(state?.drawnTile) || 0,
    hands: { [playerId]: asArray(state?.ownHand).map(Number) },
    wall: Array.from(
      { length: Math.max(0, Number(state?.wallCount) || 0) },
      () => 0,
    ),
    deadWall,
    kanCount: Number(context?.kanCount) || 0,
    callOccurred: context?.callOccurred === true,
    melds: context?.melds || {},
    discards: context?.discards || {},
    riichi: state?.riichi || {},
    scores: asArray(state?.scores).map(Number),
    matchType: state?.matchType,
    roundWind: Number(state?.roundWind) || 0,
    handNumber: Number(state?.handNumber) || 0,
    dealerIndex: Number(state?.dealerIndex) || 0,
    honba: Number(state?.honba) || 0,
    riichiSticks: Number(state?.riichiSticks) || 0,
    rules: state?.rules || {},
    kuikaeForbidden: { [playerId]: context?.kuikaeForbidden || {} },
    tempFuriten: { [playerId]: context?.tempFuriten === true },
    riichiFuriten: { [playerId]: context?.riichiFuriten === true },
    firstTurn: { [playerId]: context?.firstTurn === true },
    doubleRiichi: { [playerId]: context?.doubleRiichi === true },
    ippatsu: { [playerId]: context?.ippatsu === true },
    rinshanWin: context?.rinshanWin === true,
    chankanWin: context?.chankanWin === true,
  };
}

// A locked riichi hand is always closed. Keep this input intentionally small:
// unlike action analysis it must work on every later projection and after a
// reconnect, when there is no current-turn legal context.
export function buildRoomLockedWaitState(state, playerId) {
  return {
    hands: { [playerId]: asArray(state?.ownHand).map(Number) },
    melds: { [playerId]: [] },
  };
}

export function roomLockedWaitKey(state, playerId) {
  return JSON.stringify([
    playerId,
    state?.roundWind,
    state?.handNumber,
    state?.honba,
    state?.riichi?.[playerId] === true,
    state?.ownHand,
  ]);
}
