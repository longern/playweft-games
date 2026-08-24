import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalLuaSourceUrl } from "../games/mahjong/workers/local-game-worker-client.js";

test("mahjong worker resolves rules beside the page instead of its asset bundle", () => {
  assert.equal(
    resolveLocalLuaSourceUrl(
      "./game.lua",
      "https://games.example.test/mahjong/",
    ),
    "https://games.example.test/mahjong/game.lua",
  );
});
