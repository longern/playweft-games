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
  ["xiangqi", [2, 2]],
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
  "xiangqi",
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
        "background_color",
        "categories",
        "client",
        "description",
        "description_localized",
        "help_url",
        "id",
        "icons",
        "manifestVersion",
        "modes",
        "name",
        "name_localized",
        ...(game === "dou-dizhu" ? ["orientation"] : []),
        "protocol",
        "theme_color",
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
    assert.equal(typeof manifest.name, "string");
    assert.equal(typeof manifest.name_localized["zh-CN"], "string");
    assert.equal(typeof manifest.description, "string");
    assert.equal(typeof manifest.description_localized["zh-CN"], "string");
    assert.ok(manifest.categories.length > 0);
    assert.equal(manifest.help_url, "./help.html");
    assert.equal(manifest.icons.length, 1);
    const [manifestIcon] = manifest.icons;
    assert.match(
      manifestIcon.src,
      new RegExp(`^\\.\\./${game}\\.(?:svg|png|webp)$`),
    );
    const icon = await readFile(`public/${manifestIcon.src.slice(3)}`);
    assert.ok(icon.byteLength > 0, `${game} icon should not be empty`);

    if (manifestIcon.src.endsWith(".svg")) {
      assert.equal(manifestIcon.sizes, "any");
      assert.equal(manifestIcon.type, "image/svg+xml");
      const source = icon.toString("utf8");
      const background = source.match(/<rect\b[^>]*>/)?.[0];
      assert.ok(background, `${game} icon should have a full-size background`);
      assert.doesNotMatch(
        background,
        /\brx=/,
        `${game} icon background should let the platform own corner rounding`,
      );
    }

    if (game === "dou-dizhu") {
      assert.equal(manifest.orientation, "landscape");
    } else {
      assert.equal("orientation" in manifest, false);
    }

    if (game === "sudoku") {
      assert.deepEqual(manifest.modes, { solo: {} });
      continue;
    }

    const [min, max] = ROOM_GAMES.get(game);
    const expectedModes = {
      room: {
        players: { min, max },
        server: {
          runtime: "lua",
          entry: "./game.lua",
          persistence: "durable",
        },
      },
    };
    if (
      ["go", "dou-dizhu", "gomoku", "xiangqi", "werewolf-dealer"].includes(game)
    ) {
      expectedModes.solo = {};
    }
    assert.deepEqual(manifest.modes, expectedModes);
    const main = await readFile(`games/${game}/main.js`, "utf8");
    assert.doesNotMatch(
      main,
      /game\.lua\?raw/,
      `${game} client must not bundle the authoritative Lua source`,
    );
  }
});

