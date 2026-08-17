import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LuaFactory } from "wasmoon";

const PLAYER_TABLE = `{
  { id = "p1", name = "Human", seat = 1 },
  { id = "p2", name = "AI 1", seat = 2 },
  { id = "p3", name = "AI 2", seat = 3 },
  { id = "p4", name = "AI 3", seat = 4 }
}`;

async function runScenario(scenario) {
  const source = await readFile("games/mahjong/game.lua", "utf8");
  const lua = await new LuaFactory().createEngine();
  try {
    await lua.doString(`${source}\n${scenario}`);
    return lua.global.get("result");
  } finally {
    lua.global.close();
  }
}

test("Mahjong deals one deterministic complete 136-tile set", async () => {
  const result = await runScenario(`
    first = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 42 } })
    second = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 42 } })
    seen = {}
    duplicate = false
    total = 0
    for _, tile in ipairs(first.wall) do
      total = total + 1
      if seen[tile] then duplicate = true end
      seen[tile] = true
    end
    for _, tile in ipairs(first.deadWall) do
      total = total + 1
      if seen[tile] then duplicate = true end
      seen[tile] = true
    end
    for _, tile in ipairs(first.rinshan) do
      total = total + 1
      if seen[tile] then duplicate = true end
      seen[tile] = true
    end
    for _, player_id in ipairs(first.players) do
      for _, tile in ipairs(first.hands[player_id]) do
        total = total + 1
        if seen[tile] then duplicate = true end
        seen[tile] = true
      end
    end
    total = total + 1
    if seen[first.drawnTile] then duplicate = true end
    seen[first.drawnTile] = true
    result = {
      total = total,
      duplicate = duplicate,
      wall = #first.wall,
      handCounts = {
        #first.hands.p1, #first.hands.p2, #first.hands.p3, #first.hands.p4,
      },
      deterministic = first.hands.p1[1] == second.hands.p1[1]
        and first.wall[#first.wall] == second.wall[#second.wall],
    }
  `);

  assert.equal(result.total, 136);
  assert.equal(result.duplicate, false);
  assert.equal(result.wall, 69);
  assert.deepEqual(result.handCounts, [13, 13, 13, 13]);
  assert.equal(result.deterministic, true);
});

