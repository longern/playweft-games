import { unzipSync } from "fflate";

const DB_NAME = "playweft-mahjong-asset-packs-v2";
const PACKS = "packs";
const ASSETS = "assets";
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_ARCHIVE_SIZE = 48 * 1024 * 1024;
const PORTRAIT_POSITIONS = ["self", "right", "opposite", "left"];
const CATALOG_GROUPS = ["portraits", "tablecloths", "backgrounds", "tileBacks"];

export const MAHJONG_ASSET_SLOTS = Object.freeze({
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
  const packAssets = new Map();
  for (const asset of assets) {
    const records = packAssets.get(asset.packId) ?? [];
    records.push(asset);
    packAssets.set(asset.packId, records);
  }
  return packs
    .map((pack) => {
      const records = packAssets.get(pack.id) ?? [];
      const catalog = catalogForPack(pack);
      return {
        ...pack,
        catalog,
        appearance: normaliseAppearance(pack.appearance, catalog),
        assetNames: records.map((asset) => asset.name),
      };
    })
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.updatedAt - left.updatedAt,
    );
}

export async function createMahjongAssetPack(archive) {
  const files = await unpackMahjongAssetPack(archive);
  const manifest = await readMahjongAssetPackManifest(files);
  const name = requiredPackName(manifest.name);
  const selected = new Map();
  for (const { group, id, fileName } of catalogAssets(manifest.catalog)) {
    const file = [...files].find((candidate) => candidate.name === fileName);
    if (!file) throw new Error(`theme.json 引用了不存在的素材：${fileName}`);
    if (!file.type.startsWith("image/"))
      throw new Error(`${fileName} 不是图片文件`);
    if (file.size > MAX_FILE_SIZE)
      throw new Error(`${fileName} 超过 12 MB 限制`);
    selected.set(assetStorageSlot(group, id), file);
  }
  if (!selected.size) throw new Error("素材包未找到可导入的图片素材");

  const database = await openDatabase();
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
    defaultNames: manifest.defaultNames,
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
  const database = await openDatabase();
  const transaction = database.transaction(PACKS, "readwrite");
  const packStore = transaction.objectStore(PACKS);
  const packs = await requestPromise(packStore.getAll());
  const pack = packs.find((candidate) => candidate.id === id && candidate.active);
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
  const records = assets.filter((asset) => asset.packId === pack.id);
  const catalog = catalogForPack(pack);
  const appearance = normaliseAppearance(pack.appearance, catalog);
  const stored = new Map(records.map((asset) => [asset.slot, asset]));
  return {
    ...pack,
    catalog,
    appearance,
    assets: resolveAppearanceAssets(stored, appearance),
  };
}

function applyActiveAssets(assets, defaultNames = {}) {
  for (const [, url] of objectUrls) URL.revokeObjectURL(url);
  objectUrls = new Map();
  activeAssets = new Map();
  activeDefaultNames =
    defaultNames && typeof defaultNames === "object" ? defaultNames : {};
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
        request.result.createObjectStore(ASSETS, {
          keyPath: ["packId", "slot"],
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
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
        entry.fileName = resolveManifestAssetPath(manifestFile.name, entry.fileName);
      }
    }
    const names = value.defaults?.names;
    const defaultNames = {};
    if (names && typeof names === "object") {
      for (const [slot, displayName] of Object.entries(names)) {
        if (
          PORTRAIT_POSITIONS.includes(slot) &&
          typeof displayName === "string"
        ) {
          const trimmed = displayName.trim().slice(0, 24);
          if (trimmed) defaultNames[slot] = trimmed;
        }
      }
    }
    return {
      name: typeof value.name === "string" ? value.name : "",
      catalog,
      appearance: normaliseAppearance(value.defaults?.appearance, catalog),
      defaultNames,
    };
  } catch {
    throw new Error("theme.json 格式无效");
  }
}

function emptyCatalog() {
  return Object.fromEntries(CATALOG_GROUPS.map((group) => [group, []]));
}

function catalogFromManifest(assets) {
  if (Object.keys(assets).some((key) => !CATALOG_GROUPS.includes(key))) {
    throw new Error("素材目录包含未知分类");
  }
  const catalog = emptyCatalog();
  addCatalogEntries(catalog.portraits, assets.portraits);
  addCatalogEntries(catalog.tablecloths, assets.tablecloths);
  addCatalogEntries(catalog.backgrounds, assets.backgrounds);
  addCatalogEntries(catalog.tileBacks, assets.tileBacks);
  if (!catalogAssets(catalog).length) throw new Error("素材包未声明可用素材");
  return catalog;
}

function addCatalogEntries(target, entries) {
  if (entries === undefined) return;
  if (!Array.isArray(entries)) throw new Error("素材目录必须是数组");
  for (const entry of entries) {
    const id = String(entry?.id || "").trim();
    const fileName = entry?.file;
    const label = entry?.label;
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(id) ||
      typeof fileName !== "string" ||
      !fileName.trim() ||
      typeof label !== "string" ||
      !label.trim() ||
      label.trim().length > 24
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
    });
  }
}

function catalogAssets(catalog) {
  return CATALOG_GROUPS.flatMap((group) =>
    (catalog?.[group] ?? []).map((entry) => ({
      group,
      id: entry.id,
      fileName: entry.fileName,
    })),
  );
}

function assetStorageSlot(group, id) {
  return `${group}:${id}`;
}

function catalogForPack(pack) {
  if (!pack?.catalog || !CATALOG_GROUPS.every((group) => Array.isArray(pack.catalog[group]))) {
    throw new Error("素材包缺少素材目录");
  }
  return pack.catalog;
}

export function normaliseAppearance(appearance, catalog) {
  const choices = appearance && typeof appearance === "object" ? appearance : {};
  const portraits = choices.portraits && typeof choices.portraits === "object"
    ? choices.portraits
    : {};
  const pick = (group, requested) => {
    const entries = catalog?.[group] ?? [];
    return entries.some((entry) => entry.id === requested)
      ? requested
      : entries[0]?.id ?? "";
  };
  return {
    portraits: Object.fromEntries(
      PORTRAIT_POSITIONS.map((position) => [
        position,
        pick("portraits", portraits[position]),
      ]),
    ),
    tablecloth: pick("tablecloths", choices.tablecloth),
    background: pick("backgrounds", choices.background),
    tileBack: pick("tileBacks", choices.tileBack),
  };
}

function resolveAppearanceAssets(stored, appearance) {
  const resolved = new Map();
  for (const position of PORTRAIT_POSITIONS) {
    const id = appearance.portraits[position];
    const record = stored.get(assetStorageSlot("portraits", id));
    if (record) resolved.set(`portrait-${position}`, record);
  }
  const staticSelections = [
    ["tablecloth", "tablecloths", appearance.tablecloth],
    ["background", "backgrounds", appearance.background],
    ["tile-back", "tileBacks", appearance.tileBack],
  ];
  for (const [slot, group, id] of staticSelections) {
    const record = stored.get(assetStorageSlot(group, id));
    if (record) resolved.set(slot, record);
  }
  return resolved;
}

function resolveManifestAssetPath(manifestPath, assetPath) {
  const supplied = String(assetPath).trim();
  if (
    supplied.startsWith("/") ||
    supplied.includes("\\") ||
    supplied.split("/").some((segment) => !segment || segment === "." || segment === "..")
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
