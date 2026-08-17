import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Euler, PerspectiveCamera, Texture, Vector3 } from "three";
import {
  AUTO_RIICHI_DISCARD_DELAY_MS,
  CLAIM_LABELS,
  HAND_INSERTION_DELAY_MS,
  DORA_INDICATOR_SLOT_COUNT,
  HAND_END_PRESENTATION_DELAY_MS,
} from "../games/mahjong/constants.js";
import {
  automaticRiichiDiscard,
  claimPreviewTiles,
  deferredHandInsertion,
  doraIndicatorSlots,
  doraTypeCounts,
  exhaustiveDrawPresentation,
  opponentHandLayout,
  orderedHand,
  partitionClaimActions,
  nextDoraType,
  resultBasePaymentTotal,
  splitRevealedHand,
} from "../games/mahjong/game-format.js";
import {
  fixedViewportScale,
  MAHJONG_VIEWPORT,
} from "../games/mahjong/fixed-viewport.js";
import {
  handTransform,
  MELD_GROUP_GAP,
  MELD_HAND_CLEARANCE,
  MELD_SCALE,
  meldDisplayLayout,
  meldRightExtension,
  OPPONENT_MELD_HAND_CLEARANCE,
  meldTransform,
  ownHandOverlayTransform,
  OWN_HAND_DRAG,
  OWN_HAND_LAYOUT,
  PLAYFIELD_CENTRE_Z,
  RIICHI_TILE_ACROSS_EXTRA,
  RIVER_CORNER_GAP,
  RIVER_TILE_GAP,
  riverTransform,
  SEAT_YAW,
  TILE_PHYSICAL_MM,
  TILE_SIZE,
} from "../games/mahjong/render/three-layout.js";
import {
  TILE_FACE_NAMES,
  tileFaceFrameIndex,
} from "../games/mahjong/render/tile-texture-map.js";
import {
  BACK_LAYER_DEPTH_RATIO,
  TILE_BACK_EDGE_RADIUS,
  TILE_EDGE_RADIUS,
  TILE_EDGE_SEGMENTS,
  ThreeTileFactory,
} from "../games/mahjong/render/three-tile-factory.js";
import {
  prepareTableConsoleContext,
  TABLE_CONSOLE_LAYOUT,
  TABLE_CONSOLE_SCORE_LAYOUT,
} from "../games/mahjong/render/three-console.js";
import {
  ACTION_CALLOUT_DURATION_MS,
  ACTION_CALLOUT_SIZE,
  ACTION_CALLOUT_TARGETS,
  actionCalloutDescriptor,
  actionCalloutKey,
} from "../games/mahjong/render/three-callout.js";
import { TABLE_GEOMETRY } from "../games/mahjong/render/three-table.js";
import { planarTileJitter } from "../games/mahjong/render/three-tile-jitter.js";

