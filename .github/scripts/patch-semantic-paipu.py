from pathlib import Path
import re

# game.lua: persist only semantic tile codes/actions. Runtime tile ids, wall refs,
# and claim option indexes must never enter the paipu schema.
p = Path('games/mahjong/game.lua')
s = p.read_text()
s = s.replace('formatVersion = 1,', 'formatVersion = 2,', 1)

# No wall-position identity map is needed for semantic paipu.
s = re.sub(
    r'local function start_paipu_hand\(state, tiles\)\n\tif type\(state\.paipu\) ~= "table" then\n\t\treturn\n\tend\n\tlocal positions = \{\}\n\tfor index, tile in ipairs\(tiles\) do\n\t\tpositions\[tile\] = index - 1\n\tend\n\tstate\.paipuTilePositions = positions\n',
    'local function start_paipu_hand(state, tiles)\n\tif type(state.paipu) ~= "table" then\n\t\treturn\n\tend\n',
    s,
    count=1,
)

start = s.index('local function paipu_tile_reference(state, tile)')
end = s.index('local function finish_paipu_hand(state, hand)', start)
new_block = r'''local function paipu_tile_code(tile)
	if type(tile) ~= "number" or tile < 1 or tile > 136 then
		return nil
	end
	return tile_code(tile)
end

local function semantic_claim_type(kind)
	if kind == "kan" then return "daiminkan" end
	return kind
end

local function semantic_tile_for_kind(kind)
	kind = math.floor(tonumber(kind) or 0)
	if kind < 1 or kind > 34 then return nil end
	return tile_code((kind - 1) * 4 + 1)
end

local function paipu_discard_from_drawn(events, actor_id)
	for _, event in ipairs(events or {}) do
		if (event.type == "discarded" or event.type == "riichi")
			and event.player == actor_id then
			return event.fromDrawn == true
		end
	end
	return false
end

local function paipu_command(state, action, actor_id, events)
	if action.type == "discard" or action.type == "riichi" then
		return {
			type = action.type,
			tile = paipu_tile_code(action.tileId),
			tsumogiri = paipu_discard_from_drawn(events, actor_id),
		}
	end
	if action.type == "claim" then
		local selected_index = math.floor(tonumber(action.option) or 0)
		for _, claimant in ipairs(state.claimants or {}) do
			if claimant.playerId == actor_id then
				local option = claimant.options and claimant.options[selected_index]
				if option then
					local command = { type = semantic_claim_type(option.kind) }
					if option.kind ~= "ron" then
						command.tiles = {}
						for _, tile in ipairs(option.tileIds or {}) do
							command.tiles[#command.tiles + 1] = paipu_tile_code(tile)
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
		return { type = action.kind, tile = semantic_tile_for_kind(action.tileType) }
	end
	if action.type == "pass" or action.type == "tsumo" or action.type == "abort_nine" then
		return { type = action.type }
	end
	return nil
end

local function paipu_event(state, event, sequence)
	local recorded = copy_record_value(event)
	recorded.seq = sequence
	if type(event.tile) == "number" then
		recorded.tile = paipu_tile_code(event.tile)
	end
	return recorded
end

'''
s = s[:start] + new_block + s[end:]
s = s.replace('winningTile = paipu_tile_reference(state, state.winningTile),', 'winningTile = paipu_tile_code(state.winningTile),', 1)
s = s.replace('action = paipu_command(state, action, actor_id),', 'action = paipu_command(state, action, actor_id, events),', 1)
# Skip transport/UI/result acknowledgements and any unsupported action instead of
# leaking their runtime representation into a semantic command log.
s = s.replace(
    '''\tlocal seat = player_index(state, actor_id)\n\thand.commands[#hand.commands + 1] = {\n\t\tseat = seat,\n\t\taction = paipu_command(state, action, actor_id, events),\n\t}\n''',
    '''\tlocal command = paipu_command(state, action, actor_id, events)\n\tif command then\n\t\tlocal seat = player_index(state, actor_id)\n\t\thand.commands[#hand.commands + 1] = { seat = seat, action = command }\n\tend\n''',
    1,
)
p.write_text(s)

