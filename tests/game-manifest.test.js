import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const ROOM_GAMES = new Map([
  ["pig-dice", [2, 2]],
  ["connect-four", [2, 2]],
  ["texas-holdem", [2, 6]],
  ["dou-dizhu", [3, 3]],
  ["werewolf-dealer", [6, 15]],
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

test("Werewolf dealer supports complete presets through 15 players", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");
  const { MAX_PLAYER_COUNT, MIN_PLAYER_COUNT, PRESETS, roleCount } =
    await import("../games/werewolf-dealer/role-config.js");

  assert.equal(MIN_PLAYER_COUNT, 6);
  assert.equal(MAX_PLAYER_COUNT, 15);
  for (const playerCount of [13, 14, 15]) {
    assert.match(html, new RegExp(`data-player-count="${playerCount}"`));
    assert.ok(
      PRESETS.some((preset) => roleCount(preset) === playerCount),
      `${playerCount} players should have a built-in preset`,
    );
  }
  assert.match(dealerJs, /state\.playerCount >= MAX_PLAYER_COUNT/);
  assert.match(dealerJs, /max="\$\{MAX_PLAYER_COUNT\}"/);
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

test("Werewolf local deal header shows only the preset name and rules action", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");

  assert.match(html, /id="dealer-deal-preset-name"/);
  assert.match(html, /id="dealer-open-rules"[\s\S]*?aria-label="查看版型规则"/);
  assert.doesNotMatch(html, /请选择自己的编号/);
  assert.doesNotMatch(html, /id="dealer-progress"/);
  assert.doesNotMatch(dealerJs, /已查看 \$\{viewedCount\}/);
  assert.match(dealerJs, /dealPresetName\.textContent = state\.config\.name/);
  assert.match(
    dealerJs,
    /rulesDialogCopy\.textContent =[\s\S]*?state\.config\.rules\.trim\(\)/,
  );
});

test("Werewolf local deal grid uses available space without adding rows", async () => {
  const dealCss = await readFile(
    "games/werewolf-dealer/dealer/deal.css",
    "utf8",
  );
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");
  const responsiveCss = await readFile(
    "games/werewolf-dealer/dealer/responsive.css",
    "utf8",
  );

  assert.match(
    dealerJs,
    /grid\.dataset\.count = String\(state\.roles\.length\)/,
  );
  assert.match(
    responsiveCss,
    /orientation:\s*landscape[\s\S]*?max-height:\s*620px[\s\S]*?\.dealer-deal-panel\s*\{[^}]*760px[\s\S]*?repeat\(6,[\s\S]*?data-count="15"[\s\S]*?repeat\(8,/,
  );
  assert.match(
    responsiveCss,
    /orientation:\s*landscape[\s\S]*?min-height:\s*621px[\s\S]*?\.dealer-deal-panel\s*\{[^}]*840px[\s\S]*?\.dealer-card-grid\[data-density="dense"\][^{]*\{[^}]*repeat\(6,[\s\S]*?data-count="15"[\s\S]*?repeat\(8,/,
  );
  assert.match(
    responsiveCss,
    /orientation:\s*portrait[\s\S]*?min-height:\s*900px[\s\S]*?data-count="12"[\s\S]*?repeat\(3,/,
  );
  assert.match(
    dealCss,
    /\.dealer-rules-dialog-panel\s*\{[^}]*min-height:\s*clamp\(220px,\s*32svh,\s*280px\)/s,
  );
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
    /#dealer-selected-rules-copy[^}]*-webkit-line-clamp:\s*3;[^}]*line-clamp:\s*3/s,
  );
  assert.match(
    responsiveCss,
    /#dealer-selected-rules-copy\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*line-clamp:\s*2/s,
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

test("Werewolf dealer back action is circular and only paints mouse interaction states", async () => {
  const themeCss = await readFile(
    "games/werewolf-dealer/dealer/theme.css",
    "utf8",
  );
  const backRule = themeCss.match(/\.dealer-back-action\s*\{([^}]*)\}/s);

  assert.ok(backRule);
  assert.match(backRule[1], /border-radius:\s*50%/);
  assert.match(backRule[1], /background:\s*transparent/);
  assert.match(
    themeCss,
    /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.dealer-back-action:hover[\s\S]*?\.dealer-back-action:active/,
  );
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

test("Werewolf dealer confirms before leaving an active local deal", async () => {
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");

  assert.match(
    dealerJs,
    /state\.phase === "setup"[\s\S]*?await confirmAction\([\s\S]*?结束本轮发牌[\s\S]*?if \(confirmed\) resetToSetup\(\)/,
  );
});

test("Werewolf dealer gives guests a dedicated host waiting state", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");

  assert.match(html, /id="dealer-host-waiting"[\s\S]*?等待房主选择版型/);
  assert.match(
    dealerJs,
    /awaitingHost = isRoom && !canConfigure && !hasSelection/,
  );
  assert.match(
    dealerJs,
    /setVisible\(elements\.presetSection, !hasSelection && !awaitingHost\)/,
  );
  const setupCss = await readFile(
    "games/werewolf-dealer/dealer/setup.css",
    "utf8",
  );
  assert.match(
    setupCss,
    /\.dealer-host-waiting\[hidden\]\s*\{[^}]*display:\s*none/s,
  );
});

test("Werewolf dealer labels preset switching and built-in copying explicitly", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");

  assert.match(html, /id="dealer-change-preset"[\s\S]*?>\s*全部版型\s*</);
  assert.match(
    dealerJs,
    /editorSave\.textContent = sourceIsPreset \? "复制并保存" : "保存"/,
  );
});

test("Werewolf dealer delegates custom preset deletion confirmation", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");
  const mainJs = await readFile("games/werewolf-dealer/main.js", "utf8");

  assert.doesNotMatch(html, /id="dealer-delete-confirm"/);
  assert.match(dealerJs, /await confirmAction\(/);
  assert.match(mainJs, /isStandalone[\s\S]*?window\.confirm\(message\)/);
  assert.match(mainJs, /client\.confirm\(message\)/);
});

test("Werewolf dealer fades the enlarged identity view without scaling it", async () => {
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");
  const presenceBlock = dealerJs.match(
    /const privacyLayerPresence = createPresence\(\{([\s\S]*?)\n  \}\);/,
  );

  assert.ok(presenceBlock);
  assert.match(presenceBlock[1], /enter:\s*\{\s*opacity:\s*\[0, 1\]\s*\}/);
  assert.match(presenceBlock[1], /exit:\s*\{\s*opacity:\s*0\s*\}/);
  assert.doesNotMatch(presenceBlock[1], /scale|transform/);
  assert.match(
    dealerJs,
    /privacyLayerPresence\.setVisible\([\s\S]*?\["privacy", "reveal"\]\.includes\(state\.phase\)/,
  );
});

test("Werewolf dealer presents the role name without an ambiguous letter emblem", async () => {
  const html = await readFile("games/werewolf-dealer/index.html", "utf8");
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");
  const dealCss = await readFile(
    "games/werewolf-dealer/dealer/deal.css",
    "utf8",
  );

  assert.doesNotMatch(html, /dealer-role-mark|dealer-identity-emblem/);
  assert.doesNotMatch(dealerJs, /roleMark/);
  assert.match(
    dealCss,
    /\.dealer-identity-card strong\s*\{[^}]*font-size:\s*clamp\(1\.65rem,\s*8vw,\s*2rem\)/s,
  );
});

test("Werewolf preset picker keeps summaries readable and rules to one line", async () => {
  const dealerJs = await readFile("games/werewolf-dealer/dealer.js", "utf8");
  const setupCss = await readFile(
    "games/werewolf-dealer/dealer/setup.css",
    "utf8",
  );
  const dialogsCss = await readFile(
    "games/werewolf-dealer/dealer/dialogs.css",
    "utf8",
  );
  const descriptionRule = setupCss.match(
    /\.dealer-preset-description\s*\{([^}]*)\}/s,
  );
  const summaryRule = setupCss.match(
    /\.dealer-preset-team-summary\s*\{([^}]*)\}/s,
  );

  assert.ok(descriptionRule);
  assert.match(descriptionRule[1], /white-space:\s*nowrap/);
  assert.match(descriptionRule[1], /text-overflow:\s*ellipsis/);
  assert.ok(summaryRule);
  assert.doesNotMatch(summaryRule[1], /#8f4540/);
  assert.doesNotMatch(dealerJs, /roleCount\(preset\)\}\s*人/);
  assert.match(
    dialogsCss,
    /\.dealer-all-presets \.dealer-preset-main\s*\{[^}]*min-height:\s*104px/s,
  );
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
