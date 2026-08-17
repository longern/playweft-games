import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Euler, PerspectiveCamera, Texture, Vector3 } from "three";
import {
  CLAIM_LABELS,
  HAND_INSERTION_DELAY_MS,
  DORA_INDICATOR_SLOT_COUNT,
  HAND_END_PRESENTATION_DELAY_MS,
} from "../games/mahjong/constants.js";
import {
  automaticRiichiDiscard,
  blankDoubleClickAction,
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
  riverDisplayEntries,
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
  MELD_KAKAN_INWARD_STEP,
  MELD_SCALE,
  MELD_SIDEWAYS_BOTTOM_INSET,
  meldDisplayLayout,
  meldRightExtension,
  OPPONENT_MELD_HAND_CLEARANCE,
  LOCAL_COVERED_HAND_Z,
  LOCAL_REVEALED_HAND_Z,
  meldTransform,
  ownHandOverlayTransform,
  OWN_HAND_DRAG,
  OWN_HAND_LAYOUT,
  OWN_HAND_TILT,
  PLAYFIELD_CENTRE_Z,
  presentedHandTransform,
  presentedTileHingeTransform,
  RIICHI_TILE_ACROSS_EXTRA,
  RIVER_CORNER_GAP,
  RIVER_TILE_GAP,
  riverGridPosition,
  riverTransform,
  SEAT_YAW,
  TILE_PHYSICAL_MM,
  TILE_SIZE,
} from "../games/mahjong/render/three-layout.js";
import {
  handRevealFallProgress,
  ownDrawEntryKey,
  ownDrawEntryProgress,
  ownTileSelectionProgress,
} from "../games/mahjong/render/three-motion.js";
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
import { ThreeAnimationController } from "../games/mahjong/render/three-animation-controller.js";
import { MahjongPresentationController } from "../games/mahjong/presentation-controller.js";
import { riverTileSoundCue } from "../games/mahjong/render/audio-cues.js";
import { normalizeDiscardVolume } from "../games/mahjong/settings-dialog.js";

const MAHJONG_STYLE_MODULES = [
  "table.css",
  "controls.css",
  "settings.css",
  "result.css",
  "setup.css",
];

function readMahjongStyles() {
  return MAHJONG_STYLE_MODULES.map((fileName) =>
    readFileSync(
      new URL(`../games/mahjong/styles/${fileName}`, import.meta.url),
      "utf8",
    ),
  ).join("\n");
}

test("mahjong gives each new river tile one quiet perspective sound cue", () => {
  const state = {
    roundWind: 1,
    handNumber: 2,
    honba: 0,
    moveCount: 8,
  };
  const own = riverTileSoundCue(state, [
    { type: "discarded", playerIndex: 1, tile: 17 },
  ]);
  const opposite = riverTileSoundCue(state, [
    { type: "riichi", playerIndex: 3, tile: 19 },
  ]);

  assert.equal(riverTileSoundCue(state, [{ type: "drawn" }]), null);
  assert.equal(own.key, "1:2:0:8:discarded:1:17");
  assert.equal(opposite.key, "1:2:0:8:riichi:3:19");
  assert.ok(own.volume > opposite.volume);
  assert.ok(own.playbackRate >= 0.98 && own.playbackRate <= 1.02);
  assert.ok(opposite.playbackRate >= 0.98 && opposite.playbackRate <= 1.02);
});

test("mahjong closes river gaps left by called discards", () => {
  const entries = riverDisplayEntries([
    { type: 4, claimed: false },
    { type: 7, claimed: true },
    { type: 12, claimed: false, riichi: true },
  ]);

  assert.deepEqual(
    entries.map(({ sourceIndex, displayIndex, discard }) => ({
      sourceIndex,
      displayIndex,
      type: discard.type,
    })),
    [
      { sourceIndex: 0, displayIndex: 0, type: 4 },
      { sourceIndex: 2, displayIndex: 1, type: 12 },
    ],
  );
});

test("mahjong normalizes the saved river tile volume", () => {
  assert.equal(normalizeDiscardVolume("42"), 42);
  assert.equal(normalizeDiscardVolume(-1), 0);
  assert.equal(normalizeDiscardVolume(120), 100);
  assert.equal(normalizeDiscardVolume("invalid", 75), 75);
});

