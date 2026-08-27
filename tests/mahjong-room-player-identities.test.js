import assert from "node:assert/strict";
import { test } from "node:test";
import { createMahjongRoomPlayerPresentations } from "../games/mahjong/app/room-player-identities.js";

function createPresentationHarness({ presentation, profile, themePortrait } = {}) {
  let rendered;
  const themeController = {
    resolveCharacterPortrait: async (reference) =>
      reference?.packId === "moonlit" && reference?.characterId === "fox"
        ? themePortrait === undefined ? "moonlit-fox-portrait" : themePortrait
        : "",
    resolveCharacterVoice: async (reference, cue) =>
      reference?.packId === "moonlit" &&
      reference?.characterId === "fox" &&
      cue === "riichi"
        ? "moonlit-fox-riichi"
        : "",
    setPlatformAvatar: () => true,
  };
  const presentations = createMahjongRoomPlayerPresentations({
    isRoom: () => true,
    getState: () => ({
      players: ["guest"],
      playerPresentations: { guest: presentation },
    }),
    getRoomPlayerId: () => "host",
    getProfile: () => profile,
    themeController,
    domView: {
      applyPlayerIdentityState: (state) => {
        rendered = state;
        return Promise.resolve(true);
      },
    },
  });
  return { presentations, getRendered: () => rendered };
}

test("room player presentation uses the synchronized theme character before its built-in fallback", async () => {
  const harness = createPresentationHarness({
    presentation: {
      portraitMode: "character",
      themeCharacter: { packId: "moonlit", characterId: "fox" },
      builtinCharacterId: "builtin-3",
    },
  });
  await harness.presentations.apply();
  assert.equal(harness.getRendered().portraits.bottom, "moonlit-fox-portrait");
  assert.equal(harness.getRendered().builtinCharacters.bottom, "builtin-3");
});

test("room player presentation keeps the synchronized built-in fallback and character voice", async () => {
  const harness = createPresentationHarness({
    presentation: {
      portraitMode: "platform",
      themeCharacter: { packId: "moonlit", characterId: "fox" },
      builtinCharacterId: "builtin-2",
    },
    profile: { platformPortraitSource: "" },
    themePortrait: "",
  });
  await harness.presentations.apply();
  assert.equal(harness.getRendered().portraits.bottom, "");
  assert.equal(harness.getRendered().builtinCharacters.bottom, "builtin-2");
  assert.equal(
    await harness.presentations.resolveCharacterVoice(1, "riichi"),
    "moonlit-fox-riichi",
  );
});
