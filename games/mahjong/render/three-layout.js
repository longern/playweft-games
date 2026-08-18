// AMOS parlor-size riichi tiles are 28 × 21 × 16.5 mm. Keep the scene units
// normalized to tile height so standing and laid tiles share real proportions.
export const TILE_PHYSICAL_MM = Object.freeze({ width: 21, height: 28, depth: 16.5 });
export const TILE_SIZE = Object.freeze({
  width: TILE_PHYSICAL_MM.width / TILE_PHYSICAL_MM.height,
  height: 1,
  depth: TILE_PHYSICAL_MM.depth / TILE_PHYSICAL_MM.height,
});

export const MELD_SCALE = 0.78;
export const MELD_GROUP_GAP = 0.075;
export const MELD_HAND_CLEARANCE = 0.14;
export const OPPONENT_MELD_HAND_CLEARANCE = 0.42;
export const MELD_TILE_GAP = 0.035;
export const MELD_SIDEWAYS_BOTTOM_INSET =
  (TILE_SIZE.width - TILE_SIZE.height) * MELD_SCALE / 2;
export const MELD_KAKAN_INWARD_STEP = TILE_SIZE.width * MELD_SCALE + MELD_TILE_GAP;
export const CONCEALED_RACK_CAPACITY = 13;
// Perspective makes the near half visually denser, so the interactive centre
// sits slightly beyond the geometric screen centre toward the opposite seat.
export const PLAYFIELD_CENTRE_Z = -1.35;

export const HAND_TILE_GAP = 0.035;
const DRAWN_TILE_GAP = 0.24;
// Before the fall begins, the perspective row projects about 15px shorter than
// the orthographic HUD rack. Its screen-space centre therefore stays fixed at
// y=668.54 while the crossfade switches layers; the face-down row keeps its
// separate bottom-safe placement below.
export const LOCAL_REVEALED_HAND_Z = 6.95267;
export const LOCAL_COVERED_HAND_Z = 6.3;

export const OWN_HAND_LAYOUT = Object.freeze({
  safeAspect: 16 / 9,
  occupiedWidthRatio: 0.64,
  initialCentreTileIndex: 7,
  hudTileAspect: 0.66,
  regularGapRatio: 0.0015,
  drawnGapRatio: 0.009,
  bottomInset: 9,
});

// A shallow backward lean exposes only a narrow strip of the real tile top.
// Keep this restrained: the local rack is an orthographic HUD element rather
// than part of the perspective table scene.
export const OWN_HAND_TILT = Math.PI / 30;

export const OWN_HAND_DRAG = Object.freeze({
  discardLineY: 552,
  activationDistance: 8,
});

export function presentedTileHingeTransform(covered = false) {
  const fallDirection = covered ? 1 : -1;
  return {
    pivotZ: fallDirection * TILE_SIZE.depth / 2,
    tileY: TILE_SIZE.height / 2,
    tileZ: -fallDirection * TILE_SIZE.depth / 2,
    restingRotationX: fallDirection * Math.PI / 2,
  };
}

export const SEAT_YAW = Object.freeze({
  bottom: 0,
  right: Math.PI / 2,
  top: Math.PI,
  left: -Math.PI / 2,
});

const HAND_ANCHORS = Object.freeze({
  bottom: { x: 0, z: 7.45 },
  right: { x: 8.4, z: PLAYFIELD_CENTRE_Z },
  top: { x: 0, z: -9.75 },
  left: { x: -8.4, z: PLAYFIELD_CENTRE_Z },
});

const RIVER_COLUMN_COUNT = 6;
export const RIVER_TILE_GAP = 0.055;
const RIVER_ROW_GAP = 0.085;
const RIVER_ACROSS_STEP = TILE_SIZE.width + RIVER_TILE_GAP;
export const RIICHI_TILE_ACROSS_EXTRA = TILE_SIZE.height - TILE_SIZE.width;
const RIVER_HALF_ACROSS_EXTENT = (RIVER_COLUMN_COUNT - 1) / 2
  * RIVER_ACROSS_STEP
  + TILE_SIZE.width / 2;