test("mahjong stylesheet entry preserves the modular cascade order", () => {
  const entry = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  assert.deepEqual(
    [...entry.matchAll(/@import "\.\/styles\/([^"/]+)";/g)].map(
      (match) => match[1],
    ),
    MAHJONG_STYLE_MODULES,
  );
});

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
    /addEventListener\(\s*"webglcontextrestored",\s*this\.onContextRestored/s,
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
  assert.ok(Math.abs(firstRackTile.lift / firstRackTile.tileHeight - 0.18) < 1e-12);
  assert.equal(firstRackTile.tilt, OWN_HAND_TILT);
  assert.ok(OWN_HAND_TILT > 0.09 && OWN_HAND_TILT < 0.12);
  const safeWidth = Math.min(1280, 588 * OWN_HAND_LAYOUT.safeAspect);
  const handLeft = firstRackTile.x - firstRackTile.tileWidth / 2;
  const handRight = drawnTile.x + drawnTile.tileWidth / 2;
  assert.ok(Math.abs(handRight - handLeft - safeWidth * 0.64) < 1e-9);
  assert.equal(
    ownHandOverlayTransform(OWN_HAND_LAYOUT.initialCentreTileIndex, 1280, 588)
      .x,
    0,
  );
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
  assert.equal(
    ownHandOverlayTransform(OWN_HAND_LAYOUT.initialCentreTileIndex, 853, 392).x,
    0,
  );
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
    {
      seat: 1,
      ownHand: [5, 9, 17],
      drawnTile: 53,
      rackIndex: 2,
    },
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

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /deferredHandInsertionSeat/);
  assert.match(renderer, /deferredHandInsertionIndex/);
  assert.match(
    renderer,
    /ownInsertionDeferred\s*&&\s*index >= deferredOwnRackIndex\s*\? index \+ 1/s,
  );
  assert.match(renderer, /rack\.length \+ \(ownInsertionDeferred \? 1 : 0\)/);
  assert.match(renderer, /count - \(insertionDeferred \? 1 : 0\)/);
  assert.match(renderer, /filter\(\(index\) => index !== deferredIndex\)/);
});

test("mahjong presentation scheduling cancels insertion before terminal reveal", () => {
  let nextTimer = 0;
  const timers = new Map();
  const schedule = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay, cancelled: false });
    return id;
  };
  const cancel = (id) => {
    const timer = timers.get(id);
    if (timer) timer.cancelled = true;
  };
  let insertionReady = 0;
  let resultReady = 0;
  const presentation = new MahjongPresentationController(
    {
      onHandInsertionReady: () => insertionReady += 1,
      onResultReady: () => resultReady += 1,
    },
    { schedule, cancel },
  );

  assert.equal(
    presentation.scheduleHandInsertion(
      "10:discarded:1:13:false",
      { seat: 1, rackIndex: 2 },
      HAND_INSERTION_DELAY_MS,
    ),
    true,
  );
  const insertionTimer = presentation.handInsertionTimer;
  presentation.cancelHandInsertion();
  assert.equal(timers.get(insertionTimer).cancelled, true);
  assert.equal(presentation.handInsertion, null);
  assert.equal(insertionReady, 0);

  presentation.syncResult("10:exhaustive-draw", HAND_END_PRESENTATION_DELAY_MS);
  const resultTimer = presentation.resultTimer;
  assert.equal(presentation.resultVisible, false);
  presentation.syncResult("10:exhaustive-draw", HAND_END_PRESENTATION_DELAY_MS);
  assert.equal(presentation.resultTimer, resultTimer);
  timers.get(resultTimer).callback();
  assert.equal(presentation.resultVisible, true);
  assert.equal(resultReady, 1);
});

