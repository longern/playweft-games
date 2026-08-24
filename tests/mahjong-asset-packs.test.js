import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import {
  chooseMahjongMatchMusicUrl,
  chooseMahjongRiichiMusicUrl,
  normaliseAppearance,
  readMahjongAssetPackManifest,
  requiredPackName,
  unpackMahjongAssetPack,
} from "../games/mahjong/asset-packs.js";
import {
  normalizeMahjongDefaultAssetConfig,
  portraitNames,
} from "../games/mahjong/default-assets.js";

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

test("mahjong riichi music only replaces the match track when configured", () => {
  assert.equal(
    chooseMahjongRiichiMusicUrl("", "", false),
    "",
    "an absent riichi track keeps the normal match music active",
  );
  assert.equal(
    chooseMahjongRiichiMusicUrl(
      "https://cdn.example/default-riichi.mp3",
      "blob:custom-riichi",
      true,
    ),
    "blob:custom-riichi",
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
          tableBackgrounds: [],
          lobbyBackgrounds: [{ id: "evening", file: "lobby/evening.webp", label: "暮色" }],
          tileBacks: [],
          matchBgm: [{ id: "night", file: "music/night.ogg", label: "夜风" }],
          riichiBgm: [
            { id: "duel", file: "music/duel.ogg", label: "对决" },
          ],
          voices: [
            {
              character: "fox",
              lines: { chi: "voices/fox/chi.ogg" },
              yaku: { tanyao: "voices/fox/tanyao.ogg" },
            },
          ],
        },
        defaults: {
          portraits: { self: "fox", right: "fox" },
          matchBgm: "night",
          riichiBgm: "duel",
        },
      }),
    ),
    "moonlit/portraits/fox.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/portraits/wolf.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/felt.png": new Uint8Array([137, 80, 78, 71]),
    "moonlit/lobby/evening.webp": new Uint8Array([137, 80, 78, 71]),
    "moonlit/music/night.ogg": new Uint8Array([79, 103, 103, 83]),
    "moonlit/music/duel.ogg": new Uint8Array([79, 103, 103, 83]),
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
  assert.equal(manifest.catalog.matchBgm[0].fileName, "moonlit/music/night.ogg");
  assert.equal(
    manifest.catalog.riichiBgm[0].fileName,
    "moonlit/music/duel.ogg",
  );
  assert.equal(
    manifest.catalog.lobbyBackgrounds[0].fileName,
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
    opposite: "wolf",
    left: "wolf",
  });
  assert.equal(manifest.appearance.matchBgm, "night");
  assert.equal(manifest.appearance.riichiBgm, "duel");
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
    tableBackgrounds: [{ id: "night" }],
    lobbyBackgrounds: [],
    tileBacks: [{ id: "cloud" }],
    matchBgm: [{ id: "dawn" }],
    riichiBgm: [{ id: "duel" }],
    voices: [],
  };
  const appearance = normaliseAppearance(
    {
      portraits: { self: "cat", right: "wolf", opposite: "missing" },
      tablecloth: "felt",
      tableBackground: "missing",
      tileBack: "cloud",
      matchBgm: "dawn",
      riichiBgm: "duel",
      voice: false,
    },
    catalog,
  );
  assert.equal(appearance.portraits.self, "cat");
  assert.deepEqual(
    new Set([appearance.portraits.right, appearance.portraits.opposite]),
    new Set(["fox", "wolf"]),
  );
  assert.equal(appearance.portraits.left, "fox");
  const { portraits: _portraits, ...nonPortraitAppearance } = appearance;
  assert.deepEqual(nonPortraitAppearance, {
    tablecloth: "felt",
    tableBackground: "night",
    lobbyBackground: "",
    tileBack: "cloud",
    matchBgm: "dawn",
    riichiBgm: "duel",
    voice: false,
  });
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
    riichiBgm: [
      {
        id: "duel",
        url: "https://cdn.example/duel.mp3",
        label: "对决",
        copyright: "C",
      },
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
      portraits: {
        self: "cat",
        right: "wolf",
        pool: ["wolf", "fox", "missing"],
      },
      matchBgm: "day",
      riichiBgm: "duel",
      tablecloth: "wood",
      tileBack: "cloud",
      tableBackground: "night",
      lobbyBackground: "evening",
    },
  });
  assert.equal(config.name, "默认主题");
  assert.deepEqual(config.portraitPool, ["wolf", "fox"]);
  assert.deepEqual(config.appearance.portraits, {
    self: "cat",
    right: "",
    opposite: "",
    left: "",
  });
  assert.deepEqual(config.appearance, {
    portraits: { self: "cat", right: "", opposite: "", left: "" },
    tablecloth: "wood",
    tableBackground: "night",
    lobbyBackground: "evening",
    tileBack: "cloud",
    matchBgm: "day",
    riichiBgm: "duel",
  });
  assert.deepEqual(config.catalog.matchBgm.map(({ id, url }) => ({ id, url })), [
    { id: "night", url: "https://cdn.example/night.mp3" },
    { id: "day", url: "https://cdn.example/day.ogg" },
  ]);
  assert.equal(config.catalog.tablecloths.length, 2);
  assert.equal(config.catalog.tileBacks[0].label, "祥云");
});

