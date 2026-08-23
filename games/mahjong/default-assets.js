const ASSET_GROUPS = [
  "portraits",
  "tablecloths",
  "backgrounds",
  "lobby",
  "tileBacks",
  "music",
];
const CONFIG_ASSET_FIELDS = {
  portraits: "portraits",
  tablecloths: "tablecloths",
  backgrounds: "tableBackgrounds",
  lobby: "lobbyBackgrounds",
  tileBacks: "tileBacks",
  music: "matchBgm",
};
const PORTRAIT_POSITIONS = ["self", "right", "opposite", "left"];
const DEFAULT_APPEARANCE_KEY = "playweft.mahjong.default-asset-appearance";
let generatedPortraitSelection = null;

const injectedConfig =
  typeof __MAHJONG_DEFAULT_ASSET_CONFIG__ !== "undefined"
    ? __MAHJONG_DEFAULT_ASSET_CONFIG__
    : {};

export function normalizeMahjongDefaultAssetConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const assetPacks = normalizeAssetPacks(source.assetPacks);
  const catalog = Object.fromEntries(
    ASSET_GROUPS.map((group) => [
      group,
      normalizeEntries(source[CONFIG_ASSET_FIELDS[group]]),
    ]),
  );
  // Built-in remote config currently covers visual assets and BGM. Keep the
  // same catalog shape as a local pack so the settings renderer can inspect
  // voice entries without special-casing the default pack.
  catalog.voices = [];
  const requested = source.defaults && typeof source.defaults === "object"
    ? source.defaults
    : {};
  const portraitDefaults = requested.portraits && typeof requested.portraits === "object"
    ? requested.portraits
    : {};
  const portraitPool = normalizePortraitPool(
    portraitDefaults.pool,
    catalog.portraits,
  );
  const appearance = {
    portraits: Object.fromEntries(
      PORTRAIT_POSITIONS.map((position) => [
        position,
        position === "self"
          ? pickId(catalog.portraits, portraitDefaults.self)
          : portraitDefaults[position]
            ? pickId(catalog.portraits, portraitDefaults[position])
            : "",
      ]),
    ),
    tablecloth: pickId(catalog.tablecloths, requested?.tablecloth),
    background: pickId(catalog.backgrounds, requested?.tableBackground),
    lobby: pickId(catalog.lobby, requested?.lobbyBackground),
    tileBack: pickId(catalog.tileBacks, requested?.tileBack),
    music: requested?.matchBgm === ""
      ? ""
      : pickId(catalog.music, requested?.matchBgm),
  };
  return {
    name: "默认主题",
    catalog,
    appearance,
    portraitPool,
    assetPacks,
  };
}

export const MAHJONG_DEFAULT_ASSET_CONFIG =
  normalizeMahjongDefaultAssetConfig(injectedConfig);

export function getMahjongDefaultAssetPack() {
  const config = MAHJONG_DEFAULT_ASSET_CONFIG;
  const appearance = readAppearance(config);
  const assets = new Map();
  for (const position of PORTRAIT_POSITIONS) {
    addSelectedAsset(
      assets,
      `portrait-${position}`,
      config.catalog.portraits,
      appearance.portraits[position],
    );
  }
  addSelectedAsset(assets, "tablecloth", config.catalog.tablecloths, appearance.tablecloth);
  addSelectedAsset(assets, "background", config.catalog.backgrounds, appearance.background);
  addSelectedAsset(assets, "lobby", config.catalog.lobby, appearance.lobby);
  addSelectedAsset(assets, "tile-back", config.catalog.tileBacks, appearance.tileBack);
  addSelectedAsset(assets, "music", config.catalog.music, appearance.music);
  return {
    id: "__default__",
    name: config.name,
    active: true,
    isDefault: true,
    catalog: config.catalog,
    appearance,
    defaultNames: {},
    assetNames: ASSET_GROUPS.flatMap((group) =>
      config.catalog[group].map((entry) => entry.label),
    ),
    assets,
  };
}

export function getMahjongDefaultAssetMap() {
  return getMahjongDefaultAssetPack().assets;
}

export function getMahjongConfiguredAssetPacks() {
  return MAHJONG_DEFAULT_ASSET_CONFIG.assetPacks.map((pack) => ({ ...pack }));
}

export function getMahjongDefaultAssetCopyright() {
  const config = MAHJONG_DEFAULT_ASSET_CONFIG;
  const appearance = readAppearance(config);
  return config.catalog.music.find((entry) => entry.id === appearance.music)?.copyright || "";
}