test("mahjong puts a post-call draw in the slot after the shortened rack", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(
    renderer,
    /this\.addOwnTile\(\s*drawn,\s*rack\.length \+ \(ownInsertionDeferred \? 1 : 0\),/s,
  );
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
  assert.deepEqual(grouped.immediate.map(({ kind }) => kind), ["ron"]);
  assert.deepEqual(grouped.pon, []);
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
  const styles = readMahjongStyles();
  assert.match(
    view,
    /if \(chiClaims\.length > 0\) \{\s*elements\.claims\.append\(this\.createGroupedClaimAction\(chiClaims, "chi"\)\)/s,
  );
  assert.match(view, /if \(claims\.length === 1\)/);
  assert.match(view, /createGroupedClaimAction\(claims, kind\)/);
  assert.match(view, /picker\.className = "claim-choice-popover"/);
  assert.match(view, /picker\.setAttribute\("role", "dialog"\)/);
  assert.match(view, /picker\.setAttribute\("aria-modal", "true"\)/);
  assert.doesNotMatch(view, /heading\.textContent = "选择吃法"/);
  assert.match(
    view,
    /--claim-choice-columns",\s*String\(Math\.min\(3, claims\.length\)\)/,
  );
  assert.match(view, /layer\.className = "claim-choice-layer"/);
  assert.match(view, /if \(event\.target === layer\) setOpen\(false\)/);
  assert.match(view, /if \(event\.key === "Escape"\) setOpen\(false\)/);
  assert.match(view, /createTile\(tile\.type, "claim-choice", tile\.red\)/);
  assert.match(
    styles,
    /\.claim-choice-layer\s*\{[^}]*position: fixed;[^}]*inset: 0;[^}]*background: transparent;/s,
  );
  assert.match(
    styles,
    /\.claim-choice-popover\s*\{[^}]*position: absolute;[^}]*right: auto;[^}]*bottom: 128px;[^}]*left: 50%;[^}]*transform: translateX\(-50%\);/s,
  );
  assert.match(
    styles,
    /\.action-bar \.claim-choice\s*\{[^}]*border-color: transparent;[^}]*background: transparent;[^}]*box-shadow: none;/s,
  );
  assert.match(
    styles,
    /\.tile-claim-choice\s*\{[^}]*width: 48px;[^}]*height: 67px;/s,
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
      pon: [{ kind: "pon" }],
      immediate: [{ kind: "kan" }, { kind: "ron" }],
    },
  );

  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const chiPosition = view.indexOf(
    'elements.claims.append(this.createGroupedClaimAction(chiClaims, "chi"))',
  );
  const ponPosition = view.indexOf(
    'elements.claims.append(this.createGroupedClaimAction(ponClaims, "pon"))',
  );
  const immediatePosition = view.indexOf(
    "for (const claim of immediateClaims)",
  );
  assert.ok(
    chiPosition > 0
      && chiPosition < ponPosition
      && ponPosition < immediatePosition,
  );
  assert.match(
    view,
    /this\.elements\.actionBar\.append\(\s*this\.elements\.abort,\s*this\.elements\.claims,\s*this\.elements\.riichi,\s*this\.elements\.tsumo,\s*this\.elements\.pass,\s*this\.elements\.cancelRiichi,/s,
  );
  assert.doesNotMatch(view, /style\.order/);
});

test("mahjong double-clicks blank table space only for enabled available actions", () => {
  assert.deepEqual(
    blankDoubleClickAction({
      doubleClickPassEnabled: true,
      passAvailable: true,
      doubleClickTsumogiriEnabled: true,
      canDiscard: true,
      drawnTile: 42,
    }),
    { type: "pass" },
  );
  assert.equal(
    blankDoubleClickAction({
      doubleClickPassEnabled: true,
      passAvailable: false,
    }),
    null,
  );
  assert.deepEqual(
    blankDoubleClickAction({
      doubleClickTsumogiriEnabled: true,
      canDiscard: true,
      drawnTile: 42,
    }),
    { type: "discard", tileId: 42 },
  );
  assert.equal(
    blankDoubleClickAction({
      doubleClickTsumogiriEnabled: true,
      riichiMode: true,
      canDiscard: true,
      drawnTile: 42,
    }),
    null,
  );
});

