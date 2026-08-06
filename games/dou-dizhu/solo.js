const RANDOM_MODULUS = 2147483647;
const RANDOM_MULTIPLIER = 48271;

export const SOLO_PLAYER_ID = "solo-player-1";
export const SOLO_AI_IDS = ["solo-ai-1", "solo-ai-2"];

const SOLO_PLAYERS = [SOLO_PLAYER_ID, ...SOLO_AI_IDS];

export function createSoloDouDizhuState({
  seed = Date.now(),
  round = 1,
  starter = 1,
} = {}) {
  return newRound([...SOLO_PLAYERS], seed, round, starter);
}

export function applySoloDouDizhuAction(sourceState, action, actorId) {
  const state = structuredClone(sourceState);
  if (!action || typeof action !== "object") return rejected("INVALID_ACTION");
  const index = state.players.indexOf(actorId);
  if (index < 0) return rejected("NOT_A_PLAYER");

  if (action.type === "rematch") {
    if (!state.winner) return rejected("GAME_NOT_OVER");
    const starter = (state.starter % state.players.length) + 1;
    return accepted(
      newRound(
        state.players,
        state.seed,
        Number(state.round || 1) + 1,
        starter,
      ),
      [{ type: "rematched", player: actorId }],
    );
  }

  if (state.winner) return rejected("GAME_OVER");
  if (index + 1 !== state.turnIndex) return rejected("NOT_YOUR_TURN");

  if (state.phase === "bidding") {
    return applyBid(state, action, actorId, index);
  }
  if (state.phase !== "playing") return rejected("INVALID_PHASE");
  if (action.type === "pass") return applyPass(state, actorId, index);
  if (action.type !== "play") return rejected("INVALID_ACTION");
  return applyPlay(state, action.cards, actorId, index);
}

export function chooseSoloDouDizhuAiAction(state, actorId) {
  const index = state.players.indexOf(actorId);
  if (index < 0 || index + 1 !== state.turnIndex || state.winner) return undefined;
  const hand = state.hands[actorId] ?? [];

  if (state.phase === "bidding") {
    return { type: "bid", score: chooseBid(hand, state.highestBid) };
  }
  if (state.phase !== "playing") return undefined;

  if (!state.lastPlay) {
    return { type: "play", cards: chooseLead(hand) };
  }

  const previousPlayer = state.lastPlay.playerId;
  if (sameTeam(state, actorId, previousPlayer)) return { type: "pass" };
  const response = chooseResponse(hand, state.lastPlay);
  return response ? { type: "play", cards: response } : { type: "pass" };
}

export function findSoloDouDizhuLegalPlay(hand, previous) {
  if (!Array.isArray(hand) || hand.length === 0) return undefined;
  return previous ? chooseResponse(hand, previous) : chooseLead(hand);
}

export function sortSoloDouDizhuCardsDescending(cards) {
  return [...cards].sort((left, right) =>
    cardRank(right) - cardRank(left) || right - left,
  );
}

