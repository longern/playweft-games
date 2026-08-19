import assert from "node:assert/strict";
import { test } from "node:test";

import { mahjongInitialEntry } from "../games/mahjong/entry-flow.js";

test("mahjong only resumes a local save for a solo entry", () => {
  assert.equal(mahjongInitialEntry("solo", true), "resume");
  assert.equal(mahjongInitialEntry("solo", false), "setup");
  assert.equal(mahjongInitialEntry("room", true), "setup");
  assert.equal(mahjongInitialEntry(undefined, true), "setup");
});
