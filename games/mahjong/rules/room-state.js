import {
  mahjongPlayersForViewer,
  mahjongRotateSeat,
  mahjongRotateSeatOrder,
} from "./seat-order.js";

export { mahjongPlayersForViewer } from "./seat-order.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function rotateResult(result, viewerSeat) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    deltas: mahjongRotateSeatOrder(result.deltas, viewerSeat),
    tenpai: mahjongRotateSeatOrder(result.tenpai, viewerSeat),
    tenpaiWaits: mahjongRotateSeatOrder(result.tenpaiWaits, viewerSeat),
    winnerIndex: mahjongRotateSeat(result.winnerIndex, viewerSeat),
    paoSeat: mahjongRotateSeat(result.paoSeat, viewerSeat),
    paoSeats: asArray(result.paoSeats).map((seat) =>
      mahjongRotateSeat(seat, viewerSeat),
    ),
  };
}

function rotateMelds(melds, viewerSeat) {
  if (!melds || typeof melds !== "object") return melds;
  return Object.fromEntries(
    Object.entries(melds).map(([playerId, groups]) => [
      playerId,
      asArray(groups).map((group) => ({
        ...group,
        fromIndex: mahjongRotateSeat(group?.fromIndex, viewerSeat),
      })),
    ]),
  );
}

function rotateEvent(event, viewerSeat) {
  if (!event || typeof event !== "object") return event;
  return {
    ...event,
    playerIndex: mahjongRotateSeat(event.playerIndex, viewerSeat),
    fromIndex: mahjongRotateSeat(event.fromIndex, viewerSeat),
  };
}

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
 * Reorients a room/solo/replay projection so its viewer is presentation seat
 * one. Tile maps remain keyed by stable player IDs; only seat-indexed UI fields
 * move. Canonical paipu embedded in the projection is deliberately untouched.
 */
export function orientMahjongRoomProjection(projection, playerId) {
  const source = projection?.state;
  const players = asArray(source?.players);
  const viewerSeat = players.indexOf(playerId) + 1;
  if (players.length !== 4 || viewerSeat < 1) return projection;

  const state = {
    ...source,
    players: mahjongRotateSeatOrder(players, viewerSeat),
    playerNames: mahjongRotateSeatOrder(source.playerNames, viewerSeat),
    scores: mahjongRotateSeatOrder(source.scores, viewerSeat),
    scoreHistory: asArray(source.scoreHistory).map((entry) => ({
      ...entry,
      scores: mahjongRotateSeatOrder(entry?.scores, viewerSeat),
    })),
    initialDealerIndex: mahjongRotateSeat(source.initialDealerIndex, viewerSeat),
    dealerIndex: mahjongRotateSeat(source.dealerIndex, viewerSeat),
    turnIndex: mahjongRotateSeat(source.turnIndex, viewerSeat),
    responseIndex: mahjongRotateSeat(source.responseIndex, viewerSeat),
    drawnPlayerIndex: mahjongRotateSeat(source.drawnPlayerIndex, viewerSeat),
    winnerIndex: mahjongRotateSeat(source.winnerIndex, viewerSeat),
    abortivePlayerIndex: mahjongRotateSeat(source.abortivePlayerIndex, viewerSeat),
    melds: rotateMelds(source.melds, viewerSeat),
    result: rotateResult(source.result, viewerSeat),
    results: asArray(source.results).map((result) =>
      rotateResult(result, viewerSeat),
    ),
    paipu: source.paipu,
  };

  return {
    ...projection,
    state,
    events: asArray(projection.events).map((event) =>
      rotateEvent(event, viewerSeat),
    ),
  };
}