test("mahjong keeps action labels compact and assigns semantic action classes", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
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
  assert.match(main, /import \{ Cog, X, createIcons \} from "lucide"/);
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
    /orderedOwnTiles\(presentedState\(\)\)\.includes\(\s*selectionBeforeRiichi,?\s*\)/s,
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
    /"is-riichi-blocked",\s*riichiMode && !riichiTiles\.has\(tileId\)/,
  );
  assert.match(renderer, /riichiMode && !riichiTiles\.has\(tileId\)/);
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
  const hand = ownHandOverlayTransform(0, 1280, 720);
  const handTop = 720 / 2 - hand.y - hand.tileHeight / 2;

  assert.ok(OWN_HAND_DRAG.discardLineY < handTop - 60);
  assert.ok(OWN_HAND_DRAG.activationDistance >= 6);
  assert.doesNotMatch(html, /id="discard-button"/);
  assert.doesNotMatch(main, /elements\.discard/);
  assert.doesNotMatch(view, /elements\.discard/);
  assert.match(view, /向上拖动手牌，进入出牌区后松手打出/);
  assert.match(
    renderer,
    /addEventListener\(\s*"pointerdown",\s*this\.onPointerDown/s,
  );
  assert.match(renderer, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.doesNotMatch(renderer, /dragGuide|discard-drag-guide/);
  assert.match(
    renderer,
    /drag\.crossed\s*=\s*this\.viewport\.height \/ 2 - pointer\.y <= OWN_HAND_DRAG\.discardLineY/s,
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
  assert.ok(HAND_END_PRESENTATION_DELAY_MS > ACTION_CALLOUT_DURATION_MS);
  assert.match(main, /handEndPresentationKey\(state\)/);
  assert.match(main, /const winners = asArray\(current\.winners\)/);
  assert.match(
    main,
    /return asArray\(current\?\.winners\)\s*\.map\(\(id\) => asArray\(current\.players\)\.indexOf\(id\) \+ 1\)/s,
  );
  assert.match(main, /handEndPresentationDelay\(state\)/);
  assert.match(
    main,
    /return current\?\.phase === "hand_ended"\s*\? HAND_END_PRESENTATION_DELAY_MS\s*:\s*0/s,
  );
  assert.match(main, /current\.abortiveReason === "九种九牌"/);
  assert.match(main, /exhaustive-draw/);
  assert.match(main, /revealPlayerIndices: revealedPlayerIndices/);
  assert.match(
    main,
    /coveredPlayerIndices,/,
  );
  assert.match(
    main,
    /revealedPlayerIndices\.length \+ coveredPlayerIndices\.length > 0 &&\s*!presentation\.resultVisible/s,
  );
  assert.match(
    main,
    /function handCoveredPlayerIndices\(current\) \{[\s\S]*?return exhaustive\.covered;[\s\S]*?return \[\];\s*\}/,
  );
  assert.doesNotMatch(main, /!winners\.has\(playerId\)/);
  assert.match(renderer, /startHandReveal\(delay = 0\)/);
  assert.match(
    renderer,
    /this\.revealTiles\.push\(\{ hinge, delay: 0, covered \}\)/,
  );
  assert.doesNotMatch(renderer, /this\.revealTiles\.length \* 34/);
  assert.match(renderer, /hinge\.rotation\.x = restingRotationX \* eased/);
  assert.doesNotMatch(
    renderer,
    /tile\.position\.y = TILE_SIZE\.height \/ 2\s*\+/,
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
    html,
    /id="result-yaku" class="result-yaku"><\/div>\s*<b id="result-delta" class="result-delta"><\/b>\s*<div class="result-footer">/s,
  );
  assert.match(view, /elements\.resultDelta\.textContent = scoreDeltaSummary/);
  assert.doesNotMatch(view, /elements\.resultYaku\.append\(delta\)/);
  assert.match(view, /elements\.resultValue\.textContent = value/);
  assert.match(view, /elements\.resultSummary\.hidden = true/);
  assert.match(
    view,
    /const basePaymentTotal = resultBasePaymentTotal\(state, result\)/,
  );
  assert.match(view, /unit\.className = "result-total-unit"/);
  assert.match(view, /unit\.textContent = "点"/);
  assert.deepEqual(
    exhaustiveDrawPresentation({
      phase: "hand_ended",
      draw: true,
      result: { tenpai: [true, false, true, false] },
    }),
    { revealed: [1, 3], covered: [2, 4] },
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
  assert.match(renderer, /settlePresentedTile\(hinge, covered\)/);
});

test("mahjong moves the local terminal hand onto a bottom-safe perspective row", () => {
  const eighth = presentedHandTransform("bottom", 7, 13);
  assert.equal(eighth.x, 0);
  assert.equal(eighth.z, LOCAL_REVEALED_HAND_Z);
  const camera = new PerspectiveCamera(33, MAHJONG_VIEWPORT.aspect, 0.1, 80);
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const projected = new Vector3(0, TILE_SIZE.height / 2, eighth.z)
    .project(camera);
  const projectedY = (1 - projected.y) * MAHJONG_VIEWPORT.height / 2;
  const overlay = ownHandOverlayTransform(
    7,
    MAHJONG_VIEWPORT.width,
    MAHJONG_VIEWPORT.height,
  );
  const overlayY = MAHJONG_VIEWPORT.height / 2 - overlay.y;
  assert.ok(overlayY - projectedY > 6);
  assert.ok(overlayY - projectedY < 12);
  assert.equal(
    presentedHandTransform("bottom", 7, 13, { covered: true }).z,
    LOCAL_COVERED_HAND_Z,
  );
  assert.deepEqual(
    presentedHandTransform("top", 7, 13),
    handTransform("top", 7, 13),
  );
});

test("mahjong hand reveal rotates around a table-contact edge", () => {
  for (const covered of [false, true]) {
    const transform = presentedTileHingeTransform(covered);
    assert.equal(transform.pivotZ + transform.tileZ, 0);

    const finalCentre = new Vector3(
      0,
      transform.tileY,
      transform.tileZ,
    ).applyEuler(new Euler(transform.restingRotationX, 0, 0));
    assert.ok(Math.abs(finalCentre.y - TILE_SIZE.depth / 2) < 1e-12);
    assert.equal(transform.restingRotationX > 0, covered);
  }
});

test("mahjong hand reveal combines a sustained push with gravity and hand braking", () => {
  assert.equal(handRevealFallProgress(0), 0);
  assert.equal(handRevealFallProgress(1), 1);

  const samples = Array.from({ length: 21 }, (_, index) =>
    handRevealFallProgress(index / 20),
  );
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] > samples[index - 1]);
  }

  const earlySpeed = handRevealFallProgress(0.4) - handRevealFallProgress(0.3);
  const gravityAssistedSpeed =
    handRevealFallProgress(0.7) - handRevealFallProgress(0.6);
  const contactSpeed = handRevealFallProgress(1) - handRevealFallProgress(0.9);
  assert.ok(gravityAssistedSpeed > earlySpeed);
  assert.ok(contactSpeed > 0);
  assert.ok(contactSpeed < gravityAssistedSpeed);
});

