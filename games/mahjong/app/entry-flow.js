/**
 * Chooses the first Mahjong surface without letting a local solo save leak
 * into a future online/room entry.
 */
export function mahjongInitialEntry(mode, hasSoloSave) {
  return mode === "solo" && hasSoloSave ? "resume" : "setup";
}
