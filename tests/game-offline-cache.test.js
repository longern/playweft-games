import assert from "node:assert/strict";
import test from "node:test";

import {
  gameOfflineCacheName,
  readBuildContentVersion,
  readGameOfflineSettings,
  writeGameOfflineSettings,
} from "../src/game-offline-cache.js";

function buildDocument(version) {
  return {
    querySelector(selector) {
      assert.equal(selector, 'meta[name="playweft-build-version"]');
      return { getAttribute: () => version };
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("offline cache names follow the current build content version", () => {
  const version = "0123456789abcdef";
  assert.equal(readBuildContentVersion(buildDocument(version)), version);
  assert.equal(
    gameOfflineCacheName("mahjong", version),
    `playweft-offline:mahjong:${version}`,
  );
});

test("offline download settings retain the cached build version", () => {
  const storage = memoryStorage();
  const version = "fedcba9876543210";
  assert.deepEqual(
    writeGameOfflineSettings(
      "mahjong",
      { mode: "download", policy: "local-first", version },
      storage,
    ),
    { mode: "download", policy: "local-first", version },
  );
  assert.deepEqual(readGameOfflineSettings("mahjong", storage), {
    mode: "download",
    policy: "local-first",
    version,
  });
});
