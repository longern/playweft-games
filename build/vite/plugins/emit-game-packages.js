import { readFile } from "node:fs/promises";
import { buildMahjongOnlineSource } from "../../../games/mahjong/room-paipu-online-source.js";

export function emitGamePackages({ games }) {
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
            new URL("../../../games/mahjong/game.lua", import.meta.url),
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
            new URL("../../../games/mahjong/game.lua", import.meta.url),
            "utf8",
          );
          packageFiles.push([
            "game-online.lua",
            { source: buildMahjongOnlineSource(source) },
          ]);
        }
        for (const [fileName, input] of packageFiles) {
          const packageSource =
            input.source ??
            (await readFile(
              new URL(`../../../${input.path}`, import.meta.url),
              "utf8",
            ));
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