test("Mahjong view reveals only the viewer's concealed hand", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 7 } })
    result = view(state, {}, {
      viewer = { id = "p2", seat = 2, role = "player", isOwner = false }
    }).state
  `);

  assert.equal(result.ownHand.length, 13);
  assert.equal(result.handCounts.p1, 13);
  assert.equal(result.handCounts.p2, 13);
  assert.equal(result.drawnPlayerIndex, 1);
  assert.equal("hands" in result, false);
  assert.deepEqual(result.legalActions.claims, {});
});

test("Mahjong stores the current draw outside the fixed concealed rack", async () => {
  const result = await runScenario(`
    local base_rack = { 109,5,9,13,17,21,25,29,33,37,41,45,49 }
    local harmless = { 1,5,9,13,17,21,25,29,33,37,41,45,49 }

    local tedashi = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 73 } })
    tedashi.hands.p1 = copy_array(base_rack)
    tedashi.hands.p2, tedashi.hands.p3, tedashi.hands.p4 =
      copy_array(harmless), copy_array(harmless), copy_array(harmless)
    tedashi.turnIndex, tedashi.drawnTile = 1, 53
    local tedashi_result = on_action(tedashi, { type = "discard", tileId = 109 }, { actor = { id = "p1" } })
    tedashi = tedashi_result.state
    local opponent_projection = view(tedashi, tedashi_result.events, {
      viewer = { id = "p2", seat = 2, role = "player", isOwner = false }
    })

    local tsumogiri = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 74 } })
    tsumogiri.hands.p1 = copy_array(base_rack)
    tsumogiri.hands.p2, tsumogiri.hands.p3, tsumogiri.hands.p4 =
      copy_array(harmless), copy_array(harmless), copy_array(harmless)
    tsumogiri.turnIndex, tsumogiri.drawnTile = 1, 53
    local before = table.concat(tsumogiri.hands.p1, ",")
    local tsumogiri_result = on_action(tsumogiri, { type = "discard", tileId = 53 }, { actor = { id = "p1" } })
    tsumogiri = tsumogiri_result.state

    local function contains(hand, tile)
      for _, candidate in ipairs(hand) do if candidate == tile then return true end end
      return false
    end
    result = {
      tedashiAccepted = tedashi_result.accepted,
      tedashiFromDrawn = tedashi_result.events[1].fromDrawn,
      projectedDiscardType = opponent_projection.events[1].tile,
      projectedFromDrawn = opponent_projection.events[1].fromDrawn,
      projectedTileIdHidden = opponent_projection.events[1].tileId == nil,
      projectedHandIndexHidden = opponent_projection.events[1].handIndex == nil,
      tedashiRackCount = #tedashi.hands.p1,
      tedashiIntegratedDraw = contains(tedashi.hands.p1, 53),
      tedashiRemovedDiscard = not contains(tedashi.hands.p1, 109),
      nextRackCount = #tedashi.hands.p2,
      nextDrawSeparated = tedashi.turnIndex == 2 and tedashi.drawnTile > 0,
      tsumogiriAccepted = tsumogiri_result.accepted,
      tsumogiriFromDrawn = tsumogiri_result.events[1].fromDrawn,
      tsumogiriRackUnchanged = before == table.concat(tsumogiri.hands.p1, ","),
    }
  `);

  assert.deepEqual(result, {
    tedashiAccepted: true,
    tedashiFromDrawn: false,
    projectedDiscardType: 28,
    projectedFromDrawn: false,
    projectedTileIdHidden: true,
    projectedHandIndexHidden: true,
    tedashiRackCount: 13,
    tedashiIntegratedDraw: true,
    tedashiRemovedDiscard: true,
    nextRackCount: 13,
    nextDrawSeparated: true,
    tsumogiriAccepted: true,
    tsumogiriFromDrawn: true,
    tsumogiriRackUnchanged: true,
  });
});

test("Mahjong terminal view reveals tile faces and red-five identity", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 7 } })
    state.phase, state.winningTile = "hand_ended", 17
    state.hands.p2 = { 17, 18, 21 }
    result = view(state, {}, {
      viewer = { id = "p1", seat = 1, role = "player", isOwner = true }
    }).state
  `);

  assert.deepEqual(result.revealedHands.p2, [
    { type: 5, red: true },
    { type: 5, red: false },
    { type: 6, red: false },
  ]);
  assert.equal(result.winningTile, 5);
  assert.equal(result.winningTileRed, true);
});

test("Mahjong chi options distinguish red fives without duplicating identical copies", async () => {
  const result = await runScenario(`
    local options = chi_options({ 5, 9, 10, 17, 18, 21 }, 4)
    local state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 9 } })
    state.hands.p2 = { 5, 9, 10, 17, 18, 21 }
    state.phase, state.claimIndex = "claiming", 1
    state.lastDiscard = { player = "p1", playerIndex = 1, tile = 13, discardIndex = 1 }
    state.claimants = { { playerId = "p2", playerIndex = 2, options = options } }
    local projected = legal_actions(state, "p2").claims
    result = {
      count = #options,
      ids = {},
      projectedCount = #projected,
      normalFiveRed = projected[2].red,
      redFiveRed = projected[3].red,
      redFiveTypes = projected[3].tileTypes,
    }
    for _, option in ipairs(options) do
      result.ids[#result.ids + 1] = option.tileIds
    end
  `);

  assert.equal(result.count, 5);
  assert.deepEqual(result.ids, [
    [5, 9],
    [9, 18],
    [9, 17],
    [18, 21],
    [17, 21],
  ]);
  assert.equal(result.projectedCount, 5);
  assert.deepEqual(result.normalFiveRed, [false, false]);
  assert.deepEqual(result.redFiveRed, [false, true]);
  assert.deepEqual(result.redFiveTypes, [3, 5]);
});

