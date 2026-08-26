/**
 * Rebuilds a local match from its deterministic action log. The save is
 * treated as immutable so a temporary restore failure never destroys a
 * player's only recovery path.
 */
export async function replayMahjongSoloSave({
  game,
  save,
  playerId,
  onCheckpointError = (error) =>
    console.warn(
      "Mahjong save checkpoint was unusable; replaying full log",
      error,
    ),
}) {
  const replayed = await game.replayActions(save.actions, {
    checkpoint: save.checkpoint,
    checkpointActionIndex: save.checkpoint?.actionIndex,
    restart: !save.checkpoint,
    viewerId: playerId,
  });
  if (replayed?.checkpointError) {
    const error = new Error(replayed.checkpointError.message);
    error.name = replayed.checkpointError.name || "Error";
    onCheckpointError(error);
  }
  if (!replayed?.projection) {
    throw new Error("saved match replay did not return a projection");
  }
  return replayed.projection;
}
