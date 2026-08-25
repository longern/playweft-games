import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAHJONG_SOLO_SAVE_KEY,
  appendMahjongSoloAction,
  clearMahjongSoloSave,
  createMahjongSoloSave,
  readMahjongSoloSave,
  setMahjongSoloAutoActions,
  setMahjongSoloCheckpoint,
  setMahjongSoloOpponentPortraits,
  writeMahjongSoloSave,
} from "../games/mahjong/replay/solo-save.js";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createSave(overrides = {}) {
  return createMahjongSoloSave({
    randomSeed: "0123456789abcdef0123456789abcdef",
    matchId: "solo-example",
    matchType: "east",
    rules: { multipleRon: true, pao: true },
    playerName: "小满",
    ...overrides,
  });
}

test("mahjong solo saves round-trip a deterministic action log", () => {
  const storage = createStorage();
  const initial = createSave();
  const saved = appendMahjongSoloAction(
    initial,
    { type: "discard", tileId: 41 },
    "human",
  );

  assert.ok(saved);
  assert.equal(initial.actions.length, 0);
  assert.equal(writeMahjongSoloSave(saved, storage), true);
  assert.deepEqual(readMahjongSoloSave(storage), saved);
  assert.equal(
    JSON.parse(storage.getItem(MAHJONG_SOLO_SAVE_KEY)).savedAt > 0,
    true,
  );
});

test("mahjong solo saves retain the three opponent portraits", () => {
  const save = createSave({
    opponentPortraits: { right: "fox", opposite: "wolf", left: "cat" },
  });
  assert.deepEqual(save.opponentPortraits, {
    right: "fox",
    opposite: "wolf",
    left: "cat",
  });
});

test("mahjong solo saves update portraits after a new match reroll", () => {
  const save = createSave({
    opponentPortraits: { right: "fox", opposite: "wolf", left: "cat" },
  });
  const updated = setMahjongSoloOpponentPortraits(save, {
    self: "self",
    right: "panda",
    opposite: "tanuki",
    left: "fox",
  });
  assert.deepEqual(updated?.opponentPortraits, {
    right: "panda",
    opposite: "tanuki",
    left: "fox",
  });
});

test("mahjong solo saves reject corrupt or obsolete records", () => {
  const storage = createStorage();
  storage.setItem(
    MAHJONG_SOLO_SAVE_KEY,
    JSON.stringify({ version: 999, randomSeed: "not-a-seed" }),
  );
  assert.equal(readMahjongSoloSave(storage), null);
  assert.equal(createSave({ randomSeed: "invalid" }), null);
  assert.equal(
    appendMahjongSoloAction(createSave(), { type: "discard" }, 1),
    null,
  );
});

test("mahjong solo saves can be discarded without affecting play", () => {
  const storage = createStorage();
  writeMahjongSoloSave(createSave(), storage);
  clearMahjongSoloSave(storage);
  assert.equal(readMahjongSoloSave(storage), null);
});

test("mahjong solo saves retain per-hand automatic actions", () => {
  const storage = createStorage();
  const save = createSave();
  assert.deepEqual(save.autoActions, {
    autoWin: false,
    passClaims: false,
    autoTsumogiri: false,
  });

  const updated = setMahjongSoloAutoActions(save, {
    autoWin: true,
    passClaims: "yes",
    autoTsumogiri: true,
  });
  assert.ok(updated);
  assert.deepEqual(updated.autoActions, {
    autoWin: true,
    passClaims: false,
    autoTsumogiri: true,
  });
  writeMahjongSoloSave(updated, storage);
  assert.deepEqual(
    readMahjongSoloSave(storage)?.autoActions,
    updated.autoActions,
  );
});

test("mahjong solo saves restore from a validated hand-end checkpoint", () => {
  const first = appendMahjongSoloAction(
    createSave(),
    { type: "discard", tileId: 41 },
    "human",
  );
  const saved = setMahjongSoloCheckpoint(first, {
    formatVersion: 1,
    actionIndex: 1,
    state: { phase: "hand_ended", scores: [25000, 25000, 25000, 25000] },
    events: [{ type: "win" }],
    engineVersion: 1,
    stateVersion: 17,
  });
  assert.ok(saved?.checkpoint);
  assert.equal(saved.checkpoint.actionIndex, 1);
  assert.equal(saved.actions.length, 1);
  assert.deepEqual(
    readMahjongSoloSave({
      getItem() {
        return JSON.stringify(saved);
      },
    })?.checkpoint,
    saved.checkpoint,
  );
});

test("mahjong solo saves ignore malformed checkpoints and retain full replay", () => {
  const saved = createSave({
    actions: [{ action: { type: "discard", tileId: 41 }, actorId: "human" }],
  });
  const storage = createStorage();
  storage.setItem(
    MAHJONG_SOLO_SAVE_KEY,
    JSON.stringify({
      ...saved,
      checkpoint: {
        formatVersion: 1,
        actionIndex: 2,
        state: {},
        events: [],
        engineVersion: 1,
        stateVersion: 1,
      },
    }),
  );
  const restored = readMahjongSoloSave(storage);
  assert.ok(restored);
  assert.equal(restored.checkpoint, null);
  assert.equal(restored.actions.length, 1);
});

test("mahjong solo saves upgrade older action logs without a checkpoint or portraits", () => {
  const storage = createStorage();
  storage.setItem(
    MAHJONG_SOLO_SAVE_KEY,
    JSON.stringify({
      ...createSave({
        actions: [{ action: { type: "discard", tileId: 41 }, actorId: "human" }],
      }),
      version: 1,
    }),
  );
  const restored = readMahjongSoloSave(storage);
  assert.ok(restored);
  assert.equal(restored.version, 3);
  assert.equal(restored.checkpoint, null);
  assert.equal(restored.actions.length, 1);
  assert.deepEqual(restored.opponentPortraits, {
    right: "",
    opposite: "",
    left: "",
  });
});
