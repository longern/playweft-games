import { resolve } from "node:path";
import { defineConfig } from "vite";
import { emitGamePackages } from "./build/vite/plugins/emit-game-packages.js";
import { mahjongDefaultAssets } from "./build/vite/plugins/mahjong-default-assets.js";
import { preserveGameUrls } from "./build/vite/plugins/preserve-game-urls.js";

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
  plugins: [
    mahjongDefaultAssets(),
    emitGamePackages({ games }),
    preserveGameUrls({ games }),
  ],
  server: {
    port: 9139,
  },
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