test("Mahjong recognizes standard, seven-pairs, and thirteen-orphans wins", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 11 } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function can_tsumo(types)
      local hand = ids(types)
      state.drawnTile = table.remove(hand)
      state.hands.p1 = hand
      state.turnIndex = 1
      state.phase = "playing"
      return view(state, {}, { viewer = { id = "p1", seat = 1 } }).state.legalActions.canTsumo
    end
    result = {
      standard = can_tsumo({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28,28 }),
      sevenPairs = can_tsumo({ 1,1, 3,3, 10,10, 12,12, 20,20, 28,28, 34,34 }),
      orphans = can_tsumo({ 1,9,10,18,19,27,28,29,30,31,32,33,34,34 }),
      incomplete = can_tsumo({ 1,2,4, 5,7,9, 10,13,16, 19,22,25, 28,34 }),
    }
  `);

  assert.equal(result.standard, true);
  assert.equal(result.sevenPairs, true);
  assert.equal(result.orphans, true);
  assert.equal(result.incomplete, false);
});

test("Mahjong local AI finishes a complete game through validated Lua actions", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 12345 } })
    steps = 0
    all_accepted = true
    while state.phase ~= "hand_ended" and steps < 500 do
      local actor = state.phase == "claiming"
        and state.claimants[state.claimIndex].playerId
        or state.players[state.turnIndex]
      local action = ai_action(state, actor)
      local applied = on_action(state, action, { actor = { id = actor } })
      if not applied.accepted then all_accepted = false break end
      state = applied.state
      steps = steps + 1
    end
    result = {
      ended = state.phase == "hand_ended",
      allAccepted = all_accepted,
      steps = steps,
      winner = state.winner,
      draw = state.draw,
      wall = #state.wall,
    }
  `);

  assert.equal(result.ended, true);
  assert.equal(result.allAccepted, true);
  assert.ok(result.steps > 20 && result.steps < 500);
  assert.ok(result.winner || result.draw);
  assert.ok(result.wall >= 0);
});

test("Mahjong riichi costs 1000 points and own discards cause furiten", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 91, settings = { matchType = "east" } } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state.hands.p1 = ids({ 1,2,3, 4,5,6, 10,11,12, 19,20,21, 28 })
    state.drawnTile = ids({ 9 })[1]
    state.turnIndex = 1
    local declared = on_action(state, { type = "riichi", tileId = state.drawnTile }, { actor = { id = "p1" } })
    state = declared.state
    state.discards.p1[#state.discards.p1 + 1] = { tile = (28 - 1) * 4 + 1, claimed = false }
    local projected = view(state, {}, { viewer = { id = "p1", seat = 1 } }).state
    result = {
      accepted = declared.accepted,
      score = state.scores[1],
      sticks = state.riichiSticks,
      riichi = state.riichi.p1,
      furiten = projected.furiten,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.score, 24000);
  assert.equal(result.sticks, 1);
  assert.equal(result.riichi, true);
  assert.equal(result.furiten, true);
});

test("Mahjong scores yaku, han and fu with conserved tsumo payments", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 77 } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state.hands.p1 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
    state.deadWall[1] = 1
    state.drawnTile = ids({ 22 })[1]
    state.turnIndex = 1
    local applied = on_action(state, { type = "tsumo" }, { actor = { id = "p1" } })
    state = applied.state
    local names = {}
    for _, yaku in ipairs(state.result.yaku) do names[yaku.name] = true end
    local delta_sum = 0
    for _, delta in ipairs(state.result.deltas) do delta_sum = delta_sum + delta end
    result = {
      accepted = applied.accepted,
      phase = state.phase,
      han = state.result.han,
      fu = state.result.fu,
      tanyao = names["断幺九"] == true,
      pinfu = names["平和"] == true,
      menzenTsumo = names["门前清自摸和"] == true,
      dora = names["宝牌"] == true,
      basePaymentTotal = state.result.basePaymentTotal,
      winnerDelta = state.result.deltas[1],
      deltaSum = delta_sum,
      nextDealer = state.nextDealerIndex,
      nextHonba = state.nextHonba,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.phase, "hand_ended");
  assert.equal(result.han, 6);
  assert.equal(result.fu, 20);
  assert.equal(result.tanyao, true);
  assert.equal(result.pinfu, true);
  assert.equal(result.menzenTsumo, true);
  assert.equal(result.dora, true);
  assert.equal(result.basePaymentTotal, result.winnerDelta);
  assert.equal(result.deltaSum, 0);
  assert.equal(result.nextDealer, 1);
  assert.equal(result.nextHonba, 1);
});

