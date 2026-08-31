import { mahjongSeatForPlayer } from "./seat-order.js";

export { mahjongPlayersForViewer } from "./seat-order.js";

/**
 * Paipu is canonical match data. Replay, storage and the Lua engine all consume
 * the same seat order; viewer-relative orientation is a projection/UI concern.
 * Keep this compatibility entry point as an identity transform so older callers
 * cannot accidentally create a second seat coordinate system.
 */
export function orientMahjongPaipuRecord(record) {
  return record;
}

/**
 * Annotates a canonical projection with viewer metadata. The state and events
 * remain in opening East/South/West/North order; presentation code maps those
 * seats to self/right/opposite/left at the last possible boundary.
 */
export function orientMahjongRoomProjection(projection, playerId) {
  const source = projection?.state;
  const viewerSeat = mahjongSeatForPlayer(source?.players, playerId);
  return {
    ...projection,
    state: source
      ? { ...source, viewerPlayerId: playerId, viewerSeat }
      : source,
    viewer: { playerId, seat: viewerSeat },
  };
}
