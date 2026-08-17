export const HAND_REVEAL_FALL_DURATION_MS = 420;
export const OWN_DRAW_ENTRY_DURATION_MS = 180;

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
