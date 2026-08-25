/**
 * Async facade for the local rules runtime.  The worker owns the Lua/WASM
 * state so an expensive AI decision never blocks the table renderer.
 */
export async function createLocalLuaGame(options = {}) {
  const worker = new Worker(
    new URL("./local-game-worker.js", import.meta.url),
    { type: "module" },
  );
  const pending = new Map();
  let closed = false;
  let requestId = 0;
  let queue = Promise.resolve();

  const rejectPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  worker.addEventListener("message", ({ data }) => {
    const pendingRequest = pending.get(data?.id);
    if (!pendingRequest) return;
    pending.delete(data.id);
    if (data.ok) pendingRequest.resolve(data.result);
    else {
      const error = new Error(
        data?.error?.message || "Mahjong worker request failed",
      );
      error.name = data?.error?.name || "Error";
      pendingRequest.reject(error);
    }
  });
  worker.addEventListener("error", (event) => {
    rejectPending(
      event.error || new Error(event.message || "Mahjong worker failed"),
    );
  });

  const request = (type, payload) => {
    const run = () => {
      if (closed)
        return Promise.reject(new Error("The local Lua game is closed"));
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({ id, type, payload });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };

  try {
    const sourceUrl = resolveLocalLuaSourceUrl(options.sourceUrl);
    const initialized = await request("init", {
      options: {
        ...options,
        sourceUrl,
        extraSourceUrls: (options.extraSourceUrls ?? []).map((url) =>
          resolveLocalLuaSourceUrl(url),
        ),
      },
      viewerId: options.playerId,
    });
    return {
      matchId: initialized.matchId,
      playerId: options.playerId,
      initialProjection: initialized.projection,
      view(viewerId = options.playerId) {
        return request("view", { viewerId });
      },
      checkpoint() {
        return request("checkpoint");
      },
      exportPaipu() {
        return request("exportPaipu");
      },
      restoreCheckpoint(checkpoint, viewerId = options.playerId) {
        return request("restoreCheckpoint", { checkpoint, viewerId });
      },
      loadReplayHand(hand, viewerId = options.playerId) {
        return request("loadReplayHand", { hand, viewerId });
      },
      action(action, actorId = options.playerId, viewerId = options.playerId) {
        return request("action", { action, actorId, viewerId });
      },
      aiTurn(viewerId = options.playerId) {
        return request("aiTurn", { viewerId });
      },
      aiDecision(viewerId = options.playerId) {
        return request("aiDecision", { viewerId });
      },
      aiAction(state, actorId) {
        return request("aiAction", { state, actorId });
      },
      legalActions(state, viewerId = options.playerId) {
        return request("legalActions", { state, viewerId }).then(
          normalizeLegalActions,
        );
      },
      tenpaiReports(state, viewerId = options.playerId) {
        return request("tenpaiReports", { state, viewerId });
      },
      tenpaiReport(state, tileId, viewerId = options.playerId) {
        return request("tenpaiReport", { state, tileId, viewerId });
      },
      currentTenpaiReport(state, viewerId = options.playerId) {
        return request("currentTenpaiReport", { state, viewerId });
      },
      close() {
        if (closed) return;
        closed = true;
        rejectPending(new Error("The local Lua game is closed"));
        worker.terminate();
      },
    };
  } catch (error) {
    closed = true;
    worker.terminate();
    throw error;
  }
}

function localLuaList(value) {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

function normalizeLegalActions(legalActions) {
  if (!legalActions || typeof legalActions !== "object") return legalActions;
  return {
    ...legalActions,
    riichiTiles: localLuaList(legalActions.riichiTiles),
    selfKans: localLuaList(legalActions.selfKans),
    forbiddenDiscardTypes: localLuaList(legalActions.forbiddenDiscardTypes),
    claims: localLuaList(legalActions.claims).map((claim) => ({
      ...claim,
      tileTypes: localLuaList(claim?.tileTypes),
      red: localLuaList(claim?.red),
    })),
    tenpaiDiscards: localLuaList(legalActions.tenpaiDiscards).map((discard) => ({
      ...discard,
      waits: localLuaList(discard?.waits),
    })),
  };
}

// The worker client is emitted to /assets/ in a production build, while the
// Lua file stays next to the Mahjong page. Resolve relative URLs from the page
// rather than this module so production requests remain under /mahjong/.
export function resolveLocalLuaSourceUrl(
  sourceUrl,
  pageUrl = window.location.href,
) {
  return sourceUrl ? new URL(sourceUrl, pageUrl).href : sourceUrl;
}