export function configureMahjongDefaultAssetAppearance(nextAppearance) {
  const config = MAHJONG_DEFAULT_ASSET_CONFIG;
  const appearance = {
    ...readAppearance(config),
    ...(nextAppearance && typeof nextAppearance === "object" ? nextAppearance : {}),
    portraits: {
      ...readAppearance(config).portraits,
      ...(nextAppearance?.portraits ?? {}),
    },
  };
  try {
    localStorage.setItem(DEFAULT_APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    // The current tab still uses the returned in-memory configuration.
  }
  return getMahjongDefaultAssetPack();
}

function readAppearance(config) {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(DEFAULT_APPEARANCE_KEY) || "null");
  } catch {
    stored = null;
  }
  const requested = stored && typeof stored === "object" ? stored : config.appearance;
  return {
    portraits: resolvePortraitAppearance(config, requested?.portraits),
    tablecloth: pickId(config.catalog.tablecloths, requested?.tablecloth),
    background: pickId(
      config.catalog.backgrounds,
      requested?.tableBackground ?? requested?.background,
    ),
    lobby: pickId(
      config.catalog.lobby,
      requested?.lobbyBackground ?? requested?.lobby,
    ),
    tileBack: pickId(config.catalog.tileBacks, requested?.tileBack),
    music: (requested?.matchBgm ?? requested?.music) === ""
      ? ""
      : pickId(config.catalog.music, requested?.matchBgm ?? requested?.music),
  };
}

function resolvePortraitAppearance(config, requested) {
  const choices = requested && typeof requested === "object" ? requested : {};
  const self = pickId(config.catalog.portraits, choices.self);
  const explicit = Object.fromEntries(
    ["right", "opposite", "left"].map((position) => [
      position,
      choices[position] ? pickId(config.catalog.portraits, choices[position]) : "",
    ]),
  );
  const pool = (config.portraitPool.length
    ? config.portraitPool
    : config.catalog.portraits.map((entry) => entry.id)
  ).filter((id) => id && id !== self);
  const cacheKey = [self, ...pool, ...Object.values(explicit)].join("|");
  if (
    generatedPortraitSelection?.key === cacheKey &&
    Object.values(explicit).every((id) => !id)
  ) {
    return { ...generatedPortraitSelection.value };
  }
  const used = new Set([self]);
  const remaining = shuffle(pool);
  const result = { self };
  for (const position of ["right", "opposite", "left"]) {
    const selected = explicit[position] || nextPortrait(remaining, used, config.catalog.portraits);
    result[position] = selected;
    if (selected) used.add(selected);
  }
  if (Object.values(explicit).every((id) => !id)) {
    generatedPortraitSelection = { key: cacheKey, value: result };
  }
  return result;
}

function nextPortrait(pool, used, catalog) {
  while (pool.length) {
    const id = pool.shift();
    if (!used.has(id)) return id;
  }
  return catalog.find((entry) => !used.has(entry.id))?.id || "";
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function addSelectedAsset(target, slot, entries, id) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry) target.set(slot, { name: entry.label, url: entry.url, copyright: entry.copyright });
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const id = String(entry?.id || "").trim();
    const url = String(entry?.url || "").trim();
    const label = String(entry?.label || id).trim();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id) || !url || !label) return [];
    let parsed;
    try {
      parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return [];
    } catch {
      return [];
    }
    return [{
      id,
      url: parsed.href,
      label: label.slice(0, 24),
      copyright: String(entry?.copyright || "").trim().slice(0, 160),
    }];
  });
}

function normalizePortraitPool(pool, entries) {
  if (!Array.isArray(pool)) return [];
  const valid = new Set(entries.map((entry) => entry.id));
  return [...new Set(pool.filter((id) => valid.has(id)))];
}

function normalizeAssetPacks(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.flatMap((entry) => {
    const name = String(entry?.name || "").trim().slice(0, 40);
    const suppliedUrl = String(entry?.url || "").trim();
    if (!name || !suppliedUrl) return [];
    let url;
    try {
      const parsed = new URL(suppliedUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return [];
      url = parsed.href;
    } catch {
      return [];
    }
    if (seen.has(url)) return [];
    seen.add(url);
    return [{ name, url }];
  });
}

function pickId(entries, requested) {
  if (entries.some((entry) => entry.id === requested)) return requested;
  return entries[0]?.id || "";
}
