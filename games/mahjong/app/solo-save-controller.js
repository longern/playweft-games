import {
  appendMahjongSoloAction,
  clearMahjongSoloSave,
  MAHJONG_SOLO_CHECKPOINT_VERSION,
  MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
  writeMahjongSoloSave,
  setMahjongSoloCheckpoint,
} from "../replay/solo-save.js";

/** Keeps local-match persistence separate from the action and UI lifecycles. */
export function createMahjongSoloSaveController({
  initialSave,
  humanId,
  getThemeController,
  saveCompletedPaipu,
}) {
  let save = initialSave;

  function get() {
    return save;
  }

  function set(next) {
    save = next;
  }

  function write(next = save) {
    save = next;
    if (next) writeMahjongSoloSave(next);
  }

  function clear() {
    clearMahjongSoloSave();
    save = null;
  }

  async function persistAcceptedAction(action, actorId, projection, game) {
    if (!save) return;
    let next = appendMahjongSoloAction(save, action, actorId);
    if (!next) return;
    if (projection?.state?.phase === "hand_ended" && game) {
      try {
        const snapshot = await game.checkpoint();
        next =
          setMahjongSoloCheckpoint(next, {
            formatVersion: MAHJONG_SOLO_CHECKPOINT_VERSION,
            actionIndex: next.actions.length,
            state: snapshot.state,
            events: snapshot.events,
            engineVersion: MAHJONG_SOLO_ENGINE_CHECKPOINT_VERSION,
            stateVersion: snapshot.version,
          }) || next;
      } catch (error) {
        console.warn(
          "Mahjong save checkpoint failed; keeping the action log",
          error,
        );
      }
    }
    write(next);
    if (!projection?.state?.matchEnded || !game?.exportPaipu) return;
    try {
      const paipu = {
        ...(await game.exportPaipu()),
        viewerPlayerId: game.playerId || humanId,
      };
      const themeController = getThemeController?.();
      paipu.playerPresentations =
        save?.playerPresentations ||
        themeController?.getPaipuPlayerPresentations?.(
          paipu.players,
          paipu.viewerPlayerId,
        ) ||
        {};
      if (paipu.status === "completed") await saveCompletedPaipu?.(paipu);
    } catch (error) {
      console.warn("Mahjong paipu save failed", error);
    }
  }

  return { clear, get, persistAcceptedAction, set, write };
}
