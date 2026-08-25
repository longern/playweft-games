import { automaticMahjongAction, sameMahjongAction } from "../rules/auto-actions.js";
import {
  createMahjongAutoActionScheduler,
  shouldScheduleMahjongAiTurn,
} from "../rules/auto-action-scheduler.js";
import { automaticRiichiDiscard } from "../rules/game-format.js";

/**
 * Owns the authoritative Mahjong action lifecycle. Page code supplies the
 * transport and presentation callbacks, so a render or audio concern cannot
 * alter action locking, AI scheduling, or worker ownership.
 */
export function createMahjongSessionController({
  humanId,
  getMode,
  getGame,
  getState,
  getAutoActions,
  getRiichiMode,
  isKanDrawPending,
  sendRoomAction,
  onRoomUnavailable,
  persistAcceptedAction,
  refreshProjection,
  onSoloActionAccepted,
  onActionRejected,
  onActionError,
  onProjectionTransitionError,
  onAiActionRejected,
  onAiError,
  delays,
  scheduler = createMahjongAutoActionScheduler(),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  wait = (delay) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, delay))),
} = {}) {
  let actionInFlight = false;
  let roomActionRequestId = "";

  const sameCurrentGame = (candidate) => candidate === getGame?.();

  const aiTurnKey = (state) =>
    JSON.stringify([
      state?.phase,
      state?.turnIndex,
      state?.moveCount,
      state?.drawnTile,
      state?.lastDiscard,
    ]);

  async function dispatch(
    action,
    { source = "manual", onAcceptedProjection } = {},
  ) {
    if (!getState?.() && getMode?.() !== "room") return false;
    if (source === "manual") scheduler.cancel();
    if (actionInFlight) return false;

    if (getMode?.() === "room") {
      actionInFlight = true;
      const requestId = await sendRoomAction?.(action, {
        onRequestStarted(startedRequestId) {
          if (typeof startedRequestId === "string" && startedRequestId) {
            roomActionRequestId = startedRequestId;
          }
        },
      });
      if (!requestId) {
        actionInFlight = false;
        onRoomUnavailable?.();
        return false;
      }
      if (!roomActionRequestId) roomActionRequestId = requestId;
      return true;
    }

    const currentGame = getGame?.();
    if (!currentGame) return false;
    let reschedule = false;
    actionInFlight = true;
    try {
      const outcome = await currentGame.action(action, humanId);
      if (!sameCurrentGame(currentGame)) return false;
      if (!outcome.result?.accepted) {
        onActionRejected?.(outcome.result?.error?.code);
        return false;
      }
      await persistAcceptedAction?.(
        action,
        humanId,
        outcome.projection,
        currentGame,
      );
      onSoloActionAccepted?.(action, outcome.projection);
      if (onAcceptedProjection) {
        try {
          await onAcceptedProjection(outcome.projection, currentGame);
        } catch (error) {
          onProjectionTransitionError?.(error);
          await refreshProjection?.(outcome.projection);
        }
      } else {
        await refreshProjection?.(outcome.projection, {
          ownDiscardedTile:
            action.type === "discard" || action.type === "riichi"
              ? Number(action.tileId) || 0
              : 0,
        });
      }
      reschedule = true;
      return true;
    } catch (error) {
      if (sameCurrentGame(currentGame)) onActionError?.(error);
      return false;
    } finally {
      actionInFlight = false;
      if (reschedule && sameCurrentGame(currentGame)) scheduleAi();
    }
  }

  async function runAiTurn(generation, startedAt, minimumDelay) {
    const currentGame = getGame?.();
    const currentState = getState?.();
    if (
      getMode?.() !== "solo" ||
      !currentGame ||
      !currentState ||
      currentState.phase === "hand_ended" ||
      actionInFlight ||
      !scheduler.isCurrent(generation)
    ) {
      return;
    }

    const initialTurnKey = aiTurnKey(currentState);
    let reschedule = false;
    actionInFlight = true;
    try {
      const outcome = await currentGame.aiDecision(humanId);
      if (
        !sameCurrentGame(currentGame) ||
        !scheduler.isCurrent(generation) ||
        outcome?.status !== "acted" ||
        !outcome.action ||
        outcome.version === undefined
      ) {
        return;
      }
      const remainingDelay = minimumDelay - (now() - startedAt);
      if (remainingDelay > 0) await wait(remainingDelay);
      if (
        !sameCurrentGame(currentGame) ||
        !scheduler.isCurrent(generation) ||
        aiTurnKey(getState?.()) !== initialTurnKey
      ) {
        return;
      }
      const applied = await currentGame.action(
        outcome.action,
        outcome.actorId,
        humanId,
      );
      if (!sameCurrentGame(currentGame)) return;
      if (!applied?.result?.accepted) {
        onAiActionRejected?.({ ...outcome, result: applied?.result });
        return;
      }
      await persistAcceptedAction?.(
        outcome.action,
        outcome.actorId,
        applied.projection,
        currentGame,
      );
      reschedule = true;
      await refreshProjection?.(applied.projection);
    } catch (error) {
      if (sameCurrentGame(currentGame)) onAiError?.(error);
    } finally {
      actionInFlight = false;
      if (reschedule && sameCurrentGame(currentGame)) scheduleAi();
    }
  }

  function scheduleAutomaticAction(
    currentState,
    { visualDelay = 0, isCurrent = () => true, skipPassClaims = false } = {},
  ) {
    if (
      !currentState ||
      currentState.phase === "hand_ended" ||
      isKanDrawPending?.()
    ) {
      return false;
    }
    const automaticActions = {
      ...getAutoActions?.(),
      ...(skipPassClaims ? { passClaims: false } : {}),
    };
    const autoAction = automaticMahjongAction(
      currentState,
      automaticActions,
      { riichiMode: getRiichiMode?.() === true },
    );
    if (!autoAction) return false;
    const visibleDecision = ["claim", "tsumo", "discard"].includes(
      autoAction.type,
    );
    scheduler.schedule(
      (generation) => {
        if (!scheduler.isCurrent(generation) || actionInFlight || !isCurrent())
          return;
        const latestAction = automaticMahjongAction(
          getState?.(),
          {
            ...getAutoActions?.(),
            ...(skipPassClaims ? { passClaims: false } : {}),
          },
          { riichiMode: getRiichiMode?.() === true },
        );
        if (isCurrent() && sameMahjongAction(latestAction, autoAction)) {
          void dispatch(autoAction, { source: "automatic" });
        }
      },
      visibleDecision
        ? Math.max(
            visualDelay,
            autoAction.type === "claim" ? 0 : delays?.ownDrawEntry ?? 0,
          ) + (delays?.autoDecision ?? 0)
        : 0,
    );
    return true;
  }

  function scheduleRoomAutomaticAction({ state, isCurrent } = {}) {
    scheduler.cancel();
    if (getMode?.() !== "room") return;
    scheduleAutomaticAction(state ?? getState?.(), {
      isCurrent,
      skipPassClaims: true,
    });
  }

  function scheduleAi({ afterDealIn = false } = {}) {
    scheduler.cancel();
    const currentState = getState?.();
    if (
      getMode?.() !== "solo" ||
      !currentState ||
      currentState.phase === "hand_ended" ||
      isKanDrawPending?.()
    ) {
      return;
    }

    const visualDelay = afterDealIn ? delays?.newHandDeal ?? 0 : 0;
    if (scheduleAutomaticAction(currentState, { visualDelay })) return;

    const automaticTile = automaticRiichiDiscard(currentState, humanId);
    if (automaticTile) {
      scheduler.schedule(
        (generation) => {
          if (!scheduler.isCurrent(generation) || actionInFlight) return;
          if (automaticRiichiDiscard(getState?.(), humanId) === automaticTile) {
            void dispatch(
              { type: "discard", tileId: automaticTile },
              { source: "automatic" },
            );
          }
        },
        Math.max(visualDelay, delays?.ownDrawEntry ?? 0) +
          (delays?.autoDecision ?? 0),
      );
      return;
    }

    if (!shouldScheduleMahjongAiTurn(currentState)) return;
    const startedAt = now();
    scheduler.schedule(
      (generation) =>
        void runAiTurn(
          generation,
          startedAt,
          visualDelay + (delays?.ai ?? 0),
        ),
      0,
    );
  }

  return {
    dispatch,
    scheduleAi,
    scheduleRoomAutomaticAction,
    cancelScheduledActions() {
      scheduler.cancel();
    },
    isActionInFlight() {
      return actionInFlight;
    },
    confirmRoomState() {
      actionInFlight = false;
      roomActionRequestId = "";
    },
    rejectRoomAction(requestId) {
      if (requestId && requestId !== roomActionRequestId) return false;
      actionInFlight = false;
      roomActionRequestId = "";
      return true;
    },
  };
}
