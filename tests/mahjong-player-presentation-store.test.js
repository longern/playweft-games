import assert from "node:assert/strict";
import { test } from "node:test";
import { createMahjongPlayerPresentationStore } from "../games/mahjong/app/player-presentation-store.js";

test("player presentation store resolves one player-owned value for every renderer", () => {
  const store = createMahjongPlayerPresentationStore();
  let updates = 0;
  const unsubscribe = store.subscribe(() => {
    updates += 1;
  });
  const presentation = {
    source: "platform-portrait",
    fallbackSource: "theme-portrait",
    builtinCharacterId: "builtin-2",
  };

  store.replace(new Map([["player-1", presentation]]));

  assert.deepEqual(store.get({ playerId: "player-1" }), presentation);
  assert.deepEqual(store.get({ playerId: "missing" }), undefined);
  assert.equal(updates, 1);

  unsubscribe();
  store.clear();
  assert.equal(store.get({ playerId: "player-1" }), undefined);
  assert.equal(updates, 1);
});