test("Featured list points exclusively to every game Manifest", async () => {
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

test("Werewolf dealer keeps visible rem text at least 0.75rem", async () => {
  const files = [
    "games/werewolf-dealer/styles.css",
    "games/werewolf-dealer/dealer/deal.css",
    "games/werewolf-dealer/dealer/dialogs.css",
    "games/werewolf-dealer/dealer/responsive.css",
    "games/werewolf-dealer/dealer/setup.css",
    "games/werewolf-dealer/dealer/theme.css",
  ];

  for (const file of files) {
    const css = await readFile(file, "utf8");
    for (const match of css.matchAll(/font-size:\s*(\d*\.?\d+)rem/g)) {
      assert.ok(
        Number(match[1]) >= 0.75,
        `${file} contains text smaller than 0.75rem: ${match[0]}`,
      );
    }
  }
});

test("Werewolf dealer uses the platform-safe White God role name", async () => {
  const files = [
    "games/werewolf-dealer/role-config.js",
    "games/werewolf-dealer/help.html",
    "games/werewolf-dealer/index.html",
    "games/werewolf-dealer/dealer.js",
  ];
  const prohibitedRoleName = ["白", "痴"].join("");

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.equal(
      source.includes(prohibitedRoleName),
      false,
      `${file} contains a prohibited role name`,
    );
  }
});

test("Werewolf dealer prioritizes a one-screen mobile deal grid", async () => {
  const dealCss = await readFile(
    "games/werewolf-dealer/dealer/deal.css",
    "utf8",
  );
  const responsiveCss = await readFile(
    "games/werewolf-dealer/dealer/responsive.css",
    "utf8",
  );
  const themeCss = await readFile(
    "games/werewolf-dealer/dealer/theme.css",
    "utf8",
  );

  assert.match(
    dealCss,
    /\.dealer-card-grid\[data-density="dense"\][^{]*\{[^}]*repeat\(4,/s,
  );
  assert.match(themeCss, /height:\s*calc\(100svh\s*-\s*52px\)/);
  assert.match(
    responsiveCss,
    /orientation:\s*landscape[\s\S]*?\.dealer-card-grid\[data-density="dense"\][^{]*\{[^}]*repeat\(6,/,
  );
  assert.match(themeCss, /overflow-y:\s*auto/);
});

test("Werewolf dealer setup uses remaining height before it scrolls", async () => {
  const setupCss = await readFile(
    "games/werewolf-dealer/dealer/setup.css",
    "utf8",
  );
  const responsiveCss = await readFile(
    "games/werewolf-dealer/dealer/responsive.css",
    "utf8",
  );

  assert.match(
    setupCss,
    /\.dealer-setup-panel\.has-action-bar\s*\{[^}]*display:\s*flex/s,
  );
  assert.match(
    setupCss,
    /\.dealer-selected-rules\s*\{[^}]*margin-top:\s*14px/s,
  );
  assert.match(
    setupCss,
    /\.dealer-config-shell\.is-confirming::before\s*\{[^}]*flex:\s*1\s+1\s+220px/s,
  );
  assert.doesNotMatch(
    setupCss,
    /\.dealer-config-shell\.is-confirming[^}]*padding-top/s,
  );
  assert.match(
    setupCss,
    /#dealer-selected-rules-copy[^}]*-webkit-line-clamp:\s*3/s,
  );
  assert.match(
    responsiveCss,
    /orientation:\s*landscape[\s\S]*?\.dealer-config-shell\.is-confirming::before\s*\{[^}]*clamp\([^)]*100svh/s,
  );
  const compactLandscapeStart = responsiveCss.indexOf(
    "@media (orientation: landscape) and (max-height: 620px)",
  );
  const continuousLandscapeStart = responsiveCss.indexOf(
    "@media (orientation: landscape) {",
    compactLandscapeStart,
  );
  const compactLandscapeCss = responsiveCss.slice(
    compactLandscapeStart,
    continuousLandscapeStart,
  );
  assert.doesNotMatch(
    compactLandscapeCss,
    /\.dealer-config-shell\.is-confirming::before/,
  );
});

test("Werewolf dealer header stays borderless", async () => {
  const themeCss = await readFile(
    "games/werewolf-dealer/dealer/theme.css",
    "utf8",
  );
  const headerRule = themeCss.match(
    /body\.is-dealer-config \.game-header\s*\{([^}]*)\}/s,
  );

  assert.ok(headerRule);
  assert.doesNotMatch(headerRule[1], /border(?:-bottom)?:/);
});

test("Hidden game views cannot be reopened by component layout styles", async () => {
  const baseCss = await readFile("src/base.css", "utf8");

  assert.match(baseCss, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
});

test("Werewolf dealer page scrollbar belongs to the full-width viewport layer", async () => {
  const themeCss = await readFile(
    "games/werewolf-dealer/dealer/theme.css",
    "utf8",
  );
  const setupCss = await readFile(
    "games/werewolf-dealer/dealer/setup.css",
    "utf8",
  );
  const layoutRule = themeCss.match(
    /body\.is-dealer-config \.dealer-layout\s*\{([^}]*)\}/s,
  );

  assert.ok(layoutRule);
  assert.match(layoutRule[1], /width:\s*100%/);
  assert.match(layoutRule[1], /overflow-y:\s*auto/);
  assert.match(
    setupCss,
    /\.dealer-deal-panel\s*\{[^}]*width:\s*min\(520px,\s*calc\(100%\s*-\s*24px\)\)/s,
  );
});

test("Werewolf dealer uses the top-left back action instead of a deal footer reset", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");

  assert.match(html, /id="dealer-back"/);
  assert.doesNotMatch(html, /id="dealer-reset"/);
  assert.match(
    dealerJs,
    /elements\.back\.addEventListener\("click", handleBack\)/,
  );
  assert.match(dealerJs, /state\.phase === "setup"[\s\S]*?resetToSetup\(\)/);
});

test("Werewolf dealer uses the generated artwork for its card back", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealCss = await readFile(
    "games/werewolf-dealer/dealer/deal.css",
    "utf8",
  );
  const cardBack = await readFile(
    "games/werewolf-dealer/assets/werewolf-card-back.jpg",
  );

  assert.match(html, /class="dealer-identity-card-back"[^>]*><\/div>/);
  assert.match(dealCss, /url\("\.\.\/assets\/werewolf-card-back\.jpg"\)/);
  const numberedCardRule = dealCss.match(/\.dealer-deal-card\s*\{([^}]*)\}/s);
  assert.ok(numberedCardRule);
  assert.match(
    numberedCardRule[1],
    /url\("\.\.\/assets\/werewolf-card-back\.jpg"\)/,
  );
  assert.ok(cardBack.byteLength > 30_000);
  assert.ok(cardBack.byteLength < 150_000);
});
