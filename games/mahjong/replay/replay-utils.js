export function replayAction(action, replayTileIds) {
  const replay = structuredClone(action);
  if (replay.tile) {
    const tileId = tileIdForReference(replay.tile, replayTileIds);
    if (!tileId) throw new Error("Paipu action has an invalid tile reference");
    replay.tileId = tileId;
  }
  delete replay.tile;

  if (replay.type === "claim" && Array.isArray(replay.tiles)) {
    replay.replayClaimTileIds = replay.tiles.map((reference) => {
      const tileId = tileIdForReference(reference, replayTileIds);
      if (!tileId) throw new Error("Paipu claim has an invalid tile reference");
      return tileId;
    });
    delete replay.tiles;
  }
  return replay;
}

/**
 * Converts a stable paipu claim (`kind` + consumed wall refs) back to the
 * current engine's ephemeral option index. Runtime option numbers are retained
 * only as a legacy fallback for old records.
 */
export function resolveReplayClaimAction(action, checkpointState, actorId) {
  if (action?.type !== "claim" || !Array.isArray(action.replayClaimTileIds)) {
    return action;
  }
  const claimant = (checkpointState?.claimants || []).find(
    (entry) => entry?.playerId === actorId,
  );
  if (!claimant) throw new Error("Paipu claim actor is not an active claimant");

  const expectedKind = action.kind;
  const expectedTiles = sortedTileIds(action.replayClaimTileIds);
  const optionIndex = (claimant.options || []).findIndex(
    (option) =>
      option?.kind === expectedKind &&
      sameTileIds(sortedTileIds(option?.tileIds), expectedTiles),
  );
  if (optionIndex < 0) {
    throw new Error("Paipu claim does not match any current claim option");
  }

  const resolved = { ...action, option: optionIndex + 1 };
  delete resolved.kind;
  delete resolved.replayClaimTileIds;
  return resolved;
}

function sortedTileIds(values) {
  return Array.isArray(values)
    ? values.map(Number).filter(Number.isInteger).sort((left, right) => left - right)
    : [];
}

function sameTileIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function tileIdForReference(reference, replayTileIds) {
  if (!Number.isInteger(reference?.ref)) return 0;
  return replayTileIds?.[reference.ref] || 0;
}

export function replayTileIdsForWall(wall) {
  if (typeof wall !== "string" || wall.length !== 272) {
    throw new Error("Paipu hand has an invalid wall");
  }
  const available = new Map();
  for (let tileId = 1; tileId <= 136; tileId += 1) {
    const code = tileCode(tileId);
    const ids = available.get(code) || [];
    ids.push(tileId);
    available.set(code, ids);
  }
  const tileIds = [];
  for (let offset = 0; offset < wall.length; offset += 2) {
    const code = wall.slice(offset, offset + 2);
    const ids = available.get(code);
    if (!ids?.length) throw new Error("Paipu hand has an invalid tile code");
    tileIds.push(ids.shift());
  }
  return tileIds;
}

export function tileCode(tileId) {
  if (tileId === 17) return "0m";
  if (tileId === 53) return "0p";
  if (tileId === 89) return "0s";
  const kind = Math.floor((tileId - 1) / 4) + 1;
  if (kind <= 27) {
    return `${((kind - 1) % 9) + 1}${["m", "p", "s"][Math.floor((kind - 1) / 9)]}`;
  }
  return `${kind - 27}z`;
}

export function waitForReplayStep(speed, stepDelayMs, wait = waitForReplayDelay) {
  const delay = stepDelayMs / Math.max(0.25, Number(speed) || 1);
  return wait(delay);
}

export function waitForReplayDelay(delay, timer = globalThis.setTimeout) {
  return new Promise((resolve) => timer(resolve, delay));
}
