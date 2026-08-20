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
  }

  syncResult(key, delay) {
    const presentationKey = String(key || "");
    if (!presentationKey) {
      this.cancelResultTimer();
      this.resultKey = "";
      this.resultVisible = true;
      return;
    }
    if (presentationKey === this.resultKey) return;
    this.cancelResultTimer();
    this.resultKey = presentationKey;
    this.resultVisible = false;
    this.resultTimer = this.schedule(() => {
      this.resultTimer = 0;
      this.resultVisible = true;
      this.onResultReady?.();
    }, delay);
  }

  syncDrawReveal(key, delay) {
    const presentationKey = String(key || "");
    if (!presentationKey) {
      this.cancelDrawRevealTimer();
      this.drawRevealKey = "";
      this.drawRevealVisible = false;
      return;
    }
    if (presentationKey === this.drawRevealKey) return;
    this.cancelDrawRevealTimer();
    this.drawRevealKey = presentationKey;
    this.drawRevealVisible = false;
    this.drawRevealTimer = this.schedule(() => {
      this.drawRevealTimer = 0;
      this.drawRevealVisible = true;
      this.onDrawRevealReady?.();
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

  suspend() {
    this.cancelHandInsertion();
    this.cancelKanDraw();
    this.cancelResultTimer();
    this.cancelDrawRevealTimer();
    this.resultVisible = true;
    this.drawRevealVisible = false;
    this.drawRevealKey = "";
  }

  destroy() {
    this.suspend();
  }
}
