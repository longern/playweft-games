import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import {
  AUTO_RIICHI_DISCARD_DELAY_MS,
  DORA_INDICATOR_SLOT_COUNT,
} from "../games/mahjong/constants.js";
import {
  automaticRiichiDiscard,
  claimPreviewTiles,
  doraIndicatorSlots,
  opponentHandLayout,
  orderedHand,
  partitionClaimActions,
  splitDrawnTile,
} from "../games/mahjong/game-format.js";
import {
  handTransform,
  MELD_SCALE,
  meldDisplayLayout,
  meldTransform,
  ownHandOverlayTransform,
  ownMeldOverlayTransform,
  OWN_HAND_LAYOUT,
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
} from "../games/mahjong/render/three-tile-factory.js";
import { TABLE_GEOMETRY } from "../games/mahjong/render/three-table.js";

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
  assert.doesNotMatch(factory, /isWhiteDragon|numericType\s*===\s*32|type\s*===\s*32/);
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
    railWidth: 0.78,
    railHeight: 0.5,
    baseHeight: 0.42,
  });
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /new ThreeMahjongTable/);
  assert.match(renderer, /CAMERA_POSITION = Object\.freeze\(\{ x: 0, y: 15\.558, z: 15\.908 \}\)/);
  assert.match(renderer, /felt-texture-v1\.jpg\?url/);
  assert.match(renderer, /new SpotLight\(0xffedcf, 115, 46, 0\.93, 0\.74, 1\.35\)/);
  assert.match(renderer, /new SpotLight\(0xffedcf, 60, 46, 0\.93, 0\.74, 1\.35\)/);
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
  assert.match(main, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(main, /visualRenderer\.resume\(\)/);
  assert.match(renderer, /addEventListener\("webglcontextrestored", this\.onContextRestored\)/);
  assert.match(renderer, /this\.tableConsole\.restore\(this\.state, this\.ui\)/);
  assert.match(tableConsole, /restore\(state, ui\) \{[^}]*this\.texture\.needsUpdate = true/s);
});

test("mahjong keeps the 13-tile rack stable and moves the drawn tile to the end", () => {
  const rack = [5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53];
  const handWithSortedDraw = [...rack.slice(0, 4), 18, ...rack.slice(4)];

  assert.deepEqual(splitDrawnTile(handWithSortedDraw, 18), {
    rack,
    drawn: 18,
  });
  assert.deepEqual(orderedHand(handWithSortedDraw, 18), [...rack, 18]);

  const firstRackTile = ownHandOverlayTransform(0, 1280, 588);
  const firstRackTileAfterDraw = ownHandOverlayTransform(0, 1280, 588, { drawn: false });
  const drawnTile = ownHandOverlayTransform(13, 1280, 588, { drawn: true });
  assert.deepEqual(firstRackTile, firstRackTileAfterDraw);
  assert.ok(drawnTile.x > ownHandOverlayTransform(12, 1280, 588).x);
  assert.equal(firstRackTile.scale, drawnTile.scale);
  assert.equal(firstRackTile.scaleX, drawnTile.scaleX);
  assert.equal(firstRackTile.scaleY, drawnTile.scaleY);
  const safeWidth = Math.min(1280, 588 * OWN_HAND_LAYOUT.safeAspect);
  const handLeft = firstRackTile.x - firstRackTile.tileWidth / 2;
  const handRight = drawnTile.x + drawnTile.tileWidth / 2;
  assert.ok(Math.abs((handRight - handLeft) - safeWidth * 0.64) < 1e-9);
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
  const compactWidth = compactDrawn.x + compactDrawn.tileWidth / 2
    - (compactFirst.x - compactFirst.tileWidth / 2);
  assert.ok(Math.abs(compactWidth - compactSafeWidth * 0.64) < 1e-9);
  assert.ok(compactFirst.scale < firstRackTile.scale);
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
  const meld = ownMeldOverlayTransform(0, 1280, 720);
  assert.ok(drawn.x > rackEnd.x);
  assert.ok(meld.x > drawn.x);
});

test("mahjong preserves hand order when there is no current drawn tile", () => {
  const hand = [13, 5, 9];
  assert.deepEqual(orderedHand(hand, 0), hand);
});

