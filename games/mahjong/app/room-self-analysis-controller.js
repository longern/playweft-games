import { createLocalLuaGame } from "../workers/local-game-worker-client.js";
import { asArray } from "../rules/game-format.js";
import {
  buildRoomLockedWaitState,
  buildRoomSelfActionState,
  roomLockedWaitKey,
} from "../rules/room-self-analysis.js";
import { roomLegalStateKey } from "../rules/room-utils.js";

/**
 * Owns all private, client-side room analysis. It is deliberately separate
 * from room lifecycle and table rendering: projections enter here, workers
 * produce analysis, and the table receives only finished results.
 */
export function createMahjongRoomSelfAnalysisController({
  createGame = createLocalLuaGame,
  getPlayerId,
  getDestroyed,
  isRoom,
  applyLegalActions,
  applyLockedWait,
  onLegalActionsReady,
  onLegalActionsInvalidated,
} = {}) {
  let game;
  let playerIds = "";
  let gameReady;
  let legalRequest = 0;
  let legalRequestedKey = "";
  let legalAppliedKey = "";
  let lockedWaitRequest = 0;
  let lockedWaitRequestedKey = "";

  async function ensureGame(state) {
    const players = asArray(state?.players).map((id) => ({ id, name: id }));
    const nextPlayerIds = JSON.stringify(asArray(state?.players));
    if (!players.length) return undefined;
    if (game && playerIds === nextPlayerIds) return game;
    if (gameReady && playerIds === nextPlayerIds) return gameReady;
    game?.close();
    game = undefined;
    playerIds = nextPlayerIds;
    const ready = createGame({
      sourceUrl: "./game.lua",
      players,
      playerId: getPlayerId?.(),
    }).then((createdGame) => {
      if (getDestroyed?.() || playerIds !== nextPlayerIds) {
        createdGame.close();
        return undefined;
      }
      game = createdGame;
      return createdGame;
    });
    gameReady = ready;
    try {
      return await ready;
    } finally {
      if (gameReady === ready) gameReady = undefined;
    }
  }

  function sync(state) {
    scheduleLegalActions(state);
    scheduleLockedWait(state);
  }

  function hasCurrentLegalActions(state) {
    return state?.phase !== "playing" ||
      legalAppliedKey === roomLegalStateKey(state);
  }

  function invalidateLegalActions() {
    legalRequest += 1;
    legalRequestedKey = "";
    legalAppliedKey = "";
    onLegalActionsInvalidated?.();
  }

  function scheduleLegalActions(state) {
    const playerId = getPlayerId?.();
    const activeIndex = state?.phase === "claiming"
      ? Number(state?.responseIndex)
      : Number(state?.turnIndex);
    const activePlayer = asArray(state?.players)[activeIndex - 1];
    if (state?.phase === "claiming" && activePlayer === playerId) {
      invalidateLegalActions();
      onLegalActionsReady?.();
      return;
    }
    if (
      !state?.legalContext ||
      state?.phase !== "playing" ||
      activePlayer !== playerId
    ) {
      invalidateLegalActions();
      return;
    }
    const key = roomLegalStateKey(state);
    if (key === legalRequestedKey) return;
    legalRequestedKey = key;
    legalAppliedKey = "";
    const request = ++legalRequest;
    void runLegalActions(buildRoomSelfActionState(state, playerId), key, request);
  }

  async function runLegalActions(state, key, request) {
    try {
      const localGame = await ensureGame(state);
      if (!localGame) return;
      const legalActions = await localGame.legalActions(state, getPlayerId?.());
      if (
        getDestroyed?.() ||
        !isRoom?.() ||
        request !== legalRequest ||
        key !== legalRequestedKey
      )
        return;
      applyLegalActions?.(legalActions);
      legalAppliedKey = key;
      onLegalActionsReady?.();
    } catch (error) {
      if (request === legalRequest)
        console.error("Mahjong room legal-action preview failed", error);
    }
  }

  function scheduleLockedWait(state) {
    const playerId = getPlayerId?.();
    if (
      !isRoom?.() ||
      !["playing", "claiming"].includes(state?.phase) ||
      state?.riichi?.[playerId] !== true
    ) {
      lockedWaitRequest += 1;
      lockedWaitRequestedKey = "";
      applyLockedWait?.(null);
      return;
    }
    const key = roomLockedWaitKey(state, playerId);
    if (key === lockedWaitRequestedKey) return;
    lockedWaitRequestedKey = key;
    const request = ++lockedWaitRequest;
    void runLockedWait(
      buildRoomLockedWaitState(state, playerId),
      state,
      key,
      request,
    );
  }

  async function runLockedWait(lockedState, roomState, key, request) {
    try {
      const localGame = await ensureGame(roomState);
      if (!localGame) return;
      const report = await localGame.riichiWaitReport(
        lockedState,
        getPlayerId?.(),
      );
      if (
        getDestroyed?.() ||
        !isRoom?.() ||
        request !== lockedWaitRequest ||
        key !== lockedWaitRequestedKey
      )
        return;
      applyLockedWait?.(report?.tenpai ? report : null);
    } catch (error) {
      if (request === lockedWaitRequest)
        console.error("Mahjong locked wait analysis failed", error);
    }
  }

  function destroy() {
    legalRequest += 1;
    lockedWaitRequest += 1;
    legalRequestedKey = "";
    legalAppliedKey = "";
    lockedWaitRequestedKey = "";
    game?.close();
    game = undefined;
    gameReady = undefined;
  }

  return {
    sync,
    hasCurrentLegalActions,
    destroy,
  };
}
