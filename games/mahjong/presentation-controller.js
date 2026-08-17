export class MahjongPresentationController {
  constructor(
    { onHandInsertionReady, onResultReady },
    {
      schedule = (callback, delay) => window.setTimeout(callback, delay),
      cancel = (timer) => window.clearTimeout(timer),
    } = {},
  ) {
    this.onHandInsertionReady = onHandInsertionReady;
    this.onResultReady = onResultReady;
    this.schedule = schedule;
    this.cancel = cancel;
    this.handInsertion = null;
    this.handInsertionTimer = 0;
    this.lastHandInsertionKey = "";
    this.resultKey = "";
    this.resultVisible = true;
    this.resultTimer = 0;
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

  cancelResultTimer() {
    if (this.resultTimer) this.cancel(this.resultTimer);
    this.resultTimer = 0;
  }

  suspend() {
    this.cancelHandInsertion();
    this.cancelResultTimer();
    this.resultVisible = true;
  }

  destroy() {
    this.suspend();
  }
}