test("mahjong keeps opponent rack slots fixed while showing a separated drawn tile", () => {
  const idle = opponentHandLayout(13, 0, false);
  const afterDraw = opponentHandLayout(14, 0, true);
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
  assert.deepEqual(opponentHandLayout(11, 1, true), {
    rackCapacity: 10,
    rackCount: 10,
    hasDrawn: true,
  });
  assert.deepEqual(opponentHandLayout(11, 1, false), {
    rackCapacity: 11,
    rackCount: 11,
    hasDrawn: false,
  });
  assert.deepEqual(opponentHandLayout(2, 4, true), {
    rackCapacity: 1,
    rackCount: 1,
    hasDrawn: true,
  });
});

test("mahjong keeps five fixed dora slots and preserves red-five artwork", () => {
  assert.equal(DORA_INDICATOR_SLOT_COUNT, 5);
  assert.deepEqual(doraIndicatorSlots({
    doraIndicators: [4],
    doraIndicatorTiles: [{ type: 5, red: true }, { type: 31, red: false }],
  }), [
    { type: 5, red: true },
    { type: 31, red: false },
    null,
    null,
    null,
  ]);
  assert.deepEqual(doraIndicatorSlots({ doraIndicators: [4] }), [
    { type: 4, red: false },
    null,
    null,
    null,
    null,
  ]);
});

test("mahjong groups every chi behind one action and previews only the two consumed tiles", () => {
  const claims = [
    { option: 1, kind: "ron", tileTypes: [] },
    { option: 2, kind: "chi", tileTypes: [3, 5], red: [false, true] },
    { option: 3, kind: "chi", tileTypes: [5, 6], red: [false, false] },
  ];
  const grouped = partitionClaimActions(claims);
  assert.deepEqual(grouped.immediate.map(({ kind }) => kind), ["ron"]);
  assert.deepEqual(grouped.chi.map(({ option }) => option), [2, 3]);
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
  assert.match(view, /if \(chiClaims\.length > 0\) \{\s*elements\.claims\.append\(this\.createChiAction\(chiClaims\)\)/s);
  assert.match(view, /if \(claims\.length === 1\)/);
  assert.match(view, /picker\.className = "claim-choice-popover"/);
  assert.match(view, /--claim-choice-columns", String\(Math\.min\(3, claims\.length\)\)/);
  assert.match(view, /layer\.className = "claim-choice-layer"/);
  assert.match(view, /if \(event\.target === layer\) setOpen\(false\)/);
  assert.match(view, /if \(event\.key === "Escape"\) setOpen\(false\)/);
  assert.match(view, /createTile\(tile\.type, "claim-choice", tile\.red\)/);
  assert.match(styles, /\.claim-choice-layer \{[^}]*position: fixed;[^}]*inset: 0;[^}]*background: transparent/s);
  assert.match(styles, /\.claim-choice-popover \{/);
  assert.match(styles, /\.tile-claim-choice \{[^}]*width: 25px;[^}]*height: 35px/s);
});

