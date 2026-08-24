import { resolve } from "node:path";
import { readFile, rename, rmdir } from "node:fs/promises";
import { defineConfig } from "vite";
import { normalizeMahjongDefaultAssetConfig } from "./games/mahjong/default-assets.js";
import { buildMahjongOnlineSource } from "./games/mahjong/online-source.js";

const games = [
  "pig-dice",
  "connect-four",
  "texas-holdem",
  "dou-dizhu",
  "werewolf-dealer",
  "uno",
  "sudoku",
  "go",
  "gomoku",
  "xiangqi",
  "mahjong",
];
const THREE_VENDOR_CHUNK = "three-r185.1";

const input = {
  index: resolve(import.meta.dirname, "index.html"),
};

for (const game of games) {
  input[game] = resolve(import.meta.dirname, `games/${game}/index.html`);
  input[`${game}-help`] = resolve(
    import.meta.dirname,
    `games/${game}/help.html`,
  );
}

export default defineConfig({
  plugins: [mahjongDefaultAssets(), emitGamePackages(), preserveGameUrls()],
  build: {
    rollupOptions: {
      input,
      output: {
        manualChunks(id) {
          return id.includes("/node_modules/three/")
            ? THREE_VENDOR_CHUNK
            : undefined;
        },
        chunkFileNames(chunk) {
          return chunk.name === THREE_VENDOR_CHUNK
            ? `assets/vendor/${THREE_VENDOR_CHUNK}-[hash].js`
            : "assets/[name]-[hash].js";
        },
      },
    },
  },
});

function mahjongDefaultAssets() {
  return {
    name: "mahjong-default-assets",
    async config() {
      const sourceUrl = String(
        process.env.MAHJONG_DEFAULT_ASSET_CONFIG_URL || "",
      ).trim();
      if (!sourceUrl) return undefined;
      let response;
      try {
        response = await fetch(sourceUrl);
      } catch (error) {
        throw new Error(`无法读取麻将默认素材配置：${error.message}`);
      }
      if (!response.ok) {
        throw new Error(
          `无法读取麻将默认素材配置：HTTP ${response.status}`,
        );
      }
      let value;
      try {
        value = await response.json();
      } catch {
        throw new Error("麻将默认素材配置必须是 JSON");
      }
      const config = normalizeMahjongDefaultAssetConfig(value);
      const assetCount = Object.values(config.catalog).reduce(
        (count, entries) => count + entries.length,
        0,
      );
      if (!assetCount && !config.assetPacks.length) {
        throw new Error("麻将默认素材配置没有可用素材或可下载素材包");
      }
      return {
        define: {
          // The client module normalizes the injected source exactly once.
          // Injecting `config` here would normalize an already-normalized
          // object again and discard fields such as matchBgm.
          __MAHJONG_DEFAULT_ASSET_CONFIG__: JSON.stringify(value),
        },
      };
    },
  };
}

/**
 * Publish each Manifest and authoritative Lua entry beside its game client.
 */
function emitGamePackages() {
  return {
    name: "emit-game-packages",
    async configureServer(server) {
      const onlinePaths = new Set([
        "/mahjong/game-online.lua",
        "/games/mahjong/game-online.lua",
      ]);
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split("?", 1)[0];
        if (!onlinePaths.has(path)) {
          next();
          return;
        }
        try {
          const source = await readFile(
            new URL("./games/mahjong/game.lua", import.meta.url),
            "utf8",
          );
          const onlineSource = buildMahjongOnlineSource(source);
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.setHeader("Cache-Control", "no-cache");
          response.end(onlineSource);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const game of games) {
        const packageFiles = [
          ["playweft.json", { path: `games/${game}/playweft.json` }],
        ];
        if (game !== "sudoku") {
          packageFiles.push(["game.lua", { path: `games/${game}/game.lua` }]);
        }
        if (game === "mahjong") {
          const source = await readFile(
            new URL("./games/mahjong/game.lua", import.meta.url),
            "utf8",
          );
          packageFiles.push([
            "game-online.lua",
            { source: buildMahjongOnlineSource(source) },
          ]);
        }
        for (const [fileName, input] of packageFiles) {
          const packageSource = input.source ?? await readFile(
            new URL(`./${input.path}`, import.meta.url),
            "utf8",
          );
          this.emitFile({
            type: "asset",
            fileName: `games/${game}/${fileName}`,
            source: packageSource,
          });
        }
      }
    },
  };
}

/**
 * Keep public game URLs stable while storing their source under games/.
 */
function preserveGameUrls() {
  const gamePattern = new RegExp(`^/(${games.join("|")})(?=/|$)`);
  let outDir;

  return {
    name: "preserve-game-urls",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url) {
          request.url = request.url.replace(gamePattern, "/games/$1");
        }
        next();
      });
    },
    async closeBundle() {
      const builtGamesDir = resolve(outDir, "games");
      for (const game of games) {
        await rename(resolve(builtGamesDir, game), resolve(outDir, game));
      }
      await rmdir(builtGamesDir);
    },
  };
}