function projectedStandingTileBounds(position, index, camera, viewport) {
  const transform = handTransform(position, index, 13);
  const cos = Math.cos(transform.yaw);
  const sin = Math.sin(transform.yaw);
  const points = [];
  for (const localX of [-TILE_SIZE.width / 2, TILE_SIZE.width / 2]) {
    for (const localY of [-TILE_SIZE.height / 2, TILE_SIZE.height / 2]) {
      for (const localZ of [-TILE_SIZE.depth / 2, TILE_SIZE.depth / 2]) {
        const point = new Vector3(
          transform.x + localX * cos + localZ * sin,
          transform.y + localY,
          transform.z - localX * sin + localZ * cos,
        ).project(camera);
        points.push({
          x: ((point.x + 1) * viewport.width) / 2,
          y: ((1 - point.y) * viewport.height) / 2,
        });
      }
    }
  }
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function rectanglesOverlap(left, right) {
  return (
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top
  );
}

test("mahjong maps every standard and red-five face to the atlas", () => {
  assert.equal(TILE_FACE_NAMES.length, 37);
  assert.equal(TILE_FACE_NAMES[tileFaceFrameIndex(25)], "Sou7");
  assert.equal(TILE_FACE_NAMES[tileFaceFrameIndex(32)], "Haku");
  assert.equal(TILE_FACE_NAMES[tileFaceFrameIndex(5, true)], "Man5-Dora");
  assert.equal(TILE_FACE_NAMES[tileFaceFrameIndex(14, true)], "Pin5-Dora");
  assert.equal(TILE_FACE_NAMES[tileFaceFrameIndex(23, true)], "Sou5-Dora");
  assert.throws(() => tileFaceFrameIndex(0), RangeError);
  assert.throws(() => tileFaceFrameIndex(35), RangeError);
});

test("mahjong white dragon uses the same physical face material as every tile", () => {
  const factory = readFileSync(
    new URL("../games/mahjong/render/three-tile-factory.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    factory,
    /isWhiteDragon|numericType\s*===\s*32|type\s*===\s*32/,
  );
});

test("mahjong tile geometry follows real parlor tile proportions", () => {
  assert.deepEqual(TILE_PHYSICAL_MM, { width: 21, height: 28, depth: 16.5 });
  assert.equal(TILE_SIZE.width, 21 / 28);
  assert.equal(TILE_SIZE.height, 1);
  assert.equal(TILE_SIZE.depth, 16.5 / 28);
  assert.equal(BACK_LAYER_DEPTH_RATIO, 0.36);
  assert.equal(TILE_EDGE_RADIUS * TILE_PHYSICAL_MM.height, 2);
  assert.equal(TILE_BACK_EDGE_RADIUS * TILE_PHYSICAL_MM.height, 1.6);
  assert.equal(TILE_EDGE_SEGMENTS, 7);
});

test("mahjong table is a perspective 3D surface that surrounds every tile zone", () => {
  assert.deepEqual(TABLE_GEOMETRY, {
    width: 28,
    depth: 25,
    centreZ: -1.5,
    railWidth: 0.96,
    railHeight: 0.58,
    baseHeight: 0.42,
  });
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /new ThreeMahjongTable/);
  assert.match(
    renderer,
    /CAMERA_POSITION = Object\.freeze\(\{ x: 0, y: 15\.558, z: 15\.908 \}\)/,
  );
  assert.match(renderer, /felt-skin-moonwave-v1\.jpg\?url/);
  assert.match(renderer, /felt-texture-v1\.jpg\?url/);
  assert.match(
    renderer,
    /new SpotLight\(0xffedcf, 62, 46, 0\.96, 0\.86, 1\.35\)/,
  );
  assert.match(
    renderer,
    /new SpotLight\(0xffedcf, 28, 46, 0\.96, 0\.86, 1\.35\)/,
  );
  assert.match(renderer, /overhead\.position\.set\(0, 16, -1\.5\)/);
  assert.match(renderer, /overhead\.target\.position\.set\(0, 0, -1\.5\)/);
  assert.doesNotMatch(renderer, /ShadowMaterial|addShadowReceiver/);
});

test("mahjong restores its canvas overlay after mobile suspension", () => {
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const tableConsole = readFileSync(
    new URL("../games/mahjong/render/three-console.js", import.meta.url),
    "utf8",
  );

  assert.match(main, /window\.addEventListener\("pagehide", handlePageHide\)/);
  assert.match(main, /if \(!event\.persisted\) destroy\(\)/);
  assert.match(main, /window\.addEventListener\("pageshow", handlePageShow\)/);
  assert.match(
    main,
    /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/,
  );
  assert.match(main, /visualRenderer\.resume\(\)/);
  assert.match(
    renderer,
    /addEventListener\("webglcontextrestored", this\.onContextRestored\)/,
  );
  assert.match(
    renderer,
    /this\.tableConsole\.restore\(this\.state, this\.ui\)/,
  );
  assert.match(
    renderer,
    /if \(viewportChanged && this\.ready && this\.state && this\.ui\)/,
  );
  assert.match(renderer, /this\.render\(this\.state, \[\], this\.ui\)/);
  assert.match(
    tableConsole,
    /restore\(state, ui\) \{[^}]*this\.texture\.needsUpdate = true/s,
  );
});

test("mahjong rebuilds the table-console canvas transform before every redraw", () => {
  const calls = [];
  const context = {
    clearRect(...args) {
      calls.push(["clearRect", ...args]);
    },
    setTransform(...args) {
      calls.push(["setTransform", ...args]);
    },
  };
  prepareTableConsoleContext(context, { width: 1280, height: 1104 });
  assert.deepEqual(calls, [
    ["setTransform", 1, 0, 0, 1, 0, 0],
    ["clearRect", 0, 0, 1280, 1104],
    ["setTransform", 2, 0, 0, 2, 0, 0],
  ]);
});

test("mahjong keeps the 13-tile rack stable and moves the drawn tile to the end", () => {
  const rack = [5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53];
  assert.deepEqual(orderedHand(rack, 18), [...rack, 18]);

  const firstRackTile = ownHandOverlayTransform(0, 1280, 588);
  const firstRackTileAfterDraw = ownHandOverlayTransform(0, 1280, 588, {
    drawn: false,
  });
  const drawnTile = ownHandOverlayTransform(13, 1280, 588, { drawn: true });
  assert.deepEqual(firstRackTile, firstRackTileAfterDraw);
  assert.ok(drawnTile.x > ownHandOverlayTransform(12, 1280, 588).x);
  assert.equal(firstRackTile.scale, drawnTile.scale);
  assert.equal(firstRackTile.scaleX, drawnTile.scaleX);
  assert.equal(firstRackTile.scaleY, drawnTile.scaleY);
  const safeWidth = Math.min(1280, 588 * OWN_HAND_LAYOUT.safeAspect);
  const handLeft = firstRackTile.x - firstRackTile.tileWidth / 2;
  const handRight = drawnTile.x + drawnTile.tileWidth / 2;
  assert.ok(Math.abs(handRight - handLeft - safeWidth * 0.64) < 1e-9);
  assert.ok(Math.abs((handLeft + handRight) / 2 + safeWidth * 0.055) < 1e-9);
  assert.ok(firstRackTile.tileHeight < 76);
  assert.ok(firstRackTile.tileHeight > 68);
  assert.equal(
    firstRackTile.y - firstRackTile.tileHeight / 2,
    -588 / 2 + OWN_HAND_LAYOUT.bottomInset,
  );

  const compactFirst = ownHandOverlayTransform(0, 853, 392);
  const compactDrawn = ownHandOverlayTransform(13, 853, 392, { drawn: true });
  const compactSafeWidth = Math.min(853, 392 * OWN_HAND_LAYOUT.safeAspect);
  const compactWidth =
    compactDrawn.x +
    compactDrawn.tileWidth / 2 -
    (compactFirst.x - compactFirst.tileWidth / 2);
  assert.ok(Math.abs(compactWidth - compactSafeWidth * 0.64) < 1e-9);
  assert.ok(compactFirst.scale < firstRackTile.scale);
});

test("mahjong pauses before integrating a hand-discarded drawn tile", () => {
  const previous = {
    drawnPlayerIndex: 1,
    ownHand: [5, 9, 13, 17],
    drawnTile: 53,
  };
  assert.deepEqual(
    deferredHandInsertion(
      previous,
      [
        {
          type: "discarded",
          playerIndex: 1,
          tile: 4,
          fromDrawn: false,
        },
      ],
      { ownDiscardedTile: 13 },
    ),
    { seat: 1, ownHand: [5, 9, 17], drawnTile: 53 },
  );
  assert.equal(
    deferredHandInsertion(previous, [
      {
        type: "discarded",
        playerIndex: 1,
        tile: 53,
        fromDrawn: true,
      },
    ]),
    null,
  );
  assert.deepEqual(
    deferredHandInsertion(
      {
        drawnPlayerIndex: 3,
        players: ["p1", "p2", "p3", "p4"],
        handCounts: { p3: 10 },
      },
      [
        {
          type: "riichi",
          playerIndex: 3,
          tile: 23,
          fromDrawn: false,
        },
      ],
      { random: () => 0.49 },
    ),
    { seat: 3, rackIndex: 4 },
  );
  assert.ok(HAND_INSERTION_DELAY_MS >= 200 && HAND_INSERTION_DELAY_MS <= 350);

  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(
    main,
    /queueHandInsertion\(previousState, events, ownDiscardedTile\)/,
  );
  assert.match(
    main,
    /window\.setTimeout\(\(\) => \{\s*handInsertion = null;\s*renderCurrentState\(\);\s*\}, HAND_INSERTION_DELAY_MS\)/s,
  );
  assert.match(renderer, /deferredHandInsertionSeat/);
  assert.match(renderer, /deferredHandInsertionIndex/);
  assert.match(renderer, /count - \(insertionDeferred \? 1 : 0\)/);
  assert.match(renderer, /filter\(\(index\) => index !== deferredIndex\)/);
});

test("mahjong puts a post-call draw in the slot after the shortened rack", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /this\.addOwnTile\(\s*drawn,\s*rack\.length,/s);
  assert.doesNotMatch(renderer, /this\.addOwnTile\(\s*drawn,\s*13,/s);

  const rackEnd = ownHandOverlayTransform(9, 1280, 720);
  const drawn = ownHandOverlayTransform(10, 1280, 720, { drawn: true });
  assert.ok(drawn.x > rackEnd.x);
  assert.doesNotMatch(renderer, /ownMeldOverlayTransform|addOwnMeldTile/);
});

test("mahjong preserves hand order when there is no current drawn tile", () => {
  const hand = [13, 5, 9];
  assert.deepEqual(orderedHand(hand, 0), hand);
});

test("mahjong keeps opponent rack slots fixed while showing a separated drawn tile", () => {
  const idle = opponentHandLayout(13, 0, false);
  const afterDraw = opponentHandLayout(13, 0, true);
  assert.deepEqual(idle, {
    rackCapacity: 13,
    rackCount: 13,
    hasDrawn: false,
  });
  assert.deepEqual(afterDraw, {
    rackCapacity: 13,
    rackCount: 13,
    hasDrawn: true,
  });
  for (const position of ["bottom", "right", "top", "left"]) {
    assert.deepEqual(
      handTransform(position, 0, idle.rackCapacity),
      handTransform(position, 0, afterDraw.rackCapacity),
    );
  }
  assert.deepEqual(opponentHandLayout(10, 1, true), {
    rackCapacity: 10,
    rackCount: 10,
    hasDrawn: true,
  });
  assert.deepEqual(opponentHandLayout(11, 1, false), {
    rackCapacity: 11,
    rackCount: 11,
    hasDrawn: false,
  });
  assert.deepEqual(opponentHandLayout(1, 4, true), {
    rackCapacity: 1,
    rackCount: 1,
    hasDrawn: true,
  });
});

test("mahjong keeps five fixed dora slots and preserves red-five artwork", () => {
  assert.equal(DORA_INDICATOR_SLOT_COUNT, 5);
  assert.deepEqual(
    doraIndicatorSlots({
      doraIndicators: [4],
      doraIndicatorTiles: [
        { type: 5, red: true },
        { type: 31, red: false },
      ],
    }),
    [{ type: 5, red: true }, { type: 31, red: false }, null, null, null],
  );
  assert.deepEqual(doraIndicatorSlots({ doraIndicators: [4] }), [
    { type: 4, red: false },
    null,
    null,
    null,
    null,
  ]);
});

test("mahjong derives visible dora with suit, wind, and dragon wrapping", () => {
  assert.equal(nextDoraType(9), 1);
  assert.equal(nextDoraType(18), 10);
  assert.equal(nextDoraType(27), 19);
  assert.equal(nextDoraType(31), 28);
  assert.equal(nextDoraType(34), 32);
  assert.equal(nextDoraType(0), 0);
  assert.deepEqual(
    [...doraTypeCounts({ doraIndicators: [4, 4, 31, 34] })],
    [
      [5, 2],
      [28, 1],
      [32, 1],
    ],
  );
});

test("mahjong groups every chi behind one action and previews only the two consumed tiles", () => {
  const claims = [
    { option: 1, kind: "ron", tileTypes: [] },
    { option: 2, kind: "chi", tileTypes: [3, 5], red: [false, true] },
    { option: 3, kind: "chi", tileTypes: [5, 6], red: [false, false] },
  ];
  const grouped = partitionClaimActions(claims);
  assert.deepEqual(
    grouped.immediate.map(({ kind }) => kind),
    ["ron"],
  );
  assert.deepEqual(
    grouped.chi.map(({ option }) => option),
    [2, 3],
  );
  assert.deepEqual(claimPreviewTiles(grouped.chi[0]), [
    { type: 3, red: false },
    { type: 5, red: true },
  ]);

  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    view,
    /if \(chiClaims\.length > 0\) \{\s*elements\.claims\.append\(this\.createChiAction\(chiClaims\)\)/s,
  );
  assert.match(view, /if \(claims\.length === 1\)/);
  assert.match(view, /picker\.className = "claim-choice-popover"/);
  assert.match(
    view,
    /--claim-choice-columns", String\(Math\.min\(3, claims\.length\)\)/,
  );
  assert.match(view, /layer\.className = "claim-choice-layer"/);
  assert.match(view, /if \(event\.target === layer\) setOpen\(false\)/);
  assert.match(view, /if \(event\.key === "Escape"\) setOpen\(false\)/);
  assert.match(view, /createTile\(tile\.type, "claim-choice", tile\.red\)/);
  assert.match(
    styles,
    /\.claim-choice-layer \{[^}]*position: absolute;[^}]*inset: 0;[^}]*background: transparent/s,
  );
  assert.match(styles, /\.claim-choice-popover \{/);
  assert.match(
    styles,
    /\.tile-claim-choice \{[^}]*width: 25px;[^}]*height: 35px/s,
  );
});

