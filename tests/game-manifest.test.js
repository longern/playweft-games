import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const ROOM_GAMES = new Map([
  ["pig-dice", [2, 2]],
  ["connect-four", [2, 2]],
  ["texas-holdem", [2, 6]],
  ["dou-dizhu", [3, 3]],
  ["werewolf-dealer", [6, 12]],
  ["uno", [2, 4]],
  ["go", [2, 2]],
  ["gomoku", [2, 2]],
]);
const ALL_GAMES = [
  "pig-dice",
  "connect-four",
  "texas-holdem",
  "dou-dizhu",
  "werewolf-dealer",
  "uno",
  "sudoku",
  "go",
  "gomoku",
];

test("Every game package has a strict Playweft Manifest v1 for bridge v1", async () => {
  const ids = new Set();

  for (const game of ALL_GAMES) {
    const manifest = JSON.parse(
      await readFile(`games/${game}/playweft.json`, "utf8"),
    );

    assert.deepEqual(
      Object.keys(manifest).sort(),
      [
        "$schema",
        "client",
        "display",
        "id",
        "manifestVersion",
        "modes",
        "protocol",
        "version",
      ].sort(),
      `${game} manifest should not contain unknown top-level fields`,
    );
    assert.equal(manifest.manifestVersion, 1);
    assert.match(manifest.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
    assert.equal(ids.has(manifest.id), false, `${manifest.id} must be unique`);
    ids.add(manifest.id);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(manifest.protocol, { min: 1, max: 1 });
    assert.deepEqual(manifest.client, { entry: "./" });
    assert.equal(
      typeof manifest.display.locales[manifest.display.defaultLocale]?.name,
      "string",
    );
    assert.equal(manifest.display.help, "./help.html");
    assert.equal(manifest.display.icon, `../${game}.svg`);
    const icon = await readFile(`public/${game}.svg`, "utf8");
    const background = icon.match(/<rect\b[^>]*>/)?.[0];
    assert.ok(background, `${game} icon should have a full-size background`);
    assert.doesNotMatch(
      background,
      /\brx=/,
      `${game} icon background should let the platform own corner rounding`,
    );

    if (game === "sudoku") {
      assert.deepEqual(manifest.modes, { solo: {} });
      continue;
    }

    const [min, max] = ROOM_GAMES.get(game);
    assert.deepEqual(manifest.modes, {
      room: {
        players: { min, max },
        server: {
          runtime: "lua",
          entry: "./game.lua",
          persistence: "durable",
        },
      },
    });
    const main = await readFile(`games/${game}/main.js`, "utf8");
    assert.doesNotMatch(
      main,
      /game\.lua\?raw/,
      `${game} client must not bundle the authoritative Lua source`,
    );
  }
});

test("Featured list points exclusively to the nine game Manifests", async () => {
  const featured = JSON.parse(
    await readFile("public/featured-games.json", "utf8"),
  );

  assert.deepEqual(
    featured,
    ALL_GAMES.map((game) => ({
      manifestUrl: `./${game}/playweft.json`,
    })),
  );
});

test("Cloudflare Pages limits static CORS to browser-fetched JSON", async () => {
  const headers = await readFile("public/_headers", "utf8");

  assert.match(headers, /^\/featured-games\.json\s*$/m);
  assert.match(headers, /^\/:game\/playweft\.json\s*$/m);
  assert.equal(
    headers.match(/^\s+Access-Control-Allow-Origin: \*$/gm)?.length,
    2,
  );
  assert.doesNotMatch(headers, /^\/\*\s*$/m);
  assert.doesNotMatch(headers, /game\.lua/);
});
