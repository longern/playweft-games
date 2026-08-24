export const MAHJONG_PORTRAIT_POSITIONS = [
  "self",
  "right",
  "opposite",
  "left",
];

export function normalizeMahjongPortraitPool(pool, entries) {
  if (!Array.isArray(pool)) return [];
  const valid = new Set((entries ?? []).map((entry) => entry.id));
  return [...new Set(pool.filter((id) => valid.has(id)))];
}

export function resolveMahjongPortraitAppearance(
  entries,
  requested,
  portraitPool = [],
) {
  const choices = requested && typeof requested === "object" ? requested : {};
  const catalog = Array.isArray(entries) ? entries : [];
  const pick = (id) =>
    catalog.some((entry) => entry.id === id) ? id : "";
  const self = pick(choices.self) || catalog[0]?.id || "";
  const source = (
    portraitPool.length
      ? portraitPool
      : catalog.map((entry) => entry.id)
  ).filter((id) => id && catalog.some((entry) => entry.id === id));
  const uniqueCandidates = source.filter((id) => id !== self);
  const remaining = shuffle(uniqueCandidates);
  const repeatable = uniqueCandidates.length
    ? uniqueCandidates
    : source.length
      ? source
      : catalog.map((entry) => entry.id);
  const used = new Set([self]);
  const result = { self };
  for (const [index, position] of ["right", "opposite", "left"].entries()) {
    const selected = nextPortrait(remaining, used, repeatable, index);
    result[position] = selected;
    if (selected) used.add(selected);
  }
  return result;
}

function nextPortrait(pool, used, repeatable, repeatIndex) {
  while (pool.length) {
    const id = pool.shift();
    if (!used.has(id)) return id;
  }
  return repeatable[repeatIndex % repeatable.length] || "";
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