test("mahjong keeps action buttons in a fixed player-facing order", () => {
  assert.deepEqual(
    partitionClaimActions([
      { kind: "ron" },
      { kind: "kan" },
      { kind: "chi", option: 1 },
      { kind: "pon" },
      { kind: "chi", option: 2 },
    ]),
    {
      chi: [
        { kind: "chi", option: 1 },
        { kind: "chi", option: 2 },
      ],
      immediate: [{ kind: "pon" }, { kind: "kan" }, { kind: "ron" }],
    },
  );

  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const chiPosition = view.indexOf(
    "elements.claims.append(this.createChiAction(chiClaims))",
  );
  const immediatePosition = view.indexOf(
    "for (const claim of immediateClaims)",
  );
  assert.ok(chiPosition > 0 && chiPosition < immediatePosition);
  assert.match(
    view,
    /this\.elements\.actionBar\.append\(\s*this\.elements\.abort,\s*this\.elements\.claims,\s*this\.elements\.riichi,\s*this\.elements\.tsumo,\s*this\.elements\.pass,\s*this\.elements\.cancelRiichi,/s,
  );
  assert.doesNotMatch(view, /style\.order/);
});

test("mahjong keeps action labels compact and gives wins a dark-red treatment", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );

  assert.equal(CLAIM_LABELS.kan, "杠");
  assert.equal(CLAIM_LABELS.ankan, "杠");
  assert.equal(CLAIM_LABELS.kakan, "杠");
  assert.equal(CLAIM_LABELS.ron, "和");
  assert.match(html, /id="abort-button"[^>]*>流局<\/button>/);
  assert.match(
    html,
    /id="tsumo-button" class="win-action"[^>]*>自摸<\/button>/,
  );
  assert.match(
    html,
    /id="cancel-riichi-button"[\s\S]*?aria-label="取消立直"[\s\S]*?data-lucide="x"/,
  );
  assert.doesNotMatch(html, /id="discard-button"/);
  assert.match(styles, /\.action-bar \{[^}]*min-height: 48px/s);
  assert.match(
    styles,
    /\.action-bar button \{[^}]*min-width: 120px;[^}]*min-height: 48px;[^}]*padding: 2px 20px;[^}]*Playweft Mahjong Xingshu[^}]*font-size: 40px;[^}]*font-weight: 700;[^}]*font-synthesis: weight/s,
  );
  assert.match(
    styles,
    /\.action-bar \.riichi-cancel-action \{[^}]*width: 120px;[^}]*min-width: 120px/s,
  );
  assert.ok(40 * fixedViewportScale(1280, 588) >= 26);
  assert.match(
    styles,
    /\.action-bar \.claim-chi \{[^}]*#3d998d[^}]*#17625b[^}]*#f8fffd/s,
  );
  assert.match(styles, /\.action-bar \.claim-pon \{[^}]*#669bd0[^}]*#345f8d/s);
  assert.match(styles, /\.action-bar \.claim-kan \{[^}]*#d47b4c[^}]*#984029/s);
  assert.match(
    styles,
    /\.action-bar \.gold-action \{[^}]*#f4d979[^}]*#c58d27/s,
  );
  assert.match(styles, /#abort-button \{[^}]*#7d6d27[^}]*#4d471b/s);
  assert.match(
    styles,
    /\.action-bar \.win-action,\s*\.action-bar \.claim-ron \{[^}]*#a8404e[^}]*#641c28/s,
  );
  assert.match(
    styles,
    /#pass-button \{[^}]*background: linear-gradient\(145deg, #555b60, #292d30\)/s,
  );
  assert.match(
    styles,
    /\.action-bar \.riichi-cancel-action \{[^}]*#596f7f[^}]*#303f4b/s,
  );
  assert.match(view, /button\.className = "claim-action claim-kan"/);
});

test("mahjong uses a cancellable two-step riichi tile selection", () => {
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(main, /import \{ X, createIcons \} from "lucide"/);
  assert.match(
    main,
    /elements\.riichi\.addEventListener\("click", enterRiichiMode\)/,
  );
  assert.match(
    main,
    /elements\.cancelRiichi\.addEventListener\("click", cancelRiichiMode\)/,
  );
  assert.match(main, /selectionBeforeRiichi = selectedTileId/);
  assert.match(
    main,
    /orderedOwnTiles\(presentedState\(\)\)\.includes\(selectionBeforeRiichi\)/,
  );
  assert.match(
    main,
    /dispatch\(\{ type: "riichi", tileId: selectedTileId \}\)/,
  );
  assert.match(view, /elements\.cancelRiichi\.hidden = !riichiMode/);
  assert.match(
    view,
    /elements\.actionHint\.textContent = "选择一张牌宣言立直"/,
  );
  assert.match(
    view,
    /"is-riichi-blocked", riichiMode && !riichiTiles\.has\(tileId\)/,
  );
  assert.match(renderer, /riichiMode && !riichiTiles\.has\(tileId\)/);
  assert.match(styles, /\.action-bar \.riichi-cancel-action \{/);
});

test("mahjong shows oversized non-perspective callouts for claims, riichi, and wins", () => {
  assert.deepEqual(
    actionCalloutDescriptor({ type: "claimed", kind: "chi", playerIndex: 2 }),
    {
      label: "吃",
      color: "#f1b84b",
      glow: "#ffd985",
      action: "chi",
      playerIndex: 2,
    },
  );
  assert.equal(
    actionCalloutDescriptor({
      type: "claim_declared",
      kind: "pon",
      playerIndex: 1,
    }),
    null,
  );
  assert.equal(
    actionCalloutDescriptor({ type: "claimed", kind: "pon" }).label,
    "碰",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "claimed", kind: "kan" }).label,
    "杠",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "riichi", playerIndex: 4 }).label,
    "立直",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "won", method: "ron" }).label,
    "和",
  );
  assert.equal(
    actionCalloutDescriptor({ type: "won", method: "tsumo" }).label,
    "自摸",
  );
  assert.equal(
    actionCalloutKey(
      { type: "claimed", kind: "pon", playerIndex: 3, fromIndex: 2, tile: 18 },
      "1:2:24",
    ),
    "1:2:24:pon:3:2:18",
  );
  assert.ok(ACTION_CALLOUT_SIZE.fontSize >= 300);
  assert.ok(ACTION_CALLOUT_SIZE.height >= 300);
  assert.ok(
    ACTION_CALLOUT_DURATION_MS >= 700 && ACTION_CALLOUT_DURATION_MS <= 900,
  );
  assert.ok(ACTION_CALLOUT_TARGETS[1].y <= -160);
  assert.ok(ACTION_CALLOUT_TARGETS[3].y >= 170);
  assert.ok(ACTION_CALLOUT_TARGETS[2].x >= 350);
  assert.ok(ACTION_CALLOUT_TARGETS[4].x <= -350);

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const callout = readFileSync(
    new URL("../games/mahjong/render/three-callout.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /overlayScene\.add\(this\.actionCallout\.sprite\)/);
  assert.match(renderer, /this\.actionCallout\.showLatest\(/);
  assert.match(
    renderer,
    /delayHandRevealForCallout \? ACTION_CALLOUT_DURATION_MS : 0/,
  );
  assert.doesNotMatch(renderer, /ACTION_CALLOUT_DURATION_MS \* 0\.64/);
  assert.match(callout, /new CanvasTexture\(this\.canvas\)/);
  assert.match(callout, /new Sprite\(this\.material\)/);
  assert.match(callout, /Playweft Mahjong Xingshu/);
});

test("mahjong discards by dragging a hand tile above a fixed horizontal line", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  const hand = ownHandOverlayTransform(0, 1280, 720);
  const handTop = 720 / 2 - hand.y - hand.tileHeight / 2;

  assert.ok(OWN_HAND_DRAG.discardLineY < handTop - 60);
  assert.ok(OWN_HAND_DRAG.activationDistance >= 6);
  assert.doesNotMatch(html, /id="discard-button"/);
  assert.doesNotMatch(main, /elements\.discard/);
  assert.doesNotMatch(view, /elements\.discard/);
  assert.match(view, /向上拖动手牌，进入出牌区后松手打出/);
  assert.match(styles, /\.mahjong-three-canvas \{[^}]*touch-action: none/s);
  assert.match(
    renderer,
    /addEventListener\("pointerdown", this\.onPointerDown\)/,
  );
  assert.match(renderer, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.doesNotMatch(renderer, /dragGuide|discard-drag-guide/);
  assert.match(
    renderer,
    /drag\.crossed = this\.viewport\.height \/ 2 - pointer\.y <= OWN_HAND_DRAG\.discardLineY/,
  );
  assert.match(
    renderer,
    /if \(crossed\) this\.callbacks\.onDiscardTile\(tileId\)/,
  );
});

test("mahjong presents winning, exhaustive-draw, and nine-terminals hands before results", () => {
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const format = readFileSync(
    new URL("../games/mahjong/game-format.js", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );

  assert.equal(HAND_END_PRESENTATION_DELAY_MS, 2700);
  assert.match(main, /handRevealKey\(state\)/);
  assert.match(main, /current\.abortiveReason === "九种九牌"/);
  assert.match(main, /exhaustive-draw/);
  assert.match(main, /revealPlayerIndices: handRevealPlayerIndices\(state\)/);
  assert.match(
    main,
    /coveredPlayerIndices: exhaustiveDrawPresentation\(state\)\.covered/,
  );
  assert.match(
    main,
    /animateHandReveal: Boolean\(handRevealKey\(state\)\) && !resultVisible/,
  );
  assert.match(renderer, /startHandReveal\(delay = 0\)/);
  assert.match(
    renderer,
    /this\.revealTiles\.push\(\{ tile, delay: 0, covered \}\)/,
  );
  assert.doesNotMatch(renderer, /this\.revealTiles\.length \* 34/);
  assert.match(
    renderer,
    /tile\.rotation\.x = \(covered \? 1 : -1\) \* Math\.PI \/ 2 \* eased/,
  );
  assert.match(format, /state\.abortiveReason === "九种九牌"/);
  assert.match(format, /abortiveReveal\s*\? state\.abortiveTileRed/);
  assert.match(renderer, /this\.addPresentedHand\(state, "bottom"/);
  assert.match(html, /id="result-hands" class="result-hands"/);
  assert.match(
    html,
    /class="result-footer"[\s\S]*id="result-value" class="result-value" hidden[\s\S]*id="result-total" class="result-total" hidden[\s\S]*id="rematch-button"/,
  );
  assert.doesNotMatch(view, /你赢了/);
  assert.match(
    styles,
    /\.result-yaku \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s,
  );
  assert.match(styles, /\.result-yaku span \{[^}]*font-size: 14\.7px/s);
  assert.match(styles, /\.result-panel \{[^}]*width: 760px/s);
  assert.match(styles, /\.result-footer \{[^}]*justify-content: flex-end/s);
  assert.match(
    styles,
    /\.result-value \{[^}]*color: rgba\(255, 255, 255, 0\.62\);[^}]*font-size: 18px/s,
  );
  assert.match(
    styles,
    /\.result-total \{[^}]*color: #fff;[^}]*font-size: 42px/s,
  );
  assert.match(styles, /\.result-total-unit \{[^}]*font-size: 21px/s);
  assert.match(view, /elements\.resultValue\.textContent = value/);
  assert.match(view, /elements\.resultSummary\.hidden = true/);
  assert.match(
    view,
    /const basePaymentTotal = resultBasePaymentTotal\(state, result\)/,
  );
  assert.match(view, /unit\.className = "result-total-unit"/);
  assert.match(view, /unit\.textContent = "点"/);
  assert.match(
    styles,
    /\.tile-result \{[^}]*width: 33px;[^}]*height: 47px;[^}]*flex: 0 0 33px/s,
  );
  assert.match(
    styles,
    /\.tile-result\.is-winning-tile \{[^}]*margin-left: 9px/s,
  );

  assert.deepEqual(
    exhaustiveDrawPresentation({
      phase: "hand_ended",
      draw: true,
      result: { tenpai: [true, false, true, false] },
    }),
    { revealed: [3], covered: [2, 4] },
  );
  assert.deepEqual(
    exhaustiveDrawPresentation({
      phase: "hand_ended",
      draw: true,
      result: { abortive: true, tenpai: [true, false, true, false] },
    }),
    { revealed: [], covered: [] },
  );
  assert.match(renderer, /concealed: covered/);
  assert.match(renderer, /settlePresentedTile\(tile, covered\)/);
});

