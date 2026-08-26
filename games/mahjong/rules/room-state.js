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

function rotateResult(result, viewerSeat) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    deltas: rotateSeatOrder(result.deltas, viewerSeat),
    tenpai: rotateSeatOrder(result.tenpai, viewerSeat),
    tenpaiWaits: rotateSeatOrder(result.tenpaiWaits, viewerSeat),
    winnerIndex: rotateSeat(result.winnerIndex, viewerSeat),
    paoSeat: rotateSeat(result.paoSeat, viewerSeat),
    paoSeats: asArray(result.paoSeats).map((seat) =>
      rotateSeat(seat, viewerSeat),
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

function rotatePaipu(record, viewerSeat) {
  if (!record || typeof record !== "object") return record;
  const players = asArray(record.players)
    .map((player) => ({
      ...player,
      seat: rotateSeat(player?.seat, viewerSeat),
    }))
    .sort((left, right) => Number(left.seat) - Number(right.seat));
  return {
    ...record,
    players,
    hands: asArray(record.hands).map((hand) => ({
      ...hand,
      startScores: rotateSeatOrder(hand.startScores, viewerSeat),
      round: hand.round
        ? { ...hand.round, dealerSeat: rotateSeat(hand.round.dealerSeat, viewerSeat) }
        : hand.round,
      commands: asArray(hand.commands).map((command) => ({
        ...command,
        seat: rotateSeat(command?.seat, viewerSeat),
      })),
      events: asArray(hand.events).map((event) => rotateEvent(event, viewerSeat)),
      end: hand.end
        ? {
            ...hand.end,
            winners: asArray(hand.end.winners).map((seat) =>
              rotateSeat(seat, viewerSeat),
            ),
            result: rotateResult(hand.end.result, viewerSeat),
            results: asArray(hand.end.results).map((result) =>
              rotateResult(result, viewerSeat),
            ),
            scores: rotateSeatOrder(hand.end.scores, viewerSeat),
          }
        : hand.end,
    })),
    final: record.final
      ? {
          ...record.final,
          scores: rotateSeatOrder(record.final.scores, viewerSeat),
          ranks: rotateSeatOrder(record.final.ranks, viewerSeat),
        }
      : record.final,
  };
}

/**
 * Reorients a room projection so its viewer is always presentation seat one.
 * Tile maps remain keyed by stable player IDs; only seat-indexed fields move.
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
    dealerIndex: rotateSeat(source.dealerIndex, viewerSeat),
    turnIndex: rotateSeat(source.turnIndex, viewerSeat),
    responseIndex: rotateSeat(source.responseIndex, viewerSeat),
    drawnPlayerIndex: rotateSeat(source.drawnPlayerIndex, viewerSeat),
    winnerIndex: rotateSeat(source.winnerIndex, viewerSeat),
    abortivePlayerIndex: rotateSeat(source.abortivePlayerIndex, viewerSeat),
    melds: rotateMelds(source.melds, viewerSeat),
    result: rotateResult(source.result, viewerSeat),
    results: asArray(source.results).map((result) =>
      rotateResult(result, viewerSeat),
    ),
    paipu: rotatePaipu(source.paipu, viewerSeat),
  };

  return {
    ...projection,
    state,
    events: asArray(projection.events).map((event) =>
      rotateEvent(event, viewerSeat),
    ),
  };
}
