import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createLocalLuaGame } from "../src/local-lua-game.js";
import {
  summarizeMahjongPaipu,
  validateMahjongPaipu,
} from "../games/mahjong/replay/paipu-store.js";

const HUMAN_ID = "human";
const PLAYERS = [
  { id: HUMAN_ID, name: "你" },
  { id: "ai-1", name: "一号" },
  { id: "ai-2", name: "二号" },
  { id: "ai-3", name: "三号" },
];

const seedFor = (value) => value.toString(16).padStart(32, "0");

async function createGame(t, seed) {
  const source = await readFile("games/mahjong/game.lua", "utf8");
  t.mock.method(globalThis, "fetch", async () => new Response(source));
  return createLocalLuaGame({
    sourceUrl: "https://games.example.test/mahjong/game.lua",
    players: PLAYERS,
    playerId: HUMAN_ID,
    randomSeed: seedFor(seed),
    matchId: `paipu-${seed}`,
  });
}

test("mahjong paipu captures a fixed-width full wall and accepted actions", async (t) => {
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
  const tileId = Number(before.state.drawnTile) || before.state.ownHand.at(-1);
  assert.equal(game.action({ type: "discard", tileId }, HUMAN_ID).accepted, true);

  const record = game.exportPaipu();
  const hand = record.hands[0];
  const tiles = hand.wall.match(/../g);
  const command = hand.commands.at(-1);
  const discarded = hand.events.find((event) => event.type === "discarded");

  assert.equal(record.status, "in_progress");
  assert.equal(record.game.randomSeed, undefined);
  assert.equal(tiles.length, 136);
  assert.equal(tiles.filter((tile) => tile === "0m").length, 1);
  assert.equal(tiles.filter((tile) => tile === "5m").length, 3);
  assert.equal(command.seat, 1);
  assert.match(command.action.tile.code, /^(?:[1-9][mps]|0[mps]|[1-7]z)$/);
  assert.ok(Number.isInteger(command.action.tile.ref));
  assert.equal(command.action.tile.id, undefined);
  assert.deepEqual(discarded.tile, command.action.tile);
});

test("mahjong paipu replay uses the saved wall instead of the random seed", async (t) => {
  let sourceGame;
  for (let seed = 1; seed <= 16; seed += 1) {
    sourceGame = await createGame(t, seed);
    if (sourceGame.view(HUMAN_ID).state.turnIndex === 1) break;
    sourceGame.close();
    sourceGame = undefined;
  }
  t.after(() => sourceGame?.close());
  assert.ok(sourceGame);

  const before = sourceGame.view(HUMAN_ID);
  const tileId = Number(before.state.drawnTile) || before.state.ownHand.at(-1);
  assert.equal(sourceGame.action({ type: "discard", tileId }, HUMAN_ID).accepted, true);
  const record = sourceGame.exportPaipu();
  const wall = record.hands[0].wall;
  const replay = await createLocalLuaGame({
    sourceUrl: "https://games.example.test/mahjong/game.lua",
    players: PLAYERS,
    playerId: HUMAN_ID,
    randomSeed: seedFor(99),
    matchId: "paipu-replay",
    settings: {
      matchType: record.game.matchType,
      rules: record.game.rules,
      replayHand: {
        wall,
        round: record.hands[0].round,
        startScores: record.hands[0].startScores,
      },
    },
  });
  t.after(() => replay.close());

  assert.equal(replay.exportPaipu().hands[0].wall, wall);
  const replayTileId = tileIdForRef(wall, record.hands[0].commands[0].action.tile.ref);
  assert.ok(replayTileId > 0);
  assert.equal(replay.action({ type: "discard", tileId: replayTileId }, HUMAN_ID).accepted, true);
  assert.deepEqual(
    replay.exportPaipu().hands[0].commands[0].action.tile,
    record.hands[0].commands[0].action.tile,
  );
});

test("mahjong paipu loads a selected hand into the existing local game", async (t) => {
  const game = await createGame(t, 7);
  t.after(() => game.close());
  const sourceHand = game.exportPaipu().hands[0];
  const matchId = game.matchId;
  const targetHand = {
    wall: sourceHand.wall,
    round: {
      wind: 2,
      number: 4,
      dealerSeat: 3,
      honba: 2,
      riichiSticks: 1,
    },
    startScores: [31800, 24700, 22100, 21400],
  };

  const projection = game.loadReplayHand(targetHand, HUMAN_ID);

  assert.equal(game.matchId, matchId);
  assert.equal(projection.state.roundWind, targetHand.round.wind);
  assert.equal(projection.state.handNumber, targetHand.round.number);
  assert.equal(projection.state.dealerIndex, targetHand.round.dealerSeat);
  assert.equal(projection.state.honba, targetHand.round.honba);
  assert.equal(projection.state.riichiSticks, targetHand.round.riichiSticks);
  assert.deepEqual(projection.state.scores, targetHand.startScores);
  assert.equal(projection.state.wallCount, 69);
});

test("mahjong paipu storage accepts completed records and derives a history summary", () => {
  const wall = "1m".repeat(4) + "2m".repeat(132);
  const record = {
    format: "longern.riichi.paipu",
    formatVersion: 1,
    id: "solo-example:1",
    status: "completed",
    completedAtMs: 1_780_000_000_000,
    game: { matchType: "east" },
    players: PLAYERS.map((player, index) => ({
      seat: index + 1,
      id: player.id,
      name: player.name,
      kind: index === 0 ? "human" : "ai",
    })),
    hands: [{ wall, commands: [], events: [], end: {} }],
    final: { scores: [32000, 26000, 23000, 19000], ranks: [1, 2, 3, 4] },
  };

  const valid = validateMahjongPaipu(record);
  const summary = summarizeMahjongPaipu(valid);

  assert.deepEqual(summary.finalScores, record.final.scores);
  assert.equal(summary.playerName, "你");
  assert.equal(summary.rank, 1);
  assert.equal(summary.handCount, 1);
  assert.throws(
    () => validateMahjongPaipu({ ...record, status: "in_progress" }),
    /completed Mahjong paipu/,
  );
});

function tileIdForRef(wall, ref) {
  const available = new Map();
  for (let tileId = 1; tileId <= 136; tileId += 1) {
    const code = tileCode(tileId);
    const ids = available.get(code) || [];
    ids.push(tileId);
    available.set(code, ids);
  }
  const tiles = [];
  for (let offset = 0; offset < wall.length; offset += 2) {
    const code = wall.slice(offset, offset + 2);
    tiles.push(available.get(code).shift());
  }
  return tiles[ref];
}

function tileCode(tileId) {
  if (tileId === 17) return "0m";
  if (tileId === 53) return "0p";
  if (tileId === 89) return "0s";
  const kind = Math.floor((tileId - 1) / 4) + 1;
  if (kind <= 27) return `${((kind - 1) % 9) + 1}${["m", "p", "s"][Math.floor((kind - 1) / 9)]}`;
  return `${kind - 27}z`;
}