test("mahjong result total shows base win payments without counters or sticks", () => {
  assert.equal(resultBasePaymentTotal({}, { basePaymentTotal: 5200 }), "5200");
  assert.equal(
    resultBasePaymentTotal({ winType: "tsumo" }, { payment: "1300/2600点" }),
    "5200",
  );
  assert.equal(
    resultBasePaymentTotal({ winType: "tsumo" }, { payment: "2600点∀" }),
    "7800",
  );
  assert.equal(
    resultBasePaymentTotal({ winType: "ron", honba: 2 }, { payment: "8300点" }),
    "7700",
  );
});

test("mahjong leaves a ron tile in the river while revealing only the winner's original hand", () => {
  const rack = Array.from({ length: 13 }, (_, index) => ({
    type: (index % 9) + 1,
    red: false,
  }));
  const baseState = {
    players: ["winner", "right", "top", "left"],
    revealedHands: { winner: rack },
    winners: ["winner"],
    winningTile: 18,
    winningTileRed: true,
  };

  assert.deepEqual(
    splitRevealedHand({ ...baseState, winType: "ron" }, "winner", 1),
    { rack, drawn: null },
  );
  assert.deepEqual(
    splitRevealedHand({ ...baseState, winType: "tsumo" }, "winner", 1),
    { rack, drawn: { type: 18, red: true } },
  );
});

test("mahjong result melds preserve call direction and kan presentation", () => {
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(view, /meldDisplayLayout\(meld, winnerIndex\)/);
  assert.match(
    view,
    /\.map\(\(meld\) => createResultMeld\(meld, winnerIndex, doraCounts\)\)\s*\.reverse\(\)/,
  );
  assert.match(view, /classList\.toggle\("is-sideways", entry\.sideways\)/);
  assert.match(
    view,
    /classList\.toggle\("is-stacked", entry\.stackLevel > 0\)/,
  );
  assert.match(view, /classList\.toggle\("is-face-down", entry\.faceDown\)/);
  assert.match(view, /const RESULT_TILE_WIDTH_PX = 33/);
  assert.match(
    styles,
    /\.result-meld \.tile-result\.is-sideways \{[^}]*rotate\(90deg\)/s,
  );
  assert.match(
    styles,
    /\.result-meld \.tile-result\.is-stacked \{[^}]*bottom: 16\.5px/s,
  );
  assert.match(
    styles,
    /\.result-meld \.tile-result\.is-face-down \{[^}]*#1b569c/s,
  );

  const openKan = meldDisplayLayout(
    {
      kind: "kan",
      tiles: [1, 1, 1, 1],
      fromIndex: 2,
    },
    1,
  );
  const resultTileWidth = 33;
  const meldWidth =
    openKan.span * (resultTileWidth / (TILE_SIZE.width * MELD_SCALE)) + 3;
  const fourKanWinningHandWidth =
    resultTileWidth * 2 + meldWidth * 4 + 9 * 4 + 1.5 * 5;
  assert.ok(fourKanWinningHandWidth <= 760);
});

test("mahjong automatically tsumogiri after riichi only when discard is the sole action", () => {
  const state = {
    drawnTile: 73,
    riichi: { player: true },
    legalActions: {
      canDiscard: true,
      canTsumo: false,
      canAbortNine: false,
      selfKans: [],
    },
  };

  assert.equal(automaticRiichiDiscard(state, "player"), 73);
  assert.equal(automaticRiichiDiscard({ ...state, riichi: {} }, "player"), 0);
  assert.equal(
    automaticRiichiDiscard(
      {
        ...state,
        legalActions: { ...state.legalActions, canTsumo: true },
      },
      "player",
    ),
    0,
  );
  assert.equal(
    automaticRiichiDiscard(
      {
        ...state,
        legalActions: { ...state.legalActions, selfKans: [{ kind: "ankan" }] },
      },
      "player",
    ),
    0,
  );
  assert.equal(AUTO_RIICHI_DISCARD_DELAY_MS, 520);
});

