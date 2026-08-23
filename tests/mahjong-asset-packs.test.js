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
import { normalizeMahjongDefaultAssetConfig } from "../games/mahjong/default-assets.js";

test("mahjong music falls back when a pack has no music and preserves silence", () => {
  assert.equal(
    chooseMahjongMatchMusicUrl(
      "https://cdn.example/default.mp3",
      "blob:custom-music",
      true,
    ),
    "blob:custom-music",
  );
  assert.equal(
    chooseMahjongMatchMusicUrl(
      "https://cdn.example/default.mp3",
      "",
      false,
    ),
    "https://cdn.example/default.mp3",
  );
  assert.equal(
    chooseMahjongMatchMusicUrl(
      "https://cdn.example/default.mp3",
      "",
      true,
    ),
    "",
  );
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

test("build-time default assets keep multiple remote choices and normalize defaults", () => {
  const config = normalizeMahjongDefaultAssetConfig({
    portraits: [
      { id: "fox", url: "https://cdn.example/fox.webp", label: "赤狐" },
      { id: "wolf", url: "https://cdn.example/wolf.webp", label: "灰狼" },
      { id: "cat", url: "https://cdn.example/cat.webp", label: "黑猫" },
    ],
    matchBgm: [
      { id: "night", url: "https://cdn.example/night.mp3", label: "夜风", copyright: "A" },
      { id: "day", url: "https://cdn.example/day.ogg", label: "日光", copyright: "B" },
    ],
    tablecloths: [
      { id: "felt", url: "https://cdn.example/felt.webp", label: "绒面" },
      { id: "wood", url: "https://cdn.example/wood.webp", label: "木纹" },
    ],
    tableBackgrounds: [
      { id: "night", url: "https://cdn.example/night.webp", label: "夜景" },
    ],
    lobbyBackgrounds: [
      { id: "evening", url: "https://cdn.example/evening.webp", label: "暮色" },
    ],
    tileBacks: [
      { id: "cloud", url: "https://cdn.example/cloud.webp", label: "祥云" },
    ],
    defaults: {
      portraits: { self: "wolf", pool: ["wolf", "missing"] },
      matchBgm: "day",
      tablecloth: "wood",
      tileBack: "cloud",
      tableBackground: "night",
      lobbyBackground: "evening",
    },
  });
  assert.equal(config.name, "默认主题");
  assert.deepEqual(config.portraitPool, ["wolf"]);
  assert.deepEqual(config.appearance.portraits, {
    self: "wolf",
    right: "",
    opposite: "",
    left: "",
  });
  assert.deepEqual(config.appearance, {
    portraits: { self: "wolf", right: "", opposite: "", left: "" },
    tablecloth: "wood",
    background: "night",
    lobby: "evening",
    tileBack: "cloud",
    music: "day",
  });
  assert.deepEqual(config.catalog.music.map(({ id, url }) => ({ id, url })), [
    { id: "night", url: "https://cdn.example/night.mp3" },
    { id: "day", url: "https://cdn.example/day.ogg" },
  ]);
  assert.equal(config.catalog.tablecloths.length, 2);
  assert.equal(config.catalog.tileBacks[0].label, "祥云");
});

test("build-time default assets reject unsafe or malformed remote URLs", () => {
  const config = normalizeMahjongDefaultAssetConfig({
    matchBgm: [
      { id: "data", url: "data:audio/mp3;base64,AAAA", label: "数据" },
      { id: "bad id", url: "https://cdn.example/bad.mp3", label: "坏 ID" },
      { id: "ok", url: "https://cdn.example/ok.mp3", label: "有效" },
    ],
  });
  assert.deepEqual(config.catalog.music, [
    { id: "ok", url: "https://cdn.example/ok.mp3", label: "有效", copyright: "" },
  ]);
});

test("build-time config exposes named downloadable asset packs without ids", () => {
  const config = normalizeMahjongDefaultAssetConfig({
    assetPacks: [
      { name: "月下雀席", url: "https://cdn.example/moonlit.zip" },
      { name: "重复地址", url: "https://cdn.example/moonlit.zip" },
      { name: "不安全", url: "file:///tmp/theme.zip" },
      { name: "缺地址" },
    ],
  });
  assert.deepEqual(config.assetPacks, [
    { name: "月下雀席", url: "https://cdn.example/moonlit.zip" },
  ]);
});

test("mahjong settings separates theme management from appearance choices", () => {
  const page = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const settingsCss = readFileSync(
    new URL("../games/mahjong/styles/settings.css", import.meta.url),
    "utf8",
  );
  assert.match(page, /data-settings-tab="theme"[^>]*>主题/);
  assert.match(page, /data-settings-tab="appearance"[^>]*>装扮/);
  assert.match(page, /id="settings-theme-upload"/);
  assert.match(page, /id="settings-theme-list"/);
  assert.match(page, /id="settings-appearance-controls"/);
  assert.doesNotMatch(page, /素材包/);
  assert.doesNotMatch(page, /settings-pack-name/);
  assert.match(
    page,
    /accept="\.zip,application\/zip,application\/x-zip-compressed"/,
  );
  assert.doesNotMatch(page, /id="settings-theme-upload"[^>]*multiple/);
  assert.match(main, /configureMahjongAssetPackAppearance/);
  assert.match(main, /角色语音/);
  assert.match(main, /getMahjongDefaultPack\(\)/);
  assert.match(settingsCss, /\.settings-option strong[\s\S]*?font-size: 20px/);
  assert.match(settingsCss, /\.settings-theme-list strong[\s\S]*?font-size: 20px/);
  assert.match(
    main,
    /action === "delete"[\s\S]*?isStandalone[\s\S]*?window\.confirm\(confirmation\)[\s\S]*?await playweftClient\?\.confirm\(confirmation\)/,
  );
});
