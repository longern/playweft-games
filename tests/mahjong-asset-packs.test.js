import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import {
  normaliseAppearance,
  readMahjongAssetPackManifest,
  requiredPackName,
  unpackMahjongAssetPack,
} from "../games/mahjong/asset-packs.js";

test("mahjong asset packs require a manifest-provided name", () => {
  assert.equal(requiredPackName("  月下雀席  "), "月下雀席");
  assert.throws(() => requiredPackName(""), /theme\.json 必须指定素材包名称/);
  assert.throws(() => requiredPackName("a".repeat(41)), /不能超过 40 个字符/);
});

test("mahjong asset packs use schema version 1 catalog arrays and theme-relative paths", async () => {
  const contents = zipSync({
    "moonlit/theme.json": strToU8(JSON.stringify({
      schemaVersion: 1,
      name: "月下雀席",
      assets: {
        portraits: [
          { id: "fox", file: "portraits/fox.png", label: "赤狐" },
          { id: "wolf", file: "portraits/wolf.png", label: "灰狼" },
        ],
        tablecloths: [{ id: "felt", file: "felt.png", label: "绒面" }],
        backgrounds: [],
        tileBacks: [],
      },
      defaults: { appearance: { portraits: { right: "wolf" } } },
    })),
    "moonlit/portraits/fox.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/portraits/wolf.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/felt.png": new Uint8Array([137, 80, 78, 71]),
  });
  const files = await unpackMahjongAssetPack({
    name: "moonlit.zip",
    size: contents.byteLength,
    arrayBuffer: async () => contents.buffer.slice(0),
  });
  const manifest = await readMahjongAssetPackManifest(files);
  assert.equal(manifest.catalog.portraits.length, 2);
  assert.equal(manifest.catalog.portraits[0].fileName, "moonlit/portraits/fox.png");
  assert.equal(manifest.catalog.tablecloths[0].fileName, "moonlit/felt.png");
  assert.deepEqual(manifest.appearance.portraits, {
    self: "fox",
    right: "wolf",
    opposite: "fox",
    left: "fox",
  });
});

test("mahjong asset packs reject the former object-shaped catalog", async () => {
  const files = await unpackMahjongAssetPack({
    name: "old.zip",
    size: zipSync({
      "theme.json": strToU8(JSON.stringify({
        schemaVersion: 1,
        name: "旧格式",
        assets: { portraits: { fox: { file: "fox.png", label: "赤狐" } } },
      })),
    }).byteLength,
    arrayBuffer: async () => zipSync({
      "theme.json": strToU8(JSON.stringify({
        schemaVersion: 1,
        name: "旧格式",
        assets: { portraits: { fox: { file: "fox.png", label: "赤狐" } } },
      })),
    }).buffer,
  });
  await assert.rejects(() => readMahjongAssetPackManifest(files), /格式无效/);
});

test("appearance independently selects each local seat and falls back to available art", () => {
  const catalog = {
    portraits: [{ id: "fox" }, { id: "wolf" }, { id: "cat" }],
    tablecloths: [{ id: "felt" }],
    backgrounds: [{ id: "night" }],
    tileBacks: [{ id: "cloud" }],
  };
  assert.deepEqual(
    normaliseAppearance({
      portraits: { self: "cat", right: "wolf", opposite: "missing" },
      tablecloth: "felt",
      background: "missing",
      tileBack: "cloud",
    }, catalog),
    {
      portraits: { self: "cat", right: "wolf", opposite: "fox", left: "fox" },
      tablecloth: "felt",
      background: "night",
      tileBack: "cloud",
    },
  );
});

test("mahjong settings exposes its visual-pack tab and appearance choices", () => {
  const page = readFileSync(new URL("../games/mahjong/index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../games/mahjong/main.js", import.meta.url), "utf8");
  assert.match(page, /data-settings-tab="visual"[^>]*>画面/);
  assert.match(page, /id="settings-pack-upload"/);
  assert.match(page, /id="settings-pack-list"/);
  assert.match(page, /id="settings-pack-appearance"/);
  assert.doesNotMatch(page, /settings-pack-name/);
  assert.match(page, /accept="\.zip,application\/zip,application\/x-zip-compressed"/);
  assert.doesNotMatch(page, /id="settings-pack-upload"[^>]*multiple/);
  assert.match(main, /configureMahjongAssetPackAppearance/);
  assert.match(main, /name: "默认主题"/);
});
