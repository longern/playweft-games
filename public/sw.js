const VERSION = "v2";
const SHELL_CACHE = `playweft-shell:${VERSION}`;
const RUNTIME_CACHE = `playweft-runtime:${VERSION}`;
const policies = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await self.clients.claim();
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith("playweft-") && !key.endsWith(`:${VERSION}`))
    .map((key) => caches.delete(key)));
})()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(handleRequest(request, event.clientId));
});

async function handleRequest(request, clientId) {
  const gameId = await resolveGameId(request, clientId);
  const isNavigation = request.mode === "navigate";
  if (isNavigation) {
    return networkFirst(request, gameId === "home" ? SHELL_CACHE : gameCacheName(gameId));
  }
  if (gameId === "home") return networkFirst(request, SHELL_CACHE);
  const settings = policies.get(gameId) || { mode: "none", policy: "network-first" };
  if (settings.mode !== "download") return networkWithCacheFallback(request, gameCacheName(gameId));
  return settings.policy === "local-first"
    ? localFirst(request, gameCacheName(gameId))
    : networkFirst(request, gameCacheName(gameId));
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
  if (!match || ["assets", "src", "games"].includes(match[1])) return pathname === "/" ? "home" : null;
  return /^[a-z0-9-]+$/.test(match[1]) ? match[1] : null;
}

function gameCacheName(gameId) {
  return `playweft-offline:${gameId}:${VERSION}`;
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
    const cached = await caches.open(cacheName).then((cache) => cache.match(request));
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
    policies.set(gameId, {
      mode: data.mode === "download" ? "download" : "none",
      policy: data.policy === "local-first" ? "local-first" : "network-first",
    });
    return;
  }
  if (data.type === "game-cache-resources") {
    event.waitUntil(cacheResources(data.gameId, data.urls));
  }
});

async function cacheResources(gameId, urls) {
  if (!/^[a-z0-9-]+$/.test(String(gameId || ""))) return;
  const cache = await caches.open(gameCacheName(gameId));
  await Promise.all((urls || []).map(async (url) => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) await cache.put(url, response.clone());
    } catch {}
  }));
}
