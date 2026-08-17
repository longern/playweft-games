const DB_NAME = "playweft-mahjong-asset-packs";
const PACKS = "packs";
const ASSETS = "assets";
const MAX_FILE_SIZE = 12 * 1024 * 1024;

export const MAHJONG_ASSET_SLOTS = Object.freeze({
  avatar: "你的默认头像",
  "portrait-self": "自己",
  "portrait-right": "右手边",
  "portrait-opposite": "对家",
  "portrait-left": "左手边",
  background: "牌桌背景",
  tablecloth: "桌布",
  "tile-back": "牌背",
});

let databasePromise;
let activeAssets = new Map();
let objectUrls = new Map();
let activeDefaultNames = {};

export async function initializeMahjongAssetPacks() {
  if (!("indexedDB" in globalThis)) return new Map();
  const active = await readActivePack();
  applyActiveAssets(active?.assets ?? new Map(), active?.defaultNames);
  return active?.assets ?? new Map();
}

export function getMahjongAssetUrl(slot) {
  return activeAssets.get(slot)?.url ?? "";
}

export function getMahjongDefaultNames() {
  return { ...activeDefaultNames };
}

export async function listMahjongAssetPacks() {
  const database = await openDatabase();
  const transaction = database.transaction([PACKS, ASSETS], "readonly");
  const [packs, assets] = await Promise.all([
    requestPromise(transaction.objectStore(PACKS).getAll()),
    requestPromise(transaction.objectStore(ASSETS).getAll()),
  ]);
  const assetNames = new Map();
  for (const asset of assets) {
    const names = assetNames.get(asset.packId) ?? [];
    names.push(asset.name);
    assetNames.set(asset.packId, names);
  }
  return packs
    .map((pack) => ({ ...pack, assetNames: assetNames.get(pack.id) ?? [] }))
    .sort((left, right) => Number(right.active) - Number(left.active) || right.updatedAt - left.updatedAt);
}

