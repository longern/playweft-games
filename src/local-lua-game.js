import { LuaFactory } from "wasmoon";

const LOCAL_BRIDGE = String.raw`
local __local_state = nil
local __local_events = {}
local __local_version = 0
local __local_match_id = ""
local __local_paipu_index = 1
local __local_setup_context = nil

local function __local_context(actor_id, action_at)
  local seat = nil
  for index, id in ipairs(__local_state.players or {}) do
    if id == actor_id then seat = index break end
  end
  return {
    protocolVersion = 1,
    matchId = __local_match_id,
    actionId = "local_" .. tostring(__local_version + 1),
    actionAt = action_at,
    version = __local_version,
    actor = {
      id = actor_id,
      role = "player",
      seat = seat,
      isOwner = seat == 1,
    },
  }
end

local function __local_viewer_context(viewer_id, server_time)
  local seat = nil
  for index, id in ipairs(__local_state.players or {}) do
    if id == viewer_id then seat = index break end
  end
  return {
    protocolVersion = 1,
    matchId = __local_match_id,
    version = __local_version,
    serverTime = server_time,
    viewer = {
      id = viewer_id,
      role = "player",
      seat = seat,
      isOwner = seat == 1,
    },
  }
end

local function __local_start(context, match_id, server_time, viewer_id)
  __local_match_id = match_id
  __local_version = 0
  __local_events = {}
	__local_paipu_index = 1
	__local_state = setup(context)
	if type(__local_state.paipu) == "table" then
		__local_state.paipu.createdAtMs = server_time
		__local_state.paipu.recordIndex = __local_paipu_index
	end
  return {
    accepted = true,
    version = __local_version,
    projection = view(
      __local_state,
      __local_events,
      __local_viewer_context(viewer_id or context.players[1].id, server_time)
    ),
  }
end

function __playweft_local_setup(context, match_id, server_time)
  __local_setup_context = context
  return __local_start(context, match_id, server_time, context.players[1].id)
end

function __playweft_local_load_replay_hand(replay_hand, viewer_id, server_time)
  if type(__local_setup_context) ~= "table" then
    error("Local game has not been initialized")
  end
  local base_match = __local_setup_context.match or {}
  local settings = {}
  if type(base_match.settings) == "table" then
    for key, value in pairs(base_match.settings) do
      settings[key] = value
    end
  end
  settings.replayHand = replay_hand
  settings.replayWalls = nil
  return __local_start({
    protocolVersion = __local_setup_context.protocolVersion,
    players = __local_setup_context.players,
    match = {
      id = base_match.id,
      ownerId = base_match.ownerId,
      startedAt = base_match.startedAt,
      randomSeed = base_match.randomSeed,
      settings = settings,
    },
  }, __local_match_id, server_time, viewer_id)
end

function __playweft_local_view(viewer_id, server_time)
  return view(
    __local_state,
    __local_events,
    __local_viewer_context(viewer_id, server_time)
  )
end

function __playweft_local_action(action, actor_id, action_at)
  local result = on_action(
    __local_state,
    action,
    __local_context(actor_id, action_at)
  )
  if result.accepted == true then
    __local_state = result.state
    __local_events = result.events or {}
    __local_version = __local_version + 1
	if action.type == "new_match" then
		__local_paipu_index = __local_paipu_index + 1
		if type(__local_state.paipu) == "table" then
			__local_state.paipu.createdAtMs = action_at
			__local_state.paipu.recordIndex = __local_paipu_index
		end
	elseif type(record_paipu_action) == "function" then
		record_paipu_action(__local_state, action, actor_id, result.events)
	end
  end
  return {
    accepted = result.accepted == true,
    error = result.error,
    version = __local_version,
    events = result.events or {},
  }
end

function __playweft_local_ai_turn(viewer_id, server_time)
  local actor_id = nil
  if __local_state.phase == "playing" then
    actor_id = __local_state.players[__local_state.turnIndex]
  elseif __local_state.phase == "claiming" then
    local claimant = __local_state.claimants[__local_state.claimIndex]
    actor_id = claimant and claimant.playerId or nil
  end

  local projection = __playweft_local_view(viewer_id, server_time)
  if not actor_id then
    return { status = "idle", projection = projection }
  end
  if actor_id == viewer_id then
    return {
      status = "waiting_for_human",
      actorId = actor_id,
      projection = projection,
    }
  end
  if type(ai_action) ~= "function" then
    error("Local game does not provide an AI action")
  end
  local action = ai_action(__local_state, actor_id)
  if type(action) ~= "table" then
    error("AI did not provide an action for the active player")
  end
  local result = __playweft_local_action(action, actor_id, server_time)
  if result.accepted ~= true then
    error("AI action was rejected")
  end
  return {
    status = "acted",
    actorId = actor_id,
    action = action,
    result = result,
    projection = __playweft_local_view(viewer_id, server_time),
  }
end

function __playweft_local_checkpoint()
  return {
    state = __local_state,
    events = __local_events,
    version = __local_version,
  }
end

function __playweft_local_paipu(server_time)
	if type(export_paipu) ~= "function" then
		error("Local game does not provide a paipu exporter")
	end
	local record = export_paipu(__local_state)
	if type(record) ~= "table" then
		return nil
	end
	record.id = __local_match_id .. ":" .. tostring(__local_paipu_index)
	record.createdAtMs = __local_state.paipu and __local_state.paipu.createdAtMs or nil
	if record.status == "completed" then
		record.completedAtMs = server_time
	end
	return record
end

function __playweft_local_restore(checkpoint, viewer_id, server_time)
  if type(checkpoint) ~= "table" or type(checkpoint.state) ~= "table" then
    error("Invalid local game checkpoint")
  end
  __local_state = checkpoint.state
  __local_events = type(checkpoint.events) == "table" and checkpoint.events or {}
  __local_version = math.max(0, math.floor(tonumber(checkpoint.version) or 0))
	__local_paipu_index = math.max(1, math.floor(tonumber(__local_state.paipu and __local_state.paipu.recordIndex) or 1))
  return __playweft_local_view(viewer_id, server_time)
end
`;

