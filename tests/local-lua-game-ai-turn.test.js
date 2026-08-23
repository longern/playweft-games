import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createLocalLuaGame } from "../src/local-lua-game.js";

const HUMAN_ID = "human";
const PLAYERS = [
  { id: HUMAN_ID, name: "你" },
  { id: "ai-1", name: "一号" },
  { id: "ai-2", name: "二号" },
  { id: "ai-3", name: "三号" },
];

const seedFor = (value) => value.toString(16).padStart(32, "0");

async function createGame(t, seed, sourceOverride) {
  const source = sourceOverride ?? await readFile("games/mahjong/game.lua", "utf8");
  t.mock.method(globalThis, "fetch", async () => new Response(source));
  return createLocalLuaGame({
    sourceUrl: "https://games.example.test/mahjong/game.lua",
    players: PLAYERS,
    playerId: HUMAN_ID,
    randomSeed: seedFor(seed),
    matchId: `match-${seed}`,
  });
}

function luaTableValues(value) {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

test("local Mahjong runtime derives the active AI from its authoritative state", async (t) => {
  let game;
  let projection;
  for (let seed = 1; seed <= 16; seed += 1) {
    game = await createGame(t, seed);
    projection = game.view(HUMAN_ID);
    if (projection.state.turnIndex !== 1) break;
    game.close();
    game = undefined;
  }
  t.after(() => game?.close());

  assert.ok(game, "a deterministic seed should give an AI the opening turn");
  const expectedActor = projection.state.players[projection.state.turnIndex - 1];
  const outcome = game.aiTurn(HUMAN_ID);

  assert.equal(outcome.status, "acted");
  assert.equal(outcome.actorId, expectedActor);
  assert.equal(outcome.result.accepted, true);
  assert.equal(outcome.projection.state.moveCount, projection.state.moveCount + 1);
});

test("local Mahjong runtime leaves a human turn untouched", async (t) => {
  let game;
  for (let seed = 1; seed <= 16; seed += 1) {
    game = await createGame(t, seed);
    if (game.view(HUMAN_ID).state.turnIndex === 1) break;
    game.close();
    game = undefined;
  }
  t.after(() => game?.close());

  assert.ok(game, "a deterministic seed should give the human the opening turn");
  const before = game.view(HUMAN_ID);
  const outcome = game.aiTurn(HUMAN_ID);

  assert.equal(outcome.status, "waiting_for_human");
  assert.equal(outcome.actorId, HUMAN_ID);
  assert.equal(outcome.projection.state.moveCount, before.state.moveCount);
});

test("local Mahjong authority advances every AI turn without a page-selected actor", async (t) => {
  const game = await createGame(t, 12_345);
  t.after(() => game.close());
  let projection = game.view(HUMAN_ID);
  let steps = 0;

  while (projection.state.phase !== "hand_ended" && steps < 500) {
    const outcome = game.aiTurn(HUMAN_ID);
    if (outcome.status === "waiting_for_human") {
      const action =
        outcome.projection.state.phase === "claiming"
          ? { type: "pass" }
          : {
              type: "discard",
              tileId:
                Number(outcome.projection.state.drawnTile) ||
                outcome.projection.state.ownHand[0],
            };
      assert.equal(game.action(action, HUMAN_ID).accepted, true);
      projection = game.view(HUMAN_ID);
    } else {
      assert.equal(outcome.status, "acted");
      assert.equal(outcome.result.accepted, true);
      projection = outcome.projection;
    }
    steps += 1;
  }

  assert.equal(projection.state.phase, "hand_ended");
  assert.ok(steps > 20 && steps < 500);
});

test("local Mahjong completes a human ron and restores its terminal checkpoint", async (t) => {
  const source = await readFile("games/mahjong/game.lua", "utf8");
  const preparedRonSource = `${source}
    local original_setup = setup
    function setup(context)
      local state = original_setup(context)
      local function ids(types)
        local copies, tiles = {}, {}
        for _, kind in ipairs(types) do
          copies[kind] = (copies[kind] or 0) + 1
          tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
        end
        return tiles
      end
      local human = context.players[1].id
      local discarder = context.players[4].id
      state.hands[human] = ids({ 1,2, 4,5,6, 10,11,12, 19,20,21, 28,28 })
      state.riichi[human] = true
      local discarder_hand = ids({ 3,4,5, 7,8,9, 13,14,15, 22,23,24, 29, 3 })
      state.drawnTile = table.remove(discarder_hand)
      state.hands[discarder] = discarder_hand
      state.turnIndex = 4
      return on_action(
        state,
        { type = "discard", tileId = state.drawnTile },
        { actor = { id = discarder } }
      ).state
    end`;
  const game = await createGame(t, 1, preparedRonSource);
  t.after(() => game.close());

  const beforeClaim = game.view(HUMAN_ID);
  const ron = luaTableValues(beforeClaim.state.legalActions.claims).find(
    (claim) => claim?.kind === "ron",
  );
  assert.ok(ron, "the human projection should offer a ron claim");

  const won = game.action({ type: "claim", option: ron.option }, HUMAN_ID);
  assert.equal(won.accepted, true);
  const terminal = game.view(HUMAN_ID);
  assert.equal(terminal.state.phase, "hand_ended");
  assert.equal(terminal.state.winType, "ron");

  const snapshot = structuredClone(game.checkpoint());
  const restored = await createGame(t, 1, preparedRonSource);
  t.after(() => restored.close());
  const restoredProjection = restored.restoreCheckpoint(
    {
      state: snapshot.state,
      events: snapshot.events,
      stateVersion: snapshot.version,
    },
    HUMAN_ID,
  );

  assert.equal(restoredProjection.state.phase, "hand_ended");
  assert.equal(restoredProjection.state.winType, "ron");
});
