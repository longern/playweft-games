import { unzipSync } from "fflate";
import {
  configureMahjongDefaultAssetAppearance,
  getMahjongConfiguredAssetPacks,
  getMahjongDefaultAssetCopyright,
  getMahjongDefaultAssetMap,
  getMahjongDefaultAssetPack,
  portraitNames,
} from "./default-assets.js";
import {
  MAHJONG_PORTRAIT_POSITIONS,
  normalizeMahjongPortraitPool,
  resolveMahjongPlayerPortraits,
  resolveMahjongMatchPortraits,
  resolveMahjongPortraitDefaults,
} from "./portrait-selection.js";

const DB_NAME = "playweft-mahjong-asset-packs-v2";
const PACKS = "packs";
const ASSETS = "assets";
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_ARCHIVE_SIZE = 48 * 1024 * 1024;
const PORTRAIT_POSITIONS = MAHJONG_PORTRAIT_POSITIONS;
const CATALOG_GROUPS = [
  "portraits",
  "tablecloths",
  "tableBackgrounds",
  "lobbyBackgrounds",
  "tileBacks",
  "matchBgm",
  "riichiBgm",
];
const VOICE_CUES = ["chi", "pon", "kan", "riichi", "ron", "tsumo"];
const ASSET_STORAGE_UNAVAILABLE = "MAHJONG_ASSET_STORAGE_UNAVAILABLE";
export const MAHJONG_YAKU_VOICE_KEYS = Object.freeze({
  两立直: "double-riichi",
  立直: "riichi",
  一发: "ippatsu",
  门前清自摸和: "menzen-tsumo",
  岭上开花: "rinshan",
  抢杠: "chankan",
  海底摸月: "haitei",
  河底捞鱼: "houtei",
  断幺九: "tanyao",
  平和: "pinfu",
  二杯口: "ryanpeikou",
  一杯口: "iipeikou",
  白: "haku",
  发: "hatsu",
  中: "chun",
  自风: "seat-wind",
  场风: "round-wind",
  大三元: "daisangen",
  大四喜: "daisuushii",
  小四喜: "shousuushii",
  小三元: "shousangen",
  对对和: "toitoi",
  三暗刻: "sanankou",
  四暗刻: "suuankou",
  三杠子: "sankantsu",
  四杠子: "suukantsu",
  三色同顺: "sanshoku-doujun",
  一气通贯: "ittsuu",
  三色同刻: "sanshoku-doukou",
  混一色: "honitsu",
  清一色: "chinitsu",
  混老头: "honroutou",
  混全带幺九: "chanta",
  纯全带幺九: "junchan",
  字一色: "tsuuiisou",
  清老头: "chinroutou",
  绿一色: "ryuuiisou",
  天和: "tenhou",
  地和: "chiihou",
  国士无双: "kokushi",
  九莲宝灯: "chuuren-poutou",
  七对子: "chiitoitsu",
  宝牌: "dora",
  流局满贯: "nagashi-mangan",
});
const YAKU_VOICE_KEYS = new Set(Object.values(MAHJONG_YAKU_VOICE_KEYS));

export const MAHJONG_ASSET_SLOTS = Object.freeze({
  "portrait-self": "自己",
  "portrait-right": "右手边",
  "portrait-opposite": "对家",
  "portrait-left": "左手边",
  background: "牌桌背景",
  lobby: "大厅背景",
  tablecloth: "桌布",
  "tile-back": "牌背",
  music: "对局音乐",
});

let databasePromise;
let activeAssets = new Map();
let objectUrls = new Map();
let activeDefaultNames = {};
let activePackOverridesMatchMusic = false;
let activePackOverridesRiichiMusic = false;
let transientPack = null;
let assetPackStorageUnavailable = false;
let activePortraits = {};
let activeMatchPortraitRequest = null;
let activePackId = "__default__";
let activePortraitCatalog = [];
let activePortraitPool = [];
let activeCharacterVoiceCatalog = [];
let activePackStored = null;
const onlinePortraitUrls = new Map();
const onlinePortraitObjectUrls = new Set();
const unavailableOnlinePortraits = new Set();
const onlineCharacterVoiceUrls = new Map();
const unavailableOnlineCharacterVoices = new Set();

export async function initializeMahjongAssetPacks(matchPortraitRequest) {
  if (matchPortraitRequest && typeof matchPortraitRequest === "object") {
    activeMatchPortraitRequest = {
      savedPortraits:
        matchPortraitRequest.savedPortraits &&
        typeof matchPortraitRequest.savedPortraits === "object"
          ? structuredClone(matchPortraitRequest.savedPortraits)
          : {},
      randomSeed: String(matchPortraitRequest.randomSeed ?? ""),
    };
  }
  // Apply build-time defaults synchronously so the first user gesture can
  // start default media before IndexedDB finishes reading local packs.
  applyResolvedAssets(null);
  if (!("indexedDB" in globalThis)) {
    assetPackStorageUnavailable = true;
    return new Map();
  }
  const active = await readActivePack();
  if (active) applyResolvedAssets(active);
  return active?.assets ?? new Map();
}

