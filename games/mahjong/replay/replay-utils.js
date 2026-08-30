export function replayActionNeedsState(action) {
  return [
    "discard",
    "riichi",
    "chi",
    "pon",
    "daiminkan",
    "ron",
    "ankan",
    "kakan",
  ].includes(action?.type);
}

/** Resolve a durable semantic paipu action against the current canonical Lua state. */
export function resolveReplayAction(action, checkpointState, actorId) {
  if (!action || typeof action !== "object") throw new Error("Paipu action is invalid");
  if (!replayActionNeedsState(action)) return structuredClone(action);
  if (!checkpointState || typeof checkpointState !== "object") {
    throw new Error("Replay state is unavailable");
  }

  if (action.type === "discard" || action.type === "riichi") {
    const tileId = resolveDiscardTile(action, checkpointState, actorId);
    return { type: action.type, tileId };
  }

  if (["chi", "pon", "daiminkan", "ron"].includes(action.type)) {
    return resolveClaim(action, checkpointState, actorId);
  }

  if (action.type === "ankan" || action.type === "kakan") {
    const tileType = tileTypeForCode(action.tile);
    if (!tileType) throw new Error("Paipu kan has an invalid tile code");
    return { type: "kan", kind: action.type, tileType };
  }

  throw new Error(`Unsupported paipu action: ${action.type}`);
}

function resolveDiscardTile(action, state, actorId) {
  const expected = action.tile;
  if (!isTileCode(expected)) throw new Error("Paipu discard has an invalid tile code");
  const drawn = Number(state.drawnTile) || 0;
  if (action.tsumogiri === true) {
    if (!drawn || tileCode(drawn) !== expected) {
      throw new Error("Paipu tsumogiri does not match the current drawn tile");
    }
    return drawn;
  }

  const hand = state.hands?.[actorId] || [];
  const concealed = hand.find((tileId) => tileCode(Number(tileId)) === expected);
  if (concealed) return Number(concealed);
  if (drawn && tileCode(drawn) === expected) return drawn;
  throw new Error("Paipu discard tile is not in the current hand");
}

function resolveClaim(action, state, actorId) {
  const claimant = (state.claimants || []).find((entry) => entry?.playerId === actorId);
  if (!claimant) throw new Error("Paipu claim actor is not an active claimant");
  const runtimeKind = action.type === "daiminkan" ? "kan" : action.type;
  const expectedTiles = sortedCodes(action.tiles || []);
  const optionIndex = (claimant.options || []).findIndex((option) => {
    if (option?.kind !== runtimeKind) return false;
    if (runtimeKind === "ron") return expectedTiles.length === 0;
    return sameCodes(sortedCodes((option.tileIds || []).map((id) => tileCode(Number(id)))), expectedTiles);
  });
  if (optionIndex < 0) throw new Error("Paipu claim does not match any current claim option");
  return { type: "claim", option: optionIndex + 1 };
}

function sortedCodes(values) {
  return Array.isArray(values) ? values.map(String).sort() : [];
}

function sameCodes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function tileTypeForCode(code) {
  if (!isTileCode(code)) return 0;
  if (code[1] === "z") return 27 + Number(code[0]);
  const suit = { m: 0, p: 1, s: 2 }[code[1]];
  const rank = code[0] === "0" ? 5 : Number(code[0]);
  return suit * 9 + rank;
}

export function isTileCode(value) {
  return typeof value === "string" && /^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(value);
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
