// AMOS parlor-size riichi tiles are 28 × 21 × 16.5 mm. Keep the scene units
// normalized to tile height so standing and laid tiles share real proportions.
export const TILE_PHYSICAL_MM = Object.freeze({ width: 21, height: 28, depth: 16.5 });
export const TILE_SIZE = Object.freeze({
  width: TILE_PHYSICAL_MM.width / TILE_PHYSICAL_MM.height,
  height: 1,
  depth: TILE_PHYSICAL_MM.depth / TILE_PHYSICAL_MM.height,
});

export const MELD_SCALE = 0.78;
export const MELD_GROUP_GAP = 0.18;
export const CONCEALED_RACK_CAPACITY = 13;

const HAND_TILE_GAP = 0.035;
const DRAWN_TILE_GAP = 0.24;

export const OWN_HAND_LAYOUT = Object.freeze({
  safeAspect: 16 / 9,
  occupiedWidthRatio: 0.64,
  centreOffsetRatio: 0.055,
  hudTileAspect: 0.66,
  regularGapRatio: 0.0015,
  drawnGapRatio: 0.009,
  bottomInset: 9,
});

export const SEAT_YAW = Object.freeze({
  bottom: 0,
  right: Math.PI / 2,
  top: Math.PI,
  left: -Math.PI / 2,
});

const HAND_ANCHORS = Object.freeze({
  bottom: { x: 0, z: 7.45 },
  right: { x: 8.15, z: -0.5 },
  top: { x: 0, z: -9.7 },
  left: { x: -8.15, z: -0.5 },
});

const RIVER_ANCHORS = Object.freeze({
  bottom: { x: 0, z: 3.05 },
  right: { x: 3, z: -0.1 },
  top: { x: 0, z: -2.8 },
  left: { x: -3, z: -0.1 },
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
  const centreX = -safeWidth * OWN_HAND_LAYOUT.centreOffsetRatio;
  const firstCenter = centreX - occupiedWidth / 2 + tileWidth / 2;
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
    lift: tileHeight * 0.25,
    tilt: 0.065,
  };
}

export function ownMeldOverlayTransform(
  offset,
  viewportWidth,
  viewportHeight,
  { sideways = false, stackLevel = 0 } = {},
) {
  const base = ownHandOverlayTransform(0, viewportWidth, viewportHeight);
  const rightEdge = base.centreX + base.occupiedWidth / 2;
  const normalExtent = base.tileWidth * MELD_SCALE;
  const displayedHeight = (sideways ? TILE_SIZE.width : TILE_SIZE.height)
    * base.scaleY * MELD_SCALE;
  const stackOffset = Number(stackLevel) * displayedHeight * 0.52;
  return {
    x: rightEdge - normalExtent / 2 - offset * base.scaleX,
    y: -Math.max(1, Number(viewportHeight) || 1) / 2
      + OWN_HAND_LAYOUT.bottomInset
      + displayedHeight / 2
      + stackOffset,
    z: Number(stackLevel) * base.scaleZ * TILE_SIZE.depth * MELD_SCALE,
    scaleX: base.scaleX * MELD_SCALE,
    scaleY: base.scaleY * MELD_SCALE,
    scaleZ: base.scaleZ * MELD_SCALE,
    rotationZ: sideways ? -Math.PI / 2 : 0,
  };
}

export function riverTransform(position, index, riichi = false) {
  const anchor = RIVER_ANCHORS[position];
  if (!anchor) throw new RangeError(`Invalid mahjong seat: ${position}`);
  const column = index % 6;
  const row = Math.floor(index / 6);
  // The first six tiles run from the player's left to right. Later rows grow
  // away from the centre toward that player, while every face remains upright
  // to the seat that discarded it.
  const across = (column - 2.5) * (TILE_SIZE.width + 0.055);
  const outward = row * (TILE_SIZE.height + 0.085);
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

export function meldTransform(position, offset, { absolute = false } = {}) {
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
  // Open tiles lie flat just inside the standing rack, but share its right-side
  // layout band instead of drifting forward toward the river.
  const inward = TILE_SIZE.depth / 2 + TILE_SIZE.height * MELD_SCALE / 2 + 0.08;
  const fromRight = meldRightCentre - along;
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
    stackLevel: 0,
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
  entries.splice(markerIndex, 0, called);
  const measured = measureMeldEntries(entries);

  if (added) {
    added.sideways = true;
    added.stackLevel = 1;
    added.along = called.along;
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

function measureMeldEntries(entries) {
  const normalExtent = TILE_SIZE.width * MELD_SCALE;
  const gap = 0.035;
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
