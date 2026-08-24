export class MahjongPresentationController {
  constructor(
    { onHandInsertionReady, onKanDrawReady, onDrawRevealReady, onResultReady },
    {
      schedule = (callback, delay) => window.setTimeout(callback, delay),
      cancel = (timer) => window.clearTimeout(timer),
    } = {},
  ) {
    this.onHandInsertionReady = onHandInsertionReady;
    this.onKanDrawReady = onKanDrawReady;
    this.onDrawRevealReady = onDrawRevealReady;
    this.onResultReady = onResultReady;
    this.schedule = schedule;
    this.cancel = cancel;
    this.handInsertion = null;
    this.handInsertionTimer = 0;
    this.lastHandInsertionKey = "";
    this.kanDrawPending = false;
    this.kanDrawTimer = 0;
    this.lastKanDrawKey = "";
    this.resultKey = "";
    this.resultVisible = true;
    this.resultTimer = 0;
    this.drawRevealKey = "";
    this.drawRevealVisible = false;
    this.drawRevealTimer = 0;
    this.handEndKey = "";
    this.handEndPlan = null;
  }

  syncHandEnd(plan) {
    const key = String(plan?.key || "");
    if (!key) {
      this.cancelHandEnd();
      this.resultVisible = true;
      this.drawRevealVisible = false;
      return;
    }
    if (key === this.handEndKey) return;
    this.cancelHandEnd();
    this.handEndKey = key;
    this.resultKey = key;
    this.drawRevealKey = key;
    this.resultVisible = false;
    this.drawRevealVisible = false;
    this.handEndPlan = {
      key,
      waitForHandReveal: plan?.waitForHandReveal === true,
      showDrawReveal: plan?.showDrawReveal === true,
      drawRevealDelay: Math.max(0, Number(plan?.drawRevealDelay) || 0),
      drawRevealDuration: Math.max(0, Number(plan?.drawRevealDuration) || 0),
      resultDelay: Math.max(0, Number(plan?.resultDelay) || 0),
    };
    if (!this.handEndPlan.waitForHandReveal) this.advanceHandEnd(key);
  }

  handRevealSettled(key) {
    const presentationKey = String(key || "");
    if (
      !this.handEndPlan ||
      presentationKey !== this.handEndKey ||
      !this.handEndPlan.waitForHandReveal
    ) {
      return;
    }
    this.handEndPlan.waitForHandReveal = false;
    this.advanceHandEnd(presentationKey);
  }

  advanceHandEnd(key) {
    if (!this.handEndPlan || key !== this.handEndKey) return;
    if (!this.handEndPlan.showDrawReveal) {
      this.scheduleResult(key, this.handEndPlan.resultDelay);
      return;
    }
    this.drawRevealTimer = this.schedule(() => {
      if (key !== this.handEndKey) return;
      this.drawRevealTimer = 0;
      this.drawRevealVisible = true;
      this.onDrawRevealReady?.();
      this.scheduleResult(key, this.handEndPlan.drawRevealDuration);
    }, this.handEndPlan.drawRevealDelay);
  }

  scheduleResult(key, delay) {
    this.cancelResultTimer();
    this.resultTimer = this.schedule(() => {
      if (key !== this.handEndKey) return;
      this.resultTimer = 0;
      this.resultVisible = true;
      this.onResultReady?.();
    }, delay);
  }

  scheduleHandInsertion(key, insertion, delay) {
    const presentationKey = String(key || "");
    if (!presentationKey || presentationKey === this.lastHandInsertionKey)
      return false;
    this.lastHandInsertionKey = presentationKey;
    this.cancelHandInsertion();
    if (!insertion) return false;
    this.handInsertion = insertion;
    this.handInsertionTimer = this.schedule(() => {
      this.handInsertionTimer = 0;
      this.handInsertion = null;
      this.onHandInsertionReady?.();
    }, delay);
    return true;
  }

  cancelHandInsertion() {
    if (this.handInsertionTimer) this.cancel(this.handInsertionTimer);
    this.handInsertionTimer = 0;
    this.handInsertion = null;
  }

  scheduleKanDraw(key, delay) {
    const presentationKey = String(key || "");
    if (!presentationKey || presentationKey === this.lastKanDrawKey)
      return false;
    this.lastKanDrawKey = presentationKey;
    this.cancelKanDraw();
    this.kanDrawPending = true;
    this.kanDrawTimer = this.schedule(() => {
      this.kanDrawTimer = 0;
      this.kanDrawPending = false;
      this.onKanDrawReady?.();
    }, delay);
    return true;
  }

  cancelKanDraw() {
    if (this.kanDrawTimer) this.cancel(this.kanDrawTimer);
    this.kanDrawTimer = 0;
    this.kanDrawPending = false;
  }

  cancelResultTimer() {
    if (this.resultTimer) this.cancel(this.resultTimer);
    this.resultTimer = 0;
  }

  cancelDrawRevealTimer() {
    if (this.drawRevealTimer) this.cancel(this.drawRevealTimer);
    this.drawRevealTimer = 0;
  }

  cancelHandEnd() {
    this.cancelResultTimer();
    this.cancelDrawRevealTimer();
    this.handEndKey = "";
    this.handEndPlan = null;
    this.resultKey = "";
    this.drawRevealKey = "";
  }

  suspend() {
    this.cancelHandInsertion();
    this.cancelKanDraw();
    this.cancelHandEnd();
    this.resultVisible = true;
    this.drawRevealVisible = false;
    this.drawRevealKey = "";
  }

  destroy() {
    this.suspend();
  }
}
