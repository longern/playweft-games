import assert from "node:assert/strict";
import { test } from "node:test";

import { HUMAN_ID, PLAYERS } from "../games/mahjong/rules/constants.js";
import { seatWind } from "../games/mahjong/rules/game-format.js";
import { orientMahjongRoomProjection } from "../games/mahjong/rules/room-state.js";
import {
  mahjongCanonicalSeatForPresentation,
  mahjongOpeningDealerSeat,
  mahjongPlayersByOpeningWind,
  mahjongPlayersForViewer,
  mahjongPresentationSeat,
} from "../games/mahjong/rules/seat-order.js";

test("seat mapping converts canonical seats only at the presentation boundary", () => {
  assert.equal(mahjongPresentationSeat(1, 3), 3);
  assert.equal(mahjongPresentationSeat(2, 3), 4);
  assert.equal(mahjongCanonicalSeatForPresentation(1, 3), 3);
  assert.equal(mahjongCanonicalSeatForPresentation(4, 3), 2);
});

test("solo opening dealer draw matches the historical deterministic seed rule", () => {
  assert.equal(mahjongOpeningDealerSeat("0123456789abcdef0123456789abcdef"), 1);
  assert.equal(mahjongOpeningDealerSeat("ffffffffffffffffffffffffffffffff"), 2);
  assert.equal(mahjongOpeningDealerSeat("1234567890abcdef1234567890abcdef"), 3);
  assert.equal(mahjongOpeningDealerSeat("00000000000000000000000000000000"), 4);
});

test("solo players are stored as opening East South West North while viewer order stays stable", () => {
  const canonical = mahjongPlayersByOpeningWind(PLAYERS, 3);
  assert.deepEqual(canonical.map((player) => player.id), [
    "mahjong-ai-2",
    "mahjong-ai-3",
    HUMAN_ID,
    "mahjong-ai-1",
  ]);
  assert.deepEqual(
    mahjongPlayersForViewer(canonical, HUMAN_ID).map((player) => player.id),
    PLAYERS.map((player) => player.id),
  );
});

test("canonical solo projection preserves seats and annotates the viewer", () => {
  const canonicalPlayers = [
    "mahjong-ai-2",
    "mahjong-ai-3",
    HUMAN_ID,
    "mahjong-ai-1",
  ];
  const projection = {
    state: {
      players: canonicalPlayers,
      playerNames: ["B", "C", "You", "A"],
      scores: [25000, 25000, 25000, 25000],
      scoreHistory: [],
      initialDealerIndex: 1,
      dealerIndex: 1,
      turnIndex: 1,
      responseIndex: 0,
      drawnPlayerIndex: 1,
      melds: {},
      results: [],
      ownHand: [1, 2, 3],
    },
    events: [],
  };

  const ui = orientMahjongRoomProjection(projection, HUMAN_ID);
  assert.deepEqual(ui.state.players, canonicalPlayers);
  assert.equal(ui.state.dealerIndex, 1);
  assert.equal(ui.viewer.seat, 3);
  assert.equal(seatWind(ui.state, 1), "東");
  assert.deepEqual(ui.state.ownHand, [1, 2, 3]);
  assert.deepEqual(projection.state.players, canonicalPlayers);
});
