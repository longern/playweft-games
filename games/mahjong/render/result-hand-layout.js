import {
  MELD_SCALE,
  meldDisplayLayout,
} from "./three-layout.js";

export const RESULT_MELD_SCALE = 1;
export const RESULT_HAND_SHADOW_OPACITY = 0.18;

export function resultMeldDisplayLayout(meld, winnerIndex) {
  const layout = meldDisplayLayout(meld, winnerIndex);
  const ratio = RESULT_MELD_SCALE / MELD_SCALE;
  return {
    span: layout.span * ratio,
    entries: layout.entries.map((entry) => ({
      ...entry,
      along: entry.along * ratio,
      inward: entry.inward * ratio,
    })),
  };
}