test("Mahjong East match ends after East 4 while hanchan advances to South 1", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function finish_east_four(match_type)
      local state = setup({ players = ${PLAYER_TABLE}, match = {
        randomSeed = 88, settings = { matchType = match_type }
      } })
      state.handNumber, state.roundWind, state.dealerIndex = 4, 1, 1
      state.hands.p2 = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
      state.drawnTile = ids({ 22 })[1]
      state.turnIndex = 2
      local applied = on_action(state, { type = "tsumo" }, { actor = { id = "p2" } })
      return applied.state
    end
    east = finish_east_four("east")
    south = finish_east_four("hanchan")
    local advanced = on_action(south, { type = "next_hand" }, { actor = { id = "p1" } }).state
    result = {
      eastEnded = east.matchEnded,
      hanchanEnded = south.matchEnded,
      roundWind = advanced.roundWind,
      handNumber = advanced.handNumber,
      dealer = advanced.dealerIndex,
    }
  `);

  assert.equal(result.eastEnded, true);
  assert.equal(result.hanchanEnded, false);
  assert.equal(result.roundWind, 2);
  assert.equal(result.handNumber, 1);
  assert.equal(result.dealer, 2);
});

test("Mahjong supports concealed kan and reveals an extra dora indicator", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 314 } })
    state.hands.p1 = { 1,2,3, 17,21,25, 41,45,49, 77,81,109,113 }
    state.drawnTile, state.turnIndex = 4, 1
    local applied = on_action(state, { type = "kan", kind = "ankan", tileType = 1 }, { actor = { id = "p1" } })
    state = applied.state
    state.deadWall[1] = 17
    local projected = view(state, {}, { viewer = { id = "p1", seat = 1 } }).state
    result = {
      accepted = applied.accepted,
      meldKind = state.melds.p1[1].kind,
      kanCount = state.kanCount,
      handCount = #state.hands.p1,
      indicators = #projected.doraIndicators,
      visualIndicators = #projected.doraIndicatorTiles,
      firstIndicatorType = projected.doraIndicatorTiles[1].type,
      firstIndicatorRed = projected.doraIndicatorTiles[1].red,
      drew = state.drawnTile > 0,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.meldKind, "ankan");
  assert.equal(result.kanCount, 1);
  assert.equal(result.handCount, 10);
  assert.equal(result.indicators, 2);
  assert.equal(result.visualIndicators, 2);
  assert.equal(result.firstIndicatorType, 5);
  assert.equal(result.firstIndicatorRed, true);
  assert.equal(result.drew, true);
});

test("Mahjong opens a robbing-kan window and scores chankan", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 2718 } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state.melds.p1 = { { kind = "pon", tiles = { 9,10,11 }, fromIndex = 4 } }
    state.hands.p1 = { 17,21,25, 41,45,49, 77,81,85, 109 }
    state.drawnTile, state.turnIndex = 12, 1
    state.hands.p2 = ids({ 1,2, 4,5,6, 10,11,12, 19,20,21, 28,28 })
    state.riichi.p2 = true
    local declared = on_action(state, { type = "kan", kind = "kakan", tileType = 3 }, { actor = { id = "p1" } })
    state = declared.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      local action = { type = "pass" }
      if claimant.playerId == "p2" then action = { type = "claim", option = 1 } end
      state = on_action(state, action, { actor = { id = claimant.playerId } }).state
    end
    local chankan = false
    for _, yaku in ipairs(state.result.yaku) do if yaku.name == "抢杠" then chankan = true end end
    result = {
      openedWindow = declared.state ~= nil,
      winner = state.winner,
      winType = state.winType,
      chankan = chankan,
      ponStayedPon = state.melds.p1[1].kind == "pon",
    }
  `);

  assert.equal(result.openedWindow, true);
  assert.equal(result.winner, "p2");
  assert.equal(result.winType, "ron");
  assert.equal(result.chankan, true);
  assert.equal(result.ponStayedPon, true);
});

