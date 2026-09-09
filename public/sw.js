const VERSION = "v2";
const SHELL_CACHE = `playweft-shell:${VERSION}`;
const RUNTIME_CACHE = `playweft-runtime:${VERSION}`;
const BUILD_METADATA_CACHE = "playweft-build-metadata:v1";
const BUILD_VERSION_REQUEST = "/__playweft-build-version__";
const BUILD_VERSION_PATTERN = /^[a-f0-9]{16}$/;
const DEVELOPMENT_BUILD_VERSION = "development";
const policies = new Map();
const clientPolicies = new Map();
let currentBuildVersion;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("playweft-") &&
              key !== BUILD_METADATA_CACHE &&
              !key.startsWith("playweft-offline:") &&
              !key.endsWith(`:${VERSION}`),
          )
          .map((key) => caches.delete(key)),
      );
    })(),
  ),
);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(handleRequest(request, event.clientId, event));
});

async function handleRequest(request, clientId, event) {
  const gameId = await resolveGameId(request, clientId);
  const isNavigation = request.mode === "navigate";
  if (isNavigation) {
    return navigationNetworkFirst(request, gameId, event);
  }
  if (gameId === "home") return networkFirst(request, SHELL_CACHE);
  const settings =
    clientPolicies.get(clientId) ||
    policies.get(gameId) || {
      mode: "none",
      policy: "network-first",
      buildVersion: await resolveBuildVersion(),
    };
  const cacheName = gameCacheName(gameId, settings.buildVersion);
  if (settings.mode !== "download")
    return networkWithCacheFallback(request, cacheName);
  return settings.policy === "local-first"
    ? localFirst(request, cacheName)
    : networkFirst(request, cacheName);
}

async function resolveGameId(request, clientId) {
  const direct = gameIdFromPath(new URL(request.url).pathname);
  if (direct) return direct;
  if (clientId) {
    const client = await self.clients.get(clientId);
    const fromClient = client && gameIdFromPath(new URL(client.url).pathname);
    if (fromClient) return fromClient;
  }
  return "runtime";
}

function gameIdFromPath(pathname) {
  const match = pathname.match(/^\/([^/]+)(?:\/|$)/);
  if (!match || ["assets", "src", "games"].includes(match[1]))
    return pathname === "/" ? "home" : null;
  return /^[a-z0-9-]+$/.test(match[1]) ? match[1] : null;
}

function gameCacheName(gameId, buildVersion = VERSION) {
  return `playweft-offline:${gameId}:${normalizeBuildVersion(buildVersion)}`;
}

function normalizeBuildVersion(value) {
  const version = String(value || "")
    .trim()
    .toLowerCase();
  return BUILD_VERSION_PATTERN.test(version) ||
    version === DEVELOPMENT_BUILD_VERSION
    ? version
    : VERSION;
}

async function resolveBuildVersion({ refresh = false } = {}) {
  if (currentBuildVersion && !refresh) return currentBuildVersion;
  const metadataCache = await caches.open(BUILD_METADATA_CACHE);
  try {
    const response = await fetch("/build-version.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = normalizeBuildVersion((await response.json())?.version);
    if (value === VERSION) throw new Error("Invalid build version");
    await rememberBuildVersion(value, metadataCache);
    return value;
  } catch {
    const cached = await metadataCache.match(BUILD_VERSION_REQUEST);
    if (cached) {
      const value = normalizeBuildVersion((await cached.json())?.version);
      if (value !== VERSION) return value;
    }
    return currentBuildVersion || VERSION;
  }
}

async function navigationNetworkFirst(request, gameId, event) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      event.waitUntil(cacheNavigationResponse(request, response.clone(), gameId));
    }
    return response;
  } catch {
    const buildVersion = await resolveBuildVersion();
    const cacheName =
      gameId === "home" ? SHELL_CACHE : gameCacheName(gameId, buildVersion);
    const cached = await caches
      .open(cacheName)
      .then((cache) => cache.match(request));
    if (cached) return cached;
    throw new Error("Offline resource unavailable");
  }
}

async function cacheNavigationResponse(request, response, gameId) {
  const buildVersion =
    (await buildVersionFromNavigation(response.clone())) ||
    (await resolveBuildVersion({ refresh: true }));
  const cacheName =
    gameId === "home" ? SHELL_CACHE : gameCacheName(gameId, buildVersion);
  await caches.open(cacheName).then((cache) => cache.put(request, response));
}

async function buildVersionFromNavigation(response) {
  try {
    const source = await response.text();
    const marker = 'meta name="playweft-build-version" content="';
    const start = source.indexOf(marker);
    if (start < 0) return "";
    const valueStart = start + marker.length;
    const valueEnd = source.indexOf('"', valueStart);
    if (valueEnd < 0) return "";
    const value = normalizeBuildVersion(source.slice(valueStart, valueEnd));
    if (value === VERSION) return "";
    await rememberBuildVersion(value);
    return value;
  } catch {
    return "";
  }
}

async function rememberBuildVersion(value, suppliedMetadataCache) {
  const metadataCache =
    suppliedMetadataCache || (await caches.open(BUILD_METADATA_CACHE));
  currentBuildVersion = value;
  await metadataCache.put(
    BUILD_VERSION_REQUEST,
    new Response(JSON.stringify({ version: value }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("Offline resource unavailable");
  }
}

async function networkWithCacheFallback(request, cacheName) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches
      .open(cacheName)
      .then((cache) => cache.match(request));
    if (cached) return cached;
    throw new Error("Offline resource unavailable");
  }
}

async function localFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  return networkFirst(request, cacheName);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "game-offline-settings") {
    const gameId = String(data.gameId || "").trim();
    if (!/^[a-z0-9-]+$/.test(gameId)) return;
    const settings = {
      mode: data.mode === "download" ? "download" : "none",
      policy: data.policy === "local-first" ? "local-first" : "network-first",
      buildVersion: normalizeBuildVersion(data.buildVersion),
    };
    policies.set(gameId, settings);
    if (event.source?.id) clientPolicies.set(event.source.id, settings);
    event.waitUntil(resolveBuildVersion({ refresh: true }));
    return;
  }
  if (data.type === "game-cache-resources") {
    event.waitUntil(cacheResources(data.gameId, data.urls, data.buildVersion));
  }
});

async function cacheResources(gameId, urls, buildVersion) {
  if (!/^[a-z0-9-]+$/.test(String(gameId || ""))) return;
  const cache = await caches.open(gameCacheName(gameId, buildVersion));
  await Promise.all(
    (urls || []).map(async (url) => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) await cache.put(url, response.clone());
      } catch {}
    }),
  );
}
