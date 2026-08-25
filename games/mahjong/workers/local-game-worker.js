import { createLocalLuaGame } from "../../../src/local-lua-game.js";

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
  if (type === "exportPaipu") return game.exportPaipu();
  if (type === "restoreCheckpoint") {
    return {
      projection: game.restoreCheckpoint(payload.checkpoint, payload.viewerId),
    };
  }
  if (type === "loadReplayHand") {
    return {
      projection: game.loadReplayHand(payload.hand, payload.viewerId),
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
    return game.aiTurn(payload.viewerId);
  }
  if (type === "aiDecision") {
    return game.aiDecision(payload.viewerId);
  }
  if (type === "aiAction") {
    return game.aiAction(payload.state, payload.actorId);
  }
  if (type === "legalActions") {
    return game.legalActions(payload.state, payload.viewerId);
  }
  if (type === "tenpaiReports") {
    return game.tenpaiReports(payload.state, payload.viewerId);
  }
  if (type === "tenpaiReport") {
    return game.tenpaiReport(payload.state, payload.tileId, payload.viewerId);
  }
  if (type === "currentTenpaiReport") {
    return game.currentTenpaiReport(payload.state, payload.viewerId);
  }
  throw new TypeError(`Unknown Mahjong worker request: ${type}`);
}