test("mahjong uses one standing 3D tile transform for all four seats", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const bottom = handTransform("bottom", 0, 13);
  const right = handTransform("right", 0, 13);
  const top = handTransform("top", 0, 13);
  const left = handTransform("left", 0, 13);

  for (const transform of [bottom, right, top, left]) {
    assert.equal(transform.y, TILE_SIZE.height / 2);
  }
  assert.equal(bottom.yaw, SEAT_YAW.bottom);
  assert.equal(right.yaw, SEAT_YAW.right);
  assert.equal(top.yaw, SEAT_YAW.top);
  assert.equal(left.yaw, SEAT_YAW.left);
  assert.ok(right.x > 8);
  assert.ok(top.z < -9.5);
  assert.ok(left.x < -8);
  assert.ok(handTransform("bottom", 1, 13).x > bottom.x);
  assert.ok(handTransform("right", 1, 13).z < right.z);
  assert.ok(handTransform("top", 1, 13).x < top.x);
  assert.ok(handTransform("left", 1, 13).z > left.z);
  for (const position of ["bottom", "right", "top", "left"]) {
    assert.deepEqual(
      handTransform(position, 0, 13),
      handTransform(position, 0, 10),
    );
  }
  const bottomRackEnd = handTransform("bottom", 12, 13);
  const rightRackEnd = handTransform("right", 12, 13);
  const topRackEnd = handTransform("top", 12, 13);
  const leftRackEnd = handTransform("left", 12, 13);
  assert.ok(
    handTransform("bottom", 13, 13, { drawn: true }).x > bottomRackEnd.x,
  );
  assert.ok(handTransform("right", 13, 13, { drawn: true }).z < rightRackEnd.z);
  assert.ok(handTransform("top", 13, 13, { drawn: true }).x < topRackEnd.x);
  assert.ok(handTransform("left", 13, 13, { drawn: true }).z > leftRackEnd.z);
  assert.equal(riverTransform("bottom", 0).y, TILE_SIZE.depth / 2 + 0.015);
  assert.ok(riverTransform("bottom", 1).x > riverTransform("bottom", 0).x);
  assert.ok(riverTransform("right", 1).z < riverTransform("right", 0).z);
  assert.ok(riverTransform("top", 1).x < riverTransform("top", 0).x);
  assert.ok(riverTransform("left", 1).z > riverTransform("left", 0).z);
  assert.ok(riverTransform("bottom", 6).z > riverTransform("bottom", 0).z);
  assert.ok(
    riverTransform("bottom", 6).z - riverTransform("bottom", 0).z >
      TILE_SIZE.height,
  );
  assert.ok(riverTransform("top", 6).z < riverTransform("top", 0).z);
  assert.ok(riverTransform("right", 6).x > riverTransform("right", 0).x);
  assert.ok(riverTransform("left", 6).x < riverTransform("left", 0).x);
  assert.equal(
    riverTransform("bottom", 0, true).yaw,
    SEAT_YAW.bottom + Math.PI / 2,
  );
  assert.equal(
    riverTransform("right", 0, true).yaw,
    SEAT_YAW.right + Math.PI / 2,
  );
  const riichiColumn = 1;
  const rowStart = riverTransform("bottom", 6, false, { riichiColumn });
  const sideways = riverTransform("bottom", 7, true, { riichiColumn });
  const afterRiichi = riverTransform("bottom", 8, false, { riichiColumn });
  assert.equal(rowStart.x, riverTransform("bottom", 6).x);
  assert.ok(
    Math.abs(
      sideways.x - riverTransform("bottom", 7).x - RIICHI_TILE_ACROSS_EXTRA / 2,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      afterRiichi.x - riverTransform("bottom", 8).x - RIICHI_TILE_ACROSS_EXTRA,
    ) < 1e-9,
  );
  assert.match(renderer, /const riichiColumns = new Map\(\)/);
  assert.match(
    renderer,
    /riichiColumn: riichiColumns\.get\(Math\.floor\(index \/ 6\)\) \?\? -1/,
  );
  assert.ok(
    Math.abs(
      (riverTransform("bottom", 0).z + riverTransform("top", 0).z) / 2 -
        PLAYFIELD_CENTRE_Z,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      (riverTransform("right", 0).z + riverTransform("right", 5).z) / 2 -
        PLAYFIELD_CENTRE_Z,
    ) < 1e-9,
  );
  const bottomRight = riverTransform("bottom", 5);
  const rightBottom = riverTransform("right", 0);
  assert.ok(
    Math.abs(
      rightBottom.x -
        TILE_SIZE.height / 2 -
        (bottomRight.x + TILE_SIZE.width / 2) -
        RIVER_CORNER_GAP,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      bottomRight.z -
        TILE_SIZE.height / 2 -
        (rightBottom.z + TILE_SIZE.width / 2) -
        RIVER_CORNER_GAP,
    ) < 1e-9,
  );
  assert.equal(TABLE_CONSOLE_LAYOUT.centreZ, PLAYFIELD_CENTRE_Z);
  assert.ok(meldTransform("bottom", 0).x > 4.4);
  assert.ok(meldTransform("bottom", 0).z > 6.5);
  assert.ok(meldTransform("right", 0).x > 7.2);
  assert.ok(meldTransform("right", 0).z < -6);
  assert.ok(meldTransform("top", 0).x < -5.5);
  assert.ok(meldTransform("top", 0).z < -8.8);
  assert.ok(meldTransform("left", 0).x < -7.2);
  assert.ok(meldTransform("left", 0).z > 5);
  assert.ok(meldTransform("bottom", 1).x < meldTransform("bottom", 0).x);
  assert.ok(meldTransform("top", 1).x > meldTransform("top", 0).x);
  assert.ok(meldTransform("right", 1).z > meldTransform("right", 0).z);
  assert.ok(meldTransform("left", 1).z < meldTransform("left", 0).z);
});

test("mahjong keeps opponent racks inside commercial safe lanes", () => {
  const viewport = { width: 1280, height: 720 };
  const camera = new PerspectiveCamera(
    33,
    viewport.width / viewport.height,
    0.1,
    80,
  );
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const racks = Object.fromEntries(
    ["top", "left", "right"].map((position) => [
      position,
      Array.from({ length: 13 }, (_, index) =>
        projectedStandingTileBounds(position, index, camera, viewport),
      ),
    ]),
  );
  assert.ok(Math.min(...racks.top.map((tile) => tile.top)) >= 16);

  const avatarZones = {
    top: { left: 884, right: 974, top: 20, bottom: 130 },
    left: { left: 30, right: 122, top: 220, bottom: 340 },
    right: { left: 1158, right: 1250, top: 220, bottom: 340 },
  };
  for (const position of ["top", "left", "right"]) {
    assert.equal(
      racks[position].some((tile) =>
        rectanglesOverlap(tile, avatarZones[position]),
      ),
      false,
      `${position} rack overlaps its player station`,
    );
  }
});

