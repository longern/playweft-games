import { asArray } from "../game-format.js";

const RIVER_TILE_VOLUME_BY_SEAT = Object.freeze({
  1: 0.78,
  2: 0.62,
  3: 0.54,
  4: 0.62,
});

export function riverTileSoundCue(state, events) {
  const event = asArray(events).find(
    (candidate) =>
      candidate?.type === "discarded" || candidate?.type === "riichi",
  );
  if (!event) return null;
  const seat = Number(event.playerIndex) || 0;
  const tile = Number(event.tile) || 0;
  return {
    key: [
      Number(state?.roundWind) || 0,
      Number(state?.handNumber) || 0,
      Number(state?.honba) || 0,
      Number(state?.moveCount) || 0,
      event.type,
      seat,
      tile,
    ].join(":"),
    volume: RIVER_TILE_VOLUME_BY_SEAT[seat] ?? 0.58,
    playbackRate: 0.98 + (tile % 5) * 0.01,
  };
}
