import assert from "node:assert/strict";
import { test } from "node:test";
import { createMahjongThemeController } from "../games/mahjong/theme/theme-controller.js";

function createEventTarget() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}

test("Mahjong theme initialization does not overwrite room player identities", async () => {
  let identityUpdates = 0;
  const eventTarget = createEventTarget();
  const controller = createMahjongThemeController({
    document: { createElement() {} },
    window: eventTarget,
    themeElements: {
      upload: eventTarget,
      uploadZone: eventTarget,
      list: eventTarget,
    },
    appearanceElements: {
      feedback: { textContent: "" },
      controls: eventTarget,
    },
    isRoomActive: () => true,
    setPlayerIdentityState: () => {
      identityUpdates += 1;
    },
  });

  await controller.ready;
  await controller.applyPackAvatars();
  await Promise.resolve();
  assert.equal(identityUpdates, 0);
  controller.destroy();
});

test("Mahjong score-sheet presentations follow player IDs after canonical seat rotation", async () => {
  const eventTarget = createEventTarget();
  const controller = createMahjongThemeController({
    document: { createElement() {} },
    window: eventTarget,
    themeElements: {
      upload: eventTarget,
      uploadZone: eventTarget,
      list: eventTarget,
    },
    appearanceElements: {
      feedback: { textContent: "" },
      controls: eventTarget,
    },
    isRoomActive: () => false,
  });

  await controller.ready;
  controller.getPaipuPlayerPresentations([
    { id: "viewer" },
    { id: "right" },
    { id: "opposite" },
    { id: "left" },
  ], "opposite");
  assert.equal(
    controller.getPlayerPresentation({ playerId: "viewer" })?.builtinCharacterId,
    "builtin-3",
  );
  assert.equal(controller.getPlayerPresentation({ seat: 1 }), undefined);
  controller.destroy();
});

test("Mahjong score-sheet binding accepts the runtime canonical player ID array", async () => {
  const eventTarget = createEventTarget();
  const controller = createMahjongThemeController({
    document: { createElement() {} },
    window: eventTarget,
    themeElements: { upload: eventTarget, uploadZone: eventTarget, list: eventTarget },
    appearanceElements: { feedback: { textContent: "" }, controls: eventTarget },
    isRoomActive: () => false,
  });

  await controller.ready;
  controller.getPaipuPlayerPresentations(
    ["east", "south", "viewer", "north"],
    "viewer",
  );
  assert.equal(
    controller.getPlayerPresentation({ playerId: "viewer" })?.builtinCharacterId,
    "builtin-1",
  );
  assert.ok(controller.getPlayerPresentation({ playerId: "east" }));
  assert.ok(controller.getPlayerPresentation({ playerId: "south" }));
  assert.ok(controller.getPlayerPresentation({ playerId: "north" }));
  controller.destroy();
});

test("Mahjong fallback portraits are unique and follow the fixed visual slots", async () => {
  const eventTarget = createEventTarget();
  const controller = createMahjongThemeController({
    document: { createElement() {} },
    window: eventTarget,
    themeElements: { upload: eventTarget, uploadZone: eventTarget, list: eventTarget },
    appearanceElements: { feedback: { textContent: "" }, controls: eventTarget },
    isRoomActive: () => false,
  });

  await controller.ready;
  controller.getPaipuPlayerPresentations(
    ["mahjong-ai-2", "mahjong-ai-3", "mahjong-player", "mahjong-ai-1"],
    "mahjong-player",
  );
  assert.deepEqual(
    ["mahjong-ai-2", "mahjong-ai-3", "mahjong-player", "mahjong-ai-1"]
      .map((playerId) => controller.getPlayerPresentation({ playerId })?.builtinCharacterId),
    ["builtin-3", "builtin-2", "builtin-1", "builtin-4"],
  );
  assert.equal(
    new Set(
      ["mahjong-ai-2", "mahjong-ai-3", "mahjong-player", "mahjong-ai-1"]
        .map((playerId) => controller.getPlayerPresentation({ playerId })?.builtinCharacterId),
    ).size,
    4,
  );
  controller.destroy();
});
