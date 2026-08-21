import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import {
  chooseMahjongMatchMusicUrl,
  normaliseAppearance,
  readMahjongAssetPackManifest,
  requiredPackName,
  unpackMahjongAssetPack,
} from "../games/mahjong/asset-packs.js";

test("mahjong default music yields to a pack's music or silence", () => {
  const defaultUrl = "https://media.example/default-bgm.mp3";
  assert.equal(chooseMahjongMatchMusicUrl(defaultUrl, "", false), defaultUrl);
  assert.equal(
    chooseMahjongMatchMusicUrl(defaultUrl, "blob:custom-music", true),
    "blob:custom-music",
  );
  assert.equal(chooseMahjongMatchMusicUrl(defaultUrl, "", true), "");
});

test("mahjong asset packs require a manifest-provided name", () => {
  assert.equal(requiredPackName("  月下雀席  "), "月下雀席");
  assert.throws(() => requiredPackName(""), /theme\.json 必须指定素材包名称/);
  assert.throws(() => requiredPackName("a".repeat(41)), /不能超过 40 个字符/);
});

test("mahjong asset packs use schema version 1 catalog arrays and theme-relative paths", async () => {
  const contents = zipSync({
    "moonlit/theme.json": strToU8(
      JSON.stringify({
        schemaVersion: 1,
        name: "月下雀席",
        assets: {
          portraits: [
            { id: "fox", file: "portraits/fox.png", label: "赤狐" },
            { id: "wolf", file: "portraits/wolf.png", label: "灰狼" },
          ],
          tablecloths: [{ id: "felt", file: "felt.png", label: "绒面" }],
          backgrounds: [],
          lobby: [{ id: "evening", file: "lobby/evening.webp", label: "暮色" }],
          tileBacks: [],
          music: [{ id: "night", file: "music/night.ogg", label: "夜风" }],
          voices: [
            {
              character: "fox",
              lines: { chi: "voices/fox/chi.ogg" },
              yaku: { tanyao: "voices/fox/tanyao.ogg" },
            },
          ],
        },
        defaults: {
          appearance: { portraits: { right: "wolf" }, music: "night" },
        },
      }),
    ),
    "moonlit/portraits/fox.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/portraits/wolf.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/felt.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/lobby/evening.webp": new Uint8Array([137, 80, 78, 71]),
    "moonlit/music/night.ogg": new Uint8Array([79, 103, 103, 83]),
    "moonlit/voices/fox/chi.ogg": new Uint8Array([79, 103, 103, 83]),
    "moonlit/voices/fox/tanyao.ogg": new Uint8Array([79, 103, 103, 83]),
  });
  const files = await unpackMahjongAssetPack({
    name: "moonlit.zip",
    size: contents.byteLength,
    arrayBuffer: async () => contents.buffer.slice(0),
  });
  const manifest = await readMahjongAssetPackManifest(files);
  assert.equal(manifest.catalog.portraits.length, 2);
  assert.equal(
    manifest.catalog.portraits[0].fileName,
    "moonlit/portraits/fox.png",
  );
  assert.equal(manifest.catalog.tablecloths[0].fileName, "moonlit/felt.png");
  assert.equal(manifest.catalog.music[0].fileName, "moonlit/music/night.ogg");
  assert.equal(
    manifest.catalog.lobby[0].fileName,
    "moonlit/lobby/evening.webp",
  );
  assert.equal(
    manifest.catalog.voices[0].lines.chi,
    "moonlit/voices/fox/chi.ogg",
  );
  assert.equal(
    manifest.catalog.voices[0].yaku.tanyao,
    "moonlit/voices/fox/tanyao.ogg",
  );
  assert.equal(
    files.find((file) => file.name.endsWith("night.ogg"))?.type,
    "audio/ogg",
  );
  assert.deepEqual(manifest.appearance.portraits, {
    self: "fox",
    right: "wolf",
    opposite: "fox",
    left: "fox",
  });
  assert.equal(manifest.appearance.music, "night");
});

test("mahjong asset packs reject the former object-shaped catalog", async () => {
  const files = await unpackMahjongAssetPack({
    name: "old.zip",
    size: zipSync({
      "theme.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          name: "旧格式",
          assets: { portraits: { fox: { file: "fox.png", label: "赤狐" } } },
        }),
      ),
    }).byteLength,
    arrayBuffer: async () =>
      zipSync({
        "theme.json": strToU8(
          JSON.stringify({
            schemaVersion: 1,
            name: "旧格式",
            assets: { portraits: { fox: { file: "fox.png", label: "赤狐" } } },
          }),
        ),
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
    music: [{ id: "dawn" }],
    voices: [],
  };
  assert.deepEqual(
    normaliseAppearance(
      {
        portraits: { self: "cat", right: "wolf", opposite: "missing" },
        tablecloth: "felt",
        background: "missing",
        tileBack: "cloud",
        music: "dawn",
        voice: false,
      },
      catalog,
    ),
    {
      portraits: { self: "cat", right: "wolf", opposite: "fox", left: "fox" },
      tablecloth: "felt",
      background: "night",
      lobby: "",
      tileBack: "cloud",
      music: "dawn",
      voice: false,
    },
  );
});

test("mahjong settings exposes its visual-pack tab and appearance choices", () => {
  const page = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  assert.match(page, /data-settings-tab="visual"[^>]*>画面/);
  assert.match(page, /id="settings-pack-upload"/);
  assert.match(page, /id="settings-pack-list"/);
  assert.match(page, /id="settings-pack-appearance"/);
  assert.doesNotMatch(page, /settings-pack-name/);
  assert.match(
    page,
    /accept="\.zip,application\/zip,application\/x-zip-compressed"/,
  );
  assert.doesNotMatch(page, /id="settings-pack-upload"[^>]*multiple/);
  assert.match(main, /configureMahjongAssetPackAppearance/);
  assert.match(main, /角色语音/);
  assert.match(main, /name: "默认主题"/);
  assert.match(
    main,
    /action === "delete"[\s\S]*?window\.parent === window[\s\S]*?window\.confirm\(confirmation\)[\s\S]*?await soloClient\.confirm\(confirmation\)/,
  );
});
