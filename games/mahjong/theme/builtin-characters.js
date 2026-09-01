export const MAHJONG_BUILTIN_CHARACTER_IDS = Object.freeze([
  "builtin-1",
  "builtin-2",
  "builtin-3",
  "builtin-4",
]);

const POSITION_BY_ID = Object.freeze({
  "builtin-1": "0% 0%",
  "builtin-2": "100% 0%",
  "builtin-3": "0% 100%",
  "builtin-4": "100% 100%",
});

const NAME_BY_ID = Object.freeze({
  "builtin-1": "内置角色一",
  "builtin-2": "内置角色二",
  "builtin-3": "内置角色三",
  "builtin-4": "内置角色四",
});

const ID_BY_PORTRAIT_SLOT = Object.freeze({
  self: "builtin-1",
  right: "builtin-4",
  opposite: "builtin-3",
  left: "builtin-2",
});

export function isMahjongBuiltinCharacterId(value) {
  return MAHJONG_BUILTIN_CHARACTER_IDS.includes(String(value || ""));
}

export function getMahjongBuiltinCharacterPosition(characterId) {
  return POSITION_BY_ID[String(characterId || "")] || "";
}

export function getMahjongBuiltinCharacterName(characterId) {
  return NAME_BY_ID[String(characterId || "")] || "";
}

export function getMahjongBuiltinCharacterForPortraitSlot(slot) {
  return ID_BY_PORTRAIT_SLOT[String(slot || "")] || "";
}

export function getMahjongBuiltinCharacterForKey(key) {
  const text = String(key || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return MAHJONG_BUILTIN_CHARACTER_IDS[(hash >>> 0) % MAHJONG_BUILTIN_CHARACTER_IDS.length];
}
