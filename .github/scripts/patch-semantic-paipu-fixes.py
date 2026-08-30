from pathlib import Path

# Keep game.lua below Lua's 200-local chunk limit. Reuse existing tile_code
# directly and keep only the two recorder functions that replaced the old three.
p = Path('games/mahjong/game.lua')
s = p.read_text()
start = s.index('local function paipu_tile_code(tile)')
end = s.index('local function finish_paipu_hand(state, hand)', start)
block = r'''local function paipu_command(state, action, actor_id, events)
	if action.type == "discard" or action.type == "riichi" then
		local tsumogiri = false
		for _, event in ipairs(events or {}) do
			if (event.type == "discarded" or event.type == "riichi") and event.player == actor_id then
				tsumogiri = event.fromDrawn == true
				break
			end
		end
		return { type = action.type, tile = tile_code(action.tileId), tsumogiri = tsumogiri }
	end
	if action.type == "claim" then
		local selected_index = math.floor(tonumber(action.option) or 0)
		for _, claimant in ipairs(state.claimants or {}) do
			if claimant.playerId == actor_id then
				local option = claimant.options and claimant.options[selected_index]
				if option then
					local command = { type = option.kind == "kan" and "daiminkan" or option.kind }
					if option.kind ~= "ron" then
						command.tiles = {}
						for _, tile in ipairs(option.tileIds or {}) do
							command.tiles[#command.tiles + 1] = tile_code(tile)
						end
					end
					return command
				end
				break
			end
		end
		return nil
	end
	if action.type == "kan" and (action.kind == "ankan" or action.kind == "kakan") then
		local kind = math.floor(tonumber(action.tileType) or 0)
		return kind >= 1 and kind <= 34
			and { type = action.kind, tile = tile_code((kind - 1) * 4 + 1) }
			or nil
	end
	if action.type == "pass" or action.type == "tsumo" or action.type == "abort_nine" then
		return { type = action.type }
	end
	return nil
end

local function paipu_event(state, event, sequence)
	local recorded = copy_record_value(event)
	recorded.seq = sequence
	if type(event.tile) == "number" and event.tile >= 1 and event.tile <= 136 then
		recorded.tile = tile_code(event.tile)
	end
	return recorded
end

'''
s = s[:start] + block + s[end:]
s = s.replace(
    'winningTile = paipu_tile_code(state.winningTile),',
    'winningTile = type(state.winningTile) == "number" and state.winningTile > 0 and tile_code(state.winningTile) or nil,',
)
p.write_text(s)

# Update remaining old coordinate/ref tests to the v2 semantic resolver.
p = Path('tests/mahjong-paipu-replay-coordinates.test.js')
s = p.read_text()
start = s.index('import {\n  replayAction,')
end = s.index('\n\ntest("Mahjong paipu players', start)
s = s[:start] + 'import { resolveReplayAction } from "../games/mahjong/replay/replay-utils.js";' + s[end:]
old_start = s.index('test("recorded claim wall refs')
s = s[:old_start] + r'''test("semantic claim matching ignores interchangeable normal copies but preserves face identity", () => {
  const actorId = "south";
  const checkpointState = {
    claimants: [{
      playerId: actorId,
      options: [
        { kind: "chi", tileIds: [97, 101] },
        { kind: "chi", tileIds: [97, 89] },
      ],
    }],
  };
  assert.deepEqual(
    resolveReplayAction({ type: "chi", tiles: ["7s", "8s"] }, checkpointState, actorId),
    { type: "claim", option: 1 },
  );
});
''' 
p.write_text(s)

# One old assertion still dereferenced semantic tile as {code,ref}.
p = Path('tests/mahjong-paipu.test.js')
s = p.read_text()
s = s.replace('assert.match(command.action.tile.code,', 'assert.match(command.action.tile,')
p.write_text(s)
