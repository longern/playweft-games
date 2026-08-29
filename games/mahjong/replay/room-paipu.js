export function buildCompletedRoomPaipuRecord({
  paipu,
  matchId,
  viewerPlayerId,
  playerPresentations,
  completedAtMs = Date.now(),
} = {}) {
  if (!paipu || typeof matchId !== "string" || !matchId) return null;
  return {
    ...paipu,
    id: `${matchId}:room`,
    viewerPlayerId: typeof viewerPlayerId === "string" ? viewerPlayerId : "",
    completedAtMs,
    playerPresentations:
      playerPresentations && typeof playerPresentations === "object"
        ? playerPresentations
        : {},
  };
}