export const RIVER_CORNER_GAP = TILE_SIZE.width * 0.15;
const RIVER_RING_OFFSET = RIVER_HALF_ACROSS_EXTENT
  + TILE_SIZE.height / 2
  + RIVER_CORNER_GAP;

// All four first rows form one physical ring around the console. Keeping every
// anchor on the same ring makes adjacent inner corners meet with one narrow,
// realistic tile gap instead of leaving a larger opening beside the local river.
const RIVER_ANCHORS = Object.freeze({
  bottom: { x: 0, z: PLAYFIELD_CENTRE_Z + RIVER_RING_OFFSET },
  right: { x: RIVER_RING_OFFSET, z: PLAYFIELD_CENTRE_Z },
  top: { x: 0, z: PLAYFIELD_CENTRE_Z - RIVER_RING_OFFSET },
  left: { x: -RIVER_RING_OFFSET, z: PLAYFIELD_CENTRE_Z },
});

export function handTransform(position, index, _rackCapacity, { drawn = false } = {}) {
  const anchor = HAND_ANCHORS[position];
  if (!anchor) throw new RangeError(`Invalid mahjong seat: ${position}`);
  const step = TILE_SIZE.width + HAND_TILE_GAP;
  const drawnOffset = drawn ? DRAWN_TILE_GAP : 0;
  // Every rack owns the same left edge. Calls remove three tiles from the
  // right; they must never recenter the concealed tiles that remain.
  const along = (index - (CONCEALED_RACK_CAPACITY - 1) / 2) * step + drawnOffset;
  const yaw = SEAT_YAW[position];
  return {
    x: anchor.x + along * Math.cos(yaw),
    y: TILE_SIZE.height / 2,
    z: anchor.z - along * Math.sin(yaw),
    yaw,
  };
}

export function presentedHandTransform(
  position,
  index,
  rackCapacity,
  { drawn = false, covered = false } = {},
) {
  const transform = handTransform(position, index, rackCapacity, { drawn });
  if (position !== "bottom") return transform;
  // The local interactive hand is an orthographic overlay whose eighth tile
  // sits on the table centreline. Preserve that alignment when it moves into
  // the perspective scene, while pulling the row inward far enough that a
  // face-down fall only clips a narrow physical edge at the bottom of frame.
  return {
    ...transform,
    x: transform.x - (TILE_SIZE.width + HAND_TILE_GAP),
    z: covered ? LOCAL_COVERED_HAND_Z : LOCAL_REVEALED_HAND_Z,
  };
}

export function ownHandOverlayTransform(index, viewportWidth, viewportHeight, { drawn = false } = {}) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const safeWidth = Math.min(width, height * OWN_HAND_LAYOUT.safeAspect);
  const occupiedWidth = safeWidth * OWN_HAND_LAYOUT.occupiedWidthRatio;
  const regularGap = safeWidth * OWN_HAND_LAYOUT.regularGapRatio;
  const drawnGap = safeWidth * OWN_HAND_LAYOUT.drawnGapRatio;
  const tileWidth = (occupiedWidth - regularGap * 12 - drawnGap) / 14;
  const tileHeight = tileWidth / OWN_HAND_LAYOUT.hudTileAspect;
  const step = tileWidth + regularGap;
  const centreX = 0;
  // Derive the fixed left anchor once from the initial rack: its eighth tile
  // aligns with the table-console centre. Every later layout still starts at
  // this same first-tile position, so draws and calls only alter the right edge.
  const firstCenter =
    centreX - OWN_HAND_LAYOUT.initialCentreTileIndex * step;
  const drawnOffset = drawn ? drawnGap - regularGap : 0;
  const scaleX = tileWidth / TILE_SIZE.width;
  const scaleY = tileHeight / TILE_SIZE.height;
  return {
    x: firstCenter + index * step + drawnOffset,
    y: -height / 2 + tileHeight / 2 + OWN_HAND_LAYOUT.bottomInset,
    z: 0,
    scale: scaleY,
    scaleX,
    scaleY,
    scaleZ: scaleY,
    tileWidth,
    tileHeight,
    occupiedWidth,
    centreX,
    lift: tileHeight * 0.18,
    tilt: OWN_HAND_TILT,
  };
}

