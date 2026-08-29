import assert from "node:assert/strict";
import test from "node:test";

import { buildCompletedRoomPaipuRecord } from "../games/mahjong/replay/room-paipu.js";

test("buildCompletedRoomPaipuRecord carries room presentation data explicitly", () => {
  const paipu = {
    format: "longern.riichi.paipu",
    formatVersion: 1,
    status: "completed",
    players: [
      { id: "p1", seat: 1 },
      { id: "p2", seat: 2 },
      { id: "p3", seat: 3 },
      { id: "p4", seat: 4 },
    ],
    hands: [{ wall: "1m".repeat(136), commands: [], events: [], end: {} }],
    final: { scores: [25000, 25000, 25000, 25000], ranks: [1, 2, 3, 4] },
  };
  const playerPresentations = {
    p1: { displayName: "Alice" },
  };

  const record = buildCompletedRoomPaipuRecord({
    paipu,
    matchId: "match-123",
    viewerPlayerId: "p1",
    playerPresentations,
    completedAtMs: 123456,
  });

  assert.equal(record.id, "match-123:room");
  assert.equal(record.viewerPlayerId, "p1");
  assert.equal(record.completedAtMs, 123456);
  assert.deepEqual(record.playerPresentations, playerPresentations);
  assert.equal(record.status, "completed");
});

test("buildCompletedRoomPaipuRecord rejects incomplete room identity", () => {
  assert.equal(buildCompletedRoomPaipuRecord({ paipu: {}, matchId: "" }), null);
  assert.equal(buildCompletedRoomPaipuRecord({ matchId: "match-123" }), null);
});