test("mahjong gives only river tiles stable bounded planar variation", () => {
  const footprint = { width: TILE_SIZE.width, height: TILE_SIZE.height };
  const first = planarTileJitter("1:river:0:8", RIVER_TILE_GAP, footprint);
  assert.deepEqual(
    planarTileJitter("1:river:0:8", RIVER_TILE_GAP, footprint),
    first,
  );
  assert.notDeepEqual(
    planarTileJitter("1:river:1:8", RIVER_TILE_GAP, footprint),
    first,
  );

  const samples = Array.from({ length: 256 }, (_, index) =>
    planarTileJitter(`river:${index}`, RIVER_TILE_GAP, footprint),
  );
  for (const sample of samples) {
    assert.ok(sample.edgeDisplacement <= RIVER_TILE_GAP / 2 + 1e-12);
    assert.ok(Math.abs(sample.yaw) <= 0.04 + 1e-12);
  }
  assert.ok(samples.some((sample) => sample.along < 0));
  assert.ok(samples.some((sample) => sample.along > 0));
  assert.ok(samples.some((sample) => sample.across < 0));
  assert.ok(samples.some((sample) => sample.across > 0));
  assert.ok(samples.some((sample) => sample.yaw < 0));
  assert.ok(samples.some((sample) => sample.yaw > 0));

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const riverSection = renderer.slice(
    renderer.indexOf("  drawRivers(state) {"),
    renderer.indexOf("  drawMelds(state) {"),
  );
  const meldSection = renderer.slice(
    renderer.indexOf("  drawMelds(state) {"),
    renderer.indexOf("  handlePointerDown(event) {"),
  );
  assert.match(riverSection, /planarTileJitter\(/);
  assert.match(riverSection, /applyPlanarJitter\(/);
  assert.doesNotMatch(meldSection, /planarTileJitter|applyPlanarJitter/);
});

test("mahjong highlights matching visible tile types without adding count text", () => {
  const factory = new ThreeTileFactory(new Texture());
  const selected = factory.create({ type: 5, tileId: 17 });
  const matchingRedFive = factory.create({
    type: 5,
    red: true,
    highlight: "match",
  });
  const ordinaryDora = factory.create({ type: 5, dora: true });
  const plainRedFive = factory.create({ type: 5, red: true });
  const doubleDoraRedFive = factory.create({ type: 5, red: true, dora: true });
  const disabledRiichiTile = factory.create({ type: 5, dimmed: true });
  const concealed = factory.create({
    type: 5,
    concealed: true,
    highlight: "match",
  });
  assert.equal(
    selected.children.some(
      (child) => child.material === factory.matchHighlightMaterial,
    ),
    false,
  );
  assert.ok(
    matchingRedFive.children.some(
      (child) => child.material === factory.matchHighlightMaterial,
    ),
  );
  assert.equal(factory.matchHighlightMaterial.transparent, true);
  assert.ok(factory.matchHighlightMaterial.opacity >= 0.3);
  assert.ok(factory.matchHighlightMaterial.opacity <= 0.35);
  assert.equal(
    concealed.children.some(
      (child) => child.material === factory.matchHighlightMaterial,
    ),
    false,
  );
  assert.equal(
    plainRedFive.children.some(
      (child) => child.material === factory.doraWashMaterial,
    ),
    false,
  );
  assert.ok(
    ordinaryDora.children.some(
      (child) => child.material === factory.doraWashMaterial,
    ),
  );
  assert.ok(factory.doraWashMaterial.opacity >= 0.5);
  assert.ok(factory.doraWashMaterial.opacity <= 0.58);
  assert.ok(
    doubleDoraRedFive.children.some(
      (child) => child.material === factory.doraWashMaterial,
    ),
  );
  assert.ok(
    disabledRiichiTile.children.some(
      (child) =>
        child.material === factory.disabledWashMaterial &&
        child.geometry === factory.disabledGeometry,
    ),
  );
  assert.equal(factory.disabledWashMaterial.transparent, true);
  assert.equal(factory.disabledWashMaterial.opacity, 0.52);
  factory.destroy();

  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(view, /renderTypeHighlights\(selectedTileId\)/);
  assert.match(view, /tile\.classList\.toggle\("is-type-match"/);
  assert.match(
    renderer,
    /this\.highlightedType === tileType\(tileId\) \? "match"/,
  );
  assert.match(
    renderer,
    /this\.highlightedType === Number\(discard\.type\) \? "match"/,
  );
  assert.match(renderer, /this\.highlightedType === Number\(entry\.type\)/);
  assert.match(renderer, /this\.doraCounts = doraTypeCounts\(state\)/);
  assert.match(renderer, /dora: this\.doraCounts\.has\(tileType\(tileId\)\)/);
  assert.match(
    renderer,
    /dora: this\.doraCounts\.has\(Number\(discard\.type\)\)/,
  );
  assert.match(renderer, /dora: !entry\.faceDown && this\.doraCounts\.has/);
  assert.match(styles, /\.dora-list \.mahjong-tile\.is-type-match/);
  assert.match(styles, /\.mahjong-tile\.is-dora/);
  assert.doesNotMatch(html, /visible-tile-count|已见|未见/);
  assert.doesNotMatch(view, /visibleTileTypeCount|已见|未见/);
});

test("mahjong lets players inspect their hand outside their discard turn", () => {
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const selection = main.slice(
    main.indexOf("function selectTile(tileId)"),
    main.indexOf("function discardSelected()"),
  );
  assert.match(selection, /orderedOwnTiles\(renderState\)/);
  assert.match(selection, /state\?\.phase === "hand_ended"/);
  assert.doesNotMatch(selection, /canDiscard/);
  assert.doesNotMatch(
    view,
    /tile\.disabled = !state\.legalActions\?\.canDiscard/,
  );
  assert.match(view, /aria-disabled/);
  assert.match(renderer, /this\.pickableTiles\.push\(tile\)/);
  assert.doesNotMatch(
    renderer,
    /handlePointerUp\(event\) \{[^}]*if \(!this\.state\?\.legalActions\?\.canDiscard\) return/s,
  );
  assert.match(
    renderer,
    /discardable\s*&&\s*this\.state\?\.legalActions\?\.canDiscard/,
  );
});

test("mahjong renders every meld in the perspective table scene", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(renderer, /ownMeldOverlayTransform|addOwnMeldTile/);
  assert.match(renderer, /this\.layers\.melds\.add\(slot\)/);
  assert.ok(meldTransform("bottom", 0).x > 5.2);
  assert.ok(meldTransform("bottom", 0).x < 5.4);
  assert.ok(meldTransform("bottom", 1).x < meldTransform("bottom", 0).x);
});

test("mahjong keeps full-size four-kan bands clear of the last hand and drawn tile", () => {
  const seats = [1, 2, 3, 4];
  const positions = ["bottom", "right", "top", "left"];

  for (const seat of seats) {
    const melds = Array.from({ length: 4 }, (_, group) => ({
      kind: "kan",
      tiles: [group + 1, group + 1, group + 1, group + 1],
      fromIndex: ((seat + group) % 4) + 1,
      calledTileIndex: group % 4,
    }));
    const rightExtension = meldRightExtension(melds, seat);
    let offset = 0;
    let priorEnd = -Infinity;
    for (const meld of melds) {
      const display = meldDisplayLayout(meld, seat);
      const start =
        offset + Math.min(...display.entries.map((entry) => entry.along));
      const end = offset + display.span;
      assert.ok(start > priorEnd, `${positions[seat - 1]} kan groups overlap`);
      priorEnd = end;
      offset += display.span + MELD_GROUP_GAP;
    }
    const clearance =
      seat === 1 ? MELD_HAND_CLEARANCE : OPPONENT_MELD_HAND_CLEARANCE;
    const available = melds.length * 3 * (TILE_SIZE.width + 0.035) - clearance;
    assert.ok(rightExtension > 0);
    assert.ok(offset - MELD_GROUP_GAP - rightExtension <= available + 1e-5);
  }

  assert.ok(OPPONENT_MELD_HAND_CLEARANCE > MELD_HAND_CLEARANCE);

  assert.deepEqual(opponentHandLayout(1, 4, false), {
    rackCapacity: 1,
    rackCount: 1,
    hasDrawn: false,
  });
  assert.deepEqual(opponentHandLayout(1, 4, true), {
    rackCapacity: 1,
    rackCount: 1,
    hasDrawn: true,
  });

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(
    renderer,
    /const rightExtension = meldRightExtension\(melds, seat\)/,
  );
  assert.match(renderer, /alongOffset \+ entry\.along - rightExtension/);
  assert.match(renderer, /slot\.scale\.setScalar\(MELD_SCALE\)/);
});

test("mahjong side melds extend the physical centre line of their racks", () => {
  for (const position of ["left", "right"]) {
    const rackStart = handTransform(position, 0, 13);
    const rackEnd = handTransform(position, 12, 13);
    const meldStart = meldTransform(position, 0);
    assert.ok(Math.abs(meldStart.x - rackStart.x) < 1e-9);
    assert.ok(Math.abs(meldStart.x - rackEnd.x) < 1e-9);
  }
});

test("mahjong reserves a full local draw slot before the perspective meld band", () => {
  const viewport = { width: 1280, height: 720 };
  const camera = new PerspectiveCamera(
    33,
    viewport.width / viewport.height,
    0.1,
    80,
  );
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const drawSlot = ownHandOverlayTransform(
    10,
    viewport.width,
    viewport.height,
    {
      drawn: true,
    },
  );
  const drawSlotRight =
    viewport.width / 2 + drawSlot.x + drawSlot.tileWidth / 2;
  const display = meldDisplayLayout(
    { kind: "ankan", tiles: [14, 14, 14, 14] },
    1,
  );
  const meldLeft = Math.min(
    ...display.entries.map((entry) => {
      const transform = meldTransform("bottom", entry.along, {
        absolute: true,
      });
      const extent =
        (entry.sideways ? TILE_SIZE.height : TILE_SIZE.width) * MELD_SCALE;
      const projected = new Vector3(
        transform.x - extent / 2,
        transform.y,
        transform.z,
      ).project(camera);
      return ((projected.x + 1) * viewport.width) / 2;
    }),
  );

  assert.ok(meldLeft - drawSlotRight > drawSlot.tileWidth * 0.8);
});

test("mahjong aligns the action rail with the downstream third river row", () => {
  const viewport = { width: 1280, height: 720 };
  const camera = new PerspectiveCamera(
    33,
    viewport.width / viewport.height,
    0.1,
    80,
  );
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const points = [];
  for (let index = 12; index < 18; index += 1) {
    const transform = riverTransform("right", index);
    const rotation = new Euler(-Math.PI / 2, transform.yaw, 0, "XYZ");
    for (const x of [-TILE_SIZE.width / 2, TILE_SIZE.width / 2]) {
      for (const y of [-TILE_SIZE.height / 2, TILE_SIZE.height / 2]) {
        const point = new Vector3(x, y, 0)
          .applyEuler(rotation)
          .add(new Vector3(transform.x, transform.y, transform.z))
          .project(camera);
        points.push(((point.x + 1) * viewport.width) / 2);
      }
    }
  }
  const downstreamRiverEdge = Math.max(...points);
  const actionRailRightEdge = viewport.width - 342;
  assert.ok(Math.abs(actionRailRightEdge - downstreamRiverEdge) < 8);

  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /--mahjong-action-right: 342px/);
  assert.match(
    styles,
    /\.player-dock \{[^}]*right: var\(--mahjong-action-right\);[^}]*bottom: 128px/s,
  );
  assert.match(
    styles,
    /\.claim-choice-popover \{[^}]*right: var\(--mahjong-action-right\)/s,
  );
});

