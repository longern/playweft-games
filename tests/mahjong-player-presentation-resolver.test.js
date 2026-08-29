import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMahjongPlayerPresentation } from "../games/mahjong/app/player-presentation-resolver.js";

const resolveThemePortrait = async () => "theme-portrait";

test("player presentation resolver applies source preference and fallback once", async () => {
  const resolved = await resolveMahjongPlayerPresentation({
    playerId: "player-1",
    presentation: {
      avatarPreference: "auto",
      themeCharacter: { packId: "pack-1", characterId: "character-1" },
      builtinCharacterId: "builtin-1",
    },
    platformSource: "platform-portrait",
    resolveThemePortrait,
  });

  assert.deepEqual(
    {
      source: resolved.source,
      fallbackSource: resolved.fallbackSource,
      builtinCharacterId: resolved.builtinCharacterId,
    },
    {
      source: "platform-portrait",
      fallbackSource: "theme-portrait",
      builtinCharacterId: "builtin-1",
    },
  );
});

test("player presentation resolver respects a synchronized character mode", async () => {
  const resolved = await resolveMahjongPlayerPresentation({
    playerId: "player-1",
    presentation: {
      avatarPreference: "auto",
      portraitMode: "character",
      themeCharacter: { packId: "pack-1", characterId: "character-1" },
    },
    platformSource: "platform-portrait",
    resolveThemePortrait,
  });

  assert.equal(resolved.source, "theme-portrait");
  assert.equal(resolved.fallbackSource, "");
});

test("player presentation resolver never uses a platform source for an AI", async () => {
  const resolved = await resolveMahjongPlayerPresentation({
    playerId: "ai-1",
    presentation: {
      avatarPreference: "auto",
      themeCharacter: { packId: "pack-1", characterId: "character-1" },
    },
    platformSource: "platform-portrait",
    isAi: true,
    resolveThemePortrait,
  });

  assert.equal(resolved.source, "theme-portrait");
});