/**
 * Runs a Playweft Lua game entirely in the browser while retaining the same
 * setup/on_action/view contract used by the room runtime.
 */
export async function createLocalLuaGame({
  sourceUrl,
  players,
  playerId = players?.[0]?.id,
  randomSeed = crypto.randomUUID().replaceAll("-", ""),
  matchId = `solo-${crypto.randomUUID()}`,
  settings = {},
} = {}) {
  if (!sourceUrl || !Array.isArray(players) || players.length === 0) {
    throw new TypeError("sourceUrl and at least one player are required");
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Unable to load Lua rules (${response.status})`);
  }

  const source = await response.text();
  // Materialize JS objects as Lua tables. Wasmoon's proxy mode exposes them as
  // userdata, which would not match the room runtime's ordinary action tables.
  const lua = await new LuaFactory().createEngine({ enableProxy: false });
  let closed = false;

  try {
    await lua.doString(`${source}\n${LOCAL_BRIDGE}`);
    const setupLocal = lua.global.get("__playweft_local_setup");
    const readView = lua.global.get("__playweft_local_view");
    const applyAction = lua.global.get("__playweft_local_action");
    const loadReplayHand = lua.global.get("__playweft_local_load_replay_hand");
    const advanceAiTurn = lua.global.get("__playweft_local_ai_turn");
    const createCheckpoint = lua.global.get("__playweft_local_checkpoint");
    const restoreCheckpoint = lua.global.get("__playweft_local_restore");
    const exportPaipu = lua.global.get("__playweft_local_paipu");
    const context = {
      protocolVersion: 1,
      players: players.map((player, index) => ({
        id: player.id,
        name: player.name ?? "",
        seat: index + 1,
      })),
      match: {
        id: matchId,
        ownerId: players[0].id,
        startedAt: Date.now(),
        randomSeed: normalizeSeed(randomSeed),
        settings,
      },
    };

    setupLocal(context, matchId, Date.now());

    return {
      matchId,
      playerId,
      view(viewerId = playerId) {
        ensureOpen(closed);
        return readView(viewerId, Date.now());
      },
      action(action, actorId = playerId) {
        ensureOpen(closed);
        return applyAction(action, actorId, Date.now());
      },
      loadReplayHand(replayHand, viewerId = playerId) {
        ensureOpen(closed);
        return loadReplayHand(replayHand, viewerId, Date.now()).projection;
      },
      aiTurn(viewerId = playerId) {
        ensureOpen(closed);
        return advanceAiTurn(viewerId, Date.now());
      },
      checkpoint() {
        ensureOpen(closed);
        return createCheckpoint();
      },
      exportPaipu() {
        ensureOpen(closed);
        return exportPaipu(Date.now());
      },
      restoreCheckpoint(checkpoint, viewerId = playerId) {
        ensureOpen(closed);
        return restoreCheckpoint(
          {
            state: checkpoint?.state,
            events: checkpoint?.events,
            version: checkpoint?.stateVersion,
          },
          viewerId,
          Date.now(),
        );
      },
      close() {
        if (closed) return;
        closed = true;
        lua.global.close();
      },
    };
  } catch (error) {
    lua.global.close();
    throw error;
  }
}

function normalizeSeed(seed) {
  const text = String(seed ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(text)) return text;
  throw new TypeError("randomSeed must be a 32-character lowercase hexadecimal string");
}

function ensureOpen(closed) {
  if (closed) throw new Error("The local Lua game is closed");
}
