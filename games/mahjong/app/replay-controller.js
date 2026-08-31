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
  replayActionNeedsState,
  resolveReplayAction,
  waitForReplayDelay,
  waitForReplayStep,
} from "../replay/replay-utils.js";
import { createLocalLuaGame } from "../workers/local-game-worker-client.js";

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

  function handleSummaryReplay(event) {
    if (!state()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void seek(0);
  }

  function handleSummaryExit(event) {
    if (!state()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void exit({ returnToSetup: true });
  }

  elements.matchSummaryRematch?.addEventListener(
    "click",
    handleSummaryReplay,
    true,
  );
  elements.matchSummarySetup?.addEventListener(
    "click",
    handleSummaryExit,
    true,
  );

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
        position: 0,
        speed: 1,
        playing: false,
        busy: false,
        playbackRunId: 0,
        showOpponentHands: false,
        resultTransitioning: false,
      });
      if (elements.matchSummaryRematch)
        elements.matchSummaryRematch.textContent = "再次播放";
      await applyPlayerPresentations?.(presentationRecord(record));
      presentation.suspend();
      tableController.reset();
      await tableController.refresh(replayGame.initialProjection, { animateDealIn: true });
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
    const hand = record.hands[handIndex];
    if (!hand) throw new Error("Paipu hand is missing");
    return createLocalLuaGame({
      sourceUrl: "./game.lua",
      players: record.players.map(({ id, name }) => ({ id, name })),
      playerId: record.viewerPlayerId,
      randomSeed: crypto.randomUUID().replaceAll("-", ""),
      matchId: `replay-${record.id}-${crypto.randomUUID()}`,
      settings: {
        matchType: record.game.matchType,
        rules: record.game.rules,
        canonicalMatchSeats: true,
        initialDealerSeat: 1,
        replayHand: handSetup(record, handIndex),
      },
    });
  }

  function handSetup(record, handIndex) {
    const hand = record.hands[handIndex];
    if (!hand) throw new Error("Paipu hand is missing");
    return {
      wall: hand.wall,
      round: hand.round,
      startScores: hand.startScores,
      scoreHistoryBefore: hand.scoreHistoryBefore,
    };
  }

  function presentationRecord(record) {
    return record;
  }

  function actionForStep(current, step) {
    return {
      action: structuredClone(step.command.action),
      actorId: current.record.players[step.command.seat - 1]?.id,
      animateDealIn: false,
    };
  }

  async function resolvedActionForStep(current, step, game = getGame()) {
    const entry = actionForStep(current, step);
    if (!replayActionNeedsState(entry.action)) return entry;
    const checkpoint = await game?.checkpoint?.();
    if (!checkpoint?.state) throw new Error("Replay state is unavailable");
    return {
      ...entry,
      action: resolveReplayAction(entry.action, checkpoint.state, entry.actorId),
    };
  }

  async function advance() {
    const current = state();
    if (!current || current.busy || current.position >= current.timeline.steps.length) return false;
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
        await tableController.refresh(await replayView(current, loaded.projection), {
          animateDealIn: true,
        });
        return true;
      }
      const { action, actorId, animateDealIn } = await resolvedActionForStep(current, step);
      const outcome = await getGame()?.action(action, actorId);
      if (!outcome?.result?.accepted) {
        const code = outcome?.result?.error?.code || "unknown";
        throw new Error(`Replay action was rejected: ${code}`);
      }
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
      return projection?.state?.phase === "hand_ended" ? "hand-ended" : true;
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
      const game = getGame();
      const loaded = await game?.loadReplayHand(
        handSetup(current.record, handIndex),
        current.record.viewerPlayerId,
      );
      if (!loaded?.projection) throw new Error("Replay hand could not be loaded");
      let projection = loaded.projection;

      // Replay sequentially while seeking. A deterministic claim is resolved
      // against the engine state immediately before that claim; pre-building a
      // batch would reintroduce a dependency on ephemeral future option arrays.
      for (let index = handStart; index < target; index += 1) {
        if (current !== state() || seekRunId !== replayRunId) return;
        const step = current.timeline.steps[index];
        if (step.kind === "next-hand") continue;
        const { action, actorId } = await resolvedActionForStep(current, step, game);
        const outcome = await game?.action(action, actorId);
        if (!outcome?.result?.accepted) {
          const code = outcome?.result?.error?.code || "unknown";
          throw new Error(`Replay seek action ${index} was rejected: ${code}`);
        }
        projection = outcome.projection;
      }

      projection = await replayView(current, projection);
      if (!projection) throw new Error("Replay hand could not be loaded");
      if (current !== state() || seekRunId !== replayRunId) return;
      presentation.suspend();
      tableController.reset();
      elements.result.hidden = true;
      current.position = target;
      await tableController.refresh(projection, { animateDealIn: target === 0 });
      await applyPlayerPresentations?.(presentationRecord(current.record));
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
    while (current === state() && current.playing && runId === current.playbackRunId) {
      const advanced = await advance();
      if (!advanced || !current.playing || current.position >= current.timeline.steps.length) break;
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
    const previousPosition = paipuPreviousHandPosition(current.timeline, current.position);
    if (previousPosition === current.position) return false;
    if (tableController.getState()?.phase === "hand_ended" && !elements.result.hidden) {
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
    replayElements.controls.classList.toggle("is-result-visible", Boolean(resultVisible));
    const roundWind = ["东", "南", "西", "北"][Math.max(0, Number(hand?.round?.wind) - 1)] || "牌谱";
    const roundNumber = Number(hand?.round?.number) || handIndex + 1;
    const completed = position >= timeline.steps.length;
    replayElements.status.textContent = `${roundWind}${roundNumber}-${Number(hand?.round?.honba) || 0}`;
    if (replayElements.stepStatus) replayElements.stepStatus.textContent = `${actionCount}手`;
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
      visibility.setAttribute("aria-label", current.showOpponentHands ? "隐藏其他玩家手牌" : "显示其他玩家手牌");
      visibility.title = current.showOpponentHands ? "隐藏其他玩家手牌" : "显示其他玩家手牌";
      visibility.querySelector('[data-lucide="eye"]')?.toggleAttribute("hidden", current.showOpponentHands);
      visibility.querySelector('[data-lucide="eye-off"]')?.toggleAttribute("hidden", !current.showOpponentHands);
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
    if (elements.matchSummaryRematch)
      elements.matchSummaryRematch.textContent = "再来一局";
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
