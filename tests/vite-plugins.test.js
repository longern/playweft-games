import assert from "node:assert/strict";
import test from "node:test";

import viteConfig from "../vite.config.js";
import { emitGamePackages } from "../build/vite/plugins/emit-game-packages.js";
import { mahjongDefaultAssets } from "../build/vite/plugins/mahjong-default-assets.js";
import { preserveGameUrls } from "../build/vite/plugins/preserve-game-urls.js";

test("Vite config keeps the configured dev port and composes the three plugins", () => {
  assert.equal(viteConfig.server.port, 9139);
  assert.deepEqual(
    viteConfig.plugins.map((plugin) => plugin.name),
    ["mahjong-default-assets", "emit-game-packages", "preserve-game-urls"],
  );
});

test("Mahjong default asset plugin injects the fetched source configuration", async () => {
  const previousUrl = process.env.MAHJONG_DEFAULT_ASSET_CONFIG_URL;
  const previousFetch = globalThis.fetch;
  const sourceConfig = {
    portraits: [
      { id: "remote", url: "https://example.com/portrait.png", label: "远程人物" },
    ],
  };
  process.env.MAHJONG_DEFAULT_ASSET_CONFIG_URL = "https://example.com/assets.json";
  globalThis.fetch = async (url) => {
    assert.equal(url, "https://example.com/assets.json");
    return {
      ok: true,
      async json() {
        return sourceConfig;
      },
    };
  };
  try {
    const result = await mahjongDefaultAssets().config();
    assert.equal(
      result.define.__MAHJONG_DEFAULT_ASSET_CONFIG__,
      JSON.stringify(sourceConfig),
    );
  } finally {
    if (previousUrl === undefined) delete process.env.MAHJONG_DEFAULT_ASSET_CONFIG_URL;
    else process.env.MAHJONG_DEFAULT_ASSET_CONFIG_URL = previousUrl;
    globalThis.fetch = previousFetch;
  }
});

test("game package plugin serves and emits the generated Mahjong online source", async () => {
  const plugin = emitGamePackages({ games: ["mahjong", "sudoku"] });
  const middleware = [];
  await plugin.configureServer({ middlewares: { use(handler) { middleware.push(handler); } } });
  assert.equal(middleware.length, 1);

  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
  let nextCalls = 0;
  await middleware[0]({ url: "/mahjong/game-online.lua?watch=1" }, response, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(response.headers["Cache-Control"], "no-cache");
  assert.ok(response.body.length > 0);

  const emitted = [];
  await plugin.generateBundle.call({
    emitFile(file) {
      emitted.push(file);
    },
  });
  assert.deepEqual(
    emitted.map(({ fileName }) => fileName),
    [
      "games/mahjong/playweft.json",
      "games/mahjong/game.lua",
      "games/mahjong/game-online.lua",
      "games/sudoku/playweft.json",
    ],
  );
  assert.ok(emitted.find(({ fileName }) => fileName.endsWith("game-online.lua")).source.length > 0);
});

test("preserve-game-urls plugin rewrites public game paths in dev", async () => {
  const plugin = preserveGameUrls({ games: ["mahjong", "sudoku"] });
  const middleware = [];
  plugin.configureServer({ middlewares: { use(handler) { middleware.push(handler); } } });
  const request = { url: "/mahjong/index.html?mode=solo" };
  let nextCalls = 0;
  middleware[0](request, {}, () => {
    nextCalls += 1;
  });
  assert.equal(request.url, "/games/mahjong/index.html?mode=solo");
  assert.equal(nextCalls, 1);
});
