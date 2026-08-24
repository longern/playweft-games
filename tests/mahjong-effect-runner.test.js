import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongEffectRunner } from "../games/mahjong/app/effect-runner.js";

test("mahjong presentation failures do not prevent later terminal effects", () => {
  const errors = [];
  const rendered = [];
  const effects = createMahjongEffectRunner({
    onError(label, error) {
      errors.push({ label, message: error.message });
    },
  });

  effects.runAll([
    ["match music", () => {
      throw new TypeError("Illegal invocation");
    }],
    ["result render", () => rendered.push("hand_ended")],
  ]);

  assert.deepEqual(rendered, ["hand_ended"]);
  assert.deepEqual(errors, [
    { label: "match music", message: "Illegal invocation" },
  ]);
});
