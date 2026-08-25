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

// Kept for callers that explicitly request a random portrait layout. Theme
// defaults must use resolveMahjongPortraitDefaults so loading a pack is pure.
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

export function resolveMahjongPortraitDefaults(entries, requested) {
  const choices = requested && typeof requested === "object" ? requested : {};
  const catalog = Array.isArray(entries) ? entries : [];
  const valid = new Set(catalog.map((entry) => entry.id));
  const pick = (id) => (valid.has(id) ? id : "");
  return {
    self: pick(choices.self) || catalog[0]?.id || "",
    right: pick(choices.right),
    opposite: pick(choices.opposite),
    left: pick(choices.left),
  };
}

export function resolveMahjongMatchPortraits(
  entries,
  savedPortraits,
  fallbackPortraits,
  portraitPool = [],
  randomSeed = "",
) {
  const catalog = Array.isArray(entries) ? entries : [];
  const validIds = new Set(catalog.map((entry) => entry.id));
  const fallback = fallbackPortraits && typeof fallbackPortraits === "object"
    ? fallbackPortraits
    : {};
  const saved = savedPortraits && typeof savedPortraits === "object"
    ? savedPortraits
    : {};
  const self = validIds.has(fallback.self)
    ? fallback.self
    : (catalog[0]?.id ?? "");
  const source = (
    portraitPool.length
      ? portraitPool
      : catalog.map((entry) => entry.id)
  ).filter((id) => id && validIds.has(id) && id !== self);
  const candidates = source.length
    ? source
    : (portraitPool.length ? portraitPool : catalog.map((entry) => entry.id))
      .filter((id) => id && validIds.has(id));
  const shuffled = seededShuffle(candidates, randomSeed);
  const used = new Set([self]);
  const result = { self };
  const positions = ["right", "opposite", "left"];
  for (const position of positions) {
    const id = saved[position];
    if (!validIds.has(id) || id === self) continue;
    result[position] = id;
    used.add(id);
  }
  for (const [index, position] of positions.entries()) {
    if (result[position]) continue;
    result[position] = nextPortrait(shuffled, used, candidates, index);
    if (result[position]) used.add(result[position]);
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

function seededShuffle(values, seed) {
  const result = [...values];
  let state = hashSeed(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
