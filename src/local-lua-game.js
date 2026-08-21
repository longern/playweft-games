import { LuaFactory } from "wasmoon";

const LOCAL_BRIDGE = String.raw`
local __local_state = nil
local __local_events = {}
local __local_version = 0
local __local_match_id = ""

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

function __playweft_local_setup(context, match_id, server_time)
  __local_match_id = match_id
  __local_version = 0
  __local_events = {}
  __local_state = setup(context)
  return {
    accepted = true,
    version = __local_version,
    projection = view(
      __local_state,
      __local_events,
      __local_viewer_context(context.players[1].id, server_time)
    ),
  }
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
  end
  return {
    accepted = result.accepted == true,
    error = result.error,
    version = __local_version,
    events = result.events or {},
  }
end

function __playweft_local_ai_action(actor_id)
  if type(ai_action) ~= "function" then return nil end
  return ai_action(__local_state, actor_id)
end

function __playweft_local_checkpoint()
  return {
    state = __local_state,
    events = __local_events,
    version = __local_version,
  }
end

function __playweft_local_restore(checkpoint, viewer_id, server_time)
  if type(checkpoint) ~= "table" or type(checkpoint.state) ~= "table" then
    error("Invalid local game checkpoint")
  end
  __local_state = checkpoint.state
  __local_events = type(checkpoint.events) == "table" and checkpoint.events or {}
  __local_version = math.max(0, math.floor(tonumber(checkpoint.version) or 0))
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
    const chooseAiAction = lua.global.get("__playweft_local_ai_action");
    const createCheckpoint = lua.global.get("__playweft_local_checkpoint");
    const restoreCheckpoint = lua.global.get("__playweft_local_restore");
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
      aiAction(actorId) {
        ensureOpen(closed);
        return chooseAiAction(actorId);
      },
      checkpoint() {
        ensureOpen(closed);
        return createCheckpoint();
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