test("mahjong animation controller shares one frame loop and deduplicates events", () => {
  let now = 0;
  let nextFrame = 0;
  let pendingFrame = null;
  let frameDraws = 0;
  const samples = { reveal: [], callout: [] };
  const animations = new ThreeAnimationController(
    () => frameDraws += 1,
    {
      now: () => now,
      requestFrame(callback) {
        pendingFrame = callback;
        return ++nextFrame;
      },
      cancelFrame() {
        pendingFrame = null;
      },
    },
  );
  const advance = (time) => {
    const callback = pendingFrame;
    pendingFrame = null;
    now = time;
    callback(time);
  };

  assert.equal(animations.claim("hand-reveal", "draw:42"), true);
  assert.equal(animations.claim("hand-reveal", "draw:42"), false);
  animations.play({
    id: "hand-reveal",
    duration: 100,
    update: (progress) => samples.reveal.push(progress),
  });
  animations.play({
    id: "action-callout",
    duration: 200,
    update: (progress) => samples.callout.push(progress),
  });
  assert.equal(nextFrame, 1);

  advance(50);
  assert.deepEqual(samples.reveal, [0.5]);
  assert.deepEqual(samples.callout, [0.25]);
  assert.equal(frameDraws, 1);
  advance(100);
  assert.equal(animations.has("hand-reveal"), false);
  assert.equal(animations.has("action-callout"), true);
  advance(200);
  assert.equal(animations.has("action-callout"), false);
  assert.equal(pendingFrame, null);

  animations.resetKey("hand-reveal");
  assert.equal(animations.claim("hand-reveal", "draw:42"), true);
  animations.destroy();
});

