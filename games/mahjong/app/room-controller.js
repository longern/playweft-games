import { createLocalLuaGame } from "../workers/local-game-worker-client.js";
import { asArray } from "../rules/game-format.js";
import { orientMahjongRoomProjection } from "../rules/room-state.js";
import {
  buildRoomLegalState,
  buildRoomTenpaiReportState,
  roomAutomaticKey,
  roomEarlyTenpaiStateKey,
  roomLegalStateKey,
  roomPlayerHasFutureNormalDraw,
  roomTenpaiStateKey,
} from "../rules/room-utils.js";
import { AI_DELAY_MS } from "../rules/constants.js";

const LATE_WALL_REPORT_START = 4;
const LATE_WALL_REPORT_BUDGET_MS = 500;
const RIVER_BOTTOM_REPORT_BUDGET_MS = 500;

export function createMahjongRoomController({
  window = globalThis.window,
  elements,
  getPlayMode,
  setPlayMode,
  getPlayerId,
  setPlayerId,
  setIsOwner,
  setPlayerName,
  setHasPlatformName,
  getGameInitializing,
  setGameInitializing,
  getDestroyed,
  getClient,
  getSession,
  tableController,
  visualRendererReady,
  settingsDialog,
  transientNotice,
  roomPlayerProfiles,
  roomPlayerPresentations,
  themeController,
  beginSetupExit,
  resetAutoActions,
  syncRoomPassClaims,
  enableAutoWinAfterRiichi,
  persistCompletedPaipu,
  showMessage,
  showLoadingError,
  showSetupRecoveryError,
  showRoomSetup: showRoomSetupCallback,
  startSoloEntry,
} = {}) {
  let roomIsOwner = false;
  let roomLobbyAiPlayerIds = [];
  let roomAiGame;
  let roomAiPlayerIds = "";
  let roomAiBusy = false;
  let roomAiAwaitingState = false;
  let roomAiSchedule = 0;
  let roomAiWaitResolve;
  let roomAiGeneration = 0;
  let roomAiTurnKey = "";
  let roomAiState;
  let roomLegalGame;
  let roomLegalPlayerIds = "";
  let roomLegalRequest = 0;
  let roomLegalRequestedKey = "";
  let roomLegalAppliedKey = "";
  let roomAutomaticStateKey = "";
  let roomTenpaiGame;
  let roomTenpaiGameReady;
  let roomTenpaiPlayerIds = "";
  let roomTenpaiRequest = 0;
  let roomTenpaiRequestedKey = "";
  let roomTenpaiReports;
  let roomTenpaiReportsPromise;
  let roomTenpaiSupplementRequest = 0;
  let roomTenpaiSupplementRequestedKey = "";
  let roomTenpaiReportedKey = "";
  let playerPresentationKey = "";

  function isRoom() {
    return getPlayMode?.() === "room";
  }

  function handleReady(context) {
    setPlayMode?.(context?.mode ?? "solo");
    // A reconnect may attach this controller to a fresh room state. The
    // preference must be sent again even when the local choice is unchanged.
    playerPresentationKey = "";
    if (isRoom()) resetAutoActions?.({ persist: false });
    setPlayerId?.(context?.playerId || "");
    themeController.setRoomPlayerIdentity?.(context?.playerId || "");
    roomPlayerProfiles?.setContext({
      nextClient: getClient?.(),
      nextCapabilities: context?.capabilities,
    });
    roomIsOwner =
      context?.player?.isOwner === true ||
      context?.isOwner === true ||
      (context?.match?.ownerId && context.match.ownerId === context.playerId);
    setIsOwner?.(roomIsOwner);
    const name = context?.player?.name?.trim();
    if (name) {
      setPlayerName?.(name);
      setHasPlatformName?.(true);
    }
    roomPlayerProfiles?.requestOwnPlatformPortrait({
      initialSource: context?.player?.avatar?.src,
      reset: true,
    });
    syncPlayerPresentation({ force: true });
    if (isRoom()) {
      settingsDialog?.setSoloMatchActive(false);
      showRoomWaiting();
      return;
    }
    startSoloEntry?.();
  }

  function handlePlayerProfileChanged({ playerId, fields } = {}) {
    if (
      playerId === getPlayerId?.() &&
      (!Array.isArray(fields) || fields.includes("avatar"))
    ) {
      roomPlayerProfiles?.requestOwnPlatformPortrait();
    }
    roomPlayerProfiles?.handleChanged({ playerId });
  }

  function syncPlayerPresentation({ force = false } = {}) {
    if (!isRoom() || !getSession?.()) return false;
    const presentation = themeController.getRoomPlayerPresentation?.() || {};
    const key = JSON.stringify(presentation);
    if (!force && key === playerPresentationKey) return false;
    playerPresentationKey = key;
    return Boolean(
      getSession().dispatch({
        type: "set_player_presentation",
        playerPresentation: presentation,
      }),
    );
  }

  async function handleState(message) {
    if (!isRoom()) return;
    setPlayerId?.(message?.playerId || getPlayerId?.() || "");
    roomIsOwner = message?.state?.roomIsOwner === true;
    setIsOwner?.(roomIsOwner);
    if (roomAiAwaitingState) {
      roomAiAwaitingState = false;
      roomAiBusy = false;
    }
    const projection = orientMahjongRoomProjection(
      {
        state: message?.state,
        events: message?.events,
        serverTime: message?.serverTime,
      },
      getPlayerId?.(),
    );
    if (!projection?.state) return;
    roomLobbyAiPlayerIds = Object.keys(projection.state.aiPlayers || {});
    roomPlayerProfiles?.request(projection.state);
    const ownRiichiEvent = asArray(projection.events).find(
      (event) => event?.type === "riichi" && Number(event.playerIndex) === 1,
    );
    const startsFreshAutoActionScope = asArray(projection.events).some(
      (event) =>
        event?.type === "match_started" ||
        event?.type === "next_hand" ||
        event?.type === "new_match",
    );
    if (startsFreshAutoActionScope) resetAutoActions?.({ persist: false });
    syncRoomPassClaims?.(projection.state);
    const nextAutomaticStateKey = roomAutomaticKey(projection.state);
    const session = getSession?.();
    if (nextAutomaticStateKey !== roomAutomaticStateKey) {
      roomAutomaticStateKey = nextAutomaticStateKey;
      session?.cancelScheduledActions();
    }
    if (projection.state.phase === "lobby") {
      session?.confirmRoomState();
      setGameInitializing?.(false);
      elements.app.setAttribute("aria-busy", "false");
      if (projection.state.roomIsOwner) showRoomSetupCallback?.();
      else showRoomWaiting();
      return;
    }
    scheduleRoomAi(projection.state);
    const hadState = Boolean(tableController.getState());
    const animateDealIn =
      !hadState ||
      asArray(projection.events).some(
        (event) => event?.type === "next_hand" || event?.type === "new_match",
      );
    try {
      await visualRendererReady;
      if (getDestroyed?.() || !isRoom()) return;
      const presentationApplied = roomPlayerPresentations?.apply(projection.state);
      await tableController.refresh(projection, { animateDealIn });
      await presentationApplied;
      persistCompletedRoomPaipu(message?.state?.paipu, message.matchId);
      enableAutoWinAfterRiichi?.(projection.state, ownRiichiEvent);
      session?.confirmRoomState();
      scheduleRoomLegalActions(projection.state);
      scheduleRoomTenpaiReports(projection.state);
      scheduleRoomEarlyTenpaiReport(projection.state, projection.events);
      if (!hadState) tableController.syncMatchMusic({ fadeIn: true });
      setGameInitializing?.(false);
      elements.app.setAttribute("aria-busy", "false");
      elements.setup.hidden = true;
      elements.loading.hidden = true;
    } catch (error) {
      console.error("Mahjong room state failed to render", error);
      showLoadingError?.("房间状态加载失败，请稍后重试");
    }
  }

  function persistCompletedRoomPaipu(paipu, matchId) {
    if (!paipu || typeof matchId !== "string" || !matchId) return;
    const record = {
      ...paipu,
      id: `${matchId}:room`,
      completedAtMs: Date.now(),
    };
    void persistCompletedPaipu(record).catch((error) => {
      console.warn("Mahjong room paipu save failed", error);
    });
  }

  function scheduleAutomaticAction() {
    const state = tableController.getState();
    const key = roomAutomaticKey(state);
    if (!key || key !== roomAutomaticStateKey) return;
    if (
      state?.phase === "playing" &&
      roomLegalAppliedKey !== roomLegalStateKey(state)
    )
      return;
    getSession?.()?.scheduleRoomAutomaticAction({
      state,
      isCurrent: () =>
        !getDestroyed?.() &&
        isRoom() &&
        roomAutomaticStateKey === key &&
        roomAutomaticKey(tableController.getState()) === key,
    });
  }

  async function ensureRoomTenpaiGame(state) {
    const playerId = getPlayerId?.();
    const players = asArray(state?.players).map((id) => ({ id, name: id }));
    const playerIds = JSON.stringify(asArray(state?.players));
    if (!players.length) return undefined;
    if (roomTenpaiGame && roomTenpaiPlayerIds === playerIds) return roomTenpaiGame;
    if (roomTenpaiGameReady && roomTenpaiPlayerIds === playerIds)
      return roomTenpaiGameReady;
    roomTenpaiGame?.close();
    roomTenpaiGame = undefined;
    roomTenpaiPlayerIds = playerIds;
    const ready = createLocalLuaGame({
      sourceUrl: "./game.lua",
      players,
      playerId,
    }).then((createdGame) => {
      if (getDestroyed?.() || roomTenpaiPlayerIds !== playerIds) {
        createdGame.close();
        return undefined;
      }
      roomTenpaiGame = createdGame;
      return createdGame;
    });
    roomTenpaiGameReady = ready;
    try {
      return await ready;
    } finally {
      if (roomTenpaiGameReady === ready) roomTenpaiGameReady = undefined;
    }
  }

  function scheduleRoomTenpaiReports(state) {
    const wallCount = Math.max(0, Number(state?.wallCount) || 0);
    const playerId = getPlayerId?.();
    if (
      !isRoom() ||
      state?.phase !== "playing" ||
      wallCount > LATE_WALL_REPORT_START
    ) {
      roomTenpaiRequest += 1;
      roomTenpaiRequestedKey = "";
      roomTenpaiReports = undefined;
      roomTenpaiReportsPromise = undefined;
      if (wallCount > LATE_WALL_REPORT_START) {
        roomTenpaiSupplementRequest += 1;
        roomTenpaiSupplementRequestedKey = "";
        roomTenpaiReportedKey = "";
      }
      return;
    }
    void ensureRoomTenpaiGame(state).catch((error) => {
      console.error("Mahjong room tenpai worker failed to start", error);
    });
    const activePlayer = asArray(state.players)[Number(state.turnIndex) - 1];
    if (activePlayer !== playerId || wallCount === 0) {
      roomTenpaiRequest += 1;
      roomTenpaiRequestedKey = "";
      roomTenpaiReports = undefined;
      roomTenpaiReportsPromise = undefined;
      return;
    }
    const key = roomTenpaiStateKey(state);
    if (key === roomTenpaiRequestedKey) return;
    roomTenpaiRequestedKey = key;
    roomTenpaiReports = undefined;
    const request = ++roomTenpaiRequest;
    roomTenpaiReportsPromise = runRoomTenpaiReports(
      buildRoomLegalState(state, playerId),
      key,
      request,
    );
  }

  async function runRoomTenpaiReports(state, key, request) {
    try {
      const localGame = await ensureRoomTenpaiGame(state);
      if (!localGame) return undefined;
      const playerId = getPlayerId?.();
      const reports = await Promise.race([
        localGame.tenpaiReports(state, playerId),
        new Promise((resolve) =>
          window.setTimeout(resolve, LATE_WALL_REPORT_BUDGET_MS),
        ),
      ]);
      if (
        getDestroyed?.() ||
        !isRoom() ||
        request !== roomTenpaiRequest ||
        key !== roomTenpaiRequestedKey
      )
        return undefined;
      roomTenpaiReports =
        reports && typeof reports === "object" ? reports : undefined;
      return roomTenpaiReports;
    } catch (error) {
      if (request === roomTenpaiRequest)
        console.error("Mahjong room tenpai report failed", error);
      return undefined;
    }
  }

  async function roomTenpaiReportForDiscard(state, tileId) {
    try {
      const localGame = await ensureRoomTenpaiGame(state);
      if (!localGame) return undefined;
      return await Promise.race([
        localGame.tenpaiReport(state, tileId, getPlayerId?.()),
        new Promise((resolve) =>
          window.setTimeout(resolve, RIVER_BOTTOM_REPORT_BUDGET_MS),
        ),
      ]);
    } catch (error) {
      console.error("Mahjong river-bottom tenpai report failed", error);
      return undefined;
    }
  }

  function scheduleRoomEarlyTenpaiReport(state, events) {
    const wallCount = Math.max(0, Number(state?.wallCount) || 0);
    const playerId = getPlayerId?.();
    const sawCall = asArray(events).some((event) => event?.type === "claimed");
    const activePlayer = asArray(state?.players)[Number(state?.turnIndex) - 1];
    if (
      !sawCall ||
      state?.phase !== "playing" ||
      wallCount === 0 ||
      wallCount > LATE_WALL_REPORT_START ||
      activePlayer === playerId ||
      roomPlayerHasFutureNormalDraw(state, playerId)
    ) return;
    const key = roomEarlyTenpaiStateKey(state, playerId);
    if (key === roomTenpaiSupplementRequestedKey) return;
    roomTenpaiSupplementRequestedKey = key;
    const request = ++roomTenpaiSupplementRequest;
    void runRoomEarlyTenpaiReport(
      buildRoomTenpaiReportState(state, playerId),
      request,
    );
  }

  async function runRoomEarlyTenpaiReport(state, request) {
    try {
      const localGame = await ensureRoomTenpaiGame(state);
      if (!localGame) return;
      const playerId = getPlayerId?.();
      const report = await Promise.race([
        localGame.currentTenpaiReport(state, playerId),
        new Promise((resolve) =>
          window.setTimeout(resolve, LATE_WALL_REPORT_BUDGET_MS),
        ),
      ]);
      if (
        getDestroyed?.() ||
        !isRoom() ||
        request !== roomTenpaiSupplementRequest ||
        !report?.key ||
        report.key === roomTenpaiReportedKey
      ) return;
      const requestId = getClient?.()?.sendAction({
        type: "tenpai_report",
        tenpaiReport: report,
      });
      if (requestId) roomTenpaiReportedKey = report.key;
    } catch (error) {
      if (request === roomTenpaiSupplementRequest)
        console.error("Mahjong room early tenpai report failed", error);
    }
  }

  async function sendActionWithTenpaiReport(action, { onRequestStarted } = {}) {
    let enrichedAction = action;
    let attachedReport;
    const state = tableController?.getState();
    const playerId = getPlayerId?.();
    const isLateDiscard =
      (action?.type === "discard" || action?.type === "riichi") &&
      state?.phase === "playing" &&
      asArray(state?.players)[Number(state?.turnIndex) - 1] === playerId &&
      Math.max(0, Number(state?.wallCount) || 0) <= LATE_WALL_REPORT_START;
    if (isLateDiscard) {
      const key = roomTenpaiStateKey(state);
      if (Number(state?.wallCount) === 0) {
        const report = await roomTenpaiReportForDiscard(
          buildRoomLegalState(state, playerId),
          Number(action.tileId),
        );
        if (report) {
          enrichedAction = { ...action, tenpaiReport: report };
          attachedReport = report;
        }
      } else if (key === roomTenpaiRequestedKey) {
        const report = roomTenpaiReports?.[Number(action.tileId)];
        if (report) {
          enrichedAction = { ...action, tenpaiReport: report };
          attachedReport = report;
        }
      }
    }
    try {
      const requestId = getClient?.()?.sendAction(enrichedAction);
      onRequestStarted?.(requestId);
      if (requestId && attachedReport?.key) roomTenpaiReportedKey = attachedReport.key;
      return requestId;
    } catch (error) {
      console.error("Mahjong room action failed", error);
      return undefined;
    }
  }

  function scheduleRoomLegalActions(state) {
    const playerId = getPlayerId?.();
    const activeIndex =
      state?.phase === "claiming" ? Number(state?.responseIndex) : Number(state?.turnIndex);
    const activePlayer = asArray(state?.players)[activeIndex - 1];
    if (state?.phase === "claiming" && activePlayer === playerId) {
      roomLegalRequestedKey = "";
      roomLegalAppliedKey = "";
      roomLegalRequest += 1;
      scheduleAutomaticAction();
      return;
    }
    if (!state?.legalContext || state?.phase !== "playing" || activePlayer !== playerId) {
      roomLegalRequestedKey = "";
      roomLegalAppliedKey = "";
      roomLegalRequest += 1;
      getSession?.()?.cancelScheduledActions();
      return;
    }
    const key = roomLegalStateKey(state);
    if (key === roomLegalRequestedKey) return;
    roomLegalRequestedKey = key;
    roomLegalAppliedKey = "";
    const request = ++roomLegalRequest;
    void runRoomLegalActions(buildRoomLegalState(state, playerId), key, request);
  }

  async function runRoomLegalActions(state, key, request) {
    try {
      const players = asArray(state.players).map((id) => ({ id, name: id }));
      const playerIds = JSON.stringify(state.players);
      if (!roomLegalGame || roomLegalPlayerIds !== playerIds) {
        roomLegalGame?.close();
        roomLegalGame = await createLocalLuaGame({
          sourceUrl: "./game.lua",
          players,
          playerId: getPlayerId?.(),
        });
        roomLegalPlayerIds = playerIds;
      }
      const legalActions = await roomLegalGame.legalActions(state, getPlayerId?.());
      if (
        getDestroyed?.() ||
        !isRoom() ||
        request !== roomLegalRequest ||
        key !== roomLegalRequestedKey
      ) return;
      tableController.applyLegalActions(legalActions);
      roomLegalAppliedKey = key;
      scheduleAutomaticAction();
    } catch (error) {
      if (request === roomLegalRequest)
        console.error("Mahjong room legal-action preview failed", error);
    }
  }

  function scheduleRoomAi(state) {
    roomAiState = state;
    const key = roomAiStateKey(state);
    if (!roomIsOwner || !key) {
      roomAiGeneration += 1;
      roomAiTurnKey = "";
      cancelRoomAiWait();
      return;
    }
    if (key === roomAiTurnKey) return;
    roomAiTurnKey = key;
    const generation = ++roomAiGeneration;
    cancelRoomAiWait();
    void runRoomAi(state.aiContext, state.aiTurn.player, key, generation, performance.now());
  }

  function roomAiStateKey(state) {
    if (!state?.aiTurn?.player || !state?.aiContext) return "";
    return JSON.stringify([
      state.phase,
      state.turnIndex,
      state.moveCount,
      state.drawnTile,
      state.lastDiscard,
      state.aiTurn.player,
    ]);
  }

  function waitForRoomAiPacing(startedAt) {
    const remaining = AI_DELAY_MS - (performance.now() - startedAt);
    if (remaining <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      roomAiWaitResolve = resolve;
      roomAiSchedule = window.setTimeout(() => {
        roomAiSchedule = 0;
        roomAiWaitResolve = undefined;
        resolve();
      }, remaining);
    });
  }

  function cancelRoomAiWait() {
    window.clearTimeout(roomAiSchedule);
    roomAiSchedule = 0;
    const resolve = roomAiWaitResolve;
    roomAiWaitResolve = undefined;
    resolve?.();
  }

  async function runRoomAi(aiContext, actorId, turnKey, generation, startedAt) {
    if (roomAiBusy || getDestroyed?.() || !roomIsOwner || !aiContext || !actorId) return;
    roomAiBusy = true;
    let submitted = false;
    try {
      const players = (aiContext.players || []).map((id) => ({ id, name: id }));
      const currentIds = JSON.stringify(aiContext.players || []);
      if (!roomAiGame || roomAiPlayerIds !== currentIds) {
        roomAiGame?.close();
        roomAiGame = await createLocalLuaGame({
          sourceUrl: "./game.lua",
          players,
          playerId: actorId,
        });
        roomAiPlayerIds = currentIds;
      }
      const outcome = await roomAiGame.aiAction(aiContext, actorId);
      if (outcome?.status !== "acted" || !outcome.action) return;
      await waitForRoomAiPacing(startedAt);
      if (
        !roomIsOwner ||
        getDestroyed?.() ||
        generation !== roomAiGeneration ||
        turnKey !== roomAiTurnKey ||
        turnKey !== roomAiStateKey(roomAiState)
      ) return;
      const requestId = getClient?.()?.sendAction({
        type: "ai_turn",
        playerId: actorId,
        action: outcome.action,
      });
      submitted = Boolean(requestId);
      roomAiAwaitingState = submitted;
    } catch (error) {
      console.error("Mahjong room AI failed", error);
    } finally {
      if (submitted) return;
      roomAiBusy = false;
      if (generation !== roomAiGeneration && roomAiState) {
        roomAiTurnKey = "";
        scheduleRoomAi(roomAiState);
      }
    }
  }

  function handleActionResult() {}

  function handleError(message, _code, requestId) {
    roomAiBusy = false;
    roomAiAwaitingState = false;
    const session = getSession?.();
    if (session?.rejectRoomAction(requestId)) {
      tableController.clearResultPageReadyPending();
      if (tableController.getState()?.phase === "hand_ended")
        tableController.syncMatchMusic();
    }
    if (isRoom() && !tableController.getState()) {
      setGameInitializing?.(false);
      showRoomSetupCallback?.();
      showSetupRecoveryError?.(message);
      return;
    }
    if (!tableController.getState()) {
      showLoadingError?.(message);
      return;
    }
    if (isRoom()) {
      transientNotice?.show(message);
      return;
    }
    showMessage?.(message);
  }

  function showRoomWaiting() {
    elements.setup.hidden = true;
    elements.loading.classList.remove("is-error");
    elements.loading.classList.add("is-room-waiting");
    elements.loading.classList.add("is-active");
    elements.loadingMessage.textContent = "等待其他玩家加入…";
    elements.loadingMessage.hidden = false;
    elements.loading.hidden = false;
  }

  function selectedMatchRules() {
    return Object.fromEntries(
      [...elements.setup.querySelectorAll("[data-rule]")].map((input) => [
        input.dataset.rule,
        input.checked,
      ]),
    );
  }

  async function startMatch(matchType = "east") {
    if (!isRoom() || !roomIsOwner || getGameInitializing?.()) return;
    setGameInitializing?.(true);
    const setupExit = beginSetupExit();
    let aiPresentations = {};
    try {
      await themeController.ready;
      aiPresentations = themeController.getOnlineAiCharacterAssignments(
        roomLobbyAiPlayerIds,
        crypto.randomUUID().replaceAll("-", ""),
      );
    } catch (error) {
      console.warn("Mahjong online AI portrait assignment failed", error);
    }
    const started = await getSession?.().dispatch({
      type: "start_match",
      matchType,
      rules: selectedMatchRules(),
      aiPresentations,
    });
    if (started) return;
    await setupExit;
    setGameInitializing?.(false);
    showRoomSetupCallback?.();
  }

  function destroy() {
    cancelRoomAiWait();
    roomAiGame?.close();
    roomAiGame = undefined;
    roomLegalRequest += 1;
    roomLegalRequestedKey = "";
    roomLegalAppliedKey = "";
    roomLegalGame?.close();
    roomLegalGame = undefined;
    roomTenpaiRequest += 1;
    roomTenpaiRequestedKey = "";
    roomTenpaiReports = undefined;
    roomTenpaiReportsPromise = undefined;
    roomTenpaiSupplementRequest += 1;
    roomTenpaiSupplementRequestedKey = "";
    roomTenpaiReportedKey = "";
    roomTenpaiGame?.close();
    roomTenpaiGame = undefined;
    roomTenpaiGameReady = undefined;
  }

  return {
    handleReady,
    handleState,
    handlePlayerProfileChanged,
    handleActionResult,
    handleError,
    sendActionWithTenpaiReport,
    scheduleAutomaticAction,
    startMatch,
    syncPlayerPresentation,
    showRoomWaiting,
    getPlayerId: () => getPlayerId?.() || "",
    isOwner: () => roomIsOwner,
    destroy,
  };
}
