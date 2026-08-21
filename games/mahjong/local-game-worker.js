import { createLocalLuaGame } from "../../src/local-lua-game.js";

let game;

self.addEventListener("message", ({ data }) => {
  void handleRequest(data);
});

async function handleRequest({ id, type, payload = {} }) {
  try {
    const result = await handle(type, payload);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: error?.name || "Error",
        message: error?.message || "Mahjong worker request failed",
      },
    });
  }
}

async function handle(type, payload) {
  if (type === "init") {
    game?.close();
    game = await createLocalLuaGame(payload.options);
    return {
      matchId: game.matchId,
      projection: game.view(payload.viewerId),
    };
  }
  if (!game) throw new Error("Mahjong worker is not initialized");
  if (type === "view") return game.view(payload.viewerId);
  if (type === "checkpoint") return game.checkpoint();
  if (type === "restoreCheckpoint") {
    return {
      projection: game.restoreCheckpoint(payload.checkpoint, payload.viewerId),
    };
  }
  if (type === "action") {
    const result = game.action(payload.action, payload.actorId);
    return {
      result,
      projection: result?.accepted ? game.view(payload.viewerId) : null,
    };
  }
  if (type === "aiTurn") {
    for (const actorId of payload.actorIds || []) {
      const action = game.aiAction(actorId);
      if (!action) continue;
      const result = game.action(action, actorId);
      return {
        actorId,
        action,
        result,
        projection: result?.accepted ? game.view(payload.viewerId) : null,
      };
    }
    return { action: null, result: null, projection: null };
  }
  throw new TypeError(`Unknown Mahjong worker request: ${type}`);
}
