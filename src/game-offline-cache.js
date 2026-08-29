const DEFAULT_MODE = "none";
const DEFAULT_POLICY = "network-first";
const HOME_GAME_ID = "home";
const GAME_ID_PATTERN = /^[a-z0-9-]+$/;

export const MAHJONG_GAME_ID = "mahjong";
export const CACHE_VERSION = "v2";
export const SETTINGS_KEY = "playweft.mahjong.offline-cache-mode";
export const POLICY_KEY = "playweft.mahjong.offline-cache-policy";
export const CACHE_NAME = `playweft-offline:${MAHJONG_GAME_ID}:${CACHE_VERSION}`;

function normalizeGameId(gameId = MAHJONG_GAME_ID) {
  const value = String(gameId || MAHJONG_GAME_ID).trim().toLowerCase();
  return GAME_ID_PATTERN.test(value) ? value : MAHJONG_GAME_ID;
}

export function gameOfflineCacheName(gameId = MAHJONG_GAME_ID) {
  return `playweft-offline:${normalizeGameId(gameId)}:${CACHE_VERSION}`;
}

export function gameOfflineSettingsKeys(gameId = MAHJONG_GAME_ID) {
  const normalized = normalizeGameId(gameId);
  return {
    mode: `playweft.${normalized}.offline-cache-mode`,
    policy: `playweft.${normalized}.offline-cache-policy`,
  };
}

export function readGameOfflineSettings(
  gameId = MAHJONG_GAME_ID,
  storage = globalThis.localStorage,
) {
  const keys = gameOfflineSettingsKeys(gameId);
  let mode = DEFAULT_MODE;
  let policy = DEFAULT_POLICY;
  try {
    mode = ["download", "true"].includes(storage?.getItem(keys.mode))
      ? "download"
      : DEFAULT_MODE;
    policy = storage?.getItem(keys.policy) === "local-first"
      ? "local-first"
      : DEFAULT_POLICY;
  } catch {}
  return { mode, policy };
}

export function writeGameOfflineSettings(
  gameId,
  { mode, policy } = {},
  storage = globalThis.localStorage,
) {
  const keys = gameOfflineSettingsKeys(gameId);
  const next = {
    mode: mode === "download" ? "download" : DEFAULT_MODE,
    policy: policy === "local-first" ? "local-first" : DEFAULT_POLICY,
  };
  try {
    storage?.setItem(keys.mode, next.mode);
    storage?.setItem(keys.policy, next.policy);
  } catch {}
  return next;
}

export async function fetchGameResource(
  url,
  {
    gameId = MAHJONG_GAME_ID,
    mode,
    policy,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const request = new Request(url, { cache: "no-store" });
  const settings = readGameOfflineSettings(gameId);
  const selectedMode = mode || settings.mode;
  const selectedPolicy = policy || settings.policy;
  const cache = typeof caches !== "undefined"
    ? await caches.open(gameOfflineCacheName(gameId))
    : null;
  if (selectedPolicy === "local-first" && cache) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  try {
    const response = await fetchImpl(request);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (cache && selectedMode === "download") await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = cache && await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

export async function cacheGameOfflineResources(
  gameId,
  urls,
  { fetchImpl = globalThis.fetch } = {},
) {
  const cache = await caches.open(gameOfflineCacheName(gameId));
  const results = [];
  for (const url of [...new Set((urls || []).filter(Boolean))]) {
    try {
      const response = await fetchImpl(new Request(url, { cache: "no-store" }));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await cache.put(url, response.clone());
      results.push({ url, ok: true });
    } catch (error) {
      results.push({
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function clearGameOfflineCache(gameId = MAHJONG_GAME_ID) {
  if (typeof caches === "undefined") return false;
  return caches.delete(gameOfflineCacheName(gameId));
}

export async function registerGameOfflineServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export function notifyGameOfflineSettings(
  gameId = MAHJONG_GAME_ID,
  settings = readGameOfflineSettings(gameId),
) {
  const message = {
    type: "game-offline-settings",
    gameId: normalizeGameId(gameId),
    mode: settings.mode === "download" ? "download" : DEFAULT_MODE,
    policy: settings.policy === "local-first" ? "local-first" : DEFAULT_POLICY,
  };
  const controller = navigator.serviceWorker?.controller;
  if (controller) controller.postMessage(message);
  else void navigator.serviceWorker?.ready.then((registration) => {
    registration.active?.postMessage(message);
  });
}

export function gameOfflineResourceUrls(gameId = MAHJONG_GAME_ID, extra = []) {
  const prefix = `/${normalizeGameId(gameId)}/`;
  const current = performance.getEntriesByType?.("resource")
    ?.map((entry) => entry.name)
    .filter((url) => {
      try {
        const parsed = new URL(url, globalThis.location?.href);
        return parsed.origin === globalThis.location?.origin &&
          !parsed.pathname.endsWith("/sw.js");
      } catch {
        return false;
      }
    }) || [];
  return [...new Set([
    `${prefix}`,
    `${prefix}index.html`,
    ...current,
    ...extra,
  ])];
}

// Backward-compatible Mahjong facade for existing callers.
export const readMahjongOfflineSettings = (storage) =>
  readGameOfflineSettings(MAHJONG_GAME_ID, storage);
export const writeMahjongOfflineSettings = (settings, storage) =>
  writeGameOfflineSettings(MAHJONG_GAME_ID, settings, storage);
export const fetchMahjongResource = (url, options) =>
  fetchGameResource(url, { ...options, gameId: MAHJONG_GAME_ID });
export const cacheMahjongOfflineResources = (urls, options) =>
  cacheGameOfflineResources(MAHJONG_GAME_ID, urls, options);
export const clearMahjongOfflineCache = () =>
  clearGameOfflineCache(MAHJONG_GAME_ID);
export const registerMahjongOfflineServiceWorker = registerGameOfflineServiceWorker;
export const notifyMahjongOfflinePolicy = (policy) =>
  notifyGameOfflineSettings(MAHJONG_GAME_ID, {
    ...readMahjongOfflineSettings(),
    policy,
  });
export const mahjongOfflineResourceUrls = (extra) =>
  gameOfflineResourceUrls(MAHJONG_GAME_ID, extra);

export { DEFAULT_MODE, DEFAULT_POLICY, HOME_GAME_ID };