test("mahjong automatically tsumogiri after riichi only when discard is the sole action", () => {
  const state = {
    lastDrawn: 73,
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
  assert.equal(automaticRiichiDiscard({
    ...state,
    legalActions: { ...state.legalActions, canTsumo: true },
  }, "player"), 0);
  assert.equal(automaticRiichiDiscard({
    ...state,
    legalActions: { ...state.legalActions, selfKans: [{ kind: "ankan" }] },
  }, "player"), 0);
  assert.equal(AUTO_RIICHI_DISCARD_DELAY_MS, 520);
});

test("mahjong uses one standing 3D tile transform for all four seats", () => {
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
  assert.ok(handTransform("bottom", 13, 13, { drawn: true }).x > bottomRackEnd.x);
  assert.ok(handTransform("right", 13, 13, { drawn: true }).z < rightRackEnd.z);
  assert.ok(handTransform("top", 13, 13, { drawn: true }).x < topRackEnd.x);
  assert.ok(handTransform("left", 13, 13, { drawn: true }).z > leftRackEnd.z);
  assert.equal(riverTransform("bottom", 0).y, TILE_SIZE.depth / 2 + 0.015);
  assert.ok(riverTransform("bottom", 1).x > riverTransform("bottom", 0).x);
  assert.ok(riverTransform("right", 1).z < riverTransform("right", 0).z);
  assert.ok(riverTransform("top", 1).x < riverTransform("top", 0).x);
  assert.ok(riverTransform("left", 1).z > riverTransform("left", 0).z);
  assert.ok(riverTransform("bottom", 6).z > riverTransform("bottom", 0).z);
  assert.ok(riverTransform("bottom", 6).z - riverTransform("bottom", 0).z > TILE_SIZE.height);
  assert.ok(riverTransform("top", 6).z < riverTransform("top", 0).z);
  assert.ok(riverTransform("right", 6).x > riverTransform("right", 0).x);
  assert.ok(riverTransform("left", 6).x < riverTransform("left", 0).x);
  assert.equal(riverTransform("bottom", 0, true).yaw, SEAT_YAW.bottom + Math.PI / 2);
  assert.equal(riverTransform("right", 0, true).yaw, SEAT_YAW.right + Math.PI / 2);
  assert.ok(meldTransform("bottom", 0).x > 5.5);
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

test("mahjong keeps own melds to the right of a fixed draw slot", () => {
  const viewport = { width: 1280, height: 720 };
  const rackLeft = ownHandOverlayTransform(0, viewport.width, viewport.height);
  const rackLeftAfterCall = ownHandOverlayTransform(0, viewport.width, viewport.height);
  const drawnAfterCall = ownHandOverlayTransform(10, viewport.width, viewport.height, {
    drawn: true,
  });
  const firstMeld = ownMeldOverlayTransform(0, viewport.width, viewport.height);
  const nextMeldTile = ownMeldOverlayTransform(
    TILE_SIZE.width * MELD_SCALE + 0.035,
    viewport.width,
    viewport.height,
  );

  assert.equal(rackLeft.x, rackLeftAfterCall.x);
  assert.ok(firstMeld.x > drawnAfterCall.x);
  assert.ok(nextMeldTile.x < firstMeld.x);
  assert.equal(
    firstMeld.y - TILE_SIZE.height * firstMeld.scaleY / 2,
    -viewport.height / 2 + OWN_HAND_LAYOUT.bottomInset,
  );
});

test("mahjong melds point the called tile toward its source and preserve call order", () => {
  const chi = meldDisplayLayout({
    kind: "chi",
    tiles: [1, 2, 3],
    red: [false, false, false],
    fromIndex: 1,
    calledTileIndex: 0,
    addedTileIndex: -1,
  }, 2);
  assert.deepEqual(chi.entries.map(({ type }) => type), [3, 2, 1]);
  assert.deepEqual(chi.entries.map(({ sideways }) => sideways), [false, false, true]);
  assert.ok(chi.entries[0].along < chi.entries[1].along);
  assert.ok(chi.entries[1].along < chi.entries[2].along);

  const oppositePon = meldDisplayLayout({
    kind: "pon", tiles: [14, 14, 14], fromIndex: 3, calledTileIndex: 0,
  }, 1);
  assert.deepEqual(oppositePon.entries.map(({ sideways }) => sideways), [false, true, false]);

  const downstreamPon = meldDisplayLayout({
    kind: "pon", tiles: [14, 14, 14], fromIndex: 2, calledTileIndex: 0,
  }, 1);
  assert.deepEqual(downstreamPon.entries.map(({ sideways }) => sideways), [true, false, false]);

  const addedKan = meldDisplayLayout({
    kind: "kakan",
    tiles: [14, 14, 14, 14],
    fromIndex: 1,
    calledTileIndex: 0,
    addedTileIndex: 3,
  }, 2);
  assert.equal(addedKan.entries.length, 4);
  assert.equal(addedKan.entries.at(-1).stackLevel, 1);
  assert.equal(addedKan.entries.at(-1).sideways, true);
  assert.equal(
    addedKan.entries.at(-1).along,
    addedKan.entries.find((entry) => entry.sideways && entry.stackLevel === 0).along,
  );

  const concealedKan = meldDisplayLayout({ kind: "ankan", tiles: [7, 7, 7, 7] }, 1);
  assert.deepEqual(concealedKan.entries.map(({ faceDown }) => faceDown), [true, false, false, true]);
});

test("mahjong uses a full-viewport table without a top status bar", () => {
  const html = readFileSync(
    new URL("../games/mahjong/index.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /mahjong-header/);
  assert.doesNotMatch(html, /table-control-back|返回游戏列表/);
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
  const packageJson = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  assert.equal(typeof packageJson.dependencies.three, "string");
  assert.equal(packageJson.dependencies["pixi.js"], undefined);

  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.table-controls \{[^}]*max\(58px, calc\(env\(safe-area-inset-top\) \+ 12px\)\)/s,
  );
});

test("mahjong renders the table console as a non-perspective canvas overlay", () => {
  const consoleRenderer = readFileSync(
    new URL("../games/mahjong/render/three-console.js", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../games/mahjong/three-renderer.js", import.meta.url),
    "utf8",
  );

  assert.match(consoleRenderer, /new CanvasTexture\(this\.canvas\)/);
  assert.match(consoleRenderer, /new PlaneGeometry\(142, 92\)/);
  assert.match(consoleRenderer, /rotation: Math\.PI \/ 2/);
  assert.match(consoleRenderer, /\{ x: 320, y: 64, rotation: 0 \}/);
  assert.doesNotMatch(consoleRenderer, /\{ x: 320, y: 64, rotation: Math\.PI \}/);
  assert.match(consoleRenderer, /rotation: -Math\.PI \/ 2/);
  assert.doesNotMatch(consoleRenderer, /本场|供托/);
  assert.match(renderer, /this\.overlayScene\.add\(this\.tableConsole\.mesh\)/);
  assert.doesNotMatch(renderer, /this\.scene\.add\(this\.tableConsole\.mesh\)/);
});

test("mahjong centre console leaves every three-row river visible", () => {
  const viewport = { width: 1280, height: 588 };
  const camera = new PerspectiveCamera(33, viewport.width / viewport.height, 0.1, 80);
  camera.position.set(0, 15.558, 15.908);
  camera.lookAt(0, 0.05, 0.4);
  const downwardAngle = Math.atan2(15.558 - 0.05, 15.908 - 0.4);
  assert.ok(Math.abs(downwardAngle - Math.PI / 4) < 0.0001);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const consoleBounds = {
    left: viewport.width / 2 - 71,
    right: viewport.width / 2 + 71,
    top: viewport.height / 2 - viewport.height * 0.03 - 46,
    bottom: viewport.height / 2 - viewport.height * 0.03 + 46,
  };

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
              x: (point.x + 1) * viewport.width / 2,
              y: (1 - point.y) * viewport.height / 2,
            });
          }
        }
        const tileBounds = {
          left: Math.min(...points.map((point) => point.x)),
          right: Math.max(...points.map((point) => point.x)),
          top: Math.min(...points.map((point) => point.y)),
          bottom: Math.max(...points.map((point) => point.y)),
        };
        const overlaps = tileBounds.left < consoleBounds.right
          && tileBounds.right > consoleBounds.left
          && tileBounds.top < consoleBounds.bottom
          && tileBounds.bottom > consoleBounds.top;
        assert.equal(overlaps, false, `${position} river tile ${index} overlaps centre console`);
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
  assert.match(styles, /\.dora-list \.tile-back \{[^}]*background-color: #1b63b7/s);
  assert.match(styles, /\.dora-list \.tile-back::before \{\s*content: none;/s);
  assert.match(tileFactory, /backMaterial = new MeshPhysicalMaterial\(\{\s*color: new Color\("#1b63b7"\)/s);
  assert.match(styles, /\.dora-list \.mahjong-tile \{[^}]*width: 22px/s);
  assert.match(styles, /\.dora-list \.mahjong-tile \{[^}]*height: 31px/s);
  assert.match(styles, /\.dora-list \{[^}]*gap: 1px/s);
  assert.match(styles, /\.table-status-semantic \{[^}]*width: fit-content/s);
  assert.match(styles, /\.dora-list \{[^}]*width: max-content/s);
  assert.match(styles, /\.table-status-semantic \{[^}]*padding: 8px/s);
  assert.match(styles, /@font-face \{[^}]*Playweft Mahjong Shodo[^}]*yuji-syuku-mahjong\.woff2/s);
  assert.match(styles, /unicode-range: U\+4E09, U\+56DB, U\+4EBA, U\+6771, U\+5357/);
  assert.match(styles, /\.match-type-label \{[^}]*Playweft Mahjong Shodo/s);
  const titleFont = readFileSync(
    new URL("../games/mahjong/assets/fonts/yuji-syuku-mahjong.woff2", import.meta.url),
  );
  assert.ok(titleFont.byteLength > 1_000 && titleFont.byteLength < 8_000);
  assert.match(view, /state\.matchType === "hanchan" \? "四人南" : "四人東"/);
});

test("mahjong player nameplates leave scoring to the centre console", () => {
  const view = readFileSync(
    new URL("../games/mahjong/dom-view.js", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../games/mahjong/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(view, /detail\.textContent = riichi \? "立直" : ""/);
  assert.match(view, /detail\.hidden = !riichi/);
  assert.doesNotMatch(view, /data-detail[^\n]*scores|scores[^\n]*data-detail/);
  assert.match(styles, /\.player-right \{ top: 32%; right: 2\.5%; \}/);
  assert.match(styles, /\.player-left \{ top: 32%; left: 2\.5%; \}/);
  assert.match(styles, /\.player-bottom \{ bottom: 21%; left: 26%; \}/);
});