test("mahjong melds point the called tile toward its source and preserve call order", () => {
  const chi = meldDisplayLayout(
    {
      kind: "chi",
      tiles: [1, 2, 3],
      red: [false, false, false],
      fromIndex: 1,
      calledTileIndex: 0,
      addedTileIndex: -1,
    },
    2,
  );
  assert.deepEqual(
    chi.entries.map(({ type }) => type),
    [3, 2, 1],
  );
  assert.deepEqual(
    chi.entries.map(({ sideways }) => sideways),
    [false, false, true],
  );
  assert.ok(chi.entries[0].along < chi.entries[1].along);
  assert.ok(chi.entries[1].along < chi.entries[2].along);

  const oppositePon = meldDisplayLayout(
    {
      kind: "pon",
      tiles: [14, 14, 14],
      fromIndex: 3,
      calledTileIndex: 0,
    },
    1,
  );
  assert.deepEqual(
    oppositePon.entries.map(({ sideways }) => sideways),
    [false, true, false],
  );

  const downstreamPon = meldDisplayLayout(
    {
      kind: "pon",
      tiles: [14, 14, 14],
      fromIndex: 2,
      calledTileIndex: 0,
    },
    1,
  );
  assert.deepEqual(
    downstreamPon.entries.map(({ sideways }) => sideways),
    [true, false, false],
  );

  const addedKan = meldDisplayLayout(
    {
      kind: "kakan",
      tiles: [14, 14, 14, 14],
      fromIndex: 1,
      calledTileIndex: 0,
      addedTileIndex: 3,
    },
    2,
  );
  assert.equal(addedKan.entries.length, 4);
  assert.equal(addedKan.entries.at(-1).stackLevel, 1);
  assert.equal(addedKan.entries.at(-1).sideways, true);
  assert.equal(
    addedKan.entries.at(-1).along,
    addedKan.entries.find((entry) => entry.sideways && entry.stackLevel === 0)
      .along,
  );

  const concealedKan = meldDisplayLayout(
    { kind: "ankan", tiles: [7, 7, 7, 7] },
    1,
  );
  assert.deepEqual(
    concealedKan.entries.map(({ faceDown }) => faceDown),
    [true, false, false, true],
  );
});

test("mahjong uses one fixed 16:9 logical viewport without a top status bar", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /mahjong-header/);
  assert.doesNotMatch(html, /table-control-back|返回游戏列表/);
  assert.match(html, /id="mahjong-viewport" class="mahjong-viewport"/);
  assert.match(html, /class="table-controls"/);
  assert.match(html, /class="table-status-semantic"/);
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  assert.match(main, /MahjongThreeRenderer/);
  assert.match(main, /automaticRiichiDiscard/);
  assert.match(main, /AUTO_RIICHI_DISCARD_DELAY_MS/);
  assert.doesNotMatch(main, /MahjongPixiRenderer/);
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(typeof packageJson.dependencies.three, "string");
  assert.equal(packageJson.dependencies["pixi.js"], undefined);

  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.mahjong-app \{[^}]*overflow: hidden;[^}]*background: #000/s,
  );
  assert.match(
    styles,
    /\.mahjong-viewport \{[^}]*top: 50%;[^}]*left: 50%;[^}]*width: 1280px;[^}]*height: 720px;[^}]*transform: translate\(-50%, -50%\) scale\(var\(--mahjong-viewport-scale, 1\)\)/s,
  );
  assert.match(
    styles,
    /\.table-controls \{[^}]*position: absolute;[^}]*inset: 58px 14px auto 14px/s,
  );
  assert.doesNotMatch(styles, /\b(?:vw|vh|dvh)\b|safe-area-inset/);
  assert.equal(MAHJONG_VIEWPORT.width, 1280);
  assert.equal(MAHJONG_VIEWPORT.height, 720);
  assert.equal(fixedViewportScale(844, 390), 390 / 720);
  assert.equal(fixedViewportScale(1920, 1080), 1.5);
  assert.equal(fixedViewportScale(1024, 768), 0.8);

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /new PerspectiveCamera\(33, MAHJONG_VIEWPORT\.aspect/);
  assert.match(
    renderer,
    /const \{ width, height, aspect \} = MAHJONG_VIEWPORT/,
  );
  assert.doesNotMatch(renderer, /clientWidth|clientHeight|aspect < 1\.5/);
});

