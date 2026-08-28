import { asArray, isRedFive, tileType } from "./game-format.js";

const IDEMPOTENT_ROOM_ERRORS = new Set([
  "result_already_ready",
]);

const TRANSPORT_ROOM_ERRORS = new Set([
  "RPC_ERROR",
  "PLATFORM_ERROR",
  "INVALID_ACTION_RESULT",
]);

function isTransportError(errorCode) {
  return TRANSPORT_ROOM_ERRORS.has(errorCode) || typeof errorCode === "number";
}

export function roomActionStateKey(state) {
  return JSON.stringify([
    state?.phase,
    state?.roundWind,
    state?.handNumber,
    state?.honba,
    state?.moveCount,
    state?.turnIndex,
    state?.responseIndex,
    state?.claimIndex,
    state?.resultPage,
    state?.resultPageReady,
    asArray(state?.players)[0],
    asArray(state?.discards?.[asArray(state?.players)[0]]).length,
  ]);
}

function latestOwnDiscard(state) {
  const playerId = asArray(state?.players)[0];
  return asArray(state?.discards?.[playerId]).at(-1);
}

function actionWasConfirmed(attempt, state) {
  const action = attempt?.action;
  if (!action || !state) return false;

  if (action.type === "result_ready") {
    return state.resultPageReady === true || state.phase !== "hand_ended";
  }

  if (action.type === "discard" || action.type === "riichi") {
    const discard = latestOwnDiscard(state);
    if (!discard || Number(state.moveCount) <= Number(attempt.baseMoveCount))
      return false;
    return Number(discard.type) === tileType(action.tileId) &&
      Boolean(discard.red) === isRedFive(action.tileId) &&
      (action.type !== "riichi" || state?.riichi?.[asArray(state.players)[0]] === true);
  }

  if (action.type === "set_player_presentation") {
    const playerId = asArray(state?.players)[0];
    return JSON.stringify(state?.playerPresentations?.[playerId]) ===
      JSON.stringify(action.playerPresentation);
  }

  return false;
}

export function reconcileRoomAction({
  attempt,
  state,
  errorCode = "",
} = {}) {
  if (!attempt) return { outcome: "stale", shouldNotify: false };
  if (actionWasConfirmed(attempt, state))
    return { outcome: "confirmed", shouldNotify: false };
  if (IDEMPOTENT_ROOM_ERRORS.has(errorCode))
    return { outcome: "confirmed", shouldNotify: false };
  if (roomActionStateKey(state) !== attempt.baseStateKey)
    return { outcome: "superseded", shouldNotify: false };
  if (!errorCode) return { outcome: "pending", shouldNotify: false };
  if (isTransportError(errorCode))
    return { outcome: "unknown", shouldNotify: true };
  return { outcome: "rejected", shouldNotify: true };
}
