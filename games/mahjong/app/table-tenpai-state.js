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

function localHandIdentity(state) {
  return JSON.stringify([
    asArray(state?.players)[0],
    Number(state?.roundWind) || 0,
    Number(state?.handNumber) || 0,
  ]);
}

function hasLocalRiichi(state) {
  const playerId = asArray(state?.players)[0];
  return Boolean(playerId && state?.riichi?.[playerId] === true);
}

/**
 * Pure UI state for the local tenpai indicators.
 *
 * There are deliberately three independent lifecycles:
 * - discardPreview: a transient selected/dragged discard calculation;
 * - ordinaryWait: a confirmed post-discard wait, visible only away from the
 *   local turn;
 * - riichiWait: a hand-scoped wait that stays visible for the whole hand,
 *   including the optimistic request window and every remote turn.
 *
 * Long-press owns a snapshot of whichever status was visible at pointer-down;
 * rendering or network updates cannot replace that snapshot until pointer-up.
 */
export function createMahjongTableTenpaiState() {
  let ordinaryWait = null;
  let ordinaryWaitHandKey = "";
  let pendingWait = null;
  let pendingActionType = "";
  let riichiWait = null;
  let riichiPending = false;
  let riichiHandIdentity = "";
  let previewIntent = { source: "none", pointerId: 0, tileId: 0 };
  let heldPreviewWait = null;

  function clearHeldPreview() {
    previewIntent = { source: "none", pointerId: 0, tileId: 0 };
    heldPreviewWait = null;
  }

  function clearOrdinaryWait() {
    ordinaryWait = null;
    ordinaryWaitHandKey = "";
    pendingWait = null;
    pendingActionType = "";
  }

  function clearRiichiWait() {
    riichiWait = null;
    riichiPending = false;
    riichiHandIdentity = "";
  }

  function reset() {
    clearOrdinaryWait();
    clearRiichiWait();
    clearHeldPreview();
  }

  function clearHand() {
    clearOrdinaryWait();
    clearRiichiWait();
    clearHeldPreview();
  }

  function sync(state) {
    if (state?.phase === 'hand_ended') {
      clearRiichiWait();
      clearHeldPreview();
    }
    const nextHandIdentity = localHandIdentity(state);
    if (riichiHandIdentity && riichiHandIdentity !== nextHandIdentity) {
      clearRiichiWait();
      clearHeldPreview();
    }

    if (!riichiHandIdentity && (hasLocalRiichi(state) || riichiPending))
      riichiHandIdentity = nextHandIdentity;

    // The authoritative state ends the optimistic request. It never erases a
    // valid wait; only an explicit hand boundary/reset does that.
    if (hasLocalRiichi(state)) riichiPending = false;

    if (!ordinaryWait?.waits?.length) return;
    if (!['playing', 'claiming'].includes(state?.phase)) {
      clearOrdinaryWait();
      return;
    }
    const handKey = localHandKey(state);
    if (!ordinaryWaitHandKey) ordinaryWaitHandKey = handKey;
    else if (ordinaryWaitHandKey !== handKey) clearOrdinaryWait();
    if (
      !hasLocalRiichi(state) &&
      state?.phase === 'playing' &&
      Number(state.turnIndex) === 1
    ) clearOrdinaryWait();
  }

  function waitForDiscard(legalActions, action) {
    const waits = tenpaiWaitsForDiscard(legalActions, action?.tileId, {
      declaringRiichi: action?.type === 'riichi',
    });
    if (waits.length === 0) return null;
    return {
      waits,
      furiten: tenpaiDiscardFuriten(legalActions, action?.tileId),
    };
  }

  function setPendingDiscard(legalActions, action, state) {
    pendingWait = waitForDiscard(legalActions, action);
    pendingActionType = action?.type || '';
    if (pendingActionType === 'riichi') {
      riichiPending = true;
      riichiHandIdentity = riichiHandIdentity || localHandIdentity(state);
      if (pendingWait?.waits?.length) riichiWait = pendingWait;
    }
    return pendingWait;
  }

  function resolvePendingDiscard(status, nextState) {
    if (status === 'confirmed') {
      if (pendingActionType === 'riichi') {
        riichiPending = false;
        riichiHandIdentity = localHandIdentity(nextState);
        if (pendingWait?.waits?.length) riichiWait = pendingWait;
      } else {
        ordinaryWait = pendingWait;
        ordinaryWaitHandKey = ordinaryWait ? localHandKey(nextState) : '';
      }
    } else if (status === 'rejected') {
      if (pendingActionType === 'riichi') clearRiichiWait();
      clearOrdinaryWait();
    } else return;
    pendingWait = null;
    pendingActionType = '';
  }

  function confirmImmediateDiscard(legalActions, action) {
    pendingWait = null;
    pendingActionType = '';
    ordinaryWait = waitForDiscard(legalActions, action);
    ordinaryWaitHandKey = '';
    return ordinaryWait;
  }

  function rollbackPendingDiscard() {
    if (pendingActionType === 'riichi') clearRiichiWait();
    clearOrdinaryWait();
    if (previewIntent.source === 'drag') clearHeldPreview();
  }

  function applyLockedWait(report) {
    const waits = normalizeWaits(report);
    // Empty reports are worker misses, not authoritative evidence that a
    // riichi hand stopped waiting.
    if (waits.length === 0 && riichiWait?.waits?.length) return false;
    if (waits.length === 0) return false;
    const next = { waits, furiten: report?.furiten === true };
    if (JSON.stringify(next) === JSON.stringify(riichiWait)) return false;
    riichiWait = next;
    return true;
  }

  function confirmed(state) {
    if (riichiWait?.waits?.length &&
      ['playing', 'claiming'].includes(state?.phase))
      return riichiWait;
    if (
      !ordinaryWait?.waits?.length ||
      !['playing', 'claiming'].includes(state?.phase) ||
      (state?.phase === 'playing' && Number(state.turnIndex) === 1)
    ) return null;
    return ordinaryWait;
  }

  function preview({ state, legalActions, selectedTileId, riichiMode }) {
    if (state?.phase === 'hand_ended') return null;
    if (previewIntent.source === 'status-hold')
      return heldPreviewWait || confirmed(state);
    if (previewIntent.source === 'drag') {
      return waitForDiscard(legalActions, {
        type: riichiMode ? 'riichi' : 'discard',
        tileId: previewIntent.tileId,
      });
    }
    return waitForDiscard(legalActions, {
      type: riichiMode ? 'riichi' : 'discard',
      tileId: selectedTileId,
    });
  }

  function beginConfirmedPreview(state, pointerId = 0) {
    const wait = confirmed(state);
    if (!wait) return false;
    heldPreviewWait = wait;
    previewIntent = {
      source: 'status-hold',
      pointerId: Number(pointerId) || 0,
      tileId: 0,
    };
    return true;
  }

  function endConfirmedPreview(pointerId = 0) {
    if (
      previewIntent.source !== 'status-hold' ||
      (pointerId && previewIntent.pointerId &&
        Number(pointerId) !== previewIntent.pointerId)
    ) return false;
    clearHeldPreview();
    return true;
  }

  function beginDragPreview(tileId) {
    previewIntent = { source: 'drag', pointerId: 0, tileId: Number(tileId) || 0 };
    heldPreviewWait = null;
  }

  function endDragPreview() {
    if (previewIntent.source !== 'drag') return false;
    clearHeldPreview();
    return true;
  }

  return {
    reset,
    clearHand,
    clearConfirmedWait: clearOrdinaryWait,
    sync,
    clearPreviewIntent: ({ source } = {}) => {
      if (source && previewIntent.source !== source) return false;
      // A status-hold is owned by the active pointer gesture. Generic action
      // UI cleanup must not end it; only pointer end/cancel or a hand reset may.
      if (!source && previewIntent.source === 'status-hold') return false;
      clearHeldPreview();
      return true;
    },
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