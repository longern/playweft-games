import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AdditiveBlending,
  Euler,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Texture,
  Vector3,
} from "three";
import {
  AUTO_DECISION_DELAY_MS,
  DRAW_REVEAL_CARD_DELAY_MS,
  DRAW_REVEAL_CARD_GAP_MS,
  DRAW_REVEAL_VISIBLE_BASE_MS,
  DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS,
  HAND_INSERTION_DELAY_MS,
  HAND_END_PRESENTATION_DELAY_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
} from "../games/mahjong/constants.js";
import {
  automaticRiichiDiscard,
  blankDoubleClickAction,
  clearedTableState,
  claimPreviewTiles,
  deferredHandInsertion,
  doraIndicatorSlots,
  doraTypeCounts,
  exhaustiveDrawPresentation,
  matchResultRows,
  opponentHandLayout,
  orderedHand,
  partitionClaimActions,
  playerDisplayName,
  playerDisplayNames,
  nextDoraType,
  roundLabel,
  resultBasePaymentTotal,
  resultDetailPageCount,
  resultIndicatorSlots,
  resultScoreSheetRows,
  resultScoreRows,
  riverDisplayEntries,
  splitRevealedHand,
  tenpaiDiscardFuriten,
  tenpaiWaitsForDiscard,
} from "../games/mahjong/game-format.js";

import {
  fixedViewportScale,
  MAHJONG_VIEWPORT,
} from "../games/mahjong/fixed-viewport.js";
import {
  deferMahjongDecorativeAssets,
  deferMahjongImageAssets,
} from "../games/mahjong/deferred-visual-assets.js";
import {
  handTransform,
  MELD_GROUP_GAP,
  MELD_HAND_CLEARANCE,
  MELD_SCALE,
  meldDisplayLayout,
  meldRightExtension,
  OPPONENT_MELD_HAND_CLEARANCE,
  LOCAL_COVERED_HAND_Z,
  meldTransform,
  ownHandOverlayTransform,
  ownHandDoubleClickSafeBounds,
  OWN_HAND_DRAG,
  OWN_HAND_LAYOUT,
  PLAYFIELD_CENTRE_Z,
  presentedHandTransform,
  presentedTileHingeTransform,
  RIICHI_TILE_ACROSS_EXTRA,
  RIVER_CORNER_GAP,
  RIVER_TILE_GAP,
  riverGridPosition,
  riverTransform,
  TILE_SIZE,
} from "../games/mahjong/render/three-layout.js";
import { resultMeldDisplayLayout } from "../games/mahjong/render/result-hand-layout.js";
import { activateResultStartControl } from "../games/mahjong/result-start-control.js";
import {
  handRevealFallProgress,
  OWN_TILE_HOVER_DURATION_MS,
  ownHandCrossfadeProgress,
  ownDrawEntryKey,
  ownDrawEntryProgress,
  ownTileSelectionProgress,
  shouldCrossfadeOwnHand,
} from "../games/mahjong/render/three-motion.js";
import { tileFaceFrameIndex } from "../games/mahjong/render/tile-texture-map.js";
import {
  doraBreathIntensity,
  DORA_BREATH_DURATION_MS,
  ThreeTileFactory,
} from "../games/mahjong/render/three-tile-factory.js";
import {
  prepareTableConsoleContext,
  TABLE_CONSOLE_CORE_LAYOUT,
  TABLE_CONSOLE_LAYOUT,
  TABLE_CONSOLE_SCORE_LAYOUT,
} from "../games/mahjong/render/three-console.js";
import {
  ACTION_CALLOUT_DURATION_MS,
  actionCalloutDescriptor,
  actionCalloutEvents,
  actionCalloutKey,
} from "../games/mahjong/render/three-callout.js";
import { planarTileJitter } from "../games/mahjong/render/three-tile-jitter.js";
import { ThreeAnimationController } from "../games/mahjong/render/three-animation-controller.js";
import { ThreeKeyedSceneLayer } from "../games/mahjong/render/three-keyed-scene-layer.js";
import { MahjongPresentationController } from "../games/mahjong/presentation-controller.js";
import { riverTileSoundCue } from "../games/mahjong/render/audio-cues.js";
import { normalizeDiscardVolume } from "../games/mahjong/settings-dialog.js";
import {
  traditionalDrawReason,
  traditionalYakuName,
} from "../games/mahjong/yaku-display.js";

