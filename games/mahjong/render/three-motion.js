import {
  NEW_HAND_DEAL_DURATION_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
} from "../rules/constants.js";

export const HAND_REVEAL_FALL_DURATION_MS = 360;
export const OWN_HAND_CROSSFADE_DURATION_MS = 150;
export const OWN_TILE_HOVER_DURATION_MS = 90;
export const OWN_TILE_HOVER_LIFT = 5;
export const OWN_TILE_SELECTION_DURATION_MS = 120;
export const PENDING_DISCARD_DURATION_MS = 160;

export { NEW_HAND_DEAL_DURATION_MS, OWN_DRAW_ENTRY_DURATION_MS };

export function shouldCrossfadeOwnHand({
  revealed,
  covered,
  animated,
  hasOverlay,
}) {
  return Boolean(revealed && !covered && animated && hasOverlay);
}

export function ownHandCrossfadeProgress(value) {
  const time = Math.max(0, Math.min(1, Number(value) || 0));
  return time * time * (3 - 2 * time);
}

export function handRevealStartDelay(baseDelay, crossfadeOwnHand) {
  return Math.max(0, Number(baseDelay) || 0)
    + (crossfadeOwnHand ? OWN_HAND_CROSSFADE_DURATION_MS : 0);
}

// Two hands keep driving the row after it begins to tip. Gravity adds angular
// acceleration through the middle of the fall, then the hands absorb part of
// that speed before the tile meets the felt. It still reaches the table with a
// little velocity, so contact—not easing—provides the final stop.
export function handRevealFallProgress(value) {
  const time = Math.max(0, Math.min(1, Number(value) || 0));
  if (time === 0 || time === 1) return time;
  return 0.8 * time ** 2 + 1.6 * time ** 3 - 1.4 * time ** 4;
}

export function ownDrawEntryProgress(value) {
  const time = Math.max(0, Math.min(1, Number(value) || 0));
  return 1 - (1 - time) ** 3;
}

export function ownTileSelectionProgress(value) {
  const time = Math.max(0, Math.min(1, Number(value) || 0));
  return 1 - (1 - time) ** 3;
}

export function pendingDiscardProgress(value) {
  const time = Math.max(0, Math.min(1, Number(value) || 0));
  return 1 - (1 - time) ** 3;
}

export function newHandDealProgress(value) {
  const time = Math.max(0, Math.min(1, Number(value) || 0));
  return 1 - (1 - time) ** 3;
}

export function ownDrawEntryKey(state) {
  const tileId = Number(state?.drawnTile) || 0;
  if (
    !tileId ||
    state?.phase === "hand_ended" ||
    !state?.legalActions?.canDiscard
  ) {
    return "";
  }
  return [
    Number(state.roundWind) || 0,
    Number(state.handNumber) || 0,
    Number(state.moveCount) || 0,
    tileId,
  ].join(":");
}