export function riverTransform(
  position,
  index,
  riichi = false,
  { riichiColumn: suppliedRiichiColumn } = {},
) {
  const anchor = RIVER_ANCHORS[position];
  if (!anchor) throw new RangeError(`Invalid mahjong seat: ${position}`);
  const { column, row } = riverGridPosition(index);
  const riichiColumn = Number.isInteger(suppliedRiichiColumn)
    ? suppliedRiichiColumn
    : riichi ? column : -1;
  // The first six tiles run from the player's left to right. Later rows grow
  // away from the centre toward that player, while every face remains upright
  // to the seat that discarded it.
  const riichiWidthOffset = column > riichiColumn && riichiColumn >= 0
    ? RIICHI_TILE_ACROSS_EXTRA
    : column === riichiColumn
      ? RIICHI_TILE_ACROSS_EXTRA / 2
      : 0;
  const across = (column - (RIVER_COLUMN_COUNT - 1) / 2) * RIVER_ACROSS_STEP
    + riichiWidthOffset;
  const outward = row * (TILE_SIZE.height + RIVER_ROW_GAP);
  const yaw = SEAT_YAW[position];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: anchor.x + across * cos + outward * sin,
    y: TILE_SIZE.depth / 2 + 0.015,
    z: anchor.z - across * sin + outward * cos,
    yaw: yaw + (riichi ? Math.PI / 2 : 0),
  };
}

export function riverGridPosition(index) {
  const normalizedIndex = Math.max(0, Math.trunc(Number(index) || 0));
  const row = Math.min(2, Math.floor(normalizedIndex / RIVER_COLUMN_COUNT));
  const column = row === 2
    ? normalizedIndex - RIVER_COLUMN_COUNT * 2
    : normalizedIndex % RIVER_COLUMN_COUNT;
  return { column, row };
}

export function meldTransform(
  position,
  offset,
  { absolute = false, inwardOffset = 0 } = {},
) {
  const anchor = HAND_ANCHORS[position];
  if (!anchor) throw new RangeError(`Invalid mahjong seat: ${position}`);
  const along = absolute ? offset : offset * (TILE_SIZE.width * MELD_SCALE + 0.035);
  const yaw = SEAT_YAW[position];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const handStep = TILE_SIZE.width + HAND_TILE_GAP;
  const drawnCentre = (CONCEALED_RACK_CAPACITY
    - (CONCEALED_RACK_CAPACITY - 1) / 2) * handStep + DRAWN_TILE_GAP;
  const rackRightEdge = drawnCentre + TILE_SIZE.width / 2;
  const meldRightCentre = rackRightEdge - TILE_SIZE.width * MELD_SCALE / 2;
  // The local hand is a narrower orthographic HUD rack. Align its 3D meld band
  // after the virtual draw slot, with enough clearance that the empty slot is
  // still legible after a call and at common phone aspect ratios.
  const hudAlignment = position === "bottom" ? 0.45 : 0;
  // Side-seat calls extend the physical centre line of their concealed rack.
  // The near and opposite seats retain a separate inner lane because the local
  // rack is an orthographic HUD and the opposite rack needs its face kept clear.
  const rackLaneInset = TILE_SIZE.depth / 2
    + TILE_SIZE.height * MELD_SCALE / 2
    + 0.08;
  const laneInward = position === "left" || position === "right" ? 0 : rackLaneInset;
  const inward = laneInward + (Number(inwardOffset) || 0);
  const fromRight = meldRightCentre + hudAlignment - along;
  return {
    x: anchor.x + fromRight * cos - inward * sin,
    y: TILE_SIZE.depth * 0.39,
    z: anchor.z - fromRight * sin - inward * cos,
    yaw,
  };
}

