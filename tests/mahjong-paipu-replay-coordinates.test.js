import assert from "node:assert/strict";
import { test } from "node:test";

import { mahjongPlayersForViewer } from "../games/mahjong/rules/room-state.js";
import { resolveReplayAction } from "../games/mahjong/replay/replay-utils.js";

test("Mahjong paipu players stay canonical while presentation starts at viewer", () => {
  const players = [
    { seat: 1, id: "east", name: "East" },
    { seat: 2, id: "south", name: "South" },
    { seat: 3, id: "west", name: "West" },
    { seat: 4, id: "north", name: "North" },
  ];

  const presented = mahjongPlayersForViewer(players, "south");
  assert.deepEqual(presented.map((player) => player.id), [
    "south",
    "west",
    "north",
    "east",
  ]);
  assert.deepEqual(players.map((player) => player.id), [
    "east",
    "south",
    "west",
    "north",
  ]);
  assert.deepEqual(players.map((player) => player.seat), [1, 2, 3, 4]);
});

test("semantic claim matching ignores interchangeable normal copies but preserves face identity", () => {
  const actorId = "south";
  const checkpointState = {
    claimants: [{
      playerId: actorId,
      options: [
        { kind: "chi", tileIds: [97, 101] },
        { kind: "chi", tileIds: [97, 89] },
      ],
    }],
  };
  assert.deepEqual(
    resolveReplayAction({ type: "chi", tiles: ["7s", "8s"] }, checkpointState, actorId),
    { type: "claim", option: 1 },
  );
});
