import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slotForFilename } from "../games/mahjong/asset-packs.js";

test("mahjong asset packs recognize the documented visual slots", () => {
  assert.equal(slotForFilename("avatar.webp"), "avatar");
  assert.equal(slotForFilename("portrait-self.webp"), "portrait-self");
  assert.equal(slotForFilename("portrait-opposite.webp"), "portrait-opposite");
  assert.equal(slotForFilename("theme/background.jpg"), "background");
  assert.equal(slotForFilename("felt.png"), "tablecloth");
  assert.equal(slotForFilename("tile-back.avif"), "tile-back");
  assert.equal(slotForFilename("notes.txt"), null);
});

test("mahjong settings exposes its visual-pack tab", () => {
  const page = readFileSync(new URL("../games/mahjong/index.html", import.meta.url), "utf8");
  assert.match(page, /data-settings-tab="visual"[^>]*>画面/);
  assert.match(page, /id="settings-pack-upload"/);
  assert.match(page, /id="settings-pack-list"/);
});