export function meldDisplayLayout(meld, claimantSeat) {
  const tiles = Array.isArray(meld?.tiles) ? meld.tiles : [];
  const red = Array.isArray(meld?.red) ? meld.red : [];
  const entries = tiles.map((type, sourceIndex) => ({
    type,
    red: red[sourceIndex] === true,
    sourceIndex,
    sideways: false,
    faceDown: false,
    inward: 0,
  }));

  if (meld?.kind === "ankan") {
    entries.sort(compareMeldEntriesRightToLeft);
    entries.forEach((entry, index) => {
      entry.faceDown = index === 0 || index === entries.length - 1;
    });
    return measureMeldEntries(entries);
  }

  const addedIndex = validSourceIndex(meld?.addedTileIndex, entries.length)
    ? Number(meld.addedTileIndex)
    : meld?.kind === "kakan" ? entries.length - 1 : -1;
  const added = addedIndex >= 0 ? entries.splice(addedIndex, 1)[0] : null;
  let calledIndex = Number(meld?.calledTileIndex);
  if (addedIndex >= 0 && calledIndex > addedIndex) calledIndex -= 1;
  if (!validSourceIndex(calledIndex, entries.length)) calledIndex = 0;
  const called = entries.splice(calledIndex, 1)[0];
  entries.sort(compareMeldEntriesRightToLeft);

  const markerIndex = calledMarkerIndex(
    Number(claimantSeat),
    Number(meld?.fromIndex),
    entries.length + 1,
  );
  called.sideways = true;
  called.inward = MELD_SIDEWAYS_BOTTOM_INSET;
  entries.splice(markerIndex, 0, called);
  const measured = measureMeldEntries(entries);

  if (added) {
    added.sideways = true;
    added.along = called.along;
    added.inward = called.inward + MELD_KAKAN_INWARD_STEP;
    measured.entries.push(added);
  }
  return measured;
}

function calledMarkerIndex(claimantSeat, fromIndex, tileCount) {
  const relativeSeat = (fromIndex - claimantSeat + 4) % 4;
  if (relativeSeat === 1) return 0;
  if (relativeSeat === 2) return Math.min(1, tileCount - 1);
  return tileCount - 1;
}

function compareMeldEntriesRightToLeft(left, right) {
  return Number(right.type) - Number(left.type) || right.sourceIndex - left.sourceIndex;
}

export function meldRightExtension(melds, claimantSeat) {
  const groups = Array.isArray(melds) ? melds : [];
  if (!groups.length) return 0;
  const clearance = Number(claimantSeat) === 1
    ? MELD_HAND_CLEARANCE
    : OPPONENT_MELD_HAND_CLEARANCE;
  const available = groups.length * 3 * (TILE_SIZE.width + HAND_TILE_GAP)
    - clearance;
  const totalSpan = groups.reduce(
    (sum, meld) => sum + meldDisplayLayout(meld, claimantSeat).span,
    Math.max(0, groups.length - 1) * MELD_GROUP_GAP,
  );
  return Math.max(0, totalSpan - available);
}

function measureMeldEntries(entries) {
  const normalExtent = TILE_SIZE.width * MELD_SCALE;
  const gap = MELD_TILE_GAP;
  let cursor = 0;
  for (const entry of entries) {
    const extent = (entry.sideways ? TILE_SIZE.height : TILE_SIZE.width) * MELD_SCALE;
    entry.along = cursor + extent / 2 - normalExtent / 2;
    cursor += extent + gap;
  }
  return {
    entries,
    span: Math.max(0, cursor - gap),
  };
}

function validSourceIndex(value, length) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < length;
}