export function classifySoloDouDizhuCards(cards) {
  const sorted = sortCards([...cards]);
  const count = sorted.length;
  const counts = rankCounts(sorted);

  if (count === 2 && counts[16] === 1 && counts[17] === 1) {
    return { type: "rocket", rank: 17, size: 2 };
  }

  let fourRank;
  let tripleRank;
  for (let rank = 3; rank <= 17; rank += 1) {
    if (counts[rank] === 4) fourRank = rank;
    if (counts[rank] === 3) tripleRank = rank;
  }
  if (count === 4 && fourRank) return { type: "bomb", rank: fourRank, size: 4 };
  if (count === 1) return { type: "single", rank: cardRank(sorted[0]), size: 1 };
  if (count === 2) {
    const pairs = allGroupsAre(counts, 2);
    if (pairs?.length === 1) return { type: "pair", rank: pairs[0], size: 2 };
  }
  if (count === 3 && tripleRank) {
    return { type: "triple", rank: tripleRank, size: 3 };
  }
  if (count === 4 && tripleRank) {
    return { type: "triple_single", rank: tripleRank, size: 4 };
  }
  if (count === 5 && tripleRank) {
    for (let rank = 3; rank <= 17; rank += 1) {
      if (rank !== tripleRank && counts[rank] === 2) {
        return { type: "triple_pair", rank: tripleRank, size: 5 };
      }
    }
  }

  if (count === 6 && fourRank) {
    return { type: "four_two_single", rank: fourRank, size: 6 };
  }
  if (count === 8 && fourRank) {
    let pairCount = 0;
    for (let rank = 3; rank <= 17; rank += 1) {
      if (rank === fourRank || counts[rank] === 0) continue;
      if (counts[rank] !== 2) return undefined;
      pairCount += 1;
    }
    if (pairCount === 2) {
      return { type: "four_two_pair", rank: fourRank, size: 8 };
    }
  }

  const singleRanks = allGroupsAre(counts, 1);
  if (count >= 5 && singleRanks && ranksInSequence(singleRanks)) {
    return {
      type: "straight",
      rank: singleRanks.at(-1),
      size: count,
    };
  }
  const pairRanks = allGroupsAre(counts, 2);
  if (
    count >= 6 &&
    pairRanks?.length >= 3 &&
    ranksInSequence(pairRanks)
  ) {
    return {
      type: "pair_straight",
      rank: pairRanks.at(-1),
      size: count,
    };
  }

  const tripleRanks = [];
  for (let rank = 3; rank <= 17; rank += 1) {
    if (counts[rank] !== 3) continue;
    if (rank > 14) return undefined;
    tripleRanks.push(rank);
  }
  const tripleCount = tripleRanks.length;
  if (tripleCount >= 2 && ranksInSequence(tripleRanks)) {
    const tripleCards = tripleCount * 3;
    if (count === tripleCards) {
      return { type: "airplane", rank: tripleRanks.at(-1), size: count };
    }
    if (count === tripleCards + tripleCount) {
      return {
        type: "airplane_single",
        rank: tripleRanks.at(-1),
        size: count,
      };
    }
    if (count === tripleCards + tripleCount * 2) {
      let pairWings = true;
      for (let rank = 3; rank <= 17; rank += 1) {
        if (counts[rank] > 0 && counts[rank] !== 3 && counts[rank] !== 2) {
          pairWings = false;
        }
      }
      if (pairWings) {
        return {
          type: "airplane_pair",
          rank: tripleRanks.at(-1),
          size: count,
        };
      }
    }
  }
  return undefined;
}

export function soloDouDizhuCardsBeat(candidate, previous) {
  if (!previous) return true;
  if (candidate.type === "rocket") return previous.type !== "rocket";
  if (previous.type === "rocket") return false;
  if (candidate.type === "bomb") {
    return previous.type !== "bomb" || candidate.rank > previous.rank;
  }
  if (previous.type === "bomb" || candidate.type !== previous.type) return false;
  return candidate.size === previous.size && candidate.rank > previous.rank;
}

function applyBid(state, action, actorId, index) {
  if (action.type !== "bid") return rejected("BID_REQUIRED");
  const score = Number(action.score);
  if (!Number.isInteger(score) || score < 0 || score > 3) {
    return rejected("INVALID_BID");
  }
  if (score > 0 && score <= state.highestBid) return rejected("BID_TOO_LOW");

  state.bids[actorId] = score;
  state.bidCount += 1;
  if (score > state.highestBid) {
    state.highestBid = score;
    state.lastBidIndex = index + 1;
  }
  if (score === 3) {
    startPlaying(state);
    return accepted(state, [{ type: "landlord", player: actorId }]);
  }
  if (state.bidCount === state.players.length) {
    if (state.highestBid === 0) {
      redeal(state);
      return accepted(state, [{ type: "redealt" }]);
    }
    startPlaying(state);
    return accepted(state, [{ type: "landlord", player: state.landlord }]);
  }

  advanceTurn(state);
  state.lastEvent = {
    kind: score === 0 ? "pass_bid" : "bid",
    playerIndex: index + 1,
    count: score,
  };
  return accepted(state, [{ type: "bid", player: actorId, score }]);
}

