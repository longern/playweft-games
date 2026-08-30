export function buildCompletedRoomPaipuRecord({
  paipu,
  matchId,
  viewerPlayerId,
  playerPresentations,
  completedAtMs = Date.now(),
} = {}) {
  if (!paipu || typeof matchId !== "string" || !matchId) return null;
  const completed = paipu.status === "completed";
  return {
    ...paipu,
    roomFragment: true,
    id: `${matchId}:room`,
    viewerPlayerId: typeof viewerPlayerId === "string" ? viewerPlayerId : "",
    ...(completed ? { completedAtMs } : {}),
    playerPresentations:
      playerPresentations && typeof playerPresentations === "object"
        ? playerPresentations
        : {},
  };
}

export function mergeRoomPaipuFragmentRecord(previous, fragment) {
  if (!fragment?.roomFragment || typeof fragment.id !== "string" || !fragment.id) {
    return null;
  }
  if (previous?.id && previous.id !== fragment.id) {
    throw new TypeError("Room paipu fragment id does not match stored progress");
  }

  const hands = new Map();
  for (const hand of previous?.hands || []) {
    const index = Number(hand?.index);
    if (Number.isInteger(index) && index >= 0) hands.set(index, hand);
  }
  for (const hand of fragment.hands || []) {
    const index = Number(hand?.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new TypeError("Room paipu fragment has an invalid hand index");
    }
    hands.set(index, hand);
  }

  const merged = {
    ...(previous || {}),
    ...fragment,
    hands: [...hands.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, hand]) => hand),
    playerPresentations: {
      ...(previous?.playerPresentations || {}),
      ...(fragment.playerPresentations || {}),
    },
  };
  delete merged.roomFragment;
  if (fragment.status !== "completed") {
    merged.status = "in_progress";
    delete merged.completedAtMs;
    delete merged.final;
  }
  return merged;
}

export function hasCompleteRoomPaipuHandSequence(record) {
  if (!Array.isArray(record?.hands) || record.hands.length === 0) return false;
  return record.hands.every(
    (hand, index) =>
      Number(hand?.index) === index &&
      hand?.end &&
      typeof hand.end === "object" &&
      !Array.isArray(hand.end),
  );
}
