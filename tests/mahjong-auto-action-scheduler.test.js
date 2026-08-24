import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMahjongAutoActionScheduler,
  shouldScheduleMahjongAiTurn,
} from "../games/mahjong/rules/auto-action-scheduler.js";

function createTimers() {
  const callbacks = new Map();
  let nextId = 0;
  return {
    setTimeout(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      callbacks.delete(id);
    },
    callback(id) {
      return callbacks.get(id);
    },
  };
}

test("manual win cancels an already queued automatic win", () => {
  const timers = createTimers();
  const scheduler = createMahjongAutoActionScheduler(timers);
  const actions = [];

  scheduler.schedule(() => actions.push("automatic-tsumo"), 240);
  const queuedAutoWin = timers.callback(1);
  scheduler.cancel(); // The player clicks 和 before the automatic delay ends.
  queuedAutoWin();

  assert.deepEqual(actions, []);
});

test("only the newest queued automatic action can act", () => {
  const timers = createTimers();
  const scheduler = createMahjongAutoActionScheduler(timers);
  const actions = [];

  scheduler.schedule(() => actions.push("stale"), 240);
  const stale = timers.callback(1);
  scheduler.schedule(() => actions.push("current"), 240);
  const current = timers.callback(2);
  stale();
  current();

  assert.deepEqual(actions, ["current"]);
});

test("mahjong scheduler retains the timer host for embedded browser APIs", () => {
  const callbacks = new Map();
  const timerHost = {
    nextId: 0,
    setTimeout(callback) {
      assert.equal(this, timerHost);
      const id = ++this.nextId;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      assert.equal(this, timerHost);
      callbacks.delete(id);
    },
  };
  const scheduler = createMahjongAutoActionScheduler(timerHost);
  const actions = [];

  scheduler.schedule(() => actions.push("first"), 240);
  scheduler.cancel();
  scheduler.schedule(() => actions.push("second"), 240);
  callbacks.get(2)();

  assert.deepEqual(actions, ["second"]);
});

test("mahjong lets the worker advance an earlier AI claim before a local claim option", () => {
  assert.equal(
    shouldScheduleMahjongAiTurn({
      phase: "claiming",
      responseIndex: 1,
      turnIndex: 4,
    }),
    true,
  );
  assert.equal(
    shouldScheduleMahjongAiTurn({ phase: "playing", turnIndex: 1 }),
    false,
  );
});
