import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SOLO_AI_IDS,
  SOLO_PLAYER_ID,
  applySoloDouDizhuAction,
  chooseSoloDouDizhuAiAction,
  classifySoloDouDizhuCards,
  createSoloDouDizhuState,
  findSoloDouDizhuLegalPlay,
  sortSoloDouDizhuCardsDescending,
} from "../games/dou-dizhu/solo.js";

test("Dou Dizhu solo mode deals one complete deterministic deck", () => {
  const first = createSoloDouDizhuState({ seed: 42 });
  const second = createSoloDouDizhuState({ seed: 42 });
  const cards = [
    ...Object.values(first.hands).flat(),
    ...first.bottomCards,
  ];

  assert.deepEqual(first, second);
  assert.deepEqual(
    Object.values(first.hands).map((hand) => hand.length),
    [17, 17, 17],
  );
  assert.equal(first.bottomCards.length, 3);
  assert.equal(new Set(cards).size, 54);
  assert.deepEqual(
    [...cards].sort((left, right) => left - right),
    Array.from({ length: 54 }, (_, index) => index + 1),
  );
});

test("Dou Dizhu solo rules recognize the supported combination families", () => {
  assert.equal(classifySoloDouDizhuCards([1])?.type, "single");
  assert.equal(classifySoloDouDizhuCards([1, 2])?.type, "pair");
  assert.equal(classifySoloDouDizhuCards([1, 2, 3, 5])?.type, "triple_single");
  assert.equal(
    classifySoloDouDizhuCards([1, 5, 9, 13, 17])?.type,
    "straight",
  );
  assert.equal(
    classifySoloDouDizhuCards([1, 2, 5, 6, 9, 10])?.type,
    "pair_straight",
  );
  assert.equal(classifySoloDouDizhuCards([1, 2, 3, 4])?.type, "bomb");
  assert.equal(classifySoloDouDizhuCards([53, 54])?.type, "rocket");
});

test("Dou Dizhu solo AI chooses a legal smallest response before a bomb", () => {
  const state = createSoloDouDizhuState({ seed: 7 });
  const actorId = SOLO_AI_IDS[0];
  state.phase = "playing";
  state.turnIndex = 2;
  state.landlord = SOLO_PLAYER_ID;
  state.landlordIndex = 1;
  state.hands[actorId] = [9, 13, 17, 18, 19, 20];
  state.lastPlay = {
    playerId: SOLO_PLAYER_ID,
    playerIndex: 1,
    cards: [5],
    type: "single",
    rank: 4,
    size: 1,
  };

  const action = chooseSoloDouDizhuAiAction(state, actorId);
  const result = applySoloDouDizhuAction(state, action, actorId);

  assert.deepEqual(action, { type: "play", cards: [9] });
  assert.equal(result.accepted, true);
  assert.equal(result.state.lastPlay.rank, 5);
});

test("Dou Dizhu detects when a hand has no legal response", () => {
  const previous = { type: "single", rank: 15, size: 1 };
  assert.equal(findSoloDouDizhuLegalPlay([1, 5, 9], previous), undefined);
  assert.deepEqual(findSoloDouDizhuLegalPlay([53], previous), [53]);
});

test("Dou Dizhu display order puts jokers and high cards first", () => {
  assert.deepEqual(
    sortSoloDouDizhuCardsDescending([1, 49, 53, 54, 4]),
    [54, 53, 49, 4, 1],
  );
});

test("Dou Dizhu farmer AI does not overtake its teammate", () => {
  const state = createSoloDouDizhuState({ seed: 9 });
  const actorId = SOLO_AI_IDS[1];
  state.phase = "playing";
  state.turnIndex = 3;
  state.landlord = SOLO_PLAYER_ID;
  state.landlordIndex = 1;
  state.lastPlay = {
    playerId: SOLO_AI_IDS[0],
    playerIndex: 2,
    cards: [1],
    type: "single",
    rank: 3,
    size: 1,
  };

  assert.deepEqual(chooseSoloDouDizhuAiAction(state, actorId), {
    type: "pass",
  });
});

test("Dou Dizhu local AI can finish a complete validated game", () => {
  let state = createSoloDouDizhuState({ seed: 42 });
  let actions = 0;

  while (!state.winner && actions < 300) {
    const actorId = state.players[state.turnIndex - 1];
    const action = chooseSoloDouDizhuAiAction(state, actorId);
    const result = applySoloDouDizhuAction(state, action, actorId);
    assert.equal(result.accepted, true, JSON.stringify({ actorId, action }));
    state = result.state;
    actions += 1;
  }

  assert.ok(state.winner);
  assert.ok(actions < 300);
  assert.equal(state.hands[state.winner].length, 0);
  assert.ok(["landlord", "farmers"].includes(state.winnerTeam));
});
