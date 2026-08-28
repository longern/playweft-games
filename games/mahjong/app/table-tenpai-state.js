import {
  asArray,
  tenpaiDiscardFuriten,
  tenpaiWaitsForDiscard,
} from "../rules/game-format.js";

function normalizeWaits(report) {
  return asArray(report?.waits)
    .map((wait) => ({
      type: Number(typeof wait === "object" ? wait?.type : wait) || 0,
      noYaku: wait?.noYaku === true,
    }))
    .filter((wait) => wait.type >= 1 && wait.type <= 34);
}

function localHandKey(state) {
  const playerId = asArray(state?.players)[0];
  return JSON.stringify([
    asArray(state?.ownHand).map(Number),
    Number(state?.drawnTile) || 0,
    asArray(state?.melds?.[playerId]),
  ]);
}

function hasLocalRiichi(state) {
  const playerId = asArray(state?.players)[0];
  return Boolean(playerId && state?.riichi?.[playerId] === true);
}

/**
 * Holds the local lifecycle of a confirmed wait. It knows nothing about DOM,
 * worker requests, or network actions; callers supply authoritative snapshots
 * and use its derived result for rendering.
 */
export function createMahjongTableTenpaiState() {
  let confirmedWait = null;
  let confirmedWaitHandKey = "";
  let pendingWait = null;
  let lockedRiichiWait = null;
  let previewIntent = { source: "none", pointerId: 0, tileId: 0 };

  function clearConfirmedWait() {
    confirmedWait = null;
    confirmedWaitHandKey = "";
    pendingWait = null;
  }

  function clearPreviewIntent({ source } = {}) {
    if (source && previewIntent.source !== source) return false;
    previewIntent = { source: "none", pointerId: 0, tileId: 0 };
    return true;
  }

  function reset() {
    clearConfirmedWait();
    lockedRiichiWait = null;
    clearPreviewIntent();
  }

  function sync(state) {
    if (!hasLocalRiichi(state)) {
      lockedRiichiWait = null;
    } else if (!lockedRiichiWait && confirmedWait?.waits?.length) {
      lockedRiichiWait = confirmedWait;
    }
    if (!confirmedWait?.waits?.length) return;
    if (!["playing", "claiming"].includes(state?.phase)) {
      clearConfirmedWait();
      return;
    }
    const handKey = localHandKey(state);
    if (!confirmedWaitHandKey) {
      confirmedWaitHandKey = handKey;
    } else if (confirmedWaitHandKey !== handKey) {
      clearConfirmedWait();
      return;
    }
    if (
      !hasLocalRiichi(state) &&
      state?.phase === "playing" &&
      Number(state?.turnIndex) === 1
    ) {
      clearConfirmedWait();
    }
  }

  function waitForDiscard(legalActions, action) {
    const waits = tenpaiWaitsForDiscard(legalActions, action?.tileId, {
      declaringRiichi: action?.type === "riichi",
    });
    if (waits.length === 0) return null;
    return {
      waits,
      furiten: tenpaiDiscardFuriten(legalActions, action?.tileId),
    };
  }

  function setPendingDiscard(legalActions, action) {
    pendingWait = waitForDiscard(legalActions, action);
    return pendingWait;
  }

  function resolvePendingDiscard(status, nextState) {
    if (status === "confirmed") {
      confirmedWait = pendingWait;
      confirmedWaitHandKey = confirmedWait ? localHandKey(nextState) : "";
    } else if (status === "rejected") {
      confirmedWait = null;
      confirmedWaitHandKey = "";
    } else {
      return;
    }
    pendingWait = null;
  }

  function confirmImmediateDiscard(legalActions, action) {
    pendingWait = null;
    confirmedWait = waitForDiscard(legalActions, action);
    confirmedWaitHandKey = "";
    return confirmedWait;
  }

  function rollbackPendingDiscard() {
    pendingWait = null;
    confirmedWait = null;
    confirmedWaitHandKey = "";
    clearPreviewIntent({ source: "drag" });
  }

  function applyLockedWait(report) {
    const waits = normalizeWaits(report);
    const next = waits.length > 0
      ? { waits, furiten: report?.furiten === true }
      : null;
    if (JSON.stringify(next) === JSON.stringify(lockedRiichiWait)) return false;
    lockedRiichiWait = next;
    return true;
  }

  function confirmed(state) {
    if (hasLocalRiichi(state) && lockedRiichiWait?.waits?.length)
      return lockedRiichiWait;
    if (
      !confirmedWait?.waits?.length ||
      !["playing", "claiming"].includes(state?.phase) ||
      (state?.phase === "playing" && Number(state.turnIndex) === 1)
    )
      return null;
    return confirmedWait;
  }

  function preview({ state, legalActions, selectedTileId, riichiMode }) {
    if (state?.phase === "hand_ended") return null;
    if (previewIntent.source === "status-hold") return confirmed(state);
    if (previewIntent.source === "drag") {
      return waitForDiscard(legalActions, {
        type: riichiMode ? "riichi" : "discard",
        tileId: previewIntent.tileId,
      });
    }
    return waitForDiscard(legalActions, {
      type: riichiMode ? "riichi" : "discard",
      tileId: selectedTileId,
    });
  }

  function beginConfirmedPreview(state, pointerId = 0) {
    if (!confirmed(state)) return false;
    previewIntent = {
      source: "status-hold",
      pointerId: Number(pointerId) || 0,
      tileId: 0,
    };
    return true;
  }

  function endConfirmedPreview(pointerId = 0) {
    if (
      previewIntent.source !== "status-hold" ||
      (pointerId && previewIntent.pointerId &&
        Number(pointerId) !== previewIntent.pointerId)
    ) {
      return false;
    }
    clearPreviewIntent();
    return true;
  }

  function beginDragPreview(tileId) {
    previewIntent = {
      source: "drag",
      pointerId: 0,
      tileId: Number(tileId) || 0,
    };
  }

  function endDragPreview() {
    return clearPreviewIntent({ source: "drag" });
  }

  return {
    reset,
    clearConfirmedWait,
    sync,
    clearPreviewIntent,
    setPendingDiscard,
    resolvePendingDiscard,
    confirmImmediateDiscard,
    rollbackPendingDiscard,
    applyLockedWait,
    confirmed,
    preview,
    beginConfirmedPreview,
    endConfirmedPreview,
    beginDragPreview,
    endDragPreview,
  };
}