export async function rerollMahjongAssetPackPortraits(randomSeed = "") {
  activeMatchPortraitRequest = {
    savedPortraits: {},
    randomSeed: String(randomSeed),
  };
  if (assetPackStorageUnavailable) {
    if (transientPack) applyTransientAssets();
    else applyResolvedAssets(null);
    return getMahjongActivePortraits();
  }
  const active = await readActivePack();
  applyResolvedAssets(active);
  return getMahjongActivePortraits();
}

export async function applyMahjongMatchPortraits(savedPortraits, randomSeed) {
  activeMatchPortraitRequest = {
    savedPortraits: savedPortraits && typeof savedPortraits === "object"
      ? structuredClone(savedPortraits)
      : {},
    randomSeed: String(randomSeed ?? ""),
  };
  if (assetPackStorageUnavailable) {
    if (transientPack) applyResolvedAssets(transientPack);
    else applyResolvedAssets(null);
    return getMahjongActivePortraits();
  }
  const active = await readActivePack();
  applyResolvedAssets(active);
  return getMahjongActivePortraits();
}

export async function clearMahjongMatchPortraitRequest() {
  activeMatchPortraitRequest = null;
  if (assetPackStorageUnavailable) {
    if (transientPack) applyTransientAssets();
    else applyResolvedAssets(null);
    return;
  }
  const active = await readActivePack();
  applyResolvedAssets(active);
}

export function getMahjongActivePortraits() {
  return { ...activePortraits };
}

export function getMahjongOnlinePortraitContext() {
  return {
    packId: activePackId,
    catalog: activePortraitCatalog.map(({ id, label }) => ({ id, label })),
    portraitPool: [...activePortraitPool],
  };
}

export function getMahjongOnlineAiPortraitAssignments(playerIds, randomSeed = "") {
  const assignments = resolveMahjongPlayerPortraits(
    activePortraitCatalog,
    activePortraitPool,
    playerIds,
    randomSeed,
  );
  return Object.fromEntries(
    Object.entries(assignments).map(([playerId, portraitId]) => [
      playerId,
      { packId: activePackId, portraitId },
    ]),
  );
}

