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
  let projection = game.initialProjection;
  let actions = save.actions;
  if (save.checkpoint) {
    try {
      const restored = await game.restoreCheckpoint(save.checkpoint, playerId);
      projection = restored.projection;
      actions = save.actions.slice(save.checkpoint.actionIndex);
    } catch (error) {
      onCheckpointError(error);
    }
  }
  for (const { action, actorId } of actions) {
    const outcome = await game.action(action, actorId);
    if (!outcome.result?.accepted) {
      throw new Error(
        `saved action rejected: ${outcome.result?.error?.code || "unknown"}`,
      );
    }
    projection = outcome.projection;
  }
  return projection;
}