test("Mahjong pays every ron winner on one discard", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 1618 } })
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    local waiting = { 1,2, 4,5,6, 10,11,12, 19,20,21, 28,28 }
    state.hands.p1, state.hands.p2 = ids(waiting), ids(waiting)
    state.riichi.p1, state.riichi.p2 = true, true
    local p4_hand = ids({ 3,4,5, 7,8,9, 13,14,15, 22,23,24, 29, 3 })
    state.drawnTile = table.remove(p4_hand)
    state.hands.p4, state.turnIndex = p4_hand, 4
    local discarded = on_action(state, { type = "discard", tileId = state.drawnTile }, { actor = { id = "p4" } })
    state = discarded.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      local action = (claimant.playerId == "p1" or claimant.playerId == "p2")
        and { type = "claim", option = 1 } or { type = "pass" }
      state = on_action(state, action, { actor = { id = claimant.playerId } }).state
    end
    result = {
      phase = state.phase,
      winners = #state.winners,
      first = state.winners[1],
      second = state.winners[2],
      payerDelta = state.result.deltas[4],
    }
  `);

  assert.equal(result.phase, "hand_ended");
  assert.equal(result.winners, 2);
  assert.equal(result.first, "p1");
  assert.equal(result.second, "p2");
  assert.ok(result.payerDelta < -10000);
});

test("Mahjong supports nine-terminals abortive draw and keeps the dealer", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 999 } })
    state.hands.p1 = { 1,33,37,69,73,105,109,113,117,121,125,129,133 }
    state.drawnTile, state.turnIndex = 134, 1
    local legal = view(state, {}, { viewer = { id = "p1", seat = 1 } }).state.legalActions
    local applied = on_action(state, { type = "abort_nine" }, { actor = { id = "p1" } })
    state = applied.state
    local visible = view(state, {}, { viewer = { id = "p2", seat = 2 } }).state
    result = {
      legal = legal.canAbortNine,
      accepted = applied.accepted,
      reason = state.abortiveReason,
      abortivePlayerIndex = state.abortivePlayerIndex,
      abortiveTile = state.abortiveTile,
      visiblePlayerIndex = visible.abortivePlayerIndex,
      visibleTile = visible.abortiveTile,
      nextDealer = state.nextDealerIndex,
      nextHonba = state.nextHonba,
    }
  `);

  assert.equal(result.legal, true);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, "九种九牌");
  assert.equal(result.abortivePlayerIndex, 1);
  assert.equal(result.abortiveTile, 134);
  assert.equal(result.visiblePlayerIndex, 1);
  assert.equal(result.visibleTile, 34);
  assert.equal(result.nextDealer, 1);
  assert.equal(result.nextHonba, 1);
});

test("Mahjong applies yakuman responsibility payment and bankruptcy ending", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 2024 } })
    state.melds.p1 = {
      { kind = "pon", tiles = { 125,126,127 }, fromIndex = 2 },
      { kind = "pon", tiles = { 129,130,131 }, fromIndex = 3 },
      { kind = "pon", tiles = { 133,134,135 }, fromIndex = 2 },
    }
    state.hands.p1 = { 1,5,109,110 }
    state.drawnTile, state.turnIndex = 9, 1
    state.pao.p1.daisangen = 2
    local applied = on_action(state, { type = "tsumo" }, { actor = { id = "p1" } })
    state = applied.state
    result = {
      accepted = applied.accepted,
      paoSeat = state.result.paoSeat,
      liableDelta = state.result.deltas[2],
      otherDelta = state.result.deltas[3],
      ended = state.matchEnded,
      reason = state.endReason,
    }
  `);

  assert.equal(result.accepted, true);
  assert.equal(result.paoSeat, 2);
  assert.equal(result.liableDelta, -48000);
  assert.equal(result.otherDelta, 0);
  assert.equal(result.ended, true);
  assert.equal(result.reason, "击飞结束");
});

test("Mahjong awards nagashi mangan instead of noten payments", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 4242 } })
    state.wall = {}
    state.hands.p1 = { 1,5,9,13,17,21,25,29,33,37,41,45,49 }
    state.turnIndex, state.drawnTile = 1, 109
    local applied = on_action(state, { type = "discard", tileId = 109 }, { actor = { id = "p1" } })
    state = applied.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      state = on_action(state, { type = "pass" }, { actor = { id = claimant.playerId } }).state
    end
    result = {
      phase = state.phase,
      winType = state.winType,
      winner = state.winner,
      yaku = state.result.yaku[1].name,
      delta = state.result.deltas[1],
    }
  `);

  assert.equal(result.phase, "hand_ended");
  assert.equal(result.winType, "nagashi");
  assert.equal(result.winner, "p1");
  assert.equal(result.yaku, "流局满贯");
  assert.equal(result.delta, 12000);
});