test("mahjong renders the centre console as a perspective tabletop component", () => {
  const consoleRenderer = readFileSync(
    new URL("../games/mahjong/render/three-console.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );

  assert.match(consoleRenderer, /new CanvasTexture\(this\.canvas\)/);
  assert.match(consoleRenderer, /new RoundedBoxGeometry\(/);
  assert.match(consoleRenderer, /new PlaneGeometry\(width, depth\)/);
  assert.match(consoleRenderer, /this\.mesh\.rotation\.x = -Math\.PI \/ 2/);
  assert.match(consoleRenderer, /this\.texture\.anisotropy = anisotropy/);
  assert.match(consoleRenderer, /rotation: Math\.PI \/ 2/);
  assert.match(consoleRenderer, /y: edgeInset,[^}]*rotation: 0/s);
  assert.doesNotMatch(consoleRenderer, /y: edgeInset,[^}]*rotation: Math\.PI/s);
  assert.match(consoleRenderer, /rotation: -Math\.PI \/ 2/);
  assert.doesNotMatch(consoleRenderer, /本场|供托/);
  assert.match(renderer, /this\.scene\.add\(this\.tableConsole\.group\)/);
  assert.doesNotMatch(renderer, /this\.overlayScene\.add\(this\.tableConsole/);
  assert.ok(
    Math.abs(TABLE_CONSOLE_LAYOUT.width / TILE_SIZE.width - 5.8) < 1e-9,
  );
  assert.ok(Math.abs(TABLE_CONSOLE_LAYOUT.depth / TILE_SIZE.width - 5) < 1e-9);
});

test("mahjong centre console reserves an equal edge band for four riichi sticks", () => {
  const layout = TABLE_CONSOLE_SCORE_LAYOUT;
  const outerMargin =
    layout.stickEdgeInset - layout.stickHeight / 2 - layout.panelBorderInset;
  const innerMargin =
    layout.edgeInset -
    layout.scoreFontSize / 2 -
    layout.stickEdgeInset -
    layout.stickHeight / 2;
  assert.ok(outerMargin > 15 && outerMargin < 16);
  assert.ok(innerMargin > 9 && innerMargin < 10);
  assert.ok(Math.abs(layout.stickWidth / 84 - layout.stickHeight / 12) < 1e-9);
  assert.ok(layout.stickWidth >= layout.scoreFontSize * 2.6);
  assert.ok(layout.stickWidth <= layout.scoreFontSize * 2.9);
  assert.equal(layout.scoreFontSize, 64);
  assert.equal(layout.stickDotRadius, 8.85);
  assert.ok(
    layout.stickEdgeInset - layout.stickHeight / 2 > layout.panelBorderInset,
  );

  const consoleRenderer = readFileSync(
    new URL("../games/mahjong/render/three-console.js", import.meta.url),
    "utf8",
  );
  assert.match(consoleRenderer, /state\.riichi\?\.\[playerId\] === true/);
  assert.match(consoleRenderer, /drawRiichiStick\(/);
  assert.match(consoleRenderer, /context\.arc\(0, 0, stickDotRadius/);
  assert.match(consoleRenderer, /760\} \$\{scoreFontSize\}px "Roboto Slab"/);
});

test("mahjong centre console leaves every three-row river visible", () => {
  const viewport = {
    width: MAHJONG_VIEWPORT.width,
    height: MAHJONG_VIEWPORT.height,
  };
  const camera = new PerspectiveCamera(
    33,
    viewport.width / viewport.height,
    0.1,
    80,
  );
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  const downwardAngle = Math.atan2(15.558 - 0.05, 15.908 - 0.4);
  assert.ok(Math.abs(downwardAngle - Math.PI / 4) < 0.0001);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const consolePoints = [];
  for (const x of [
    -TABLE_CONSOLE_LAYOUT.width / 2,
    TABLE_CONSOLE_LAYOUT.width / 2,
  ]) {
    for (const z of [
      TABLE_CONSOLE_LAYOUT.centreZ - TABLE_CONSOLE_LAYOUT.depth / 2,
      TABLE_CONSOLE_LAYOUT.centreZ + TABLE_CONSOLE_LAYOUT.depth / 2,
    ]) {
      const point = new Vector3(
        x,
        TABLE_CONSOLE_LAYOUT.height + 0.024,
        z,
      ).project(camera);
      consolePoints.push({
        x: ((point.x + 1) * viewport.width) / 2,
        y: ((1 - point.y) * viewport.height) / 2,
      });
    }
  }
  const consoleBounds = {
    left: Math.min(...consolePoints.map((point) => point.x)),
    right: Math.max(...consolePoints.map((point) => point.x)),
    top: Math.min(...consolePoints.map((point) => point.y)),
    bottom: Math.max(...consolePoints.map((point) => point.y)),
  };
  assert.ok(consoleBounds.top < viewport.height / 2);
  assert.ok(consoleBounds.bottom < viewport.height / 2);
  assert.ok(viewport.height / 2 - consoleBounds.bottom < 30);

  for (const position of ["bottom", "right", "top", "left"]) {
    for (let index = 0; index < 18; index += 1) {
      for (const riichi of [false, true]) {
        const transform = riverTransform(position, index, riichi);
        const rotation = new Euler(-Math.PI / 2, transform.yaw, 0, "XYZ");
        const points = [];
        for (const x of [-TILE_SIZE.width / 2, TILE_SIZE.width / 2]) {
          for (const y of [-TILE_SIZE.height / 2, TILE_SIZE.height / 2]) {
            const point = new Vector3(x, y, 0)
              .applyEuler(rotation)
              .add(new Vector3(transform.x, transform.y, transform.z))
              .project(camera);
            points.push({
              x: ((point.x + 1) * viewport.width) / 2,
              y: ((1 - point.y) * viewport.height) / 2,
            });
          }
        }
        const tileBounds = {
          left: Math.min(...points.map((point) => point.x)),
          right: Math.max(...points.map((point) => point.x)),
          top: Math.min(...points.map((point) => point.y)),
          bottom: Math.max(...points.map((point) => point.y)),
        };
        const overlaps =
          tileBounds.left < consoleBounds.right &&
          tileBounds.right > consoleBounds.left &&
          tileBounds.top < consoleBounds.bottom &&
          tileBounds.bottom > consoleBounds.top;
        assert.equal(
          overlaps,
          false,
          `${position} river tile ${index} overlaps centre console`,
        );
      }
    }
  }
});

test("mahjong keeps honba and riichi sticks in the top-left status panel", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const statusStart = html.indexOf('class="table-status-semantic"');
  const matchType = html.indexOf('class="match-type-label"');
  const tableStart = html.indexOf('class="table-shell"');
  const honba = html.indexOf('id="honba-count"');
  const riichiSticks = html.indexOf('id="riichi-stick-count"');

  assert.ok(statusStart >= 0);
  assert.ok(honba > statusStart && honba < tableStart);
  assert.ok(riichiSticks > statusStart && riichiSticks < tableStart);
  assert.ok(matchType > riichiSticks && matchType < tableStart);
  assert.doesNotMatch(html, /id="round-label"/);
});

test("mahjong renders a compact fixed five-slot dora rack", () => {
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  const tileFactory = readFileSync(
    new URL("../games/mahjong/render/three-tile-factory.js", import.meta.url),
    "utf8",
  );

  assert.match(view, /doraIndicatorSlots\(state\)/);
  assert.match(view, /is-revealed/);
  assert.match(view, /is-concealed/);
  assert.match(styles, /\.dora-list \.tile-back/);
  assert.match(
    styles,
    /\.dora-list \.tile-back \{[^}]*background-color: #1b569c/s,
  );
  assert.match(styles, /\.dora-list \.tile-back::before \{\s*content: none;/s);
  assert.match(
    tileFactory,
    /backMaterial = new MeshPhysicalMaterial\(\{\s*color: new Color\("#1b569c"\)/s,
  );
  assert.match(styles, /\.dora-list \.mahjong-tile \{[^}]*width: 30px/s);
  assert.match(styles, /\.dora-list \.mahjong-tile \{[^}]*height: 42px/s);
  assert.match(styles, /\.dora-list \{[^}]*gap: 1px/s);
  assert.match(styles, /\.table-status-semantic \{[^}]*width: fit-content/s);
  assert.match(styles, /\.dora-list \{[^}]*width: max-content/s);
  assert.match(styles, /\.table-status-semantic \{[^}]*padding: 10px/s);
  assert.match(
    styles,
    /@font-face \{[^}]*Playweft Mahjong Xingshu[^}]*bakudai-mahjong-ui\.woff2/s,
  );
  assert.match(
    styles,
    /unicode-range:[^}]*U\+4E09[^}]*U\+6771[^}]*U\+78B0[^}]*U\+8FC7/s,
  );
  assert.doesNotMatch(styles, /zhi-mang-xing-mahjong-fallback/);
  assert.match(styles, /\.match-type-label \{[^}]*Playweft Mahjong Xingshu/s);
  const interfaceFont = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/bakudai-mahjong-ui.woff2",
      import.meta.url,
    ),
  );
  const interfaceFontNotice = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/BAKUDAI-FONT-NOTICE.txt",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    interfaceFont.byteLength > 1_000 && interfaceFont.byteLength < 10_000,
  );
  assert.match(interfaceFontNotice, /Bakudai Brush Font/);
  assert.match(interfaceFontNotice, /SIL Open Font License 1\.1/);
  assert.match(view, /state\.matchType === "hanchan" \? "四人南" : "四人東"/);
});

test("mahjong player nameplates leave scoring to the centre console", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(html, /data-detail/);
  assert.doesNotMatch(view, /detail\.textContent|detail\.hidden/);
  assert.doesNotMatch(view, /riichi \? "立直"/);
  assert.doesNotMatch(view, /data-detail[^\n]*scores|scores[^\n]*data-detail/);
  assert.match(styles, /\.player-right \{ top: 223px; right: 24px; \}/);
  assert.match(styles, /\.player-left \{ top: 223px; left: 24px; \}/);
  assert.match(styles, /\.player-bottom \{ bottom: 151px; left: 325px; \}/);
  assert.match(styles, /\.player-top \{ top: 22px; right: 299px; \}/);
  assert.match(styles, /\.player-station \{[^}]*width: 104px/s);
  assert.match(styles, /\.player-station::before \{[^}]*width: 78px/s);
  assert.match(styles, /\.player-station strong \{ font-size: 16px; \}/);
});

test("mahjong prefers the platform avatar for the local player", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(html, /id="player-bottom"[\s\S]*?data-player-avatar/);
  assert.match(main, /capabilities\)\.includes\("user\.getProfile"\)/);
  assert.match(main, /getUserProfile\(\{ fields: \["avatar"\] \}\)/);
  assert.match(main, /const source = profile\?\.avatar\?\.src;/);
  assert.match(main, /setPlayerAvatar\("bottom", source\)/);
  assert.match(view, /image\.onload = \(\) =>/);
  assert.match(view, /image\.onerror = \(\) =>/);
  assert.match(styles, /\.platform-player-avatar \{[^}]*object-fit: cover/s);
});
