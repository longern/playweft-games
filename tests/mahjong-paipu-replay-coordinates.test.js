import assert from "node:assert/strict";
import { test } from "node:test";

import { mahjongPlayersForViewer } from "../games/mahjong/rules/room-state.js";
import {
  replayAction,
  resolveReplayClaimAction,
} from "../games/mahjong/replay/replay-utils.js";

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

test("recorded claim wall refs resolve the current engine option instead of trusting its old index", () => {
  const replayTileIds = Array.from({ length: 136 }, (_, index) => index + 1001);
  const recorded = replayAction(
    {
      type: "claim",
      option: 1,
      paipuClaim: {
        kind: "pon",
        tiles: [{ ref: 12 }, { ref: 44 }],
      },
    },
    replayTileIds,
  );

  const actorId = "south";
  const checkpointState = {
    claimants: [
      {
        playerId: actorId,
        options: [
          { kind: "pon", tileIds: [9991, 9992] },
          { kind: "pon", tileIds: [replayTileIds[44], replayTileIds[12]] },
        ],
      },
    ],
  };

  const resolved = resolveReplayClaimAction(recorded, checkpointState, actorId);
  assert.equal(resolved.option, 2);
  assert.equal(resolved.paipuClaim, undefined);
});

test("legacy claim commands without stable refs remain replayable by their recorded option", () => {
  const action = { type: "claim", option: 3 };
  assert.deepEqual(resolveReplayClaimAction(action, {}, "south"), action);
});