test("Mahjong detects four-winds abortive draw after claims are passed", async () => {
  const result = await runScenario(`
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 5150 } })
    local east = 109
    state.discards.p1 = { { tile = east, claimed = false } }
    state.discards.p2 = { { tile = 110, claimed = false } }
    state.discards.p3 = { { tile = 111, claimed = false } }
    state.moveCount = 3
    state.turnIndex, state.drawnTile = 4, 112
    local applied = on_action(state, { type = "discard", tileId = 112 }, { actor = { id = "p4" } })
    state = applied.state
    while state.phase == "claiming" do
      local claimant = state.claimants[state.claimIndex]
      state = on_action(state, { type = "pass" }, { actor = { id = claimant.playerId } }).state
    end
    result = { phase = state.phase, reason = state.abortiveReason, honba = state.nextHonba }
  `);

  assert.equal(result.phase, "hand_ended");
  assert.equal(result.reason, "四风连打");
  assert.equal(result.honba, 1);
});

test("Mahjong supports agari-yame and East-match extension", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    function winning_hand(state, player_id, seat)
      state.hands[player_id] = ids({ 2,3,4, 6,7,8, 11,12,13, 20,21, 26,26 })
      state.drawnTile = ids({ 22 })[1]
      state.turnIndex = seat
    end
    yame = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 61, settings = { matchType = "east" } } })
    yame.handNumber, yame.scores[1] = 4, 31000
    winning_hand(yame, "p1", 1)
    yame = on_action(yame, { type = "tsumo" }, { actor = { id = "p1" } }).state

    extension = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 62, settings = { matchType = "east" } } })
    extension.handNumber = 4
    extension.scores = { 20000, 20000, 20000, 20000 }
    winning_hand(extension, "p2", 2)
    extension = on_action(extension, { type = "tsumo" }, { actor = { id = "p2" } }).state
    local advanced = on_action(extension, { type = "next_hand" }, { actor = { id = "p1" } }).state
    result = {
      yameEnded = yame.matchEnded,
      yameReason = yame.endReason,
      extensionEnded = extension.matchEnded,
      extensionWind = advanced.roundWind,
      extensionHand = advanced.handNumber,
    }
  `);

  assert.equal(result.yameEnded, true);
  assert.equal(result.yameReason, "庄家止和");
  assert.equal(result.extensionEnded, false);
  assert.equal(result.extensionWind, 2);
  assert.equal(result.extensionHand, 1);
});

test("Mahjong extension draws ignore target score until the forced final hand", async () => {
  const result = await runScenario(`
    function extension_state(match_type, wind, hand, scores)
      local state = setup({ players = ${PLAYER_TABLE}, match = {
        randomSeed = 71,
        settings = { matchType = match_type }
      } })
      state.roundWind, state.handNumber, state.dealerIndex = wind, hand, 1
      state.scores = scores
      state.result = { tenpai = { false, false, false, false } }
      return state
    end

    south_draw = extension_state("east", 2, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_draw, false, true)
    west_draw = extension_state("hanchan", 3, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(west_draw, false, true)

    south_tenpai = extension_state("east", 2, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_tenpai, true, true)
    south_win = extension_state("east", 2, 1, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_win, false, false)

    south_four = extension_state("east", 2, 4, { 26000, 25000, 25000, 24000 })
    mark_next_hand(south_four, false, true)
    west_four = extension_state("hanchan", 3, 4, { 26000, 25000, 25000, 24000 })
    mark_next_hand(west_four, false, true)
    south_four_repeat = extension_state("east", 2, 4, { 32000, 24000, 23000, 21000 })
    mark_next_hand(south_four_repeat, true, true)

    result = {
      southDrawEnded = south_draw.matchEnded,
      southNextHand = south_draw.nextHandNumber,
      westDrawEnded = west_draw.matchEnded,
      westNextHand = west_draw.nextHandNumber,
      tenpaiEnded = south_tenpai.matchEnded,
      tenpaiNextHand = south_tenpai.nextHandNumber,
      winEnded = south_win.matchEnded,
      southFourEnded = south_four.matchEnded,
      southFourReason = south_four.endReason,
      westFourEnded = west_four.matchEnded,
      westFourReason = west_four.endReason,
      southFourRepeatEnded = south_four_repeat.matchEnded,
    }
  `);

  assert.equal(result.southDrawEnded, false);
  assert.equal(result.southNextHand, 2);
  assert.equal(result.westDrawEnded, false);
  assert.equal(result.westNextHand, 2);
  assert.equal(result.tenpaiEnded, false);
  assert.equal(result.tenpaiNextHand, 1);
  assert.equal(result.winEnded, true);
  assert.equal(result.southFourEnded, true);
  assert.equal(result.southFourReason, "延长赛结束");
  assert.equal(result.westFourEnded, true);
  assert.equal(result.westFourReason, "延长赛结束");
  assert.equal(result.southFourRepeatEnded, false);
});

test("Mahjong forbids genbutsu and suji kuikae immediately after a call", async () => {
  const result = await runScenario(`
    function ids(types)
      local copies, tiles = {}, {}
      for _, kind in ipairs(types) do
        copies[kind] = (copies[kind] or 0) + 1
        tiles[#tiles + 1] = (kind - 1) * 4 + copies[kind]
      end
      return tiles
    end
    state = setup({ players = ${PLAYER_TABLE}, match = { randomSeed = 71 } })
    state.hands.p2 = ids({ 2,3,4,5,6,7,8,9,10,11,12,28,29 })
    local called = 1
    state.discards.p1 = { { tile = called, claimed = false } }
    state.lastDiscard = { player = "p1", playerIndex = 1, tile = called, discardIndex = 1 }
    state.claimants = { {
      playerId = "p2", playerIndex = 2, distance = 1,
      options = { { kind = "chi", tileIds = { 5, 9 } } },
    } }
    state.claimResponses = { { claimant = 1, option = 1 } }
    local events = {}
    resolve_claims(state, events)

    local projected = view(state, {}, { viewer = { id = "p2", seat = 2 } }).state
    local ai = ai_action(state, "p2")
    local forbidden = on_action(state, { type = "discard", tileId = 13 }, { actor = { id = "p2" } })
    local allowed = on_action(state, { type = "discard", tileId = 113 }, { actor = { id = "p2" } })
    local pon = kuikae_forbidden_types({ kind = "pon", tileIds = { 53, 54 } })
    result = {
      forbiddenTypes = projected.legalActions.forbiddenDiscardTypes,
      forbiddenAccepted = forbidden.accepted,
      forbiddenCode = forbidden.error.code,
      allowedAccepted = allowed.accepted,
      cleared = next(state.kuikaeForbidden.p2) == nil,
      aiAvoided = tile_type(ai.tileId) ~= 1 and tile_type(ai.tileId) ~= 4,
      ponGenbutsu = pon[14] == true,
      calledTileIndex = projected.melds.p2[1].calledTileIndex,
    }
  `);

  assert.deepEqual(result.forbiddenTypes, [1, 4]);
  assert.equal(result.forbiddenAccepted, false);
  assert.equal(result.forbiddenCode, "KUIKAE_FORBIDDEN");
  assert.equal(result.allowedAccepted, true);
  assert.equal(result.cleared, true);
  assert.equal(result.aiAvoided, true);
  assert.equal(result.ponGenbutsu, true);
  assert.equal(result.calledTileIndex, 0);
});
