import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompletedRoomPaipuRecord,
  hasCompleteRoomPaipuHandSequence,
  mergeRoomPaipuFragmentRecord,
} from "../games/mahjong/replay/room-paipu.js";

const players = [
  { id: "p1", seat: 1 },
  { id: "p2", seat: 2 },
  { id: "p3", seat: 3 },
  { id: "p4", seat: 4 },
];

function hand(index) {
  return {
    index,
    wall: "1m".repeat(136),
    commands: [],
    events: [],
    end: {},
  };
}

test("buildCompletedRoomPaipuRecord carries room presentation data explicitly", () => {
  const paipu = {
    format: "longern.riichi.paipu",
    formatVersion: 1,
    status: "completed",
    game: { mode: "room", matchType: "east" },
    players,
    hands: [hand(0)],
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
  assert.equal(record.roomFragment, true);
});

test("room paipu fragments merge by global hand index", () => {
  const first = buildCompletedRoomPaipuRecord({
    paipu: {
      format: "longern.riichi.paipu",
      formatVersion: 1,
      status: "in_progress",
      game: { mode: "room", matchType: "east", initialScores: [25000, 25000, 25000, 25000] },
      players,
      hands: [hand(0)],
      integrity: { eventCount: 2 },
    },
    matchId: "match-streamed",
    viewerPlayerId: "p1",
    playerPresentations: { p1: { displayName: "Alice" } },
  });
  assert.equal(first.completedAtMs, undefined);

  const progress = mergeRoomPaipuFragmentRecord(null, first);
  assert.equal(progress.status, "in_progress");
  assert.deepEqual(progress.hands.map((entry) => entry.index), [0]);
  assert.equal(progress.roomFragment, undefined);

  const finalFragment = buildCompletedRoomPaipuRecord({
    paipu: {
      format: "longern.riichi.paipu",
      formatVersion: 1,
      status: "completed",
      game: { mode: "room", matchType: "east", initialScores: [25000, 25000, 25000, 25000] },
      players,
      hands: [hand(1)],
      final: { scores: [30000, 25000, 24000, 21000], ranks: [1, 2, 3, 4] },
      integrity: { eventCount: 4 },
    },
    matchId: "match-streamed",
    viewerPlayerId: "p1",
    playerPresentations: { p2: { displayName: "Bob" } },
    completedAtMs: 987654,
  });
  const completed = mergeRoomPaipuFragmentRecord(progress, finalFragment);

  assert.equal(completed.status, "completed");
  assert.equal(completed.completedAtMs, 987654);
  assert.deepEqual(completed.hands.map((entry) => entry.index), [0, 1]);
  assert.deepEqual(completed.playerPresentations, {
    p1: { displayName: "Alice" },
    p2: { displayName: "Bob" },
  });
  assert.equal(hasCompleteRoomPaipuHandSequence(completed), true);
});

test("completed streamed room paipu rejects a missing hand", () => {
  const record = {
    hands: [hand(0), hand(2)],
  };
  assert.equal(hasCompleteRoomPaipuHandSequence(record), false);
});

test("buildCompletedRoomPaipuRecord rejects incomplete room identity", () => {
  assert.equal(buildCompletedRoomPaipuRecord({ paipu: {}, matchId: "" }), null);
  assert.equal(buildCompletedRoomPaipuRecord({ matchId: "match-123" }), null);
});
