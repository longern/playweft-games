import { resultDetailPageCount } from "../rules/game-format.js";
import {
  buildMahjongPaipuTimeline,
  clampPaipuPosition,
  paipuHandIndexAtPosition,
  paipuActionCountAtPosition,
  paipuNextHandPosition,
  paipuPreviousHandPosition,
} from "../replay/paipu-playback.js";
import {
  replayAction,
  replayTileIdsForWall,
  waitForReplayDelay,
  waitForReplayStep,
} from "../replay/replay-utils.js";
import { createLocalLuaGame } from "../workers/local-game-worker-client.js";
import { orientMahjongPaipuRecord } from "../rules/room-state.js";

const REPLAY_STEP_DELAY_MS = 780;
const REPLAY_RESULT_PAGE_DELAY_MS = 2400;
const REPLAY_SPEEDS = [0.5, 1, 2, 4];

export function createMahjongReplayController({
  window,
  elements,
  replayElements,
  getGame,
  setGame,
  getGameInitializing,
  getPlayMode,
  setPlayMode,
  setGameInitializing,
  getReplayState,
  setReplayState,
  closePaipuPanel,
  loadMahjongPaipu,
  tableController,
  presentation,
  settingsDialog,
  session,
  showMessage,
  showSetup,
  applyPlayerPresentations,
}) {
  let replayRunId = 0;

  function state() {
    return getReplayState();
  }

  async function replay(id) {
    if (getGame() || getGameInitializing()) return;
    let record;
    try {
      record = await loadMahjongPaipu(id);
    } catch (error) {
      console.error("Unable to load Mahjong paipu", error);
      showMessage("牌谱读取失败");
      return;
    }
    let timeline;
    try {
      timeline = buildMahjongPaipuTimeline(record);
    } catch (error) {
      console.error("Mahjong paipu timeline is invalid", error);
      showMessage("牌谱格式无效");
      return;
    }
    closePaipuPanel({ animate: false, restoreFocus: false });
    setGameInitializing(true);
    setPlayMode("replay");
    elements.setup.hidden = true;
    elements.result.hidden = true;
    elements.loading.hidden = false;
    elements.loading.classList.add("is-active");
    try {
      const replayGame = await createReplayGame(record, 0);
      setGame(replayGame);
      setReplayState({
        record,
        timeline,
        tileIdsByHand: record.hands.map((hand) =>
          replayTileIdsForWall(hand.wall),
        ),
        position: 0,
        speed: 1,
        playing: false,
        busy: false,
        playbackRunId: 0,
        showOpponentHands: false,
        resultTransitioning: false,
      });
      await applyPlayerPresentations?.(record);
      presentation.suspend();
      tableController.reset();
      await tableController.refresh(replayGame.initialProjection, {
        animateDealIn: true,
      });
      elements.loading.hidden = true;
      elements.app.setAttribute("aria-busy", "false");
      settingsDialog.setSoloMatchActive(true);
      settingsDialog.setEndMatchLabel("返回大厅");
      replayElements.controls.hidden = false;
      renderControls();
    } catch (error) {
      console.error("Mahjong paipu replay failed", error);
      await exit({ returnToSetup: true });
      showMessage("牌谱回放无法启动");
    } finally {
      setGameInitializing(false);
      elements.loading.hidden = true;
    }
  }

  async function createReplayGame(record, handIndex = 0) {
    const replayRecord = orientMahjongPaipuRecord(record, record.viewerPlayerId);
    const hand = replayRecord.hands[handIndex];
    if (!hand) throw new Error("Paipu hand is missing");
    return createLocalLuaGame({
      sourceUrl: "./game.lua",
      players: replayRecord.players.map(({ id, name }) => ({ id, name })),
      playerId: record.viewerPlayerId,
      randomSeed: crypto.randomUUID().replaceAll("-", ""),
      matchId: `replay-${record.id}-${crypto.randomUUID()}`,
      settings: {
        matchType: record.game.matchType,
        rules: record.game.rules,
        replayHand: {
          wall: hand.wall,
          round: hand.round,
          startScores: hand.startScores,
          scoreHistoryBefore: hand.scoreHistoryBefore,
        },
      },
    });
  }

  function handSetup(record, handIndex) {
    const hand = orientMahjongPaipuRecord(record, record.viewerPlayerId)?.hands[
      handIndex
    ];
    if (!hand) throw new Error("Paipu hand is missing");
    return {
      wall: hand.wall,
      round: hand.round,
      startScores: hand.startScores,
      scoreHistoryBefore: hand.scoreHistoryBefore,
    };
  }

  function actionForStep(current, step) {
    const action = replayAction(
      step.command.action,
      current.tileIdsByHand[step.handIndex],
    );
    return {
      action,
      actorId: current.record.players[step.command.seat - 1]?.id,
      animateDealIn: false,
    };
  }

  async function advance() {
    const current = state();
    if (!current || current.busy || current.position >= current.timeline.steps.length)
      return false;
    current.busy = true;
    renderControls();
    try {
      const step = current.timeline.steps[current.position];
      if (step.kind === "next-hand") {
        const loaded = await getGame()?.loadReplayHand(
          handSetup(current.record, step.handIndex),
          current.record.viewerPlayerId,
        );
        if (!loaded?.projection) throw new Error("Replay hand could not be loaded");
        if (current !== state()) return false;
        current.position += 1;
        await tableController.refresh(
          await replayView(current, loaded.projection),
          { animateDealIn: true },
        );
        return true;
      }
      const { action, actorId, animateDealIn } = actionForStep(current, step);
      const outcome = await getGame()?.action(action, actorId);
      if (!outcome?.result?.accepted) throw new Error("Replay action was rejected");
      if (current !== state()) return false;
      current.position += 1;
      const projection = await replayView(current, outcome.projection);
      await tableController.refresh(projection, {
        animateDealIn,
        ownDiscardedTile:
          action.type === "discard" || action.type === "riichi"
            ? Number(action.tileId) || 0
            : 0,
      });
      return projection?.state?.phase === "hand_ended"
        ? "hand-ended"
        : true;
    } catch (error) {
      console.error("Mahjong paipu playback step failed", error);
      pause();
      showMessage("牌谱回放中断");
      return false;
    } finally {
      if (current === state()) {
        current.busy = false;
        renderControls();
      }
    }
  }

  async function seek(position) {
    const current = state();
    if (!current || current.busy) return;
    const target = clampPaipuPosition(current.timeline, position);
    if (target === current.position) {
      renderControls();
      return;
    }
    pause();
    current.busy = true;
    const seekRunId = ++replayRunId;
    renderControls();
    try {
      const handIndex = paipuHandIndexAtPosition(current.timeline, target);
      const handStart = current.timeline.handStarts[handIndex];
      const actions = [];
      for (let index = handStart; index < target; index += 1) {
        if (current !== state() || seekRunId !== replayRunId) return;
        const { action, actorId } = actionForStep(
          current,
          current.timeline.steps[index],
        );
        actions.push({ action, actorId });
      }
      const replayed = await getGame()?.replayActions(actions, {
        replayHand: handSetup(current.record, handIndex),
        viewerId: current.record.viewerPlayerId,
      });
      const projection = await replayView(current, replayed?.projection);
      if (!projection) throw new Error("Replay hand could not be loaded");
      if (current !== state() || seekRunId !== replayRunId) return;
      presentation.suspend();
      tableController.reset();
      elements.result.hidden = true;
      current.position = target;
      await tableController.refresh(projection, { animateDealIn: target === 0 });
      await applyPlayerPresentations?.(current.record);
    } catch (error) {
      console.error("Mahjong paipu seek failed", error);
      showMessage("无法跳转到该位置");
    } finally {
      if (current === state()) {
        current.busy = false;
        renderControls();
      }
    }
  }

  async function toggle() {
    const current = state();
    if (!current || current.busy) return;
    if (current.playing) {
      pause();
      return;
    }
    if (current.position >= current.timeline.steps.length) return;
    tableController.syncMatchMusic();
    current.playing = true;
    const runId = ++current.playbackRunId;
    renderControls();
    while (
      current === state() &&
      current.playing &&
      runId === current.playbackRunId
    ) {
      const advanced = await advance();
      if (!advanced || !current.playing || current.position >= current.timeline.steps.length)
        break;
      if (advanced === "hand-ended") {
        const continued = await autoAdvanceResult(current, runId);
        if (!continued) break;
      }
      await waitForReplayStep(current.speed, REPLAY_STEP_DELAY_MS);
    }
    if (current === state() && runId === current.playbackRunId) {
      current.playing = false;
      renderControls();
    }
  }

  function pause() {
    const current = state();
    if (!current) return;
    current.playing = false;
    current.playbackRunId += 1;
    // Keep the visual control in sync with the state immediately. The
    // playback loop may still be unwinding asynchronously, so waiting for
    // its finally block leaves the button showing pause for a noticeable
    // moment after the user has already paused.
    renderControls();
  }

  async function autoAdvanceResult(current, playbackRunId) {
    if (!(await waitForResult(current, playbackRunId))) return false;
    const detailCount = resultDetailPageCount(tableController.getState());
    for (let page = 0; page < detailCount; page += 1) {
      await waitForReplayDelay(REPLAY_RESULT_PAGE_DELAY_MS);
      if (!isActive(current, playbackRunId)) return false;
      await tableController.continueResult();
    }
    await waitForReplayDelay(REPLAY_RESULT_PAGE_DELAY_MS);
    if (!isActive(current, playbackRunId)) return false;
    if (tableController.getState()?.matchEnded) return false;
    await tableController.continueResult();
    return isActive(current, playbackRunId) && tableController.getState()?.phase !== "hand_ended";
  }

  async function waitForResult(current, playbackRunId) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (!isActive(current, playbackRunId)) return false;
      if (
        !elements.result.hidden &&
        !elements.result.inert &&
        elements.result.getAttribute("aria-hidden") === "false"
      ) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return false;
  }

  function isActive(current, playbackRunId) {
    return current === state() && current.playing && playbackRunId === current.playbackRunId;
  }

  async function advanceFromResult(action) {
    const current = state();
    if (
      !current ||
      action?.type !== "next_hand" ||
      current.timeline.steps[current.position]?.kind !== "next-hand"
    ) return false;
    await tableController.dismissResultForReplay();
    return advance();
  }

  async function nextHand(current) {
    if (!current || current !== state() || current.busy) return false;
    const nextPosition = paipuNextHandPosition(current.timeline, current.position);
    if (nextPosition === current.position) return false;
    if (
      current.timeline.steps[current.position]?.kind === "next-hand" &&
      tableController.getState()?.phase === "hand_ended"
    ) {
      await advanceFromResult({ type: "next_hand" });
      return true;
    }
    await seek(nextPosition);
    return true;
  }

  async function previousHand(current) {
    if (!current || current !== state() || current.busy) return false;
    const previousPosition = paipuPreviousHandPosition(
      current.timeline,
      current.position,
    );
    if (previousPosition === current.position) return false;

    // A completed hand can still be covered by the result panel. Clear that
    // presentation state before rebuilding the previous hand so navigation
    // follows the same cross-hand lifecycle as the forward button.
    if (
      tableController.getState()?.phase === "hand_ended" &&
      !elements.result.hidden
    ) {
      await tableController.dismissResultForReplay();
      if (current !== state()) return false;
    }
    await seek(previousPosition);
    return true;
  }

  function cycleSpeed() {
    const current = state();
    if (!current || current.busy) return;
    const index = REPLAY_SPEEDS.indexOf(current.speed);
    current.speed = REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.length];
    renderControls();
  }

  async function replayView(current, fallbackProjection) {
    if (!current?.showOpponentHands) return fallbackProjection;
    const game = getGame();
    if (typeof game?.view !== "function") return fallbackProjection;
    return game.view(current.record.viewerPlayerId, { revealAllHands: true });
  }

  async function toggleOpponentHands() {
    const current = state();
    if (!current || current.busy) return false;
    current.showOpponentHands = !current.showOpponentHands;
    current.busy = true;
    renderControls();
    try {
      const projection = await replayView(
        current,
        await getGame()?.view(current.record.viewerPlayerId),
      );
      if (!projection || current !== state()) return false;
      await tableController.refresh(projection);
      return true;
    } catch (error) {
      current.showOpponentHands = !current.showOpponentHands;
      console.error("Mahjong replay hand visibility toggle failed", error);
      showMessage("无法切换其他玩家手牌显示");
      return false;
    } finally {
      if (current === state()) {
        current.busy = false;
        renderControls();
      }
    }
  }

  function renderControls() {
    const current = state();
    if (!current || !replayElements.controls) return;
    const { timeline, position } = current;
    const handIndex = paipuHandIndexAtPosition(timeline, position);
    const hand = timeline.hands[handIndex];
    const actionCount = paipuActionCountAtPosition(timeline, position);
    const result = elements.result;
    const resultVisible =
      tableController?.getState?.()?.phase === "hand_ended" &&
      result &&
      !result.hidden &&
      result.getAttribute("aria-hidden") === "false" &&
      presentation?.resultVisible === true &&
      current.resultTransitioning !== true;
    replayElements.controls.classList.toggle(
      "is-result-visible",
      Boolean(resultVisible),
    );
    const roundWind = ["东", "南", "西", "北"][Math.max(0, Number(hand?.round?.wind) - 1)] || "牌谱";
    const roundNumber = Number(hand?.round?.number) || handIndex + 1;
    const completed = position >= timeline.steps.length;
    replayElements.status.textContent = `${roundWind}${roundNumber}-${Number(hand?.round?.honba) || 0}`;
    if (replayElements.stepStatus) {
      replayElements.stepStatus.textContent = `${actionCount}手`;
    }
    replayElements.progress.max = String(timeline.steps.length);
    replayElements.progress.value = String(position);
    replayElements.progress.setAttribute("aria-valuetext", `${position} / ${timeline.steps.length}`);
    replayElements.controls.setAttribute("aria-busy", String(current.busy));
    setControlState(replayElements.previousHand, current.busy, paipuPreviousHandPosition(timeline, position) === position);
    setControlState(replayElements.nextHand, current.busy, paipuNextHandPosition(timeline, position) === position);
    setControlState(replayElements.stepBack, current.busy, position === 0);
    setControlState(replayElements.stepForward, current.busy, completed);
    setControlState(replayElements.toggle, current.busy, completed);
    setControlState(replayElements.speed, current.busy, false);
    replayElements.progress.setAttribute("aria-disabled", String(current.busy));
    replayElements.speed.textContent = `${current.speed}×`;
    replayElements.toggle.setAttribute("aria-label", current.playing ? "暂停" : "播放");
    replayElements.toggle.setAttribute("aria-pressed", String(current.playing));
    replayElements.toggle.title = current.playing ? "暂停" : "播放";
    replayElements.toggle.querySelector('[data-lucide="play"]')?.toggleAttribute("hidden", current.playing);
    replayElements.toggle.querySelector('[data-lucide="pause"]')?.toggleAttribute("hidden", !current.playing);
    const visibility = replayElements.handVisibility;
    if (visibility) {
      visibility.setAttribute("aria-pressed", String(current.showOpponentHands));
      visibility.setAttribute(
        "aria-label",
        current.showOpponentHands ? "隐藏其他玩家手牌" : "显示其他玩家手牌",
      );
      visibility.title = current.showOpponentHands
        ? "隐藏其他玩家手牌"
        : "显示其他玩家手牌";
      visibility
        .querySelector('[data-lucide="eye"]')
        ?.toggleAttribute("hidden", current.showOpponentHands);
      visibility
        .querySelector('[data-lucide="eye-off"]')
        ?.toggleAttribute("hidden", !current.showOpponentHands);
      setControlState(visibility, current.busy, false);
    }
  }

  function setControlState(element, busy, unavailable) {
    element.disabled = unavailable;
    element.setAttribute("aria-disabled", String(busy || unavailable));
  }

  function onResultExitStart() {
    const current = state();
    if (!current) return;
    current.resultTransitioning = true;
    renderControls();
  }

  function onResultReady() {
    const current = state();
    if (!current) return;
    current.resultTransitioning = false;
    renderControls();
  }

  async function exit({ returnToSetup = true } = {}) {
    const current = state();
    if (!current && getPlayMode() !== "replay") return;
    replayRunId += 1;
    pause();
    setReplayState(null);
    replayElements.controls.hidden = true;
    const replayGame = getGame();
    setGame(undefined);
    try {
      session?.cancelScheduledActions();
      tableController.syncMatchMusic({ enabled: false });
      presentation.suspend();
      replayGame?.close();
      tableController.reset();
    } catch (error) {
      console.error("Mahjong paipu replay cleanup failed", error);
    } finally {
      elements.result.hidden = true;
      elements.loading.hidden = true;
      setPlayMode("solo");
      settingsDialog.setOpen(false, { restoreFocus: false, animate: false });
      settingsDialog.setSoloMatchActive(false);
      settingsDialog.setEndMatchLabel("结束本局");
      if (returnToSetup) showSetup();
    }
  }

  return {
    replay,
    advance,
    seek,
    toggle,
    pause,
    nextHand,
    previousHand,
    cycleSpeed,
    toggleOpponentHands,
    onResultExitStart,
    onResultReady,
    renderControls,
    advanceFromResult,
    exit,
  };
}
