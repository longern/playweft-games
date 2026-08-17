import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addResponseLatencySample,
  clearImmediateResponseLatency,
  readImmediateResponseLatency,
  recordImmediateResponseLatency,
  shouldMeasureImmediateResponse,
} from "../src/response-latency.js";

test("only simple Mahjong acknowledgements are selected for latency sampling", () => {
  assert.equal(shouldMeasureImmediateResponse({ type: "discard" }), true);
  assert.equal(shouldMeasureImmediateResponse({ type: "claim" }), true);
  assert.equal(shouldMeasureImmediateResponse({ type: "next_hand" }), true);
  assert.equal(shouldMeasureImmediateResponse({ type: "recalculate_scores" }), false);
  assert.equal(shouldMeasureImmediateResponse(), false);
});

test("response latency keeps a bounded in-memory per-action sample history", () => {
  clearImmediateResponseLatency();
  for (let sample = 0; sample < 26; sample += 1) {
    recordImmediateResponseLatency(
      { type: "discard" },
      sample + 0.6,
      { recordedAt: 1000 + sample },
    );
  }

  const snapshot = readImmediateResponseLatency();
  assert.deepEqual(snapshot.actions.discard.samples, Array.from({ length: 24 }, (_, index) => index + 3));
  assert.equal(snapshot.actions.discard.lastMs, 26);
  assert.equal(snapshot.actions.discard.meanMs, 15);
  assert.equal(snapshot.actions.discard.updatedAt, 1025);
});

test("invalid and non-immediate samples do not enter the persisted snapshot", () => {
  const initial = addResponseLatencySample(undefined, "discard", 48, 100);
  const ignored = addResponseLatencySample(initial, "recalculate_scores", 600, 101);
  const invalid = addResponseLatencySample(initial, "discard", -1, 101);
  assert.deepEqual(ignored, initial);
  assert.deepEqual(invalid, initial);
});
