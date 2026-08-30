from pathlib import Path

path = Path('games/mahjong/replay/solo-save.js')
text = path.read_text()
old = '''export const MAHJONG_SOLO_SAVE_VERSION = 3;
export const MAHJONG_SOLO_CHECKPOINT_VERSION = 1;
// Increment only when a game.lua state change cannot read an older raw state.
export const MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION = 1;'''
new = '''export const MAHJONG_SOLO_SAVE_VERSION = 4;
export const MAHJONG_SOLO_SEAT_MODEL = "opening-winds";
export const MAHJONG_SOLO_CHECKPOINT_VERSION = 1;
// Increment only when a game.lua state change cannot read an older raw state.
export const MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION = 2;'''
if old in text:
    text = text.replace(old, new, 1)
text = text.replace(
    '    version: MAHJONG_SOLO_SAVE_VERSION,\n    randomSeed,',
    '    version: MAHJONG_SOLO_SAVE_VERSION,\n    seatModel: MAHJONG_SOLO_SEAT_MODEL,\n    randomSeed,',
    1,
)
old = '''    !isPlainObject(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== MAHJONG_SOLO_SAVE_VERSION)
  ) {'''
new = '''    !isPlainObject(value) ||
    value.version !== MAHJONG_SOLO_SAVE_VERSION ||
    value.seatModel !== MAHJONG_SOLO_SEAT_MODEL
  ) {'''
if old in text:
    text = text.replace(old, new, 1)
text = text.replace(
    '    version: MAHJONG_SOLO_SAVE_VERSION,\n    randomSeed: value.randomSeed,',
    '    version: MAHJONG_SOLO_SAVE_VERSION,\n    seatModel: MAHJONG_SOLO_SEAT_MODEL,\n    randomSeed: value.randomSeed,',
    1,
)
path.write_text(text)

path = Path('games/mahjong/app/solo-match-controller.js')
text = path.read_text()
needle = '''        // players[] is already opening East/South/West/North.
        initialDealerSeat: 1,'''
if 'canonicalMatchSeats: true' not in text:
    assert needle in text
    text = text.replace(needle, needle + '\n        canonicalMatchSeats: true,', 1)
path.write_text(text)

path = Path('games/mahjong/online-source.js')
text = path.read_text()
needle = '      initialDealerSeat = 1,\n'
if '      canonicalMatchSeats = true,\n' not in text:
    assert needle in text
    text = text.replace(needle, needle + '      canonicalMatchSeats = true,\n', 1)
path.write_text(text)

path = Path('games/mahjong/game.lua')
text = path.read_text()
needle = '''\t\tmatchEnded = false,
\t\taiPlayers = ai_players or {},
\t\trules = rule_settings(settings),
'''
if 'canonicalMatchSeats = settings and settings.canonicalMatchSeats == true' not in text:
    assert needle in text
    text = text.replace(
        needle,
        '''\t\tmatchEnded = false,
\t\taiPlayers = ai_players or {},
\t\tcanonicalMatchSeats = settings and settings.canonicalMatchSeats == true,
\t\trules = rule_settings(settings),
''',
        1,
    )
old = '''\tif action.type == "new_match" then
\t\tif state.phase ~= "hand_ended" then
\t\t\treturn rejected("game_not_over")
\t\tend
\t\treturn accepted(
\t\t\tnew_match(state.players, state.playerNames, next_match_seed(state.seed), {
\t\t\t\tmatchType = state.matchType,
\t\t\t\trules = state.rules,
\t\t\t}, state.aiPlayers),
\t\t\t{ { type = "new_match", player = actor_id, playerIndex = seat } }
\t\t)
\tend'''
new = '''\tif action.type == "new_match" then
\t\tif state.phase ~= "hand_ended" then
\t\t\treturn rejected("game_not_over")
\t\tend
\t\tlocal next_seed = next_match_seed(state.seed)
\t\tlocal players, names = copy_array(state.players), copy_array(state.playerNames)
\t\tlocal next_settings = {
\t\t\tmatchType = state.matchType,
\t\t\trules = state.rules,
\t\t\tcanonicalMatchSeats = state.canonicalMatchSeats == true,
\t\t}
\t\tif state.canonicalMatchSeats then
\t\t\tlocal seat_draw = (next_seed * RANDOM_MULTIPLIER) % RANDOM_MODULUS
\t\t\tlocal east = (seat_draw % PLAYER_COUNT) + 1
\t\t\tplayers, names = {}, {}
\t\t\tfor offset = 0, PLAYER_COUNT - 1 do
\t\t\t\tlocal source = ((east - 1 + offset) % PLAYER_COUNT) + 1
\t\t\t\tplayers[#players + 1] = state.players[source]
\t\t\t\tnames[#names + 1] = state.playerNames[source]
\t\t\tend
\t\t\tnext_settings.initialDealerSeat = 1
\t\tend
\t\tlocal next_state = new_match(players, names, next_seed, next_settings, state.aiPlayers)
\t\treturn accepted(
\t\t\tnext_state,
\t\t\t{ { type = "new_match", player = actor_id, playerIndex = player_index(next_state, actor_id) } }
\t\t)
\tend'''
if old in text:
    text = text.replace(old, new, 1)
path.write_text(text)

path = Path('tests/mahjong-solo-save.test.js')
text = path.read_text()
if 'MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,' not in text:
    text = text.replace(
        '  MAHJONG_SOLO_SAVE_KEY,\n',
        '  MAHJONG_SOLO_SAVE_KEY,\n  MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,\n  MAHJONG_SOLO_SAVE_VERSION,\n',
        1,
    )
text = text.replace(
    '    engineVersion: 1,\n    stateVersion: 17,',
    '    engineVersion: MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,\n    stateVersion: 17,',
    1,
)
old = '''test("mahjong solo saves upgrade older action logs without a checkpoint or portraits", () => {
  const storage = createStorage();
  storage.setItem(
    MAHJONG_SOLO_SAVE_KEY,
    JSON.stringify({
      ...createSave({
        actions: [{ action: { type: "discard", tileId: 41 }, actorId: "human" }],
      }),
      version: 1,
    }),
  );
  const restored = readMahjongSoloSave(storage);
  assert.ok(restored);
  assert.equal(restored.version, 3);
  assert.equal(restored.checkpoint, null);
  assert.equal(restored.actions.length, 1);
  assert.deepEqual(restored.opponentPortraits, {
    right: "",
    opposite: "",
    left: "",
  });
});'''
new = '''test("mahjong solo saves reject pre-canonical seat models", () => {
  const storage = createStorage();
  storage.setItem(
    MAHJONG_SOLO_SAVE_KEY,
    JSON.stringify({
      ...createSave({
        actions: [{ action: { type: "discard", tileId: 41 }, actorId: "human" }],
      }),
      version: MAHJONG_SOLO_SAVE_VERSION - 1,
      seatModel: undefined,
    }),
  );
  assert.equal(readMahjongSoloSave(storage), null);
});'''
if old in text:
    text = text.replace(old, new, 1)
path.write_text(text)
