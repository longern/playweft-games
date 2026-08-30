const PLAYER_COUNT = 4;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function rotateSeat(seat, viewerSeat) {
  const value = Number(seat);
  if (!Number.isInteger(value) || value < 1 || value > PLAYER_COUNT) {
    return seat;
  }
  return ((value - viewerSeat + PLAYER_COUNT) % PLAYER_COUNT) + 1;
}

function rotateSeatOrder(values, viewerSeat) {
  const source = asArray(values);
  if (source.length !== PLAYER_COUNT) return source;
  return Array.from(
    { length: PLAYER_COUNT },
    (_, index) => source[(viewerSeat - 1 + index) % PLAYER_COUNT],
  );
}

/**
 * Returns match players in presentation order (viewer, shimocha, toimen,
 * kamicha) without changing their canonical match-seat identity. Paipu itself
 * always keeps players in the opening East/South/West/North order.
 */
export function mahjongPlayersForViewer(players, playerId) {
  const source = asArray(players);
  const viewerSeat = source.findIndex((player) =>
    (typeof player === "object" ? player?.id : player) === playerId,
  ) + 1;
  return source.length === PLAYER_COUNT && viewerSeat > 0
    ? rotateSeatOrder(source, viewerSeat)
    : source;
}

function rotateResult(result, viewerSeat) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    deltas: rotateSeatOrder(result.deltas, viewerSeat),
    tenpai: rotateSeatOrder(result.tenpai, viewerSeat),
    tenpaiWaits: rotateSeatOrder(result.tenpaiWaits, viewerSeat),
    winnerIndex: rotateSeat(result.winnerIndex, viewerSeat),
    paoSeat: rotateSeat(result.paoSeat, viewerSeat),
    paoSeats: asArray(result.paoSeats).map((seat) => rotateSeat(seat, viewerSeat)),
  };
}

function rotateMelds(melds, viewerSeat) {
  if (!melds || typeof melds !== "object") return melds;
  return Object.fromEntries(
    Object.entries(melds).map(([playerId, groups]) => [
      playerId,
      asArray(groups).map((group) => ({
        ...group,
        fromIndex: rotateSeat(group?.fromIndex, viewerSeat),
      })),
    ]),
  );
}

function rotateEvent(event, viewerSeat) {
  if (!event || typeof event !== "object") return event;
  return {
    ...event,
    playerIndex: rotateSeat(event.playerIndex, viewerSeat),
    fromIndex: rotateSeat(event.fromIndex, viewerSeat),
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
 * Reorients a room/replay projection so its viewer is presentation seat one.
 * Tile maps remain keyed by stable player IDs; only seat-indexed UI fields move.
 * Canonical paipu embedded in the projection is deliberately left untouched.
 */
export function orientMahjongRoomProjection(projection, playerId) {
  const source = projection?.state;
  const players = asArray(source?.players);
  const viewerSeat = players.indexOf(playerId) + 1;
  if (players.length !== PLAYER_COUNT || viewerSeat < 1) return projection;

  const state = {
    ...source,
    players: rotateSeatOrder(players, viewerSeat),
    playerNames: rotateSeatOrder(source.playerNames, viewerSeat),
    scores: rotateSeatOrder(source.scores, viewerSeat),
    scoreHistory: asArray(source.scoreHistory).map((entry) => ({
      ...entry,
      scores: rotateSeatOrder(entry?.scores, viewerSeat),
    })),
    initialDealerIndex: rotateSeat(source.initialDealerIndex, viewerSeat),
    dealerIndex: rotateSeat(source.dealerIndex, viewerSeat),
    turnIndex: rotateSeat(source.turnIndex, viewerSeat),
    responseIndex: rotateSeat(source.responseIndex, viewerSeat),
    drawnPlayerIndex: rotateSeat(source.drawnPlayerIndex, viewerSeat),
    winnerIndex: rotateSeat(source.winnerIndex, viewerSeat),
    abortivePlayerIndex: rotateSeat(source.abortivePlayerIndex, viewerSeat),
    melds: rotateMelds(source.melds, viewerSeat),
    result: rotateResult(source.result, viewerSeat),
    results: asArray(source.results).map((result) => rotateResult(result, viewerSeat)),
    paipu: source.paipu,
  };

  return {
    ...projection,
    state,
    events: asArray(projection.events).map((event) => rotateEvent(event, viewerSeat)),
  };
}