function applyPass(state, actorId, index) {
  if (!state.lastPlay || state.lastPlay.playerId === actorId) {
    return rejected("CANNOT_PASS");
  }
  state.passCount += 1;
  if (state.passCount >= state.players.length - 1) {
    const leader = state.lastPlay.playerIndex;
    state.turnIndex = leader;
    state.lastPlay = null;
    state.passCount = 0;
    state.lastEvent = { kind: "new_trick", playerIndex: leader, count: 0 };
    return accepted(state, [
      { type: "new_trick", player: state.players[leader - 1] },
    ]);
  }
  state.lastEvent = { kind: "pass", playerIndex: index + 1, count: 0 };
  advanceTurn(state);
  return accepted(state, [{ type: "pass", player: actorId }]);
}

function applyPlay(state, requestedCards, actorId, index) {
  const cards = selectedCards(state.hands[actorId], requestedCards);
  if (!cards) return rejected("INVALID_CARDS");
  const combo = classifySoloDouDizhuCards(cards);
  if (!combo) return rejected("INVALID_COMBO");
  if (!soloDouDizhuCardsBeat(combo, state.lastPlay)) {
    return rejected("DOES_NOT_BEAT");
  }

  state.hands[actorId] = removeCards(state.hands[actorId], cards);
  state.lastPlay = {
    playerId: actorId,
    playerIndex: index + 1,
    cards,
    ...combo,
  };
  state.passCount = 0;
  if (combo.type === "bomb" || combo.type === "rocket") {
    state.multiplier *= 2;
  }
  if (state.hands[actorId].length === 0) {
    state.winner = actorId;
    state.winnerIndex = index + 1;
    state.winnerTeam = actorId === state.landlord ? "landlord" : "farmers";
    state.lastEvent = {
      kind: "won",
      playerIndex: index + 1,
      count: state.multiplier,
    };
    return accepted(state, [{ type: "won", player: actorId }]);
  }

  state.lastEvent = {
    kind: "play",
    playerIndex: index + 1,
    count: cards.length,
    combo: combo.type,
  };
  advanceTurn(state);
  return accepted(state, [
    { type: "played", player: actorId, cards: cards.length },
  ]);
}

function chooseBid(hand, highestBid) {
  const counts = rankCounts(hand);
  let strength = 0;
  if (counts[16] && counts[17]) strength += 5;
  for (let rank = 3; rank <= 15; rank += 1) {
    if (counts[rank] === 4) strength += 3.5;
  }
  strength += counts[17] * 2;
  strength += counts[16] * 1.4;
  strength += counts[15] * 0.8;
  strength += counts[14] * 0.25;
  const desired = strength >= 7 ? 3 : strength >= 4.5 ? 2 : strength >= 2.5 ? 1 : 0;
  return desired > highestBid ? desired : 0;
}

function chooseLead(hand) {
  const wholeHand = classifySoloDouDizhuCards(hand);
  if (wholeHand) return [...hand];
  const groups = cardGroups(hand);
  const straight = longestSequence(groups, 1, 5);
  if (straight) return straight;
  const pairStraight = longestSequence(groups, 2, 3);
  if (pairStraight) return pairStraight;
  const airplane = longestSequence(groups, 3, 2);
  if (airplane) return airplane;

  const triple = groups.find((group) => group.cards.length === 3 && group.rank <= 14);
  if (triple) {
    const pair = groups.find(
      (group) => group.rank !== triple.rank && group.cards.length === 2,
    );
    if (pair) return [...triple.cards, ...pair.cards];
    const single = groups.find(
      (group) => group.rank !== triple.rank && group.cards.length < 4,
    );
    if (single) return [...triple.cards, single.cards[0]];
    return [...triple.cards];
  }
  const pair = groups.find((group) => group.cards.length === 2);
  if (pair) return [...pair.cards];
  return [sortCards([...hand])[0]];
}