const MAHJONG_STYLE_MODULES = [
  "fonts.css",
  "table.css",
  "draw-reveal.css",
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

test("mahjong shares asset-pack names across result views", () => {
  const state = {
    players: ["self", "right", "opposite", "left"],
    playerNames: ["你", "青岚", "织羽", "墨池"],
    scores: [25_000, 25_000, 25_000, 25_000],
  };
  const options = {
    playerName: "平台昵称",
    defaultNames: {
      self: "诺亚",
      right: "潮獭",
      opposite: "兰",
      left: "罗斯",
    },
    playerNameIsAuthoritative: false,
  };
  assert.equal(playerDisplayName(state, 3, options), "兰");
  assert.deepEqual(playerDisplayNames(state, options), [
    "诺亚",
    "潮獭",
    "兰",
    "罗斯",
  ]);
  assert.deepEqual(
    matchResultRows(state, "平台昵称", options).map((entry) => entry.name),
    ["诺亚", "潮獭", "兰", "罗斯"],
  );
  assert.deepEqual(
    resultScoreRows(
      { ...state, result: { deltas: [0, 0, 0, 0] } },
      "平台昵称",
      options,
    ).map((entry) => entry.name),
    ["诺亚", "潮獭", "兰", "罗斯"],
  );
});

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

test("mahjong clears the rendered table before dismissing a hand result", () => {
  const cleared = clearedTableState({
    phase: "hand_ended",
    players: ["self", "right", "top", "left"],
    ownHand: [1, 2, 3],
    drawnTile: 4,
    drawnPlayerIndex: 1,
    handCounts: { self: 13, right: 12, top: 11, left: 10 },
    discards: {
      self: [{ type: 1 }],
      right: [{ type: 2 }],
      top: [{ type: 3 }],
      left: [{ type: 4 }],
    },
    melds: {
      self: [{ kind: "pon", tiles: [1, 1, 1] }],
      right: [],
      top: [],
      left: [],
    },
    revealedHands: { self: [1, 2, 3] },
    doraIndicators: [1],
    doraIndicatorTiles: [{ type: 1 }],
    legalActions: { canDiscard: true },
    winners: ["self"],
    winningTile: 4,
    winningTileRed: true,
    winType: "tsumo",
    draw: true,
    riichi: { self: true, right: false, top: true, left: false },
  });

  assert.deepEqual(cleared.ownHand, []);
  assert.equal(cleared.drawnTile, 0);
  assert.equal(cleared.drawnPlayerIndex, 0);
  assert.deepEqual(cleared.handCounts, {
    self: 0,
    right: 0,
    top: 0,
    left: 0,
  });
  assert.deepEqual(cleared.discards, {
    self: [],
    right: [],
    top: [],
    left: [],
  });
  assert.deepEqual(cleared.melds, {
    self: [],
    right: [],
    top: [],
    left: [],
  });
  assert.deepEqual(cleared.revealedHands, {});
  assert.deepEqual(cleared.doraIndicators, []);
  assert.deepEqual(cleared.legalActions, {});
  assert.deepEqual(cleared.winners, []);
  assert.equal(cleared.winningTile, 0);
  assert.equal(cleared.winType, "");
  assert.equal(cleared.draw, false);
  assert.deepEqual(cleared.riichi, {
    self: false,
    right: false,
    top: false,
    left: false,
  });
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
  const frames = [
    tileFaceFrameIndex(25),
    tileFaceFrameIndex(32),
    tileFaceFrameIndex(5, true),
    tileFaceFrameIndex(14, true),
    tileFaceFrameIndex(23, true),
  ];
  assert.ok(frames.every(Number.isInteger));
  assert.equal(new Set(frames).size, frames.length);
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
  const tile = new ThreeTileFactory(new Texture()).create({ type: 1 });
  assert.ok(tile.children.length >= 3);
  tile.traverse((child) => child.geometry?.dispose());
});

test("mahjong table is a perspective 3D surface that surrounds every tile zone", () => {
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
  const table = readFileSync(
    new URL("../games/mahjong/render/three-table.js", import.meta.url),
    "utf8",
  );
  assert.match(table, /new ShadowMaterial\(\{/);
  assert.match(table, /shadowCatcher\.receiveShadow = true/);
  assert.match(table, /this\.group\.add\(felt, shadowCatcher\)/);
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
    /viewportChanged[\s\S]*?this\.ready[\s\S]*?this\.state[\s\S]*?this\.ui[\s\S]*?!this\.animations\.has\("hand-reveal"\)/,
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
  assert.ok(
    Math.abs(firstRackTile.lift / firstRackTile.tileHeight - 0.18) < 1e-12,
  );
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

test("mahjong keeps blank double-click actions away from the local hand", () => {
  const bounds = ownHandDoubleClickSafeBounds(1280, 720);
  const first = ownHandOverlayTransform(0, 1280, 720);
  const drawn = ownHandOverlayTransform(13, 1280, 720, { drawn: true });

  assert.ok(bounds.left < first.x - first.tileWidth / 2);
  assert.ok(bounds.right > drawn.x + drawn.tileWidth / 2);
  assert.ok(bounds.top > first.y + first.tileHeight / 2);
  assert.ok(bounds.bottom < first.y - first.tileHeight / 2);
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /ownHandDoubleClickSafeBounds/);
  assert.match(renderer, /pointer\.x >= safeBounds\.left/);
});

test("mahjong aligns its rightmost action with the thirteenth hand tile", () => {
  const styles = readMahjongStyles();
  const actionInset = Number(
    styles.match(/--mahjong-action-right:\s*([\d.]+)px/)?.[1],
  );
  const thirteenthTile = ownHandOverlayTransform(12, 1280, 720);
  const thirteenthRightEdge =
    1280 / 2 + thirteenthTile.x + thirteenthTile.tileWidth / 2;

  assert.ok(Number.isFinite(actionInset));
  assert.ok(Math.abs(1280 - actionInset - thirteenthRightEdge) < 0.01);
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
  assert.equal(
    DRAW_REVEAL_VISIBLE_BASE_MS,
    HAND_END_PRESENTATION_DELAY_MS - DRAW_REVEAL_CARD_DELAY_MS,
  );
  assert.equal(DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS, 450);
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
  let kanDrawReady = 0;
  let drawRevealReady = 0;
  let resultReady = 0;
  const presentation = new MahjongPresentationController(
    {
      onHandInsertionReady: () => (insertionReady += 1),
      onKanDrawReady: () => (kanDrawReady += 1),
      onDrawRevealReady: () => (drawRevealReady += 1),
      onResultReady: () => (resultReady += 1),
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

  assert.equal(presentation.scheduleKanDraw("10:kan:1", 300), true);
  assert.equal(presentation.kanDrawPending, true);
  assert.equal(presentation.scheduleKanDraw("10:kan:1", 300), false);
  const kanDrawTimer = presentation.kanDrawTimer;
  timers.get(kanDrawTimer).callback();
  assert.equal(presentation.kanDrawPending, false);
  assert.equal(kanDrawReady, 1);

  presentation.syncHandEnd({
    key: "10:exhaustive-draw",
    waitForHandReveal: true,
    showDrawReveal: true,
    drawRevealDelay: DRAW_REVEAL_CARD_GAP_MS,
    drawRevealDuration: 1200,
  });
  assert.equal(presentation.resultVisible, false);
  assert.equal(presentation.drawRevealVisible, false);
  presentation.handRevealSettled("other-hand");
  assert.equal(presentation.drawRevealTimer, 0);
  presentation.handRevealSettled("10:exhaustive-draw");
  const drawRevealTimer = presentation.drawRevealTimer;
  assert.equal(timers.get(drawRevealTimer).delay, DRAW_REVEAL_CARD_GAP_MS);
  timers.get(drawRevealTimer).callback();
  assert.equal(presentation.drawRevealVisible, true);
  assert.equal(drawRevealReady, 1);
  const resultTimer = presentation.resultTimer;
  assert.equal(timers.get(resultTimer).delay, 1200);
  timers.get(resultTimer).callback();
  assert.equal(presentation.resultVisible, true);
  assert.equal(resultReady, 1);
  presentation.syncHandEnd(null);
  assert.equal(presentation.drawRevealVisible, false);
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

test("mahjong writes every result-sheet yaku in traditional form", () => {
  assert.deepEqual(
    [
      "门前清自摸和",
      "海底捞鱼",
      "河底捞鱼",
      "三色同顺",
      "九莲宝灯",
      "混全带幺九",
      "国士无双",
      "宝牌",
    ].map(traditionalYakuName),
    [
      "門前清自摸和",
      "海底撈魚",
      "河底撈魚",
      "三色同順",
      "九蓮寶燈",
      "混全帶幺九",
      "國士無雙",
      "寶牌",
    ],
  );
});

test("mahjong keeps five fixed dora slots and preserves red-five artwork", () => {
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

test("mahjong reveals ura indicators only on a riichi win result page", () => {
  const state = {
    doraIndicatorTiles: [{ type: 5, red: true }],
    uraDoraIndicatorTiles: [{ type: 14, red: false }],
    riichi: { p1: false, p2: true },
  };
  assert.deepEqual(resultIndicatorSlots(state, "p2"), {
    dora: [{ type: 5, red: true }, null, null, null, null],
    ura: [{ type: 14, red: false }, null, null, null, null],
  });
  assert.deepEqual(resultIndicatorSlots(state, "p1").ura, [
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.deepEqual(
    resultIndicatorSlots({ ...state, winType: "nagashi" }, "p2").ura,
    [null, null, null, null, null],
  );
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
    /\.tile-claim-choice,\s*\.tile-tenpai-wait\s*\{[^}]*width: 48px;[^}]*height: 67px;/s,
  );
});

test("mahjong previews waits and visible-copy counts for the selected discard", () => {
  const legalActions = {
    tenpaiDiscards: [
      {
        tileId: 42,
        furiten: true,
        waits: [
          { type: 9, remaining: 3, noYaku: true },
          { type: 28, remaining: 0, noYaku: false },
        ],
      },
    ],
  };
  assert.deepEqual(tenpaiWaitsForDiscard(legalActions, 42), [
    { type: 9, remaining: 3, noYaku: true },
    { type: 28, remaining: 0, noYaku: false },
  ]);
  assert.deepEqual(tenpaiWaitsForDiscard(legalActions, 41), []);
  assert.deepEqual(tenpaiWaitsForDiscard({}, 42), []);
  assert.equal(tenpaiDiscardFuriten(legalActions, 42), true);
  assert.equal(tenpaiDiscardFuriten(legalActions, 41), false);

  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const styles = readMahjongStyles();
  assert.match(html, /id="tenpai-preview"[^>]*hidden/);
  assert.match(html, /id="tenpai-waits"/);
  assert.match(view, /renderTenpaiPreview\(state, selectedTileId\)/);
  assert.match(
    view,
    /waits\.length > 0\s*&&\s*tenpaiDiscardFuriten\(state\?\.legalActions, selectedTileId\)/s,
  );
  assert.match(view, /count\.textContent = `\$\{wait\.remaining\} 张`/);
  assert.match(
    view,
    /count\.classList\.toggle\("is-empty", wait\.remaining === 0\)/,
  );
  assert.match(view, /wait\.noYaku/);
  assert.match(view, /noYaku\.className = "tenpai-no-yaku"/);
  assert.match(
    styles,
    /\.tenpai-preview\s*\{[\s\S]*?bottom:\s*128px;[\s\S]*?left:\s*50%;[\s\S]*?gap:\s*16px;[\s\S]*?padding:\s*12px 28px;/,
  );
  assert.match(styles, /\.tenpai-wait-list\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(styles, /\.tenpai-wait-count\.is-empty/);
  assert.match(
    styles,
    /\.tenpai-no-yaku\s*\{[\s\S]*?position: absolute;[\s\S]*?top: -32px;[\s\S]*?background: #d32f2f;[\s\S]*?color: #fff;[\s\S]*?font-size: 18px;/,
  );
  assert.match(styles, /\.tenpai-wait\s*\{[\s\S]*?gap: 8px;/);
  assert.match(styles, /\.tenpai-wait-count\s*\{[\s\S]*?font-size: 18px;/);
  assert.match(
    styles,
    /\.tenpai-preview\.is-furiten\s*\{[\s\S]*?background:\s*var\(--mahjong-warning-fill\);[\s\S]*?color:\s*var\(--mahjong-warning-text\);/,
  );
  assert.match(
    styles,
    /\.action-bar > \.furiten-badge\s*\{[\s\S]*?background:\s*var\(--mahjong-warning-fill\);[\s\S]*?color:\s*var\(--mahjong-warning-text\);/,
  );
  assert.match(
    styles,
    /\.tenpai-preview\.is-furiten \.tenpai-wait-count\s*\{[\s\S]*?color:\s*var\(--mahjong-warning-text\);/,
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
    chiPosition > 0 &&
      chiPosition < ponPosition &&
      ponPosition < immediatePosition,
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

  assert.match(html, /id="abort-button"[^>]*>\s*流局\s*<\/button>/);
  assert.match(
    html,
    /id="tsumo-button"[\s\S]*?class="win-action"[^>]*>\s*自摸\s*<\/button>/,
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
  assert.deepEqual(
    actionCalloutEvents([
      { type: "claimed", kind: "pon", playerIndex: 1 },
      { type: "won", method: "ron", playerIndex: 2 },
      { type: "won", method: "ron", playerIndex: 4 },
    ]).map((event) => event.playerIndex),
    [2, 4],
  );
  assert.deepEqual(
    actionCalloutEvents([
      { type: "claimed", kind: "chi", playerIndex: 2 },
      { type: "claimed", kind: "pon", playerIndex: 3 },
    ]).map((event) => event.playerIndex),
    [3],
  );
  assert.equal(
    actionCalloutKey(
      { type: "claimed", kind: "pon", playerIndex: 3, fromIndex: 2, tile: 18 },
      "1:2:24",
    ),
    "1:2:24:pon:3:2:18",
  );
  assert.ok(
    ACTION_CALLOUT_DURATION_MS >= 700 && ACTION_CALLOUT_DURATION_MS <= 900,
  );

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const callout = readFileSync(
    new URL("../games/mahjong/render/three-callout.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /overlayScene\.add\(this\.actionCallout\.group\)/);
  assert.match(renderer, /this\.actionCallout\.showLatest\(/);
  assert.match(
    renderer,
    /const revealDelay = ui\.delayHandRevealForCallout\s*\? ACTION_CALLOUT_DURATION_MS\s*:\s*0/s,
  );
  assert.doesNotMatch(renderer, /ACTION_CALLOUT_DURATION_MS \* 0\.64/);
  assert.match(callout, /MAX_CONCURRENT_CALLOUTS = 3/);
  assert.match(callout, /ACTION_CALLOUT_SCALE = 0\.78/);
  assert.match(callout, /this\.group\.add\(\.\.\.this\.slots/);
  assert.match(
    callout,
    /this\.show\(calloutEvents\.map\(actionCalloutDescriptor\)\)/,
  );
  assert.match(callout, /for \(const \{ descriptor, slot \} of active\)/);
  assert.equal((callout.match(/this\.animations\.play\(\{/g) ?? []).length, 1);
  assert.match(callout, /new CanvasTexture\(canvas\)/);
  assert.match(callout, /new Sprite\(material\)/);
  assert.match(callout, /Mahjong Brush/);
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
  const resultRenderer = readFileSync(
    new URL("../games/mahjong/result-hand-renderer.js", import.meta.url),
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
  assert.match(main, /handEndPresentationKey\(state\)/);
  assert.match(main, /const winners = asArray\(current\.winners\)/);
  assert.match(
    main,
    /return asArray\(current\?\.winners\)\s*\.map\(\(id\) => asArray\(current\.players\)\.indexOf\(id\) \+ 1\)/s,
  );
  assert.match(main, /handEndPresentationPlan\(state\)/);
  assert.match(main, /isExhaustiveDrawRevealState\(current\)/);
  assert.match(main, /drawRevealVisibleDuration\(current\)/);
  assert.match(main, /DRAW_REVEAL_VISIBLE_PER_TENPAI_PLAYER_MS/);
  assert.match(
    main,
    /asArray\(current\?\.result\?\.tenpaiWaits\)\s*\.filter\(\s*\(waits\) => asArray\(waits\)\.length > 0/s,
  );
  assert.match(main, /presentation\.syncHandEnd\(/);
  assert.match(main, /presentation\.handRevealSettled\(key\)/);
  assert.match(main, /renderPresentationOverlays/);
  assert.match(renderer, /onHandRevealComplete\?\.\(key\)/);
  assert.match(renderer, /this\.animations\.has\("hand-reveal"\)/);
  assert.match(main, /DRAW_REVEAL_CARD_GAP_MS/);
  assert.match(main, /DRAW_REVEAL_CARD_DELAY_MS/);
  assert.match(main, /presentation\.drawRevealVisible/);
  assert.match(main, /current\.result\?\.abortive === true/);
  assert.match(main, /abortive-draw/);
  assert.match(main, /resultDelay: HAND_END_PRESENTATION_DELAY_MS/);
  assert.match(main, /current\.abortiveReason === "九种九牌"/);
  assert.match(main, /exhaustive-draw/);
  assert.match(
    html,
    /id="draw-reveal"[\s\S]*?<div class="draw-reveal-card">[\s\S]*?data-draw-tenpai-seat="3"[\s\S]*?id="draw-reveal-reason"/,
  );
  assert.match(view, /renderDrawReveal\(state, showDrawReveal\)/);
  assert.match(view, /const nagashi = state\?\.winType === "nagashi"/);
  assert.match(view, /!abortive && !exhaustive && !nagashi/);
  assert.match(
    view,
    /state\.abortiveReason \|\| state\.result\?\.reason \|\| "途中流局"/,
  );
  assert.match(
    view,
    /const waitsBySeat = exhaustive\s*\? asArray\(state\.result\?\.tenpaiWaits\)/s,
  );
  assert.match(view, /label\.hidden = waits\.length === 0/);
  assert.match(view, /createTile\(type, "draw-reveal-wait"\)/);
  assert.doesNotMatch(html, /data-draw-tenpai-seat="[1-4]" hidden>听牌/);
  const drawRevealStyles = readFileSync(
    new URL("../games/mahjong/styles/draw-reveal.css", import.meta.url),
    "utf8",
  );
  assert.match(drawRevealStyles, /mask-image: url\("data:image\/svg\+xml/);
  assert.match(drawRevealStyles, /width: 720px;\s*height: 500px;/s);
  assert.match(drawRevealStyles, /inset: -20px -20px 0;/);
  assert.match(
    drawRevealStyles,
    /inset: 0 0 10px;[\s\S]*?filter: blur\(18px\)/,
  );
  assert.match(
    drawRevealStyles,
    /draw-reveal-card strong\s*\{[\s\S]*?"Mahjong Brush"/s,
  );
  assert.match(view, /traditionalDrawReason\(/);
  assert.match(
    resultRenderer,
    /const results = asArray\(state\.results\)\.length/,
  );
  assert.doesNotMatch(
    resultRenderer,
    /if \(state\.winType === "nagashi"\) \{\s*this\.hide\(\);/s,
  );
  const paperRenderer = readFileSync(
    new URL("../games/mahjong/result-paper-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(
    paperRenderer,
    /drawYakuTable\(context, yaku, logicalWidth, \{ winType \}\)/,
  );
  assert.match(paperRenderer, /value: nagashi \? "" : fu/);
  assert.match(paperRenderer, /value: nagashi \? "" : han/);
  assert.match(
    paperRenderer,
    /context\.fillText\("滿貫", valueRight, baseline\)/,
  );
  assert.match(
    drawRevealStyles,
    /flex-wrap: wrap;[\s\S]*?max-width: 230px;[\s\S]*?max-height: 187px;/,
  );
  assert.match(drawRevealStyles, /draw-reveal-tenpai-top\s*\{\s*top: 20px;/);
  assert.match(
    drawRevealStyles,
    /draw-reveal-tenpai-right\s*\{[\s\S]*?right: 60px;/,
  );
  assert.match(
    drawRevealStyles,
    /\.draw-reveal-tenpai \.mahjong-tile\s*\{[^}]*width: 42px;[^}]*height: 59px;/s,
  );
  assert.match(main, /revealPlayerIndices: revealedPlayerIndices/);
  assert.match(main, /coveredPlayerIndices,/);
  assert.match(
    main,
    /revealedPlayerIndices\.length \+ coveredPlayerIndices\.length > 0 &&\s*!presentation\.resultVisible/s,
  );
  assert.match(
    main,
    /function handCoveredPlayerIndices\(current\) \{[\s\S]*?return exhaustive\.covered;[\s\S]*?return \[\];\s*\}/,
  );
  assert.doesNotMatch(main, /!winners\.has\(playerId\)/);
  assert.match(renderer, /startHandReveal\(delay = 0, key = ""\)/);
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
  assert.match(html, /id="result-hands"[\s\S]*?class="result-hands"/);
  assert.match(
    html,
    /<section[\s\S]*?id="result-panel"[^>]*>\s*<div class="result-page-stage">\s*<div class="result-page-track">\s*<div id="result-detail-content" class="result-content result-detail-content">/,
  );
  assert.ok(
    html.indexOf('id="result-panel"') > html.indexOf('class="player-dock"'),
  );
  assert.match(
    html,
    /id="result-score-content" class="result-content result-score-content" aria-label="记分纸" hidden><\/div>[\s\S]*class="result-footer"[\s\S]*id="rematch-button"/,
  );
  assert.match(
    html,
    /id="rematch-button" class="result-start-control"[^>]*aria-label="继续"[\s\S]*?id="rematch-button-label"[^>]*>继续<\/span>/,
  );
  assert.match(view, /const rematchLabel = "继续"/);
  assert.doesNotMatch(view, /你赢了/);
  assert.doesNotMatch(
    html,
    /id="result-heading"|id="result-score-list"|id="result-score-delta"/,
  );
  assert.match(view, /this\.renderResultScores\(state, playerName\)/);
  assert.match(view, /elements\.resultDetailContent\.hidden = false/);
  assert.match(view, /elements\.resultScoreContent\.hidden = false/);
  assert.doesNotMatch(view, /result-score-sheet/);
  assert.doesNotMatch(html, /id="result-value"|id="result-total"/);
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
  const resultStyles = readFileSync(
    new URL("../games/mahjong/styles/result.css", import.meta.url),
    "utf8",
  );
  assert.match(
    resultStyles,
    /\.result-panel\s*\{[^}]*inset:\s*0;[^}]*width:\s*1280px;[^}]*height:\s*720px;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    resultStyles,
    /\.result-panel::before\s*\{[^}]*inset:\s*-48px;[^}]*result-backdrop-grow/s,
  );
  const resultContentRule =
    resultStyles.match(/\.result-content\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(resultContentRule, /width:\s*100%/);
  assert.match(resultContentRule, /height:\s*100%/);
  assert.doesNotMatch(
    resultContentRule,
    /border(?:-radius)?:|background:|box-shadow:|backdrop-filter:/,
  );
  assert.match(resultStyles, /@keyframes result-content-grow/);
  assert.match(resultStyles, /@keyframes result-page-step/);
  assert.match(resultStyles, /@keyframes result-page-step-previous/);
  assert.match(resultStyles, /@keyframes result-page-step-current/);
  assert.match(resultStyles, /result-page-step 920ms linear both/);
  assert.match(
    resultStyles,
    /result-page-step-previous 560ms cubic-bezier\(0\.32, 0, 0\.2, 1\) both/,
  );
  assert.match(
    resultStyles,
    /result-page-step-current 560ms cubic-bezier\(0\.22, 0\.61, 0\.36, 1\) 360ms both/,
  );
  assert.match(main, /const RESULT_PAGE_TRANSITION_MS = 920;/);
  assert.doesNotMatch(resultStyles, /translateX\(-100%\)/);
  assert.doesNotMatch(resultStyles, /result-page-enter|result-page-leave/);
  assert.match(main, /outgoing\.classList\.add\("is-step-previous"\)/);
  assert.match(main, /elements\.resultTrack\.prepend\(outgoing\)/);
  assert.match(
    main,
    /elements\.resultTrack\.classList\.add\("is-step-advancing"\)/,
  );
  assert.match(
    main,
    /elements\.result\.addEventListener\("dblclick", \(event\) => \{\s*if \(!isResultBlankSpace\(event\.target\)\) return;\s*resultHandRenderer\.playStartButtonActivation\(\(\) => void continueResult\(\)\);\s*}\);/s,
  );
  assert.match(
    resultRenderer,
    /this\.onResultSceneDoubleClick = \(event\) => \{\s*if \(this\.resultButtonHit\(event\)\) return;\s*this\.playStartButtonActivation\(\(\) => this\.onBlankDoubleClick\?\.\(\)\);\s*};/s,
  );
  assert.match(resultStyles, /@keyframes result-screen-exit/);
});

test("mahjong blank result double-click starts the button animation before advancing", () => {
  const calls = [];
  activateResultStartControl({
    startAnimation() {
      calls.push("button-animation");
    },
    onContinue() {
      calls.push("result-step");
    },
  });
  assert.deepEqual(calls, ["button-animation", "result-step"]);
});

test("mahjong keeps the result start button aligned across detail and score pages", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/result-hand-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /this\.host\.prepend\(this\.renderer\.domElement\);/);
  assert.match(
    renderer,
    /this\.scoreHost\.prepend\(this\.renderer\.domElement\);/,
  );
  assert.match(
    renderer,
    /const RESULT_START_BUTTON_HOME = new Vector3\(6\.45, 0, 2\.9\);/,
  );
  assert.doesNotMatch(renderer, /anchorStartButtonToResultPanel/);
  const resultStyles = readFileSync(
    new URL("../games/mahjong/styles/result.css", import.meta.url),
    "utf8",
  );
  assert.match(
    resultStyles,
    /\.result-detail-content:not\(\.is-three-result-rendered\)\s*\{\s*--result-content-offset-y: -42px;/,
  );
});

test("mahjong result fu and han values are at least half the point-value size", () => {
  const paperRenderer = readFileSync(
    new URL("../games/mahjong/result-paper-renderer.js", import.meta.url),
    "utf8",
  );
  const scoreFields = paperRenderer.match(
    /const fields = \[([\s\S]*?)\];/,
  )?.[1];
  const values = [...(scoreFields?.matchAll(/numberSize: (\d+)/g) ?? [])].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(values, [36, 36, 64]);
  assert.ok(values[0] >= values[2] / 2);
  assert.ok(values[1] >= values[2] / 2);
});

test("mahjong result yaku names are no more than 1.4 times the han-unit size", () => {
  const paperRenderer = readFileSync(
    new URL("../games/mahjong/result-paper-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(
    paperRenderer,
    /const preferredNameSize = groupCount === 2 \? 40 : 32;/,
  );
  assert.match(
    paperRenderer,
    /const preferredValueSize = groupCount === 2 \? 29 : 23;/,
  );
  assert.ok(40 / 29 <= 1.4);
  assert.ok(32 / 23 <= 1.4);
});

test("mahjong score-sheet instant photos use distinct subtle tilts", () => {
  const paperRenderer = readFileSync(
    new URL("../games/mahjong/result-paper-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(
    paperRenderer,
    /const INSTANT_PHOTO_TILT_RADIANS = Object\.freeze\(\[\s*-0\.021,\s*0\.014,\s*-0\.01,\s*0\.017,\s*\]\);/,
  );
  assert.match(
    paperRenderer,
    /card\.rotation\.y = INSTANT_PHOTO_TILT_RADIANS\[index\];/,
  );
  assert.match(
    paperRenderer,
    /const INSTANT_PHOTO_POSITION_OFFSETS = Object\.freeze\(\[\s*Object\.freeze\(\{ x: -0\.028, z: 0\.014 \}\),\s*Object\.freeze\(\{ x: 0\.018, z: -0\.011 \}\),\s*Object\.freeze\(\{ x: -0\.013, z: 0\.021 \}\),\s*Object\.freeze\(\{ x: 0\.024, z: 0\.007 \}\),\s*\]\);/,
  );
  assert.match(paperRenderer, /scoreSheetPlayerCentre\(index\) \+ offset\.x/);
  assert.match(paperRenderer, /INSTANT_PHOTO_EDGE_OVERLAP \+\s*offset\.z/);
});

test("mahjong defers default decorative images until after window load", () => {
  const properties = new Map();
  const listeners = new Map();
  const document = {
    readyState: "loading",
    documentElement: {
      style: { setProperty: (name, value) => properties.set(name, value) },
      dataset: {},
    },
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    setTimeout: (callback) => callback(),
  };
  deferMahjongDecorativeAssets({
    document,
    window,
    urls: { "--mahjong-default-portrait-image": "/portraits.jpg" },
  });
  assert.equal(properties.size, 0);
  listeners.get("load")();
  assert.equal(
    properties.get("--mahjong-default-portrait-image"),
    'url("/portraits.jpg")',
  );
  assert.equal(
    document.documentElement.dataset.mahjongDecorativeAssets,
    "ready",
  );

  const styles = [
    "../games/mahjong/styles/setup.css",
    "../games/mahjong/styles/table.css",
    "../games/mahjong/styles/controls.css",
    "../games/mahjong/styles/result.css",
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(
    styles,
    /url\("\.\.\/assets\/(?:player-portraits-v1|moonlit-table-v3|felt-skin-moonwave-v1|tiles\/riichi-faces)/,
  );
});

test("mahjong defers lobby signpost image until after window load", () => {
  const listeners = new Map();
  const image = {
    dataset: { deferredImage: "signpost" },
    removeAttribute(name) {
      delete this.dataset[
        name
          .replace("data-", "")
          .replace(/-([a-z])/g, (_, char) => char.toUpperCase())
      ];
    },
  };
  const document = {
    readyState: "loading",
    querySelectorAll: () => [image],
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    setTimeout: (callback) => callback(),
  };
  deferMahjongImageAssets({
    document,
    window,
    urls: { signpost: "/signpost.webp" },
  });
  assert.equal(image.src, undefined);
  listeners.get("load")();
  assert.equal(image.src, "/signpost.webp");
  assert.equal(image.dataset.deferredImage, undefined);

  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /rel="preload"[^>]+waiting-(?:evening|signpost)/);
  assert.match(html, /data-deferred-image="signpost"/);
});

test("mahjong starts with an inline low-resolution tile atlas and a sampled felt colour", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const resultRenderer = readFileSync(
    new URL("../games/mahjong/result-hand-renderer.js", import.meta.url),
    "utf8",
  );
  const table = readFileSync(
    new URL("../games/mahjong/render/three-table.js", import.meta.url),
    "utf8",
  );
  const placeholder = readFileSync(
    new URL(
      "../games/mahjong/assets/tiles/riichi-faces-placeholder.webp",
      import.meta.url,
    ),
  );

  assert.ok(placeholder.byteLength < 4_096);
  assert.match(renderer, /riichi-faces-placeholder\.webp\?url/);
  assert.match(renderer, /this\.deferDefaultTextures\(\)/);
  assert.match(renderer, /afterWindowLoad\(/);
  assert.match(resultRenderer, /riichi-faces-placeholder\.webp\?url/);
  assert.match(resultRenderer, /this\.deferFaceAtlas\(\)/);
  assert.match(table, /DEFAULT_FELT_AVERAGE_COLOR = "#163523"/);
  assert.match(table, /setDefaultFeltTexture\(texture\)/);
});

test("mahjong retries restored match music on the first user gesture", () => {
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  assert.match(
    main,
    /document\.addEventListener\("pointerdown", resumeMatchMusic, \{ passive: true \}\);/,
  );
  assert.match(
    main,
    /document\.addEventListener\("keydown", resumeMatchMusic\);/,
  );
  assert.match(
    main,
    /function resumeMatchMusic\(\) \{\s*if \(!musicNeedsGesture \|\| !game \|\| state\?\.phase === "hand_ended"\) return;\s*syncMatchMusic\(\{ fadeIn: matchMusicGain === 0 \}\);\s*}/s,
  );
});

test("mahjong result pages separate winners before the score summary", () => {
  const state = {
    phase: "hand_ended",
    draw: false,
    results: [{ winnerIndex: 2 }, { winnerIndex: 4 }],
    scores: [21_000, 31_000, 18_000, 30_000],
    result: { deltas: [-8_000, 6_000, -4_000, 6_000] },
    playerNames: ["自家", "青岚", "织羽", "墨池"],
  };
  assert.equal(resultDetailPageCount(state), 2);
  assert.equal(resultDetailPageCount({ ...state, draw: true }), 0);
  assert.deepEqual(resultScoreRows(state, "你"), [
    { name: "你", before: 29_000, delta: -8_000, after: 21_000 },
    { name: "青岚", before: 25_000, delta: 6_000, after: 31_000 },
    { name: "织羽", before: 22_000, delta: -4_000, after: 18_000 },
    { name: "墨池", before: 24_000, delta: 6_000, after: 30_000 },
  ]);
  assert.deepEqual(matchResultRows(state, "你"), [
    { seat: 2, name: "青岚", score: 31_000, rank: 1 },
    { seat: 4, name: "墨池", score: 30_000, rank: 2 },
    { seat: 1, name: "你", score: 21_000, rank: 3 },
    { seat: 3, name: "织羽", score: 18_000, rank: 4 },
  ]);
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const resultStyles = readFileSync(
    new URL("../games/mahjong/styles/result.css", import.meta.url),
    "utf8",
  );
  assert.match(
    main,
    /if \(state\.matchEnded\) \{\s*showMatchSummary\(\);\s*return;/s,
  );
  assert.match(main, /await advanceFromResult\(\{ type: "new_match" \}\)/);
  assert.match(main, /function returnToSetupFromSummary\(\)/);
  assert.match(
    main,
    /renderResultExitTable\(outcome\.projection\?\.state\);/,
  );
  assert.match(main, /visualRenderer\.prepareDealIn\(\);/);
  assert.match(main, /await waitForDelay\(NEW_HAND_TABLE_PAUSE_MS\);/);
  assert.match(
    main,
    /await refresh\(outcome\.projection, \{ animateDealIn: true \}\)/,
  );
  assert.match(main, /showSetup\(\{ behindResult: true \}\)/);
  assert.match(
    html,
    /id="match-summary"[\s\S]*?id="match-summary-rows"[\s\S]*?再来一局[\s\S]*?返回大厅/,
  );
  assert.match(
    resultStyles,
    /\.match-summary\s*\{[\s\S]*?backdrop-filter: blur\(18px\)/,
  );
  assert.match(
    resultStyles,
    /\.match-summary-photo\s*\{[\s\S]*?padding: 18px 18px 78px;/,
  );
  const setupStyles = readFileSync(
    new URL("../games/mahjong/styles/setup.css", import.meta.url),
    "utf8",
  );
  assert.match(
    setupStyles,
    /\.setup-panel\.is-prepared-for-result-exit\s*\{[\s\S]*?z-index: 85;[\s\S]*?pointer-events: none;/,
  );
});

test("mahjong score sheets retain the latest scored hands and show each change from the prior row", () => {
  const rows = resultScoreSheetRows({
    scoreHistory: [
      {
        roundWind: 1,
        handNumber: 1,
        honba: 0,
        scores: [25_000, 25_000, 25_000, 25_000],
      },
      {
        roundWind: 1,
        handNumber: 1,
        honba: 1,
        scores: [24_000, 25_000, 25_000, 26_000],
      },
    ],
  });
  assert.deepEqual(rows, [
    {
      round: "東1",
      honba: 1,
      scores: [24_000, 25_000, 25_000, 26_000],
      deltas: [-1_000, 0, 0, 1_000],
    },
  ]);
});

test("mahjong result melds use the same physical tile scale as the hand", () => {
  const layout = resultMeldDisplayLayout(
    { kind: "pon", tiles: [14, 14, 14], fromIndex: 2 },
    3,
  );
  assert.equal(layout.entries.length, 3);
});

test("mahjong centre-aligns the shorter local perspective reveal before it falls", () => {
  const eighth = presentedHandTransform("bottom", 7, 13);
  assert.equal(eighth.x, 0);
  const tileCorners = [];
  for (const x of [-TILE_SIZE.width / 2, TILE_SIZE.width / 2]) {
    for (const y of [-TILE_SIZE.height / 2, TILE_SIZE.height / 2]) {
      for (const z of [-TILE_SIZE.depth / 2, TILE_SIZE.depth / 2]) {
        tileCorners.push(new Vector3(x, y, z));
      }
    }
  }
  const screenBounds = (object, camera) => {
    object.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const yCoordinates = tileCorners.map((corner) => {
      const projected = corner
        .clone()
        .applyMatrix4(object.matrixWorld)
        .project(camera);
      return ((1 - projected.y) * MAHJONG_VIEWPORT.height) / 2;
    });
    const top = Math.min(...yCoordinates);
    const bottom = Math.max(...yCoordinates);
    return { top, bottom, height: bottom - top, centre: (top + bottom) / 2 };
  };

  const overlayTransform = ownHandOverlayTransform(
    7,
    MAHJONG_VIEWPORT.width,
    MAHJONG_VIEWPORT.height,
  );
  const overlayTile = new Group();
  overlayTile.position.set(
    overlayTransform.x,
    overlayTransform.y,
    overlayTransform.z,
  );
  overlayTile.rotation.x = overlayTransform.tilt;
  overlayTile.scale.set(
    overlayTransform.scaleX,
    overlayTransform.scaleY,
    overlayTransform.scaleZ,
  );
  const overlayCamera = new OrthographicCamera(
    -MAHJONG_VIEWPORT.width / 2,
    MAHJONG_VIEWPORT.width / 2,
    MAHJONG_VIEWPORT.height / 2,
    -MAHJONG_VIEWPORT.height / 2,
    0.1,
    2000,
  );
  overlayCamera.position.set(0, 0, 1000);
  overlayCamera.lookAt(0, 0, 0);

  const camera = new PerspectiveCamera(33, MAHJONG_VIEWPORT.aspect, 0.1, 80);
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);

  const slot = new Group();
  slot.position.set(eighth.x, 0, eighth.z);
  slot.rotation.y = eighth.yaw;
  const hingeTransform = presentedTileHingeTransform(false);
  const hinge = new Group();
  hinge.position.z = hingeTransform.pivotZ;
  const perspectiveTile = new Group();
  perspectiveTile.position.set(0, hingeTransform.tileY, hingeTransform.tileZ);
  hinge.add(perspectiveTile);
  slot.add(hinge);

  const overlayBounds = screenBounds(overlayTile, overlayCamera);
  const perspectiveBounds = screenBounds(perspectiveTile, camera);
  assert.ok(perspectiveBounds.height < overlayBounds.height);
  assert.ok(Math.abs(perspectiveBounds.centre - overlayBounds.centre) < 0.001);
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

test("mahjong crossfades only the local revealed hand into perspective", () => {
  assert.equal(
    shouldCrossfadeOwnHand({
      revealed: true,
      covered: false,
      animated: true,
      hasOverlay: true,
    }),
    true,
  );
  for (const overrides of [
    { revealed: false },
    { covered: true },
    { animated: false },
    { hasOverlay: false },
  ]) {
    assert.equal(
      shouldCrossfadeOwnHand({
        revealed: true,
        covered: false,
        animated: true,
        hasOverlay: true,
        ...overrides,
      }),
      false,
    );
  }
  assert.equal(ownHandCrossfadeProgress(0), 0);
  assert.equal(ownHandCrossfadeProgress(0.5), 0.5);
  assert.equal(ownHandCrossfadeProgress(1), 1);
});

test("mahjong animation controller shares one frame loop and deduplicates events", () => {
  let now = 0;
  let nextFrame = 0;
  let pendingFrame = null;
  let frameDraws = 0;
  const samples = { reveal: [], callout: [] };
  const animations = new ThreeAnimationController(() => (frameDraws += 1), {
    now: () => now,
    requestFrame(callback) {
      pendingFrame = callback;
      return ++nextFrame;
    },
    cancelFrame() {
      pendingFrame = null;
    },
  });
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

  const breath = [];
  animations.play({
    id: "dora-breath",
    duration: 100,
    repeat: true,
    update: (progress) => breath.push(progress),
  });
  advance(225);
  advance(350);
  assert.deepEqual(breath, [0.25, 0.5]);
  assert.equal(animations.has("dora-breath"), true);
  animations.cancel("dora-breath");
  assert.equal(pendingFrame, null);

  animations.resetKey("hand-reveal");
  assert.equal(animations.claim("hand-reveal", "draw:42"), true);
  animations.destroy();
});

test("mahjong keeps a gold dora lightbox lit between breaths", () => {
  assert.equal(DORA_BREATH_DURATION_MS, 2800);
  assert.equal(doraBreathIntensity(0), 0.5);
  assert.equal(doraBreathIntensity(0.5), 1);
  assert.equal(doraBreathIntensity(1), 0.5);
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
  const pointerDown = renderer.slice(
    renderer.indexOf("  handlePointerDown(event) {"),
    renderer.indexOf("  handlePointerMove(event) {"),
  );
  const hoverUpdate = renderer.slice(
    renderer.indexOf("  setHoveredTile(tile, force = false) {"),
    renderer.indexOf("  drawFrame() {"),
  );
  const pointerUp = renderer.slice(
    renderer.indexOf("  handlePointerUp(event) {"),
    renderer.indexOf("  handleTileTap(tileId, discardable) {"),
  );
  const cancelDrag = renderer.slice(
    renderer.indexOf("  cancelDrag(redraw = true) {"),
    renderer.indexOf("  pickTile(event) {"),
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
  assert.match(main, /onClearSelection: clearSelectedTile/);
  assert.match(selection, /function clearSelectedTile\(\)/);
  assert.match(selection, /if \(!selectedTileId\) return/);
  assert.match(
    pointerUp,
    /if \(!this\.pickTableTile\(event\)\) this\.callbacks\.onClearSelection\?\.\(\)/,
  );
  assert.match(pointerUp, /this\.lastTap = \{ tileId: 0, time: 0 \}/);
  assert.doesNotMatch(selectionUpdate, /clearGroup|drawRivers|drawMelds/);
  assert.match(selectionUpdate, /this\.updateTypeHighlights\(\)/);
  assert.match(renderer, /fromY: tile\.position\.y/);
  assert.match(hoverUpdate, /this\.queueOwnTileMotions\(\)/);
  assert.match(
    hoverUpdate,
    /this\.startOwnTileMotion\(OWN_TILE_HOVER_DURATION_MS\)/,
  );
  assert.doesNotMatch(hoverUpdate, /tile\.position\.y\s*=/);
  assert.match(pointerDown, /this\.cancelOwnTileMotion\(\)/);
  assert.doesNotMatch(pointerDown, /this\.setHoveredTile\(null\)/);
  assert.match(
    renderer,
    /this\.callbacks\.onPreviewDragTile\?\.\(drag\.tileId\)/,
  );
  assert.match(
    cancelDrag,
    /if \(drag\?\.moved\) this\.callbacks\.onEndDragPreview\?\.\(\)/,
  );
  assert.match(main, /onPreviewDragTile: previewDraggedTile/);
  assert.match(main, /onEndDragPreview: restoreSelectedTilePreview/);
  assert.match(
    main,
    /function previewDraggedTile\(tileId\) \{\s*domView\.renderTenpaiPreview\(presentedState\(\), Number\(tileId\) \|\| 0\);\s*\}/,
  );
  assert.match(
    pointerUp,
    /const hovered = canDiscard \? this\.pickTile\(event\) : null/,
  );
  assert.match(pointerUp, /style\.cursor = hovered \? "pointer" : "default"/);
  assert.match(
    cancelDrag,
    /if \(drag && this\.renderer\?\.domElement\)\s*this\.renderer\.domElement\.style\.cursor = "default"/,
  );
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
  const resultRenderer = readFileSync(
    new URL("../games/mahjong/result-hand-renderer.js", import.meta.url),
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
  assert.match(view, /--result-meld-inward/);
  assert.match(
    resultRenderer,
    /const melds = \[\.\.\.asArray\(state\.melds\?\.\[playerId\]\)\]\.reverse\(\);/,
  );
  assert.doesNotMatch(
    resultRenderer,
    /const melds = asArray\(state\.melds\?\.\[playerId\]\)\.reverse\(\);/,
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
});

test("mahjong gives every automatic win and tsumogiri one recognition delay", () => {
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  assert.equal(AUTO_DECISION_DELAY_MS, 520);
  assert.equal(OWN_DRAW_ENTRY_DURATION_MS, 180);
  assert.match(
    main,
    /const isVisibleTileDecision = \["claim", "tsumo", "discard"\]\.includes\([\s\S]*?Math\.max\([\s\S]*?OWN_DRAW_ENTRY_DURATION_MS[\s\S]*?\+ AUTO_DECISION_DELAY_MS/s,
  );
  assert.match(
    main,
    /automaticRiichiDiscard[\s\S]*?Math\.max\(visualDelay, OWN_DRAW_ENTRY_DURATION_MS\)[\s\S]*?AUTO_DECISION_DELAY_MS/s,
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
  }
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
  assert.notEqual(
    riverTransform("bottom", 0, true).yaw,
    riverTransform("bottom", 0).yaw,
  );
  assert.notEqual(
    riverTransform("right", 0, true).yaw,
    riverTransform("right", 0).yaw,
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
  assert.ok(meldTransform("bottom", 0).x > 4.4);
  assert.ok(meldTransform("bottom", 0).z > 6.5);
  assert.ok(meldTransform("right", 0).x > 7.2);
  assert.ok(meldTransform("top", 0).x < -5.5);
  assert.ok(meldTransform("top", 0).z < -8.8);
  assert.ok(meldTransform("left", 0).x < -7.2);
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

test("mahjong retains keyed river scene nodes across snapshots", () => {
  const group = new Group();
  const layer = new ThreeKeyedSceneLayer(group);
  const removed = [];
  const reconcile = (entries) =>
    layer.reconcile(entries, {
      keyOf: (entry) => entry.id,
      create: (entry) => ({ node: new Group(), value: entry.value }),
      update: (record, entry) => {
        record.value = entry.value;
      },
      remove: (record, key) => removed.push([key, record.value]),
    });

  reconcile([
    { id: "1:0", value: "first" },
    { id: "2:0", value: "second" },
  ]);
  const retained = layer.records.get("1:0");
  reconcile([
    { id: "1:0", value: "updated" },
    { id: "1:1", value: "new" },
  ]);

  assert.strictEqual(layer.records.get("1:0"), retained);
  assert.equal(retained.value, "updated");
  assert.equal(group.children.includes(retained.node), true);
  assert.equal(group.children.length, 2);
  assert.deepEqual(removed, [["2:0", "second"]]);
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
  const tsumogiriTile = factory.create({ type: 5, tsumogiri: true });
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
  assert.equal(factory.matchHighlightMaterial.color.getHexString(), "4285f4");
  assert.equal(factory.matchHighlightMaterial.opacity, 0.24);
  assert.equal(factory.matchHighlightMaterial.depthWrite, false);
  assert.equal(factory.matchHighlightMaterial.depthTest, true);
  assert.equal(
    matchingRedFive.children.find(
      (child) => child.material === factory.matchHighlightMaterial,
    )?.geometry,
    factory.matchHighlightGeometry,
  );
  factory.matchHighlightGeometry.computeBoundingBox();
  const matchingFace = matchingRedFive.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  assert.ok(
    factory.matchHighlightGeometry.boundingBox.max.z > matchingFace.position.z,
    "the full-body selection wash must be in front of the printed face",
  );
  factory.tsumogiriWashGeometry.computeBoundingBox();
  const tsumogiriFace = tsumogiriTile.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  assert.ok(
    factory.tsumogiriWashGeometry.boundingBox.max.z > tsumogiriFace.position.z,
    "the full-body tsumogiri wash must be in front of the printed face",
  );
  assert.equal(
    concealed.children.some(
      (child) => child.material === factory.matchHighlightMaterial,
    ),
    false,
  );
  assert.equal(
    plainRedFive.children.some(
      (child) => child.material === factory.doraLightboxMaterial,
    ),
    false,
  );
  const doraFace = ordinaryDora.children.find(
    (child) => child.material === factory.faceMaterial,
  );
  const doraLightbox = ordinaryDora.children.find(
    (child) => child.material === factory.doraLightboxMaterial,
  );
  const doraHalo = ordinaryDora.children.find(
    (child) => child.material === factory.doraHaloMaterial,
  );
  const doraEmission = ordinaryDora.children.find(
    (child) => child.material === factory.doraEmissionMaterial,
  );
  assert.ok(doraFace);
  assert.ok(doraLightbox);
  assert.ok(doraHalo);
  assert.ok(doraEmission);
  assert.equal(doraLightbox.position.z, 0);
  assert.ok(doraLightbox.geometry === factory.doraLightboxGeometry);
  assert.equal(
    factory.doraLightboxMaterial.uniforms.lightColor.value.getHexString(),
    "ffe16a",
  );
  assert.equal(factory.doraLightboxMaterial.depthWrite, false);
  assert.equal(factory.doraLightboxMaterial.uniforms.intensity.value, 0);
  assert.equal(factory.doraEmissionMaterial.blending, AdditiveBlending);
  assert.equal(factory.doraEmissionMaterial.uniforms.intensity.value, 0);
  assert.ok(doraHalo.position.z < doraFace.position.z);
  assert.equal(factory.doraHaloMaterial.depthWrite, false);
  assert.equal(factory.doraHaloMaterial.opacity, 0);
  factory.setDoraGlowIntensity(1);
  assert.equal(factory.doraLightboxMaterial.uniforms.intensity.value, 1);
  assert.equal(factory.doraEmissionMaterial.uniforms.intensity.value, 1);
  assert.equal(factory.doraHaloMaterial.opacity, 0.045);
  factory.setDoraGlowIntensity(0);
  assert.ok(
    doubleDoraRedFive.children.some(
      (child) => child.material === factory.doraLightboxMaterial,
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
  assert.match(
    renderer,
    /dora:\s*this\.showGameHints\s*&&\s*this\.doraCounts\.has\(tileType\(tileId\)\)/s,
  );
  assert.match(
    renderer,
    /const dora =\s*this\.showGameHints\s*&&\s*this\.doraCounts\.has\(Number\(discard\.type\)\)/s,
  );
  assert.match(
    renderer,
    /dora:\s*this\.showGameHints\s*&&\s*!entry\.faceDown\s*&&\s*this\.doraCounts\.has/s,
  );
  assert.match(renderer, /this\.tileFactory\.beginFrame\(\)/);
  assert.match(renderer, /this\.syncDoraBreathing\(\)/);
  assert.match(renderer, /this\.animations\.has\("dora-breath"\)/);
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
  const pointerMove = renderer.slice(
    renderer.indexOf("  handlePointerMove(event) {"),
    renderer.indexOf("  handlePointerUp(event) {"),
  );
  assert.match(pointerMove, /this\.setHoveredTile\(tile\)/);
  assert.match(pointerMove, /style\.cursor = tile\s*\?\s*"pointer"/);
  assert.doesNotMatch(pointerMove, /legalActions\?\.canDiscard/);
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
  }

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
  assert.match(
    html,
    /id="auto-win-button"[^>]*aria-pressed="false"[\s\S]*?class="auto-action-icon"/,
  );
  assert.match(
    html,
    /id="pass-claims-button"[^>]*aria-pressed="false"[\s\S]*?data-icon="bell-off"/,
  );
  assert.match(
    html,
    /id="auto-tsumogiri-button"[^>]*aria-pressed="false"[\s\S]*?class="auto-action-icon"/,
  );
  assert.match(html, /id="mahjong-viewport" class="mahjong-viewport"/);
  assert.match(html, /class="table-controls"/);
  assert.match(html, /class="table-status-semantic"/);
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  assert.match(main, /MahjongThreeRenderer/);
  assert.match(main, /automaticRiichiDiscard/);
  assert.doesNotMatch(main, /MahjongPixiRenderer/);
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(typeof packageJson.dependencies.three, "string");
  assert.equal(packageJson.dependencies["pixi.js"], undefined);

  const styles = readMahjongStyles();
  assert.doesNotMatch(styles, /\b(?:vw|vh|dvh)\b|safe-area-inset/);
  assert.equal(fixedViewportScale(844, 390), 390 / 720);
  assert.equal(fixedViewportScale(1920, 1080), 1.5);
  assert.equal(fixedViewportScale(1024, 768), 0.8);

  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
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
    /role="tab"[^>]*data-settings-tab="operation"[^>]*>\s*操作\s*<\/button>/,
  );
  assert.match(
    html,
    /role="tab"[^>]*data-settings-tab="help"[^>]*>\s*帮助\s*<\/button>/,
  );
  assert.match(
    html,
    /role="tab"[^>]*data-settings-tab="sound"[^>]*>\s*声音\s*<\/button>/,
  );
  assert.match(
    html,
    /id="discard-volume-setting"[^>]*type="range"[^>]*min="0"[^>]*max="100"/,
  );
  assert.match(html, /id="discard-volume-value"[^>]*>\s*100%\s*<\/output\s*>/);
  assert.match(html, /class="settings-dialog-close"[^>]*aria-label="关闭设置"/);
  assert.match(html, /class="settings-dialog-body"/);
  assert.match(
    html,
    /id="settings-end-match-button"[^>]*hidden[^>]*>\s*结束本局\s*<\/button>/,
  );
  assert.match(
    html,
    /id="settings-return-button"[^>]*>\s*返回对局\s*<\/button>/,
  );
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
  assert.match(dialog, /setSoloMatchActive\(active\)/);
  assert.match(dialog, /window\.localStorage\.setItem/);
  assert.match(main, /settingsDialog\.doubleClickTsumogiriEnabled/);
  assert.match(main, /settingsDialog\.doubleClickPassEnabled/);
  assert.match(main, /settingsDialog\.setSoloMatchActive\(true\)/);
  assert.match(main, /结束本局并返回标题/);
  assert.match(main, /cue\.volume \* settingsDialog\.discardVolumeScale/);
  assert.match(
    main,
    /passAvailable: !elements\.pass\.hidden && !elements\.pass\.disabled/,
  );
  const styles = readMahjongStyles();
  assert.match(
    styles,
    /\.settings-dialog-card\s*\{[^}]*grid-template-rows:\s*68px minmax\(0, 1fr\) 72px;/s,
  );
  assert.match(styles, /\.settings-dialog-body\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(styles, /\.settings-dialog-footer\s*\{[^}]*border-top:/s);
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

test("mahjong shuffles behind a synchronized waiting-scene exit", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles/setup.css", import.meta.url),
    "utf8",
  );

  assert.match(html, /class="loading-spinner"/);
  assert.doesNotMatch(html, /class="loading-mark"|正在摆好牌桌/);
  assert.match(
    styles,
    /\.setup-panel\.is-leaving \.setup-signpost\s*\{[^}]*opacity:\s*0;[^}]*translateX\(-36px\)/s,
  );
  assert.match(
    styles,
    /\.loading-panel\.is-active \.loading-spinner\s*\{\s*opacity:\s*1;/,
  );
  assert.match(
    main,
    /\[game\] = await Promise\.all\(\[\s*gamePreparation,\s*setupExit,\s*visualRendererReady,\s*\]\)/,
  );
  assert.match(
    main,
    /await refresh\(game\.initialProjection, \{ animateDealIn: true \}\)[\s\S]*?scheduleAi\(\{ afterDealIn: true \}\)/,
  );
  assert.ok(
    main.indexOf("createLocalLuaGame({") <
      main.indexOf("elements.setup.hidden = true;"),
  );
});

test("mahjong forwards the initial deal animation to the Three renderer", () => {
  const main = readFileSync(
    new URL("../games/mahjong/main.js", import.meta.url),
    "utf8",
  );
  assert.match(
    main,
    /visualRenderer\.render\(renderState, visibleEvents, \{[\s\S]*?dealInKey: animateDealIn \? handDealInKey\(state\) : "",[\s\S]*?animateDealIn,/,
  );
});

test("mahjong reverses the covered-tile edge hinge when dealing a new hand", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(
    renderer,
    /const hingeTransform = presentedTileHingeTransform\(true\);[\s\S]*?hinge\.rotation\.x = hingeTransform\.restingRotationX;[\s\S]*?hinge\.add\(tile\)/,
  );
  assert.match(
    renderer,
    /entry\.hinge\.rotation\.x = entry\.restingRotationX \* \(1 - eased\)/,
  );
});

test("mahjong fades only the non-perspective local hand when dealing", () => {
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  const dealTile = renderer.slice(
    renderer.indexOf("addConcealedHandTile(transform)"),
    renderer.indexOf("startDealIn()"),
  );
  assert.doesNotMatch(dealTile, /cloneTileMaterialsForFade\(tile\)/);
  const ownTile = renderer.slice(
    renderer.indexOf("\n  addOwnTile("),
    renderer.indexOf("\n  pruneOwnTiles()"),
  );
  assert.match(
    ownTile,
    /cloneTileMaterialsForFade\(tile\)[\s\S]*?dealInTiles\.push\(\{ kind: "fade", materials \}\)/,
  );
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
  assert.match(consoleRenderer, /"Mahjong Brush"/);
  assert.ok(
    TABLE_CONSOLE_CORE_LAYOUT.roundFontSize >
      TABLE_CONSOLE_CORE_LAYOUT.wallFontSize,
  );
  assert.equal(roundLabel(1, 1), "東一局");
  assert.match(renderer, /this\.scene\.add\(this\.tableConsole\.group\)/);
  assert.doesNotMatch(renderer, /this\.overlayScene\.add\(this\.tableConsole/);
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
  const mahjongBrushFont = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/bakudai-mahjong.woff2",
      import.meta.url,
    ),
  );
  const mahjongBrushText = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/mahjong-brush-text.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const interfaceFontNotice = readFileSync(
    new URL(
      "../games/mahjong/assets/fonts/BAKUDAI-FONT-NOTICE.txt",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    mahjongBrushFont.byteLength > 20_000 &&
      mahjongBrushFont.byteLength < 60_000,
  );
  assert.match(interfaceFontNotice, /Bakudai Brush Font/);
  assert.match(interfaceFontNotice, /SIL Open Font License 1\.1/);
  assert.match(interfaceFontNotice, /one WOFF2 subset/);
  for (const label of ["荒牌流局", "九種九牌", "四風連打"]) {
    assert.ok(
      [...label].every((character) => mahjongBrushText.includes(character)),
      `${label} is included in the unified font subset`,
    );
  }
  assert.equal(traditionalDrawReason("九种九牌"), "九種九牌");
  assert.equal(traditionalDrawReason("四风连打"), "四風連打");
  assert.match(view, /state\.matchType === "hanchan" \? "四人南" : "四人東"/);

  const styles = readMahjongStyles();
  const entry = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(entry, /@import "\.\/styles\/fonts\.css"/);
  assert.match(styles, /font-family: "Mahjong Brush"/);
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
    /windBadge\.classList\.toggle\("is-east", wind === "東"\)/,
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
  assert.match(html, /class="player-avatar is-default-portrait"[^>]*data-player-avatar/);
  assert.match(view, /const preload = new Image\(\)/);
  assert.match(view, /avatar\.classList\.remove\("is-default-portrait"\)/);
});