# replay-utils.js: semantic paipu -> ephemeral runtime action adapter.
p = Path('games/mahjong/replay/replay-utils.js')
p.write_text(r'''export function replayActionNeedsState(action) {
  return [
    "discard",
    "riichi",
    "chi",
    "pon",
    "daiminkan",
    "ron",
    "ankan",
    "kakan",
  ].includes(action?.type);
}

/** Resolve a durable semantic paipu action against the current canonical Lua state. */
export function resolveReplayAction(action, checkpointState, actorId) {
  if (!action || typeof action !== "object") throw new Error("Paipu action is invalid");
  if (!replayActionNeedsState(action)) return structuredClone(action);
  if (!checkpointState || typeof checkpointState !== "object") {
    throw new Error("Replay state is unavailable");
  }

  if (action.type === "discard" || action.type === "riichi") {
    const tileId = resolveDiscardTile(action, checkpointState, actorId);
    return { type: action.type, tileId };
  }

  if (["chi", "pon", "daiminkan", "ron"].includes(action.type)) {
    return resolveClaim(action, checkpointState, actorId);
  }

  if (action.type === "ankan" || action.type === "kakan") {
    const tileType = tileTypeForCode(action.tile);
    if (!tileType) throw new Error("Paipu kan has an invalid tile code");
    return { type: "kan", kind: action.type, tileType };
  }

  throw new Error(`Unsupported paipu action: ${action.type}`);
}

function resolveDiscardTile(action, state, actorId) {
  const expected = action.tile;
  if (!isTileCode(expected)) throw new Error("Paipu discard has an invalid tile code");
  const drawn = Number(state.drawnTile) || 0;
  if (action.tsumogiri === true) {
    if (!drawn || tileCode(drawn) !== expected) {
      throw new Error("Paipu tsumogiri does not match the current drawn tile");
    }
    return drawn;
  }

  const hand = state.hands?.[actorId] || [];
  const concealed = hand.find((tileId) => tileCode(Number(tileId)) === expected);
  if (concealed) return Number(concealed);
  if (drawn && tileCode(drawn) === expected) return drawn;
  throw new Error("Paipu discard tile is not in the current hand");
}

function resolveClaim(action, state, actorId) {
  const claimant = (state.claimants || []).find((entry) => entry?.playerId === actorId);
  if (!claimant) throw new Error("Paipu claim actor is not an active claimant");
  const runtimeKind = action.type === "daiminkan" ? "kan" : action.type;
  const expectedTiles = sortedCodes(action.tiles || []);
  const optionIndex = (claimant.options || []).findIndex((option) => {
    if (option?.kind !== runtimeKind) return false;
    if (runtimeKind === "ron") return expectedTiles.length === 0;
    return sameCodes(sortedCodes((option.tileIds || []).map((id) => tileCode(Number(id)))), expectedTiles);
  });
  if (optionIndex < 0) throw new Error("Paipu claim does not match any current claim option");
  return { type: "claim", option: optionIndex + 1 };
}

function sortedCodes(values) {
  return Array.isArray(values) ? values.map(String).sort() : [];
}

function sameCodes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function tileTypeForCode(code) {
  if (!isTileCode(code)) return 0;
  if (code[1] === "z") return 27 + Number(code[0]);
  const suit = { m: 0, p: 1, s: 2 }[code[1]];
  const rank = code[0] === "0" ? 5 : Number(code[0]);
  return suit * 9 + rank;
}

export function isTileCode(value) {
  return typeof value === "string" && /^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(value);
}

export function tileCode(tileId) {
  if (tileId === 17) return "0m";
  if (tileId === 53) return "0p";
  if (tileId === 89) return "0s";
  const kind = Math.floor((tileId - 1) / 4) + 1;
  if (kind <= 27) {
    return `${((kind - 1) % 9) + 1}${["m", "p", "s"][Math.floor((kind - 1) / 9)]}`;
  }
  return `${kind - 27}z`;
}

export function waitForReplayStep(speed, stepDelayMs, wait = waitForReplayDelay) {
  const delay = stepDelayMs / Math.max(0.25, Number(speed) || 1);
  return wait(delay);
}

export function waitForReplayDelay(delay, timer = globalThis.setTimeout) {
  return new Promise((resolve) => timer(resolve, delay));
}
''')

