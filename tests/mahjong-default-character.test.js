import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearMahjongDefaultCharacterMemory,
  getOrCreateMahjongDefaultCharacter,
  MAHJONG_DEFAULT_CHARACTER_STORAGE_KEY,
} from "../games/mahjong/theme/default-character.js";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("Mahjong persists one device default character from the built-in roster", () => {
  clearMahjongDefaultCharacterMemory();
  const storage = createStorage();
  const options = {
    storage,
    characterIds: ["builtin-1", "builtin-2", "builtin-3"],
    chooseIndex: () => 1,
  };
  const first = getOrCreateMahjongDefaultCharacter(options);
  assert.deepEqual(first, { characterId: "builtin-2" });
  assert.deepEqual(
    JSON.parse(storage.values.get(MAHJONG_DEFAULT_CHARACTER_STORAGE_KEY)),
    first,
  );

  clearMahjongDefaultCharacterMemory();
  const restored = getOrCreateMahjongDefaultCharacter({
    ...options,
    chooseIndex: () => 2,
  });
  assert.deepEqual(restored, first);
});
