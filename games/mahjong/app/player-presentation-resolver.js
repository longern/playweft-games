import { getMahjongBuiltinCharacterForKey } from "../theme/builtin-characters.js";

export function normalizeMahjongPlayerPresentation(value, playerId = "") {
  const theme = value?.themeCharacter;
  return {
    playerId: String(playerId || ""),
    avatarPreference: value?.avatarPreference === "theme" ? "theme" : "auto",
    portraitMode:
      value?.portraitMode === "platform"
        ? "platform"
        : value?.portraitMode === "character"
          ? "character"
          : undefined,
    themeCharacter:
      theme && typeof theme === "object" && theme.packId && theme.characterId
        ? { packId: String(theme.packId), characterId: String(theme.characterId) }
        : undefined,
    builtinCharacterId:
      typeof value?.builtinCharacterId === "string"
        ? value.builtinCharacterId
        : "",
  };
}

export function chooseMahjongPortraitSource({
  themeSource = "",
  platformSource = "",
  avatarPreference = "auto",
} = {}) {
  const theme = typeof themeSource === "string" ? themeSource : "";
  const platform =
    avatarPreference === "theme"
      ? ""
      : typeof platformSource === "string"
        ? platformSource
        : "";
  return {
    source: platform || theme,
    fallbackSource: platform && theme ? theme : "",
  };
}

export async function resolveMahjongPlayerPresentation({
  playerId = "",
  presentation,
  platformSource = "",
  isAi = false,
  resolveThemePortrait,
  fallbackBuiltinCharacterId,
} = {}) {
  const normalized = normalizeMahjongPlayerPresentation(presentation, playerId);
  const themeSource = normalized.themeCharacter
    ? (await resolveThemePortrait?.(normalized.themeCharacter)) || ""
    : "";
  const selected = chooseMahjongPortraitSource({
    themeSource,
    platformSource:
      isAi || normalized.portraitMode === "character" ? "" : platformSource,
    avatarPreference: normalized.avatarPreference,
  });
  return {
    ...normalized,
    ...selected,
    builtinCharacterId:
      normalized.builtinCharacterId ||
      String(fallbackBuiltinCharacterId || getMahjongBuiltinCharacterForKey(playerId)),
  };
}