export async function createMahjongAssetPack(files, name) {
  const manifest = await readManifest(files);
  const selected = new Map();
  for (const file of files) {
    const slot = slotForFilename(file.name);
    if (!slot) continue;
    if (!file.type.startsWith("image/")) throw new Error(`${file.name} 不是图片文件`);
    if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} 超过 12 MB 限制`);
    selected.set(slot, file);
  }
  for (const [slot, fileName] of Object.entries(manifest.assetFiles ?? {})) {
    const file = [...files].find((candidate) => basename(candidate.name) === basename(fileName));
    if (!file) throw new Error(`theme.json 引用了不存在的头像：${fileName}`);
    if (!file.type.startsWith("image/")) throw new Error(`${fileName} 不是图片文件`);
    selected.set(slot, file);
  }
  if (!selected.size) throw new Error("未找到素材。文件请命名为 avatar、background、tablecloth 或 tile-back。");

  const database = await openDatabase();
  const transaction = database.transaction([PACKS, ASSETS], "readwrite");
  const packStore = transaction.objectStore(PACKS);
  const assetStore = transaction.objectStore(ASSETS);
  const currentPacks = await requestPromise(packStore.getAll());
  const now = Date.now();
  const id = globalThis.crypto?.randomUUID?.() ?? `pack-${now}-${Math.random().toString(36).slice(2)}`;
  for (const pack of currentPacks) packStore.put({ ...pack, active: false });
  packStore.put({
    id,
    name: normaliseName(name || manifest.name),
    active: true,
    defaultNames: manifest.defaultNames,
    createdAt: now,
    updatedAt: now,
  });
  for (const [slot, file] of selected) {
    assetStore.put({ packId: id, slot, name: file.name, blob: file, updatedAt: now });
  }
  await transactionPromise(transaction);
  await refreshActiveAssets();
  return listMahjongAssetPacks();
}

export async function activateMahjongAssetPack(id) {
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

export async function deleteMahjongAssetPack(id) {
  const database = await openDatabase();
  const transaction = database.transaction([PACKS, ASSETS], "readwrite");
  const packStore = transaction.objectStore(PACKS);
  const assetStore = transaction.objectStore(ASSETS);
  const packs = await requestPromise(packStore.getAll());
  const removed = packs.find((pack) => pack.id === id);
  if (!removed) throw new Error("找不到该素材包");
  const remaining = packs.filter((pack) => pack.id !== id);
  const nextActive = removed.active ? remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id : packs.find((pack) => pack.active)?.id;
  packStore.delete(id);
  for (const pack of remaining) packStore.put({ ...pack, active: pack.id === nextActive });
  const assets = await requestPromise(assetStore.getAll());
  for (const asset of assets) if (asset.packId === id) assetStore.delete([asset.packId, asset.slot]);
  await transactionPromise(transaction);
  await refreshActiveAssets();
  return listMahjongAssetPacks();
}

export function slotForFilename(name) {
  const base = basename(name).replace(/\.[^.]+$/, "").toLowerCase().replace(/[ _]+/g, "-");
  if (["avatar", "default-avatar"].includes(base)) return "avatar";
  if (["portrait-self", "portrait-right", "portrait-opposite", "portrait-left"].includes(base)) return base;
  if (["background", "table-background"].includes(base)) return "background";
  if (["tablecloth", "table-cloth", "felt"].includes(base)) return "tablecloth";
  if (["tile-back", "tileback", "back"].includes(base)) return "tile-back";
  return null;
}

async function refreshActiveAssets() {
  const active = await readActivePack();
  applyActiveAssets(active?.assets ?? new Map(), active?.defaultNames);
}

async function readActivePack() {
  const database = await openDatabase();
  const transaction = database.transaction([PACKS, ASSETS], "readonly");
  const [packs, assets] = await Promise.all([
    requestPromise(transaction.objectStore(PACKS).getAll()),
    requestPromise(transaction.objectStore(ASSETS).getAll()),
  ]);
  const pack = packs.find((candidate) => candidate.active);
  if (!pack) return null;
  return { ...pack, assets: new Map(assets.filter((asset) => asset.packId === pack.id).map((asset) => [asset.slot, asset])) };
}

function applyActiveAssets(assets, defaultNames = {}) {
  for (const [, url] of objectUrls) URL.revokeObjectURL(url);
  objectUrls = new Map();
  activeAssets = new Map();
  activeDefaultNames = defaultNames && typeof defaultNames === "object" ? defaultNames : {};
  const root = document.documentElement;
  for (const [slot, record] of assets) {
    root.removeAttribute(`data-mahjong-has-${slot}`);
    root.style.removeProperty(`--mahjong-${slot}-image`);
    if (!record?.blob) continue;
    const url = URL.createObjectURL(record.blob);
    objectUrls.set(slot, url);
    activeAssets.set(slot, { ...record, url });
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
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(PACKS, { keyPath: "id" });
        request.result.createObjectStore(ASSETS, { keyPath: ["packId", "slot"] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

function normaliseName(name) {
  return String(name || "").trim().slice(0, 40) || "新素材包";
}

async function readManifest(files) {
  const manifestFile = [...files].find((file) => basename(file.name).toLowerCase() === "theme.json");
  if (!manifestFile) return {};
  try {
    const value = JSON.parse(await manifestFile.text());
    if (!value || typeof value !== "object") throw new Error();
    if (value.schemaVersion !== 1) throw new Error();
    const assets = value.assets && typeof value.assets === "object" ? value.assets : {};
    const portraitEntries = assets.portraits && typeof assets.portraits === "object" ? assets.portraits : {};
    const assetFiles = {};
    for (const [key, fileName] of Object.entries(portraitEntries)) {
      if (["self", "right", "opposite", "left"].includes(key) && typeof fileName === "string") {
        assetFiles[`portrait-${key}`] = fileName;
      }
    }
    const staticAssets = {
      tablecloth: assets.tablecloth,
      background: assets.background,
      "tile-back": assets.tileBack,
    };
    for (const [slot, fileName] of Object.entries(staticAssets)) {
      if (typeof fileName === "string") assetFiles[slot] = fileName;
    }
    const names = value.defaults?.names;
    const defaultNames = {};
    if (names && typeof names === "object") {
      for (const [slot, displayName] of Object.entries(names)) {
        if (["self", "right", "opposite", "left"].includes(slot) && typeof displayName === "string") {
          const trimmed = displayName.trim().slice(0, 24);
          if (trimmed) defaultNames[slot] = trimmed;
        }
      }
    }
    return { name: typeof value.name === "string" ? value.name : "", assetFiles, defaultNames };
  } catch {
    throw new Error("theme.json 格式无效");
  }
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
