const PLAYER_COUNT = 4;
const RANDOM_MODULUS = 2147483647;
const RANDOM_MULTIPLIER = 48271;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function mahjongSeatForPlayer(players, playerId) {
  const index = asArray(players).findIndex((player) =>
    (typeof player === "object" ? player?.id : player) === playerId,
  );
  return index >= 0 ? index + 1 : 0;
}

export function mahjongPresentationSeat(canonicalSeat, viewerSeat) {
  const seat = Number(canonicalSeat);
  const viewer = Number(viewerSeat);
  if (![seat, viewer].every(Number.isInteger) || seat < 1 || seat > 4 || viewer < 1 || viewer > 4)
    return seat;
  return ((seat - viewer + PLAYER_COUNT) % PLAYER_COUNT) + 1;
}

export function mahjongCanonicalSeatForPresentation(presentationSeat, viewerSeat) {
  const seat = Number(presentationSeat);
  const viewer = Number(viewerSeat);
  if (![seat, viewer].every(Number.isInteger) || seat < 1 || seat > 4 || viewer < 1 || viewer > 4)
    return seat;
  return ((viewer + seat - 2) % PLAYER_COUNT) + 1;
}

export function mahjongRotateSeat(seat, viewerSeat) {
  const value = Number(seat);
  if (!Number.isInteger(value) || value < 1 || value > PLAYER_COUNT) {
    return seat;
  }
  return ((value - viewerSeat + PLAYER_COUNT) % PLAYER_COUNT) + 1;
}

export function mahjongRotateSeatOrder(values, viewerSeat) {
  const source = asArray(values);
  if (source.length !== PLAYER_COUNT) return source;
  return Array.from(
    { length: PLAYER_COUNT },
    (_, index) => source[(viewerSeat - 1 + index) % PLAYER_COUNT],
  );
}

/**
 * Returns match players in presentation order (viewer, shimocha, toimen,
 * kamicha) without changing their canonical match-seat identity.
 */
export function mahjongPlayersForViewer(players, playerId) {
  const source = asArray(players);
  const viewerSeat = mahjongSeatForPlayer(source, playerId);
  return source.length === PLAYER_COUNT && viewerSeat > 0
    ? mahjongRotateSeatOrder(source, viewerSeat)
    : source;
}

/**
 * Reproduces game.lua's historical opening-East draw from a match seed.
 * This lets solo mode canonicalize its player array without changing which
 * player would have opened as East for an existing deterministic seed.
 */
export function mahjongOpeningDealerSeat(randomSeed) {
  let seed = 0;
  for (const character of String(randomSeed ?? "")) {
    const digit = Number.parseInt(character, 16);
    if (!Number.isInteger(digit)) continue;
    seed = (seed * 16 + digit) % RANDOM_MODULUS;
  }
  if (seed === 0) seed = 1;
  const seatDraw = (seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS;
  return (seatDraw % PLAYER_COUNT) + 1;
}

/**
 * Converts a clockwise player list into canonical match-seat order:
 * opening East, South, West, North. Relative clockwise order is preserved.
 */
export function mahjongPlayersByOpeningWind(players, openingDealerSeat) {
  const seat = Number(openingDealerSeat);
  const source = asArray(players);
  if (
    source.length !== PLAYER_COUNT ||
    !Number.isInteger(seat) ||
    seat < 1 ||
    seat > PLAYER_COUNT
  ) {
    return source;
  }
  return mahjongRotateSeatOrder(source, seat);
}
