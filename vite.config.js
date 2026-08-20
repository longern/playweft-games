import { resolve } from "node:path";
import { readFile, rename, rmdir } from "node:fs/promises";
import { defineConfig } from "vite";

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
  plugins: [emitGamePackages(), preserveGameUrls()],
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

/**
 * Publish each Manifest and authoritative Lua entry beside its game client.
 */
function emitGamePackages() {
  return {
    name: "emit-game-packages",
    async generateBundle() {
      for (const game of games) {
        const packageFiles = [
          ["playweft.json", `games/${game}/playweft.json`],
          ...(game === "sudoku"
            ? []
            : [["game.lua", `games/${game}/game.lua`]]),
        ];
        for (const [fileName, sourcePath] of packageFiles) {
          this.emitFile({
            type: "asset",
            fileName: `games/${game}/${fileName}`,
            source: await readFile(
              new URL(`./${sourcePath}`, import.meta.url),
              "utf8",
            ),
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
