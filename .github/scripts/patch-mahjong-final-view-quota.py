from pathlib import Path

source = Path('games/mahjong/online-source.js')
text = source.read_text()
old = '''    if projection.state.resultSummaryVisible then
      projection.state.paipu = export_paipu(state, "room")
    end
'''
new = '''    -- Completed hand fragments are already streamed to every client at
    -- hand_ended.  Re-exporting the hand paipu here would deep-copy the full
    -- command/event log inside a single view() call and can exceed the host's
    -- 50k Lua instruction quota on long hands.  The final summary carries only
    -- match metadata; clients assemble the durable paipu from saved fragments.
'''
assert old in text, 'final paipu export block not found'
source.write_text(text.replace(old, new, 1))

test_path = Path('tests/mahjong-online-source.test.js')
test_text = test_path.read_text()
marker = 'test("Mahjong room entry stays below the Lua source limit", async () => {'
assert marker in test_text
regression = r'''test("Mahjong final summary view stays within the runtime quota without re-exporting paipu", async () => {
  const result = await runOnlineWithinRuntimeQuota(`
    local started = setup({
      players = ${PLAYERS},
      serverTime = 1000,
      match = {
        id = "final-view-quota",
        ownerId = "p1",
        randomSeed = "0000000000000000000000000000002a",
      },
    })
    local state = started.state
    state.phase = "hand_ended"
    state.matchEnded = true
    state.result = { winnerIndex = 1, deltas = { 1000, -1000, 0, 0 } }
    state.results = { state.result }
    state.resultPage = 2

    -- Inflate only the authoritative hand log.  Final summary rendering must
    -- be independent of its size because clients have already persisted this
    -- hand fragment before reaching the summary page.
    local hand = state.paipu and state.paipu.hands and state.paipu.hands[1]
    hand.commands = {}
    hand.events = {}
    for index = 1, 1200 do
      hand.commands[index] = {
        seat = ((index - 1) % 4) + 1,
        action = { type = "discard", tile = { code = "1m", ref = ((index - 1) % 136) + 1 } },
      }
      hand.events[index] = {
        type = "discarded",
        playerIndex = ((index - 1) % 4) + 1,
        tile = { code = "1m", ref = ((index - 1) % 136) + 1 },
      }
    end

    local projection = __within_quota(function()
      return view(state, {}, { viewer = { id = state.players[1], isOwner = true } })
    end)
    result = {
      summary = projection.state.resultSummaryVisible == true,
      paipu_omitted = projection.state.paipu == nil,
    }
  `);

  assert.deepEqual(result, {
    summary: true,
    paipu_omitted: true,
  });
});

'''
assert 'Mahjong final summary view stays within the runtime quota' not in test_text
test_path.write_text(test_text.replace(marker, regression + marker, 1))