test("mahjong gives a newly drawn local tile a short falling fade-in", () => {
  assert.equal(ownDrawEntryProgress(0), 0);
  assert.equal(ownDrawEntryProgress(0.5), 0.875);
  assert.equal(ownDrawEntryProgress(1), 1);

  const state = {
    phase: "playing",
    roundWind: 1,
    handNumber: 2,
    moveCount: 17,
    drawnTile: 42,
    legalActions: { canDiscard: true },
  };
  assert.equal(ownDrawEntryKey(state), "1:2:17:42");
  assert.equal(ownDrawEntryKey({ ...state, drawnTile: 0 }), "");
  assert.equal(ownDrawEntryKey({ ...state, phase: "hand_ended" }), "");

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /tile\.position\.y \+= tile\.userData\.lift/);
  assert.match(renderer, /cloneTileMaterialsForFade\(tile\)/);
});

test("mahjong reuses local tile meshes for a quick interruptible selection lift", () => {
  assert.equal(ownTileSelectionProgress(0), 0);
  assert.equal(ownTileSelectionProgress(0.5), 0.875);
  assert.equal(ownTileSelectionProgress(1), 1);

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
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
  const selection = main.slice(
    main.indexOf("function selectTile(tileId)"),
    main.indexOf("function discardSelected()"),
  );
  const selectionUpdate = renderer.slice(
    renderer.indexOf("  updateSelection(ui) {"),
    renderer.indexOf("  drawHands(state, selectedTileId) {"),
  );
  const domSelection = view.slice(
    view.indexOf("  renderSelection("),
    view.indexOf("  renderTypeHighlights(selectedTileId) {"),
  );
  assert.match(renderer, /this\.ownTileRecords = new Map\(\)/);
  assert.match(renderer, /this\.ownTileRecords\.get\(Number\(tileId\)\)/);
  assert.doesNotMatch(renderer, /clearGroup\(this\.ownHandLayer\)/);
  assert.match(renderer, /this\.startOwnTileMotion\(\)/);
  assert.match(selection, /visualRenderer\.updateSelection\(/);
  assert.doesNotMatch(selection, /visualRenderer\.render\(/);
  assert.doesNotMatch(selectionUpdate, /clearGroup|drawRivers|drawMelds/);
  assert.match(selectionUpdate, /this\.updateTypeHighlights\(\)/);
  assert.match(renderer, /this\.renderer\.shadowMap\.autoUpdate = false/);
  assert.match(domSelection, /this\.updateHandSelection\(selectedTileId\)/);
  assert.doesNotMatch(domSelection, /this\.renderHands|this\.renderActions/);
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
  assert.match(view, /meldDisplayLayout\(meld, winnerIndex\)/);
  assert.match(
    view,
    /\.map\(\(meld\) => createResultMeld\(meld, winnerIndex, doraCounts\)\)\s*\.reverse\(\)/,
  );
  assert.match(view, /classList\.toggle\("is-sideways", entry\.sideways\)/);
  assert.doesNotMatch(view, /is-stacked|stackLevel/);
  assert.match(view, /classList\.toggle\("is-face-down", entry\.faceDown\)/);
  assert.match(view, /const RESULT_TILE_WIDTH_PX = 33/);
  assert.match(view, /--result-meld-inward/);

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
  assert.equal(handTransform("right", 6, 13).z, TABLE_CONSOLE_LAYOUT.centreZ);
  assert.equal(handTransform("left", 6, 13).z, TABLE_CONSOLE_LAYOUT.centreZ);
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
  assert.deepEqual(riverGridPosition(12), { column: 0, row: 2 });
  assert.deepEqual(riverGridPosition(17), { column: 5, row: 2 });
  assert.deepEqual(riverGridPosition(18), { column: 6, row: 2 });
  assert.equal(riverTransform("bottom", 18).z, riverTransform("bottom", 12).z);
  assert.ok(riverTransform("bottom", 18).x > riverTransform("bottom", 17).x);
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
    /const \{ row \} = riverGridPosition\(displayIndex\);[\s\S]*riichiColumn: riichiColumns\.get\(row\) \?\? -1/,
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
  assert.ok(meldTransform("right", 0).z < PLAYFIELD_CENTRE_Z - 5.5);
  assert.ok(meldTransform("top", 0).x < -5.5);
  assert.ok(meldTransform("top", 0).z < -8.8);
  assert.ok(meldTransform("left", 0).x < -7.2);
  assert.ok(meldTransform("left", 0).z > PLAYFIELD_CENTRE_Z + 5.5);
  assert.ok(
    Math.abs(
      meldTransform("left", 0).z +
        meldTransform("right", 0).z -
        PLAYFIELD_CENTRE_Z * 2,
    ) < 1e-9,
  );
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
    selected.children.find(
      (child) => child.material === factory.matchHighlightMaterial,
    )?.visible,
    false,
  );
  assert.equal(
    matchingRedFive.children.find(
      (child) => child.material === factory.matchHighlightMaterial,
    )?.visible,
    true,
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
  const doraWash = ordinaryDora.children.find(
    (child) => child.material === factory.doraWashMaterial,
  );
  const doraFace = ordinaryDora.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  assert.ok(doraWash);
  assert.ok(doraFace);
  assert.ok(doraWash.position.z > doraFace.position.z);
  assert.ok(doraWash.renderOrder > doraFace.renderOrder);
  assert.ok(factory.doraWashMaterial.opacity >= 0.5);
  assert.ok(factory.doraWashMaterial.opacity <= 0.58);
  assert.ok(
    doubleDoraRedFive.children.some(
      (child) => child.material === factory.doraWashMaterial,
    ),
  );
  const disabledWash = disabledRiichiTile.children.find(
    (child) =>
      child.material === factory.disabledWashMaterial &&
      child.geometry === factory.disabledGeometry,
  );
  const disabledFace = disabledRiichiTile.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  assert.ok(disabledWash);
  assert.ok(disabledFace);
  assert.ok(disabledWash.renderOrder > disabledFace.renderOrder);
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
  assert.match(view, /renderTypeHighlights\(selectedTileId\)/);
  assert.match(view, /tile\.classList\.toggle\(\s*"is-type-match"/);
  assert.match(
    renderer,
    /this\.highlightedType === tileType\(tileId\)\s*\?\s*"match"/s,
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
  assert.ok(
    meldTransform("bottom", 0).x >
      handTransform("bottom", 13, 13, { drawn: true }).x,
  );
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
  assert.equal(addedKan.entries.at(-1).sideways, true);
  const calledTile = addedKan.entries.find(
    (entry) => entry.sideways && entry.sourceIndex !== 3,
  );
  const addedTile = addedKan.entries.at(-1);
  assert.equal(addedTile.along, calledTile.along);
  assert.equal(addedTile.inward - calledTile.inward, MELD_KAKAN_INWARD_STEP);
  assert.ok(addedTile.inward > calledTile.inward);
  assert.ok(addedKan.entries.every((entry) => !("stackLevel" in entry)));

  for (const position of ["bottom", "right", "top", "left"]) {
    const calledPosition = meldTransform(position, calledTile.along, {
      absolute: true,
      inwardOffset: calledTile.inward,
    });
    const addedPosition = meldTransform(position, addedTile.along, {
      absolute: true,
      inwardOffset: addedTile.inward,
    });
    const calledDistance = Math.hypot(
      calledPosition.x,
      calledPosition.z - PLAYFIELD_CENTRE_Z,
    );
    const addedDistance = Math.hypot(
      addedPosition.x,
      addedPosition.z - PLAYFIELD_CENTRE_Z,
    );
    assert.ok(
      addedDistance < calledDistance,
      `${position} added kan faces inward`,
    );
  }

  const normalTile = addedKan.entries.find((entry) => !entry.sideways);
  const normalBottom = normalTile.inward - (TILE_SIZE.height * MELD_SCALE) / 2;
  const sidewaysBottom = calledTile.inward - (TILE_SIZE.width * MELD_SCALE) / 2;
  assert.ok(Math.abs(normalBottom - sidewaysBottom) < 1e-12);
  assert.equal(calledTile.inward, MELD_SIDEWAYS_BOTTOM_INSET);

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
  assert.doesNotMatch(html, /table-control-help[^>]*>\?[^<]*<\/a>/);
  assert.match(html, /id="settings-button"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /data-lucide="cog"/);
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

  const styles = readMahjongStyles();
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

test("mahjong settings dialog combines operation controls and themed help", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const dialog = readFileSync(
    new URL("../games/mahjong/settings-dialog.js", import.meta.url),
    "utf8",
  );
  const helpHtml = readFileSync(
    new URL("../games/mahjong/help.html", import.meta.url),
    "utf8",
  );

  assert.match(
    html,
    /id="settings-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/,
  );
  assert.match(
    html,
    /role="tab"[^>]*data-settings-tab="operation"[^>]*>操作<\/button>/,
  );
  assert.match(
    html,
    /role="tab"[^>]*data-settings-tab="help"[^>]*>帮助<\/button>/,
  );
  assert.match(
    html,
    /role="tab"[^>]*data-settings-tab="sound"[^>]*>声音<\/button>/,
  );
  assert.match(
    html,
    /id="discard-volume-setting"[^>]*type="range"[^>]*min="0"[^>]*max="100"/,
  );
  assert.match(html, /id="discard-volume-value"[^>]*>100%<\/output>/);
  assert.match(html, /class="settings-dialog-close"[^>]*aria-label="关闭设置"/);
  assert.match(html, /双击空白处摸切/);
  assert.match(
    html,
    /id="double-click-pass-setting"[^>]*>[\s\S]*?<strong>双击空白处跳过<\/strong>/,
  );
  assert.doesNotMatch(html, /settings-switch|轮到自己且已摸牌时/);
  assert.match(
    html,
    /<iframe[^>]*title="麻将玩法帮助"[^>]*src="\.\/help\.html"/,
  );
  assert.doesNotMatch(helpHtml, /\.\.\/\.\.\/src\/help\.css/);
  assert.match(helpHtml, /\.\/styles\/help\.css/);
  assert.match(dialog, /DOUBLE_CLICK_TSUMOGIRI_KEY/);
  assert.match(dialog, /DOUBLE_CLICK_PASS_KEY/);
  assert.match(dialog, /DISCARD_VOLUME_KEY/);
  assert.match(dialog, /window\.localStorage\.setItem/);
  assert.match(main, /Cog, X, createIcons/);
  assert.match(main, /settingsDialog\.doubleClickTsumogiriEnabled/);
  assert.match(main, /settingsDialog\.doubleClickPassEnabled/);
  assert.match(main, /cue\.volume \* settingsDialog\.discardVolumeScale/);
  assert.match(
    main,
    /passAvailable: !elements\.pass\.hidden && !elements\.pass\.disabled/,
  );
  assert.match(renderer, /addEventListener\("dblclick", this\.onDoubleClick\)/);
  assert.match(
    renderer,
    /if \(this\.pickTile\(event\) \|\| this\.pickTableTile\(event\)\) return/,
  );
  assert.match(
    renderer,
    /\[this\.layers\.hands, this\.layers\.rivers, this\.layers\.melds\]/,
  );
  assert.match(helpHtml, /href="\.\/styles\/help\.css"/);
  assert.match(helpHtml, /双击牌桌空白处可以直接摸切或跳过/);
  assert.doesNotMatch(helpHtml, /本地 Lua 规则|view\(\)/);
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
  const tileFactory = readFileSync(
    new URL("../games/mahjong/render/three-tile-factory.js", import.meta.url),
    "utf8",
  );

  assert.match(view, /doraIndicatorSlots\(state\)/);
  assert.match(view, /is-revealed/);
  assert.match(view, /is-concealed/);
  assert.match(
    tileFactory,
    /backMaterial = new MeshPhysicalMaterial\(\{\s*color: new Color\("#1b569c"\)/s,
  );
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
  assert.doesNotMatch(html, /data-detail/);
  assert.doesNotMatch(view, /detail\.textContent|detail\.hidden/);
  assert.doesNotMatch(view, /riichi \? "立直"/);
  assert.doesNotMatch(view, /data-detail[^\n]*scores|scores[^\n]*data-detail/);
});

test("mahjong marks the east-seat badge explicitly", () => {
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  assert.match(
    view,
    /windBadge\.classList\.toggle\("is-east", wind === "东"\)/,
  );
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
  assert.match(html, /id="player-bottom"[\s\S]*?data-player-avatar/);
  assert.match(main, /capabilities\)\.includes\("user\.getProfile"\)/);
  assert.match(main, /getUserProfile\(\{ fields: \["avatar"\] \}\)/);
  assert.match(main, /const source = profile\?\.avatar\?\.src;/);
  assert.match(main, /setPlayerAvatar\("bottom", source\)/);
  assert.match(view, /image\.onload = \(\) =>/);
  assert.match(view, /image\.onerror = \(\) =>/);
});
