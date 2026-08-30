import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMahjongCompletedPaipuSaver } from "../games/mahjong/replay/completed-paipu.js";
import {
  buildMahjongOnlineSource,
  MAHJONG_ONLINE_SOURCE_LIMIT,
} from "../games/mahjong/room-paipu-online-source.js";

function fragment(handIndex, status = "in_progress") {
  return {
    id: "match-stream:room",
    roomFragment: true,
    status,
    hands: [{ index: handIndex }],
  };
}

test("room paipu saver accepts each hand once and still accepts the final hand", async () => {
  const writes = [];
  const save = createMahjongCompletedPaipuSaver({
    save: async (record) => {
      writes.push([record.hands[0].index, record.status]);
      return { saved: true };
    },
  });

  assert.equal((await save(fragment(0))).saved, true);
  assert.equal((await save(fragment(0))).reason, "duplicate");
  assert.equal((await save(fragment(1))).saved, true);
  assert.equal((await save(fragment(1, "completed"))).saved, true);
  assert.equal((await save(fragment(1, "completed"))).reason, "duplicate");

  assert.deepEqual(writes, [
    [0, "in_progress"],
    [1, "in_progress"],
    [1, "completed"],
  ]);
});

test("production rolling Mahjong room source stays below the Lua source limit", async () => {
  const source = await readFile("games/mahjong/game.lua", "utf8");
  const onlineSource = buildMahjongOnlineSource(source);
  assert.ok(
    Buffer.byteLength(onlineSource) < MAHJONG_ONLINE_SOURCE_LIMIT,
    `rolling room source is ${Buffer.byteLength(onlineSource)} bytes`,
  );
});
