export const TILE_FACE_NAMES = [
  ...Array.from({ length: 9 }, (_, index) => `Man${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `Pin${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `Sou${index + 1}`),
  "Ton", "Nan", "Shaa", "Pei", "Haku", "Hatsu", "Chun",
  "Man5-Dora", "Pin5-Dora", "Sou5-Dora",
];

const RED_FACE_INDEX = new Map([
  [5, 34],
  [14, 35],
  [23, 36],
]);

export function tileFaceFrameIndex(type, red = false) {
  const numericType = Number(type);
  if (!Number.isInteger(numericType) || numericType < 1 || numericType > 34) {
    throw new RangeError(`Invalid mahjong tile type: ${type}`);
  }
  return red ? RED_FACE_INDEX.get(numericType) ?? numericType - 1 : numericType - 1;
}
