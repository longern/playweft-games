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
} = {}) {
  let actionInFlight = false;
  let roomActionRequestId = "";

  const sameCurrentGame = (candidate) => candidate === getGame?.();

  async function dispatch(
    action,
    { source = "manual", onAcceptedProjection } = {},
  ) {
    if (!getState?.()) return false;
    if (source === "manual") scheduler.cancel();
    if (actionInFlight) return false;

    if (getMode?.() === "room") {
      actionInFlight = true;
      const requestId = await sendRoomAction?.(action);
      if (!requestId) {
        actionInFlight = false;
        onRoomUnavailable?.();
        return false;
      }
      roomActionRequestId = requestId;
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

  async function runAiTurn(generation) {
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

    let reschedule = false;
    actionInFlight = true;
    try {
      const outcome = await currentGame.aiTurn(humanId);
      if (!sameCurrentGame(currentGame) || !outcome?.projection) return;
      if (outcome.status === "acted" && !outcome.result?.accepted) {
        onAiActionRejected?.(outcome);
        return;
      }
      if (outcome.status === "acted") {
        await persistAcceptedAction?.(
          outcome.action,
          outcome.actorId,
          outcome.projection,
          currentGame,
        );
        reschedule = true;
      }
      await refreshProjection?.(outcome.projection);
    } catch (error) {
      if (sameCurrentGame(currentGame)) onAiError?.(error);
    } finally {
      actionInFlight = false;
      if (reschedule && sameCurrentGame(currentGame)) scheduleAi();
    }
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
    const autoAction = automaticMahjongAction(
      currentState,
      getAutoActions?.(),
      { riichiMode: getRiichiMode?.() === true },
    );
    if (autoAction) {
      const visibleDecision = ["claim", "tsumo", "discard"].includes(
        autoAction.type,
      );
      scheduler.schedule(
        (generation) => {
          if (!scheduler.isCurrent(generation) || actionInFlight) return;
          const latestAction = automaticMahjongAction(
            getState?.(),
            getAutoActions?.(),
            { riichiMode: getRiichiMode?.() === true },
          );
          if (sameMahjongAction(latestAction, autoAction)) {
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
      return;
    }

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
    scheduler.schedule(
      (generation) => void runAiTurn(generation),
      visualDelay + (delays?.ai ?? 0),
    );
  }

  return {
    dispatch,
    scheduleAi,
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
