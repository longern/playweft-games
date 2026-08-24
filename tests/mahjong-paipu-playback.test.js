import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMahjongPaipuTimeline,
  clampPaipuPosition,
  paipuHandIndexAtPosition,
  paipuNextHandPosition,
  paipuPreviousHandPosition,
} from "../games/mahjong/paipu-playback.js";

function recordWithHands(...commandCounts) {
  return {
    hands: commandCounts.map((count, handIndex) => ({
      round: { wind: 1, number: handIndex + 1 },
      commands: Array.from({ length: count }, (_, commandIndex) => ({
        seat: 1,
        action: { type: "discard", tile: { ref: commandIndex } },
      })),
    })),
  };
}

test("paipu playback starts at the deal-in and inserts an explicit next-hand step", () => {
  const timeline = buildMahjongPaipuTimeline(recordWithHands(2, 1));

  assert.equal(timeline.steps.length, 4);
  assert.deepEqual(timeline.handStarts, [0, 3]);
  assert.equal(timeline.steps[0].kind, "action");
  assert.equal(timeline.steps[2].kind, "next-hand");
  assert.equal(paipuHandIndexAtPosition(timeline, 0), 0);
  assert.equal(paipuHandIndexAtPosition(timeline, 2), 0);
  assert.equal(paipuHandIndexAtPosition(timeline, 3), 1);
});

test("paipu playback navigation lands on complete hand starts without leaving its bounds", () => {
  const timeline = buildMahjongPaipuTimeline(recordWithHands(2, 1, 3));

  assert.equal(paipuNextHandPosition(timeline, 0), 3);
  assert.equal(paipuNextHandPosition(timeline, 4), 5);
  assert.equal(paipuPreviousHandPosition(timeline, 5), 3);
  assert.equal(paipuPreviousHandPosition(timeline, 3), 0);
  assert.equal(clampPaipuPosition(timeline, -20), 0);
  assert.equal(clampPaipuPosition(timeline, 999), timeline.steps.length);
});

test("paipu playback rejects a hand without a command log", () => {
  assert.throws(
    () => buildMahjongPaipuTimeline({ hands: [{}] }),
    /invalid command log/,
  );
});