export async function resolveMahjongOnlinePortrait(reference) {
  const packId = String(reference?.packId || "").trim();
  const portraitId = String(reference?.portraitId || "").trim();
  if (!packId || !portraitId) return null;
  const cacheKey = `${packId}:${portraitId}`;
  if (onlinePortraitUrls.has(cacheKey)) return onlinePortraitUrls.get(cacheKey);
  if (unavailableOnlinePortraits.has(cacheKey)) return null;
  if (packId === activePackId) {
    const entry = activePortraitCatalog.find((candidate) => candidate.id === portraitId);
    const record = activePackStored?.get?.(assetStorageSlot("portraits", portraitId));
    const url = record?.blob
      ? createOnlinePortraitObjectUrl(record.blob)
      : record?.url || activeAssets.get(`portrait-${portraitId}`)?.url;
    if (entry && url) {
      onlinePortraitUrls.set(cacheKey, url);
      return url;
    }
    unavailableOnlinePortraits.add(cacheKey);
  }
  if (packId === "__default__") {
    const pack = getMahjongDefaultPack();
    const entry = pack.catalog.portraits.find((candidate) => candidate.id === portraitId);
    if (entry?.url) {
      onlinePortraitUrls.set(cacheKey, entry.url);
      return entry.url;
    }
    unavailableOnlinePortraits.add(cacheKey);
    return null;
  }
  if (assetPackStorageUnavailable) return null;
  try {
    const database = await openDatabase();
    const transaction = database.transaction([PACKS, ASSETS], "readonly");
    const [pack, record] = await Promise.all([
      requestPromise(transaction.objectStore(PACKS).get(packId)),
      requestPromise(
        transaction.objectStore(ASSETS).get([
          packId,
          assetStorageSlot("portraits", portraitId),
        ]),
      ),
    ]);
    const catalog = catalogForPack(pack);
    if (!catalog.portraits.some((entry) => entry.id === portraitId) || !record) {
      unavailableOnlinePortraits.add(cacheKey);
      return null;
    }
    const url = record.blob
      ? createOnlinePortraitObjectUrl(record.blob)
      : record.url;
    if (!url) {
      unavailableOnlinePortraits.add(cacheKey);
      return null;
    }
    onlinePortraitUrls.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

export async function resolveMahjongOnlineCharacterVoice(reference, cue) {
  const packId = String(reference?.packId || "").trim();
  const characterId = String(reference?.characterId || "").trim();
  const voiceCue = String(cue || "").trim();
  if (!packId || !characterId || !voiceCue) return null;
  const cacheKey = `${packId}:${characterId}:${voiceCue}`;
  if (onlineCharacterVoiceUrls.has(cacheKey)) {
    return onlineCharacterVoiceUrls.get(cacheKey);
  }
  if (unavailableOnlineCharacterVoices.has(cacheKey)) return null;
  const voiceAssetId = `${characterId}:${voiceCue}`;
  if (packId === activePackId) {
    const voiceSet = activeCharacterVoiceCatalog.find(
      (entry) => entry.characterId === characterId,
    );
    const assetPath = voiceCue.startsWith("yaku:")
      ? voiceSet?.yaku?.[voiceCue.slice(5)]
      : voiceSet?.lines?.[voiceCue];
    const record = activePackStored?.get?.(assetStorageSlot("voices", voiceAssetId));
    const url = record?.blob
      ? createOnlinePortraitObjectUrl(record.blob)
      : record?.url || assetPath || "";
    if (url) {
      onlineCharacterVoiceUrls.set(cacheKey, url);
      return url;
    }
    unavailableOnlineCharacterVoices.add(cacheKey);
    return null;
  }
  if (packId === "__default__") {
    const voiceSet = getMahjongDefaultPack().catalog.voices?.find(
      (entry) => entry.characterId === characterId,
    );
    const url = voiceCue.startsWith("yaku:")
      ? voiceSet?.yaku?.[voiceCue.slice(5)]
      : voiceSet?.lines?.[voiceCue];
    if (url) {
      onlineCharacterVoiceUrls.set(cacheKey, url);
      return url;
    }
    unavailableOnlineCharacterVoices.add(cacheKey);
    return null;
  }
  if (assetPackStorageUnavailable) return null;
  try {
    const database = await openDatabase();
    const transaction = database.transaction([PACKS, ASSETS], "readonly");
    const [pack, record] = await Promise.all([
      requestPromise(transaction.objectStore(PACKS).get(packId)),
      requestPromise(
        transaction.objectStore(ASSETS).get([
          packId,
          assetStorageSlot("voices", voiceAssetId),
        ]),
      ),
    ]);
    const catalog = catalogForPack(pack);
    const voiceSet = catalog.voices.find(
      (entry) => entry.characterId === characterId,
    );
    const declared = voiceCue.startsWith("yaku:")
      ? voiceSet?.yaku?.[voiceCue.slice(5)]
      : voiceSet?.lines?.[voiceCue];
    if (!declared || !record) {
      unavailableOnlineCharacterVoices.add(cacheKey);
      return null;
    }
    const url = record.blob
      ? createOnlinePortraitObjectUrl(record.blob)
      : record.url;
    if (!url) {
      unavailableOnlineCharacterVoices.add(cacheKey);
      return null;
    }
    onlineCharacterVoiceUrls.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

export function getMahjongAssetUrl(slot) {
  return activeAssets.get(slot)?.url ?? "";
}

/** Return an asset's pre-load colour, when the asset declares one. */
export function getMahjongAssetFallbackColor(slot) {
  return activeAssets.get(slot)?.fallbackColor ?? "";
}

export function getMahjongDefaultAssetUrl(slot) {
  return getMahjongDefaultAssetPack().assets.get(slot)?.url ?? "";
}

export function chooseMahjongMatchMusicUrl(
  defaultUrl,
  customUrl,
  packOverridesMusic,
) {
  return packOverridesMusic ? customUrl : defaultUrl;
}

export const chooseMahjongRiichiMusicUrl = chooseMahjongMatchMusicUrl;

/** Use an active pack's music choice, falling back when it has no music. */
export function getMahjongMatchMusicUrl() {
  const defaultUrl = getMahjongDefaultAssetMap().get("music")?.url ?? "";
  return chooseMahjongMatchMusicUrl(
    defaultUrl,
    getMahjongAssetUrl("music"),
    activePackOverridesMatchMusic,
  );
}

/** Use a configured riichi track, otherwise leave the normal match music playing. */
export function getMahjongRiichiMusicUrl() {
  const defaultUrl =
    getMahjongDefaultAssetMap().get("riichi-music")?.url ?? "";
  return chooseMahjongRiichiMusicUrl(
    defaultUrl,
    getMahjongAssetUrl("riichi-music"),
    activePackOverridesRiichiMusic,
  );
}

export function getMahjongDefaultNames() {
  return { ...activeDefaultNames };
}

export function getMahjongDefaultPack() {
  return getMahjongDefaultAssetPack();
}

export { getMahjongConfiguredAssetPacks };

export function configureMahjongDefaultPackAppearance(appearance) {
  const pack = configureMahjongDefaultAssetAppearance(appearance);
  applyResolvedAssets(null);
  return pack;
}

export function getMahjongMatchMusicCopyright() {
  if (!activePackOverridesMatchMusic && !activePackOverridesRiichiMusic) {
    return getMahjongDefaultAssetCopyright();
  }
  const defaults = getMahjongDefaultAssetMap();
  const matchCopyright = (
    activePackOverridesMatchMusic
      ? activeAssets.get("music")
      : defaults.get("music")
  )?.copyright;
  const riichiCopyright = (
    activePackOverridesRiichiMusic
      ? activeAssets.get("riichi-music")
      : defaults.get("riichi-music")
  )?.copyright;
  return [
    matchCopyright && `对局音乐：${matchCopyright}`,
    riichiCopyright && `立直音乐：${riichiCopyright}`,
  ].filter(Boolean).join("；");
}

export async function listMahjongAssetPacks() {
  if (assetPackStorageUnavailable) return listTransientAssetPacks();
  let database;
  try {
    database = await openDatabase();
  } catch (error) {
    if (!isAssetStorageUnavailable(error)) throw error;
    return listTransientAssetPacks();
  }
  const transaction = database.transaction([PACKS, ASSETS], "readonly");
  const [packs, assets] = await Promise.all([
    requestPromise(transaction.objectStore(PACKS).getAll()),
    requestPromise(transaction.objectStore(ASSETS).getAll()),
  ]);
  const packAssets = new Map();
  for (const asset of assets) {
    const records = packAssets.get(asset.packId) ?? [];
    records.push(asset);
    packAssets.set(asset.packId, records);
  }
  return packs
    .flatMap((pack) => {
      const records = packAssets.get(pack.id) ?? [];
      try {
        const catalog = catalogForPack(pack);
        return [{
          ...pack,
          catalog,
          portraitPool: pack.portraitPool ?? [],
          appearance: normaliseAppearance(
            pack.appearance,
            catalog,
          ),
          assetNames: records.map((asset) => asset.name),
        }];
      } catch {
        // A stale or malformed stored pack must not hide valid packs or the
        // built-in default theme from the settings screen.
        return [];
      }
    })
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.updatedAt - left.updatedAt,
    );
}

export async function createMahjongAssetPack(archive, metadata = {}) {
  const files = await unpackMahjongAssetPack(archive);
  const manifest = await readMahjongAssetPackManifest(files);
  const name = requiredPackName(manifest.name);
  const selected = new Map();
  for (const { group, id, fileName } of catalogAssets(manifest.catalog)) {
    const file = [...files].find((candidate) => candidate.name === fileName);
    if (!file) throw new Error(`theme.json 引用了不存在的素材：${fileName}`);
    const expectedType =
      group === "matchBgm" || group === "riichiBgm" || group === "voices"
        ? "audio/"
        : "image/";
    if (!file.type.startsWith(expectedType))
      throw new Error(
        `${fileName} 不是${expectedType === "audio/" ? "音频" : "图片"}文件`,
      );
    if (file.size > MAX_FILE_SIZE)
      throw new Error(`${fileName} 超过 12 MB 限制`);
    selected.set(assetStorageSlot(group, id), file);
  }
  if (!selected.size) throw new Error("素材包未找到可导入素材");

  if (assetPackStorageUnavailable) {
    return installTransientAssetPack(manifest, selected, metadata);
  }

  let database;
  try {
    database = await openDatabase();
  } catch (error) {
    if (!isAssetStorageUnavailable(error)) throw error;
    return installTransientAssetPack(manifest, selected, metadata);
  }
  const transaction = database.transaction([PACKS, ASSETS], "readwrite");
  const packStore = transaction.objectStore(PACKS);
  const assetStore = transaction.objectStore(ASSETS);
  const currentPacks = await requestPromise(packStore.getAll());
  const now = Date.now();
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `pack-${now}-${Math.random().toString(36).slice(2)}`;
  for (const pack of currentPacks) packStore.put({ ...pack, active: false });
  packStore.put({
    id,
    name,
    active: true,
    catalog: manifest.catalog,
    appearance: manifest.appearance,
    portraitPool: manifest.portraitPool,
    defaultNames: portraitNames(manifest.catalog, manifest.appearance),
    sourceUrl: typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : "",
    createdAt: now,
    updatedAt: now,
  });
  for (const [slot, file] of selected) {
    assetStore.put({
      packId: id,
      slot,
      name: file.name,
      blob: file,
      updatedAt: now,
    });
  }
  await transactionPromise(transaction);
  await refreshActiveAssets();
  return listMahjongAssetPacks();
}

/** Unpack one user-selected ZIP into browser Files without uploading it. */
export async function unpackMahjongAssetPack(archive) {
  if (!archive?.name || typeof archive.arrayBuffer !== "function") {
    throw new Error("请选择一个 .zip 素材包");
  }
  if (!/\.zip$/i.test(archive.name)) {
    throw new Error("素材包必须是 .zip 文件");
  }
  if (Number(archive.size) > MAX_ARCHIVE_SIZE) {
    throw new Error("素材包压缩文件超过 48 MB 限制");
  }

  let entries;
  try {
    entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  } catch {
    throw new Error("无法解压素材包 ZIP");
  }
  const files = Object.entries(entries)
    .filter(([path]) => !path.endsWith("/"))
    .map(
      ([path, bytes]) => new File([bytes], path, { type: fileMimeType(path) }),
    );
  if (!files.length) throw new Error("素材包 ZIP 为空");
  return files;
}

export async function activateMahjongAssetPack(id) {
  if (assetPackStorageUnavailable) {
    if (!transientPack || transientPack.id !== id) throw new Error("找不到该主题包");
    transientPack = { ...transientPack, active: true };
    applyTransientAssets();
    return listTransientAssetPacks();
  }
  const database = await openDatabase();
  const transaction = database.transaction(PACKS, "readwrite");
  const store = transaction.objectStore(PACKS);
  const packs = await requestPromise(store.getAll());
  if (!packs.some((pack) => pack.id === id)) throw new Error("找不到该素材包");
  for (const pack of packs) store.put({ ...pack, active: pack.id === id });
  await transactionPromise(transaction);
  await refreshActiveAssets();
  return listMahjongAssetPacks();
}

/** Persist the active pack's local visual choices without changing room identity. */
export async function configureMahjongAssetPackAppearance(id, appearance) {
  if (assetPackStorageUnavailable) {
    if (!transientPack || transientPack.id !== id) throw new Error("请先启用这个主题包");
    const catalog = transientPack.catalog;
    const nextAppearance = normaliseAppearance(
      appearance,
      catalog,
    );
    transientPack = {
      ...transientPack,
      appearance: nextAppearance,
      assets: resolveAppearanceAssets(
        transientPack.stored,
        nextAppearance,
        catalog,
      ),
    };
    applyTransientAssets();
    return listTransientAssetPacks();
  }
  const database = await openDatabase();
  const transaction = database.transaction(PACKS, "readwrite");
  const packStore = transaction.objectStore(PACKS);
  const packs = await requestPromise(packStore.getAll());
  const pack = packs.find(
    (candidate) => candidate.id === id && candidate.active,
  );
  if (!pack) throw new Error("请先启用这个素材包");
  const catalog = catalogForPack(pack);
  packStore.put({
    ...pack,
    catalog,
    appearance: normaliseAppearance(appearance, catalog),
    updatedAt: Date.now(),
  });
  await transactionPromise(transaction);
  await refreshActiveAssets();
  return listMahjongAssetPacks();
}

/** Stop using uploaded assets while keeping every imported pack available. */
export async function deactivateMahjongAssetPacks() {
  if (assetPackStorageUnavailable) {
    if (transientPack) transientPack = { ...transientPack, active: false };
    applyResolvedAssets(null);
    return listTransientAssetPacks();
  }
  const database = await openDatabase();
  const transaction = database.transaction(PACKS, "readwrite");
  const store = transaction.objectStore(PACKS);
  const packs = await requestPromise(store.getAll());
  for (const pack of packs) store.put({ ...pack, active: false });
  await transactionPromise(transaction);
  await refreshActiveAssets();
  return listMahjongAssetPacks();
}

export async function deleteMahjongAssetPack(id) {
  if (assetPackStorageUnavailable) {
    if (!transientPack || transientPack.id !== id) throw new Error("找不到该主题包");
    transientPack = null;
    applyResolvedAssets(null);
    return listTransientAssetPacks();
  }
  const database = await openDatabase();
  const transaction = database.transaction([PACKS, ASSETS], "readwrite");
  const packStore = transaction.objectStore(PACKS);
  const assetStore = transaction.objectStore(ASSETS);
  const packs = await requestPromise(packStore.getAll());
  const removed = packs.find((pack) => pack.id === id);
  if (!removed) throw new Error("找不到该素材包");
  const remaining = packs.filter((pack) => pack.id !== id);
  const nextActive = removed.active
    ? undefined
    : packs.find((pack) => pack.active)?.id;
  packStore.delete(id);
  for (const pack of remaining)
    packStore.put({ ...pack, active: pack.id === nextActive });
  const assets = await requestPromise(assetStore.getAll());
  for (const asset of assets)
    if (asset.packId === id) assetStore.delete([asset.packId, asset.slot]);
  await transactionPromise(transaction);
  await refreshActiveAssets();
  return listMahjongAssetPacks();
}

async function refreshActiveAssets() {
  if (assetPackStorageUnavailable) {
    applyTransientAssets();
    return;
  }
  const active = await readActivePack();
  applyResolvedAssets(active);
}

function installTransientAssetPack(manifest, stored, metadata) {
  const id = `transient-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  transientPack = {
    id,
    name: manifest.name,
    active: true,
    catalog: manifest.catalog,
    appearance: manifest.appearance,
    portraitPool: manifest.portraitPool,
    defaultNames: portraitNames(manifest.catalog, manifest.appearance),
    sourceUrl: typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : "",
    stored,
    assets: resolveAppearanceAssets(
      stored,
      manifest.appearance,
      manifest.catalog,
    ),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  applyTransientAssets();
  return listTransientAssetPacks();
}

function listTransientAssetPacks() {
  if (!transientPack) return [];
  const { stored, ...pack } = transientPack;
  return [{
    ...pack,
    assetNames: [...stored.values()].map((asset) => asset.name),
  }];
}

function applyTransientAssets() {
  applyResolvedAssets(transientPack?.active ? transientPack : null);
}

function applyResolvedAssets(active) {
  applyPackAssets(active || getMahjongDefaultAssetPack());
}

function applyPackAssets(pack) {
  clearOnlinePortraitUrlCache();
  activePackId = String(pack?.id || "__default__");
  activePortraitCatalog = Array.isArray(pack?.catalog?.portraits)
    ? [...pack.catalog.portraits]
    : [];
  activePortraitPool = Array.isArray(pack?.portraitPool)
    ? [...pack.portraitPool]
    : [];
  activeCharacterVoiceCatalog = Array.isArray(pack?.catalog?.voices)
    ? [...pack.catalog.voices]
    : [];
  activePackStored = pack?.stored instanceof Map ? pack.stored : null;
  if (!activeMatchPortraitRequest) {
    applyActiveAssets(
      pack.assets,
      pack.defaultNames,
      Boolean(pack.catalog.matchBgm.length),
      Boolean(pack.catalog.riichiBgm.length),
      pack.appearance.portraits,
    );
    return;
  }
  const { savedPortraits, randomSeed } = activeMatchPortraitRequest;
  const portraits = resolveMahjongMatchPortraits(
    pack.catalog.portraits,
    savedPortraits,
    pack.appearance.portraits,
    pack.portraitPool,
    randomSeed,
  );
  const appearance = { ...pack.appearance, portraits };
  const assets = pack.stored
    ? resolveAppearanceAssets(pack.stored, appearance, pack.catalog)
    : getMahjongDefaultAssetPack({ portraits }).assets;
  applyActiveAssets(
    assets,
    portraitNames(pack.catalog, appearance),
    Boolean(pack.catalog.matchBgm.length),
    Boolean(pack.catalog.riichiBgm.length),
    portraits,
  );
}

function createOnlinePortraitObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  onlinePortraitObjectUrls.add(url);
  return url;
}

function clearOnlinePortraitUrlCache() {
  for (const url of onlinePortraitObjectUrls) URL.revokeObjectURL(url);
  onlinePortraitObjectUrls.clear();
  onlinePortraitUrls.clear();
  unavailableOnlinePortraits.clear();
  onlineCharacterVoiceUrls.clear();
  unavailableOnlineCharacterVoices.clear();
}

async function readActivePack() {
  const database = await openDatabase();
  const transaction = database.transaction([PACKS, ASSETS], "readonly");
  const [packs, assets] = await Promise.all([
    requestPromise(transaction.objectStore(PACKS).getAll()),
    requestPromise(transaction.objectStore(ASSETS).getAll()),
  ]);
  for (const pack of packs.filter((candidate) => candidate.active)) {
    try {
      const records = assets.filter((asset) => asset.packId === pack.id);
      const catalog = catalogForPack(pack);
      const appearance = normaliseAppearance(
        pack.appearance,
        catalog,
      );
      const stored = new Map(records.map((asset) => [asset.slot, asset]));
      return {
        ...pack,
        catalog,
        appearance,
        defaultNames: portraitNames(catalog, appearance),
        assets: resolveAppearanceAssets(stored, appearance, catalog),
        stored,
      };
    } catch {
      // Treat an invalid active record as absent. The caller will apply the
      // built-in defaults, while a later valid import can replace the record.
    }
  }
  return null;
}

function applyActiveAssets(
  assets,
  defaultNames = {},
  packOverridesMatchMusic = false,
  packOverridesRiichiMusic = false,
  portraits = {},
) {
  for (const [, url] of objectUrls) URL.revokeObjectURL(url);
  objectUrls = new Map();
  activeAssets = new Map();
  activePackOverridesMatchMusic = packOverridesMatchMusic;
  activePackOverridesRiichiMusic = packOverridesRiichiMusic;
  activeDefaultNames =
    defaultNames && typeof defaultNames === "object" ? defaultNames : {};
  activePortraits = portraits && typeof portraits === "object" ? { ...portraits } : {};
  const root = document.documentElement;
  for (const [slot, record] of assets) {
    if (!record?.blob && !record?.url) continue;
    const url = record.blob ? URL.createObjectURL(record.blob) : record.url;
    if (record.blob) objectUrls.set(slot, url);
    activeAssets.set(slot, { ...record, url });
    if (!(slot in MAHJONG_ASSET_SLOTS)) continue;
    root.removeAttribute(`data-mahjong-has-${slot}`);
    root.style.removeProperty(`--mahjong-${slot}-image`);
    root.style.setProperty(`--mahjong-${slot}-image`, `url("${url}")`);
    root.setAttribute(`data-mahjong-has-${slot}`, "");
  }
  for (const slot of Object.keys(MAHJONG_ASSET_SLOTS)) {
    if (assets.has(slot)) continue;
    root.removeAttribute(`data-mahjong-has-${slot}`);
    root.style.removeProperty(`--mahjong-${slot}-image`);
  }
  window.dispatchEvent(new CustomEvent("mahjong:asset-pack-changed"));
}

function openDatabase() {
  if (assetPackStorageUnavailable || !("indexedDB" in globalThis)) {
    assetPackStorageUnavailable = true;
    return Promise.reject(createAssetStorageError());
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(PACKS, { keyPath: "id" });
        request.result.createObjectStore(ASSETS, {
          keyPath: ["packId", "slot"],
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      assetPackStorageUnavailable = true;
      databasePromise = null;
      throw createAssetStorageError(error);
    });
  }
  return databasePromise;
}

function createAssetStorageError(cause) {
  const error = new Error("当前浏览器未开放本机主题包存储");
  error.code = ASSET_STORAGE_UNAVAILABLE;
  if (cause) error.cause = cause;
  return error;
}

function isAssetStorageUnavailable(error) {
  return error?.code === ASSET_STORAGE_UNAVAILABLE;
}

export function requiredPackName(name) {
  const value = String(name || "").trim();
  if (!value) throw new Error("theme.json 必须指定素材包名称（name）");
  if (value.length > 40)
    throw new Error("theme.json 的素材包名称不能超过 40 个字符");
  return value;
}

export async function readMahjongAssetPackManifest(files) {
  const manifestFiles = [...files].filter(
    (file) => basename(file.name).toLowerCase() === "theme.json",
  );
  if (manifestFiles.length !== 1)
    throw new Error("素材包必须且只能包含一个 theme.json");
  const [manifestFile] = manifestFiles;
  try {
    const value = JSON.parse(await manifestFile.text());
    if (!value || typeof value !== "object") throw new Error();
    if (value.schemaVersion !== 1) throw new Error();
    const assets =
      value.assets && typeof value.assets === "object" ? value.assets : {};
    const catalog = catalogFromManifest(assets);
    for (const group of CATALOG_GROUPS) {
      for (const entry of catalog[group]) {
        entry.fileName = resolveManifestAssetPath(
          manifestFile.name,
          entry.fileName,
        );
      }
    }
    for (const voiceSet of catalog.voices) {
      for (const [cue, fileName] of Object.entries(voiceSet.lines)) {
        voiceSet.lines[cue] = resolveManifestAssetPath(
          manifestFile.name,
          fileName,
        );
      }
      for (const [cue, fileName] of Object.entries(voiceSet.yaku ?? {})) {
        voiceSet.yaku[cue] = resolveManifestAssetPath(
          manifestFile.name,
          fileName,
        );
      }
    }
    const portraitPool = normalizeMahjongPortraitPool(
      value.defaults?.portraits?.pool,
      catalog.portraits,
    );
    const appearance = normaliseAppearance(value.defaults, catalog);
    return {
      name: typeof value.name === "string" ? value.name : "",
      catalog,
      portraitPool,
      appearance,
      defaultNames: portraitNames(catalog, appearance),
    };
  } catch {
    throw new Error("theme.json 格式无效");
  }
}

function emptyCatalog() {
  return {
    ...Object.fromEntries(CATALOG_GROUPS.map((group) => [group, []])),
    voices: [],
  };
}

function catalogFromManifest(assets) {
  if (
    Object.keys(assets).some(
      (key) => !CATALOG_GROUPS.includes(key) && key !== "voices",
    )
  ) {
    throw new Error("素材目录包含未知分类");
  }
  const catalog = emptyCatalog();
  addCatalogEntries(catalog.portraits, assets.portraits);
  addCatalogEntries(catalog.tablecloths, assets.tablecloths, {
    supportsFallbackColor: true,
  });
  addCatalogEntries(catalog.tableBackgrounds, assets.tableBackgrounds);
  addCatalogEntries(catalog.lobbyBackgrounds, assets.lobbyBackgrounds);
  addCatalogEntries(catalog.tileBacks, assets.tileBacks);
  addCatalogEntries(catalog.matchBgm, assets.matchBgm);
  addCatalogEntries(catalog.riichiBgm, assets.riichiBgm);
  addVoiceSets(catalog.voices, assets.voices, catalog.portraits);
  if (!catalogAssets(catalog).length) throw new Error("素材包未声明可用素材");
  return catalog;
}

function addVoiceSets(target, voiceSets, portraits) {
  if (voiceSets === undefined) return;
  if (!Array.isArray(voiceSets)) throw new Error("角色语音目录必须是数组");
  for (const voiceSet of voiceSets) {
    const characterId = String(voiceSet?.character || "").trim();
    const lines = voiceSet?.lines ?? {};
    const yaku = voiceSet?.yaku;
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(characterId) ||
      !portraits.some((portrait) => portrait.id === characterId) ||
      typeof lines !== "object" ||
      Array.isArray(lines) ||
      (yaku !== undefined &&
        (!yaku || typeof yaku !== "object" || Array.isArray(yaku)))
    ) {
      throw new Error("角色语音条目无效");
    }
    if (target.some((entry) => entry.characterId === characterId)) {
      throw new Error("角色语音中存在重复角色");
    }
    const normalisedLines = {};
    for (const [cue, fileName] of Object.entries(lines)) {
      if (
        !VOICE_CUES.includes(cue) ||
        typeof fileName !== "string" ||
        !fileName.trim()
      ) {
        throw new Error("角色语音台词无效");
      }
      normalisedLines[cue] = fileName.trim();
    }
    const normalisedYaku = {};
    for (const [cue, fileName] of Object.entries(yaku ?? {})) {
      if (
        !YAKU_VOICE_KEYS.has(cue) ||
        typeof fileName !== "string" ||
        !fileName.trim()
      ) {
        throw new Error("角色报番台词无效");
      }
      normalisedYaku[cue] = fileName.trim();
    }
    if (
      !Object.keys(normalisedLines).length &&
      !Object.keys(normalisedYaku).length
    ) {
      throw new Error("角色语音至少需要一条台词");
    }
    target.push({ characterId, lines: normalisedLines, yaku: normalisedYaku });
  }
}

function addCatalogEntries(target, entries, { supportsFallbackColor = false } = {}) {
  if (entries === undefined) return;
  if (!Array.isArray(entries)) throw new Error("素材目录必须是数组");
  for (const entry of entries) {
    const id = String(entry?.id || "").trim();
    const fileName = entry?.file;
    const label = entry?.label;
    const fallbackColor = normaliseFallbackColor(entry?.fallbackColor);
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(id) ||
      typeof fileName !== "string" ||
      !fileName.trim() ||
      typeof label !== "string" ||
      !label.trim() ||
      label.trim().length > 24 ||
      (entry?.fallbackColor !== undefined &&
        (!supportsFallbackColor || !fallbackColor))
    ) {
      throw new Error("素材目录条目无效");
    }
    if (target.some((entry) => entry.id === id)) {
      throw new Error("素材目录中存在重复 ID");
    }
    target.push({
      id,
      label: label.trim(),
      fileName: fileName.trim(),
      fallbackColor,
    });
  }
}

function normaliseFallbackColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "";
}

function catalogAssets(catalog) {
  return [
    ...CATALOG_GROUPS.flatMap((group) =>
      (catalog?.[group] ?? []).map((entry) => ({
        group,
        id: entry.id,
        fileName: entry.fileName,
      })),
    ),
    ...(catalog?.voices ?? []).flatMap((voiceSet) =>
      Object.entries(voiceSet.lines).map(([cue, fileName]) => ({
        group: "voices",
        id: `${voiceSet.characterId}:${cue}`,
        fileName,
      })),
    ),
    ...(catalog?.voices ?? []).flatMap((voiceSet) =>
      Object.entries(voiceSet.yaku ?? {}).map(([cue, fileName]) => ({
        group: "voices",
        id: `${voiceSet.characterId}:yaku:${cue}`,
        fileName,
      })),
    ),
  ];
}

function assetStorageSlot(group, id) {
  return `${group}:${id}`;
}

function catalogForPack(pack) {
  if (!pack?.catalog || !Array.isArray(pack.catalog.voices)) {
    throw new Error("素材包缺少素材目录");
  }
  const catalog = { ...pack.catalog };
  for (const group of CATALOG_GROUPS) {
    if (Array.isArray(catalog[group])) continue;
    if (group === "lobbyBackgrounds" || group === "riichiBgm") {
      catalog[group] = [];
      continue;
    }
    throw new Error("素材包缺少素材目录");
  }
  return catalog;
}

export function normaliseAppearance(appearance, catalog) {
  const choices =
    appearance && typeof appearance === "object" ? appearance : {};
  const portraits =
    choices.portraits && typeof choices.portraits === "object"
      ? choices.portraits
      : {};
  const pick = (group, requested) => {
    const entries = catalog?.[group] ?? [];
    return entries.some((entry) => entry.id === requested)
      ? requested
      : (entries[0]?.id ?? "");
  };
  return {
    portraits: resolveMahjongPortraitDefaults(
      catalog?.portraits ?? [],
      portraits,
    ),
    tablecloth: pick("tablecloths", choices.tablecloth),
    tableBackground: pick("tableBackgrounds", choices.tableBackground),
    lobbyBackground: pick("lobbyBackgrounds", choices.lobbyBackground),
    tileBack: pick("tileBacks", choices.tileBack),
    matchBgm: choices.matchBgm === "" ? "" : pick("matchBgm", choices.matchBgm),
    riichiBgm: choices.riichiBgm === "" ? "" : pick("riichiBgm", choices.riichiBgm),
    voice: choices.voice !== false,
  };
}

function resolveAppearanceAssets(stored, appearance, catalog) {
  const resolved = new Map();
  for (const position of PORTRAIT_POSITIONS) {
    const id = appearance.portraits[position];
    const record = stored.get(assetStorageSlot("portraits", id));
    if (record) resolved.set(`portrait-${position}`, record);
  }
  if (appearance.voice) {
    const voicesByCharacter = new Map(
      catalog.voices.map((voiceSet) => [voiceSet.characterId, voiceSet]),
    );
    for (const position of PORTRAIT_POSITIONS) {
      const voiceSet = voicesByCharacter.get(appearance.portraits[position]);
      if (!voiceSet) continue;
      for (const [cue] of Object.entries(voiceSet.lines)) {
        const record = stored.get(
          assetStorageSlot("voices", `${voiceSet.characterId}:${cue}`),
        );
        if (record) resolved.set(`voice-${position}:${cue}`, record);
      }
      for (const [cue] of Object.entries(voiceSet.yaku ?? {})) {
        const record = stored.get(
          assetStorageSlot("voices", `${voiceSet.characterId}:yaku:${cue}`),
        );
        if (record) resolved.set(`voice-${position}:yaku:${cue}`, record);
      }
    }
  }
  const staticSelections = [
    ["tablecloth", "tablecloths", appearance.tablecloth],
    ["background", "tableBackgrounds", appearance.tableBackground],
    ["tile-back", "tileBacks", appearance.tileBack],
    ["music", "matchBgm", appearance.matchBgm],
    ["riichi-music", "riichiBgm", appearance.riichiBgm],
  ];
  for (const [slot, group, id] of staticSelections) {
    const record = stored.get(assetStorageSlot(group, id));
    const entry = catalog[group].find((candidate) => candidate.id === id);
    if (record) {
      resolved.set(slot, {
        ...record,
        fallbackColor: entry?.fallbackColor ?? "",
      });
    }
  }
  const lobbyId = appearance.lobbyBackground;
  const lobbyRecord = stored.get(assetStorageSlot("lobbyBackgrounds", lobbyId));
  if (lobbyRecord) resolved.set("lobby", lobbyRecord);
  return resolved;
}

function resolveManifestAssetPath(manifestPath, assetPath) {
  const supplied = String(assetPath).trim();
  if (
    supplied.startsWith("/") ||
    supplied.includes("\\") ||
    supplied
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("素材文件路径无效");
  }
  const directory = String(manifestPath).split("/").slice(0, -1);
  return [...directory, ...supplied.split("/")].join("/");
}

function fileMimeType(name) {
  const extension = basename(name).split(".").at(-1)?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      opus: "audio/ogg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      aac: "audio/aac",
      json: "application/json",
    }[extension] ?? "application/octet-stream"
  );
}

function basename(name) {
  return String(name).split(/[\\/]/).at(-1) ?? "";
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