# replay controller: no wall-ref identity map. Resolve semantic actions only at
# the execution boundary against the current canonical engine state.
p = Path('games/mahjong/app/replay-controller.js')
s = p.read_text()
s = s.replace('  replayAction,\n  replayTileIdsForWall,\n  resolveReplayClaimAction,', '  replayActionNeedsState,\n  resolveReplayAction,')
s = s.replace('        tileIdsByHand: record.hands.map((hand) => replayTileIdsForWall(hand.wall)),\n', '')
s = re.sub(
    r'  function actionForStep\(current, step\) \{.*?\n  \}\n\n  async function resolvedActionForStep\(current, step, game = getGame\(\)\) \{.*?\n  \}\n',
    '''  function actionForStep(current, step) {\n    return {\n      action: structuredClone(step.command.action),\n      actorId: current.record.players[step.command.seat - 1]?.id,\n      animateDealIn: false,\n    };\n  }\n\n  async function resolvedActionForStep(current, step, game = getGame()) {\n    const entry = actionForStep(current, step);\n    if (!replayActionNeedsState(entry.action)) return entry;\n    const checkpoint = await game?.checkpoint?.();\n    if (!checkpoint?.state) throw new Error("Replay state is unavailable");\n    return {\n      ...entry,\n      action: resolveReplayAction(entry.action, checkpoint.state, entry.actorId),\n    };\n  }\n''',
    s,
    count=1,
    flags=re.S,
)
p.write_text(s)

# Format v2 is intentionally incompatible. Validate semantic command schema and
# canonical seat invariants at persistence/load boundaries.
p = Path('games/mahjong/replay/paipu-store.js')
s = p.read_text()
s = s.replace('record.formatVersion !== 1', 'record.formatVersion !== 2', 1)
s = s.replace('  for (const hand of record.hands) validateHand(hand);', '  validateCanonicalPlayers(record.players);\n  for (const hand of record.hands) validateHand(hand);', 1)
s = s.replace(
    '  if (!Array.isArray(hand.commands) || !Array.isArray(hand.events) || !isPlainObject(hand.end)) {\n    throw new TypeError("Mahjong paipu contains an incomplete hand");\n  }',
    '  if (!Array.isArray(hand.commands) || !Array.isArray(hand.events) || !isPlainObject(hand.end)) {\n    throw new TypeError("Mahjong paipu contains an incomplete hand");\n  }\n  for (const command of hand.commands) validateSemanticCommand(command);',
    1,
)
insert = r'''
function validateCanonicalPlayers(players) {
  const ids = new Set();
  players.forEach((player, index) => {
    if (!isPlainObject(player) || player.seat !== index + 1 || typeof player.id !== "string" || !player.id) {
      throw new TypeError("Mahjong paipu players must use canonical opening seats");
    }
    if (ids.has(player.id)) throw new TypeError("Mahjong paipu player ids must be unique");
    ids.add(player.id);
  });
}

function validateSemanticCommand(command) {
  if (!isPlainObject(command) || !Number.isInteger(command.seat) || command.seat < 1 || command.seat > 4 || !isPlainObject(command.action)) {
    throw new TypeError("Mahjong paipu contains an invalid command");
  }
  const action = command.action;
  const simple = new Set(["pass", "tsumo", "abort_nine"]);
  if (simple.has(action.type)) return;
  if (action.type === "discard" || action.type === "riichi") {
    if (!isTileCode(action.tile) || typeof action.tsumogiri !== "boolean") throw new TypeError("Mahjong paipu contains an invalid semantic discard");
    if ("tileId" in action || "ref" in action || "option" in action) throw new TypeError("Mahjong paipu contains runtime action identity");
    return;
  }
  if (["chi", "pon", "daiminkan"].includes(action.type)) {
    const expected = action.type === "daiminkan" ? 3 : 2;
    if (!Array.isArray(action.tiles) || action.tiles.length !== expected || !action.tiles.every(isTileCode)) {
      throw new TypeError("Mahjong paipu contains an invalid semantic claim");
    }
    if ("option" in action) throw new TypeError("Mahjong paipu contains a runtime claim option");
    return;
  }
  if (action.type === "ron") return;
  if (action.type === "ankan" || action.type === "kakan") {
    if (!isTileCode(action.tile)) throw new TypeError("Mahjong paipu contains an invalid semantic kan");
    return;
  }
  throw new TypeError("Mahjong paipu contains an unsupported semantic action");
}

function isTileCode(value) {
  return typeof value === "string" && /^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(value);
}
'''
s = s.replace('\nfunction isWallEncoding(value) {', insert + '\nfunction isWallEncoding(value) {', 1)
p.write_text(s)

