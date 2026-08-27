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
