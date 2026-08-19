export const MAHJONG_SOLO_SAVE_KEY = "playweft.mahjong.solo-save.v1";
export const MAHJONG_SOLO_SAVE_VERSION = 1;

export function readMahjongSoloSave(storage = safeLocalStorage()) {
  if (!storage) return null;
  try {
    return normalizeSave(JSON.parse(storage.getItem(MAHJONG_SOLO_SAVE_KEY)));
  } catch {
    return null;
  }
}

export function writeMahjongSoloSave(save, storage = safeLocalStorage()) {
  const normalized = normalizeSave(save);
  if (!storage || !normalized) return false;
  try {
    storage.setItem(
      MAHJONG_SOLO_SAVE_KEY,
      JSON.stringify({
        ...normalized,
        savedAt: Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearMahjongSoloSave(storage = safeLocalStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(MAHJONG_SOLO_SAVE_KEY);
  } catch {
    // Private-mode and storage-quota failures should not prevent play.
  }
}

export function createMahjongSoloSave({
  randomSeed,
  matchId,
  matchType,
  rules,
  playerName,
  actions = [],
  autoActions,
} = {}) {
  return normalizeSave({
    version: MAHJONG_SOLO_SAVE_VERSION,
    randomSeed,
    matchId,
    matchType,
    rules,
    playerName,
    actions,
    autoActions,
  });
}

export function appendMahjongSoloAction(save, action, actorId) {
  const normalized = normalizeSave(save);
  if (!normalized || !isPlainObject(action) || typeof actorId !== "string") {
    return null;
  }
  return {
    ...normalized,
    actions: [
      ...normalized.actions,
      { action: structuredClone(action), actorId },
    ],
  };
}

export function setMahjongSoloAutoActions(save, autoActions) {
  const normalized = normalizeSave(save);
  if (!normalized) return null;
  return {
    ...normalized,
    autoActions: normalizeAutoActions(autoActions),
  };
}

function normalizeSave(value) {
  if (!isPlainObject(value) || value.version !== MAHJONG_SOLO_SAVE_VERSION) {
    return null;
  }
  if (!/^[0-9a-f]{32}$/.test(value.randomSeed ?? "")) return null;
  if (typeof value.matchId !== "string" || !value.matchId) return null;
  if (value.matchType !== "east" && value.matchType !== "hanchan") return null;
  if (!isPlainObject(value.rules) || !Array.isArray(value.actions)) return null;
  if (!value.actions.every(isSavedAction)) return null;
  return {
    version: MAHJONG_SOLO_SAVE_VERSION,
    randomSeed: value.randomSeed,
    matchId: value.matchId,
    matchType: value.matchType,
    rules: { ...value.rules },
    playerName: typeof value.playerName === "string" ? value.playerName : "",
    actions: value.actions.map(({ action, actorId }) => ({
      action: structuredClone(action),
      actorId,
    })),
    autoActions: normalizeAutoActions(value.autoActions),
  };
}

function normalizeAutoActions(value) {
  return {
    autoWin: value?.autoWin === true,
    passClaims: value?.passClaims === true,
    autoTsumogiri: value?.autoTsumogiri === true,
  };
}

function isSavedAction(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.action) &&
    typeof value.actorId === "string"
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