function chooseResponse(hand, previous) {
  const targetSize = Number(previous.size ?? previous.cards?.length);
  const groups = cardGroups(hand);
  const candidates = [];
  const seen = new Set();
  enumerateSelections(groups, targetSize, 0, [], (cards) => {
    addResponseCandidate(candidates, seen, cards, previous);
  });
  for (const group of groups) {
    if (group.cards.length === 4) {
      addResponseCandidate(candidates, seen, group.cards, previous);
    }
  }
  const smallJoker = groups.find((group) => group.rank === 16)?.cards[0];
  const bigJoker = groups.find((group) => group.rank === 17)?.cards[0];
  if (smallJoker && bigJoker) {
    addResponseCandidate(candidates, seen, [smallJoker, bigJoker], previous);
  }
  candidates.sort(compareResponses);
  return candidates[0]?.cards;
}

function addResponseCandidate(candidates, seen, cards, previous) {
  const sorted = sortCards([...cards]);
  const key = sorted.join(",");
  if (seen.has(key)) return;
  seen.add(key);
  const combo = classifySoloDouDizhuCards(sorted);
  if (!combo || !soloDouDizhuCardsBeat(combo, previous)) return;
  candidates.push({ cards: sorted, combo });
}

function compareResponses(left, right) {
  const penalty = (candidate) =>
    candidate.combo.type === "rocket" ? 2 : candidate.combo.type === "bomb" ? 1 : 0;
  return (
    penalty(left) - penalty(right) ||
    left.combo.rank - right.combo.rank ||
    left.cards.length - right.cards.length
  );
}

function enumerateSelections(groups, remaining, index, cards, visit) {
  if (remaining === 0) {
    visit(cards);
    return;
  }
  if (index >= groups.length) return;
  const availableAfter = groups
    .slice(index + 1)
    .reduce((total, group) => total + group.cards.length, 0);
  const group = groups[index];
  const maximum = Math.min(group.cards.length, remaining);
  for (let count = 0; count <= maximum; count += 1) {
    const nextRemaining = remaining - count;
    if (nextRemaining > availableAfter) continue;
    enumerateSelections(
      groups,
      nextRemaining,
      index + 1,
      [...cards, ...group.cards.slice(0, count)],
      visit,
    );
  }
}

function longestSequence(groups, copies, minimumRanks) {
  let current = [];
  let best = [];
  for (let rank = 3; rank <= 14; rank += 1) {
    const group = groups.find((candidate) => candidate.rank === rank);
    if (group && group.cards.length >= copies) {
      current.push(...group.cards.slice(0, copies));
      if (current.length > best.length) best = [...current];
    } else {
      current = [];
    }
  }
  return best.length >= copies * minimumRanks ? best : undefined;
}

function sameTeam(state, left, right) {
  if (!left || !right || left === right) return false;
  return left !== state.landlord && right !== state.landlord;
}

function newRound(players, seed, round, starter) {
  const state = {
    players: [...players],
    seed: normalizeSeed(seed),
    round,
    starter,
    phase: "bidding",
    turnIndex: starter,
    bidCount: 0,
    highestBid: 0,
    lastBidIndex: 0,
    bids: {},
    hands: {},
    bottomCards: [],
    landlord: "",
    landlordIndex: 0,
    multiplier: 1,
    passCount: 0,
    lastPlay: null,
    winner: "",
    winnerIndex: 0,
    winnerTeam: "",
    lastEvent: { kind: "dealt", playerIndex: starter, count: 0 },
  };
  deal(state);
  return state;
}