test("portrait pools keep self fixed and ignore explicit opponent seats", () => {
  const catalog = [
    { id: "self" },
    { id: "right" },
    { id: "opposite" },
    { id: "left" },
  ];
  const resolved = normaliseAppearance(
    { portraits: { self: "self", right: "opposite" } },
    { portraits: catalog },
    ["right", "opposite", "left"],
  ).portraits;
  assert.equal(resolved.self, "self");
  assert.deepEqual(new Set([resolved.right, resolved.opposite, resolved.left]), new Set(["right", "opposite", "left"]));
  const poolOnly = normaliseAppearance(
    { portraits: { self: "self", right: "opposite" } },
    { portraits: catalog },
    ["right"],
  ).portraits;
  assert.deepEqual(poolOnly, {
    self: "self",
    right: "right",
    opposite: "right",
    left: "right",
  });
});

test("portrait pools repeat entries after unique portraits are exhausted", () => {
  const onePortrait = normaliseAppearance(
    { portraits: { self: "solo" } },
    { portraits: [{ id: "solo" }] },
    ["solo"],
  ).portraits;
  assert.deepEqual(onePortrait, {
    self: "solo",
    right: "solo",
    opposite: "solo",
    left: "solo",
  });

  const twoPortraits = normaliseAppearance(
    { portraits: { self: "self" } },
    { portraits: [{ id: "self" }, { id: "other" }] },
    ["other"],
  ).portraits;
  assert.equal(twoPortraits.self, "self");
  assert.equal(twoPortraits.right, "other");
  assert.equal(twoPortraits.opposite, "other");
  assert.equal(twoPortraits.left, "other");
});

test("portrait labels follow the currently assigned avatar seats", () => {
  assert.deepEqual(
    portraitNames(
      { portraits: [{ id: "fox", label: "赤狐" }, { id: "wolf", label: "灰狼" }] },
      { portraits: { self: "wolf", right: "fox", opposite: "wolf", left: "fox" } },
    ),
    { self: "灰狼", right: "赤狐", opposite: "灰狼", left: "赤狐" },
  );
});

test("build-time default assets reject unsafe or malformed remote URLs", () => {
  const config = normalizeMahjongDefaultAssetConfig({
    matchBgm: [
      { id: "data", url: "data:audio/mp3;base64,AAAA", label: "数据" },
      { id: "bad id", url: "https://cdn.example/bad.mp3", label: "坏 ID" },
      { id: "ok", url: "https://cdn.example/ok.mp3", label: "有效" },
    ],
  });
  assert.deepEqual(config.catalog.matchBgm, [
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
  const themeController = readFileSync(
    new URL("../games/mahjong/theme-controller.js", import.meta.url),
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
  assert.match(themeController, /configureMahjongAssetPackAppearance/);
  assert.match(themeController, /角色语音/);
  assert.match(themeController, /getMahjongDefaultPack\(\)/);
  assert.match(settingsCss, /\.settings-option strong[\s\S]*?font-size: 20px/);
  assert.match(settingsCss, /\.settings-theme-list strong[\s\S]*?font-size: 20px/);
  assert.match(
    themeController,
    /action === "delete"[\s\S]*?isStandalone[\s\S]*?browserWindow\.confirm\(message\)[\s\S]*?await confirm\?\.\(message\)/,
  );
});