# Update direct paipu tests from wall refs to semantic codes, and add a full
# duplicate-copy chi -> discard replay regression matching the reported 788s case.
p = Path('tests/mahjong-paipu.test.js')
s = p.read_text()
s = s.replace('  assert.ok(Number.isInteger(command.action.tile.ref));\n  assert.equal(command.action.tile.id, undefined);\n  assert.deepEqual(discarded.tile, command.action.tile);', '  assert.match(command.action.tile, /^(?:[1-9][mps]|0[mps]|[1-7]z)$/);\n  assert.equal(typeof command.action.tsumogiri, "boolean");\n  assert.equal(typeof discarded.tile, "string");')
# Replace old replay-ref test details conservatively.
s = re.sub(r'  const replayTileId = tileIdForRef\(wall, record\.hands\[0\]\.commands\[0\]\.action\.tile\.ref\);.*?\n  \);', '''  assert.equal(typeof record.hands[0].commands[0].action.tile, "string");\n  assert.equal(record.formatVersion, 2);''', s, count=1, flags=re.S)
s = s.replace('    formatVersion: 1,', '    formatVersion: 2,', 1)
# Remove obsolete helper functions at file tail.
s = re.sub(r'\nfunction tileIdForRef\(wall, ref\) \{.*\Z', '\n', s, flags=re.S)
p.write_text(s)

# New focused semantic resolver + real Lua round-trip regression.
p = Path('tests/mahjong-semantic-paipu.test.js')
p.write_text(r'''import assert from "node:assert/strict";
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
  assert.equal(record.formatVersion, 2);
  const semantic = record.hands[0].commands.slice(-2).map((entry) => entry.action);
  assert.deepEqual(semantic[0], { type: "chi", tiles: ["7s", "8s"] });
  assert.deepEqual(semantic[1], { type: "discard", tile: "8s", tsumogiri: false });
  assert.equal(JSON.stringify(record).includes('"ref"'), false);
  assert.equal(JSON.stringify(record).includes('"tileId"'), false);
  assert.equal(JSON.stringify(record).includes('"option"'), false);
});
''')

# Existing room integration assertions expect wall refs. Update them to semantic tile codes.
p = Path('tests/mahjong-room-paipu-integration.test.js')
s = p.read_text()
s = s.replace('import {\n  replayAction,\n  replayTileIdsForWall,\n} from "../games/mahjong/replay/replay-utils.js";\n', '')
s = s.replace('  assert.ok(Number.isInteger(discard.action.tile?.ref));\n\n  const replayTiles = replayTileIdsForWall(validated.hands[0].wall);\n  const replayed = replayAction(discard.action, replayTiles);\n  assert.ok(Number.isInteger(replayed.tileId) && replayed.tileId > 0);', '  assert.match(discard.action.tile, /^(?:[1-9][mps]|0[mps]|[1-7]z)$/);\n  assert.equal(typeof discard.action.tsumogiri, "boolean");')
s = s.replace('and type(ai_command.action.tile.ref) == "number"', 'and type(ai_command.action.tile) == "string"')
s = s.replace('and type(timer_command.action.tile.ref) == "number"', 'and type(timer_command.action.tile) == "string"')
p.write_text(s)
