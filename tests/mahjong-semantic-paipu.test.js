import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLocalLuaGame } from "../src/local-lua-game.js";
import { resolveReplayAction } from "../games/mahjong/replay/replay-utils.js";

const PLAYERS = ["east", "south", "west", "north"].map((id) => ({ id, name: id }));

test("semantic chi ignores interchangeable normal tile identity", () => {
  const state = {
    claimants: [{
      playerId: "north",
      options: [{ kind: "chi", tileIds: [97, 101] }], // 7s + first normal 8s
    }],
  };
  assert.deepEqual(
    resolveReplayAction({ type: "chi", tiles: ["7s", "8s"] }, state, "north"),
    { type: "claim", option: 1 },
  );
});

test("788s can replay 78s chi on 9s and then discard the remaining 8s", async (t) => {
  const source = await readFile("games/mahjong/game.lua", "utf8");
  t.mock.method(globalThis, "fetch", async () => new Response(source));
  const game = await createLocalLuaGame({
    sourceUrl: "https://games.example.test/mahjong/game.lua",
    players: PLAYERS,
    playerId: "north",
    randomSeed: "0000000000000000000000000000002a",
    matchId: "semantic-chi-788s",
  });
  t.after(() => game.close());

  const checkpoint = game.checkpoint();
  const state = checkpoint.state;
  const actor = "north";
  const discarder = "west";
  state.phase = "claiming";
  state.turnIndex = 3;
  state.drawnTile = 0;
  state.hands[actor] = [1, 5, 9, 13, 21, 25, 29, 37, 41, 49, 97, 101, 104];
  state.melds[actor] = [];
  state.discards[discarder] = [{ tile: 105, claimed: false, riichi: false, tsumogiri: false }];
  state.lastDiscard = { player: discarder, playerIndex: 3, tile: 105, discardIndex: 1 };
  state.claimants = [{
    playerId: actor,
    playerIndex: 4,
    distance: 1,
    options: [{ kind: "chi", tileIds: [97, 101] }],
    ronOpportunity: false,
  }];
  state.claimResponses = [];
  state.claimIndex = 1;
  state.kuikaeForbidden[actor] = {};
  game.restoreCheckpoint(checkpoint, actor);

  let current = game.checkpoint().state;
  const claim = resolveReplayAction({ type: "chi", tiles: ["7s", "8s"] }, current, actor);
  assert.equal(game.action(claim, actor).accepted, true);

  current = game.checkpoint().state;
  assert.equal(current.phase, "playing");
  assert.equal(current.turnIndex, 4);
  assert.ok(current.hands[actor].includes(104), "the other normal 8s should remain concealed");

  const discard = resolveReplayAction({ type: "discard", tile: "8s", tsumogiri: false }, current, actor);
  assert.equal(discard.tileId, 104);
  assert.equal(game.action(discard, actor).accepted, true);

  const record = game.exportPaipu();
  assert.equal(record.formatVersion, 3);
  const semantic = record.hands[0].commands.slice(-2).map((entry) => entry.action);
  assert.deepEqual(semantic[0], { type: "chi", tiles: ["7s", "8s"] });
  assert.deepEqual(semantic[1], { type: "discard", tile: "8s", tsumogiri: false });
  assert.equal(JSON.stringify(record).includes('"ref"'), false);
  assert.equal(JSON.stringify(record).includes('"tileId"'), false);
  assert.equal(JSON.stringify(record).includes('"option"'), false);
});
