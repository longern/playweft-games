const MAX_YAW_RADIANS = 0.04;
const NORMAL_SCALE = 0.42;

export function planarTileJitter(key, adjacentGap, footprint) {
  const gap = Math.max(0, Number(adjacentGap) || 0);
  const width = Math.max(0, Number(footprint?.width) || 0);
  const height = Math.max(0, Number(footprint?.height) || 0);
  const clearance = gap / 2;
  const radius = Math.hypot(width, height) / 2;
  if (!clearance || !radius) {
    return { along: 0, across: 0, yaw: 0, edgeDisplacement: 0, limit: clearance };
  }

  const geometricYawLimit = 2 * Math.asin(Math.min(1, clearance / (2 * radius)));
  const yawLimit = Math.min(MAX_YAW_RADIANS, geometricYawLimit);
  const yaw = clippedNormal(key, 0) * yawLimit;
  const rotationalSweep = 2 * radius * Math.sin(Math.abs(yaw) / 2);
  const translationLimit = Math.max(0, clearance - rotationalSweep);
  const rawAlong = clippedNormal(key, 1);
  const rawAcross = clippedNormal(key, 2);
  const rawLength = Math.hypot(rawAlong, rawAcross);
  const vectorScale = rawLength > 1 ? 1 / rawLength : 1;
  const along = rawAlong * vectorScale * translationLimit;
  const across = rawAcross * vectorScale * translationLimit;
  const edgeDisplacement = Math.hypot(along, across) + rotationalSweep;

  return { along, across, yaw, edgeDisplacement, limit: clearance };
}

function clippedNormal(key, channel) {
  const first = Math.max(Number.EPSILON, hashUnit(`${key}:${channel}:a`));
  const second = hashUnit(`${key}:${channel}:b`);
  const normal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return Math.max(-1, Math.min(1, normal * NORMAL_SCALE));
}

function hashUnit(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 0.5) / 4294967296;
}