function deal(state) {
  const deck = Array.from({ length: 54 }, (_, index) => index + 1);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = nextRandom(state) % (index + 1);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  state.hands = {};
  state.players.forEach((player, index) => {
    state.hands[player] = sortCards(deck.slice(index * 17, index * 17 + 17));
  });
  state.bottomCards = deck.slice(51);
}

function startPlaying(state) {
  state.landlordIndex = state.lastBidIndex;
  state.landlord = state.players[state.landlordIndex - 1];
  state.hands[state.landlord] = sortCards([
    ...state.hands[state.landlord],
    ...state.bottomCards,
  ]);
  state.phase = "playing";
  state.turnIndex = state.landlordIndex;
  state.multiplier = Math.max(state.highestBid, 1);
  state.lastPlay = null;
  state.passCount = 0;
  state.lastEvent = {
    kind: "landlord",
    playerIndex: state.landlordIndex,
    count: state.highestBid,
  };
}

function redeal(state) {
  state.starter = (state.starter % state.players.length) + 1;
  state.phase = "bidding";
  state.turnIndex = state.starter;
  state.bidCount = 0;
  state.highestBid = 0;
  state.lastBidIndex = 0;
  state.bids = {};
  state.landlord = "";
  state.landlordIndex = 0;
  state.multiplier = 1;
  state.passCount = 0;
  state.lastPlay = null;
  state.lastEvent = {
    kind: "redealt",
    playerIndex: state.starter,
    count: 0,
  };
  deal(state);
}

function selectedCards(hand, requested) {
  if (!Array.isArray(requested) || requested.length === 0) return undefined;
  const owned = new Set(hand);
  const seen = new Set();
  const cards = [];
  for (const card of requested) {
    if (
      !Number.isInteger(card) ||
      card < 1 ||
      card > 54 ||
      seen.has(card) ||
      !owned.has(card)
    ) {
      return undefined;
    }
    seen.add(card);
    cards.push(card);
  }
  return sortCards(cards);
}

function removeCards(hand, cards) {
  const selected = new Set(cards);
  return hand.filter((card) => !selected.has(card));
}

function advanceTurn(state) {
  state.turnIndex = (state.turnIndex % state.players.length) + 1;
}

function nextRandom(state) {
  state.seed = (state.seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS;
  return state.seed;
}

function normalizeSeed(seed) {
  const normalized = Math.floor(Math.abs(Number(seed) || 1)) % RANDOM_MODULUS;
  return normalized || 1;
}

function cardRank(card) {
  if (card === 53) return 16;
  if (card === 54) return 17;
  return Math.floor((card - 1) / 4) + 3;
}

function sortCards(cards) {
  return cards.sort((left, right) => cardRank(left) - cardRank(right) || left - right);
}

function rankCounts(cards) {
  const counts = Array(18).fill(0);
  for (const card of cards) counts[cardRank(card)] += 1;
  return counts;
}

function cardGroups(cards) {
  const grouped = new Map();
  for (const card of sortCards([...cards])) {
    const rank = cardRank(card);
    if (!grouped.has(rank)) grouped.set(rank, []);
    grouped.get(rank).push(card);
  }
  return [...grouped.entries()].map(([rank, groupedCards]) => ({
    rank,
    cards: groupedCards,
  }));
}

function allGroupsAre(counts, expected) {
  const ranks = [];
  for (let rank = 3; rank <= 17; rank += 1) {
    if (counts[rank] === 0) continue;
    if (counts[rank] !== expected) return undefined;
    ranks.push(rank);
  }
  return ranks;
}

function ranksInSequence(ranks) {
  if (ranks.length === 0 || ranks.at(-1) > 14) return false;
  return ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1);
}

function accepted(state, events) {
  return { accepted: true, state, events };
}

function rejected(code) {
  return {
    accepted: false,
    error: {
      code,
      message: code.toLowerCase().replaceAll("_", " "),
    },
  };
}
