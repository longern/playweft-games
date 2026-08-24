export class ThreeAnimationController {
  constructor(
    onFrame,
    {
      now = () => performance.now(),
      requestFrame = (callback) => window.requestAnimationFrame(callback),
      cancelFrame = (frame) => window.cancelAnimationFrame(frame),
    } = {},
  ) {
    this.onFrame = onFrame;
    this.now = now;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.tracks = new Map();
    this.lastKeys = new Map();
    this.frame = 0;
    this.destroyed = false;
  }

  claim(id, key, requested = true) {
    const animationKey = String(key || "");
    if (!requested || !animationKey) return false;
    if (this.lastKeys.get(id) === animationKey) return false;
    this.lastKeys.set(id, animationKey);
    return true;
  }

  resetKey(id) {
    this.lastKeys.delete(id);
  }

  play({
    id,
    delay = 0,
    duration,
    repeat = false,
    updatesShadow = false,
    update,
    complete,
  }) {
    if (this.destroyed) return false;
    const normalizedDuration = Math.max(1, Number(duration) || 1);
    this.tracks.set(id, {
      beginsAt: this.now() + Math.max(0, Number(delay) || 0),
      duration: normalizedDuration,
      repeat: repeat === true,
      updatesShadow: updatesShadow === true,
      update,
      complete,
    });
    this.ensureFrame();
    return true;
  }

  cancel(id, { finish = false } = {}) {
    const track = this.tracks.get(id);
    if (!track) return false;
    this.tracks.delete(id);
    if (finish) {
      track.update?.(1);
      track.complete?.();
      this.onFrame?.(track.updatesShadow);
    }
    this.stopFrameIfIdle();
    return true;
  }

  cancelAll({ finish = false } = {}) {
    for (const id of [...this.tracks.keys()]) this.cancel(id, { finish });
  }

  has(id) {
    return this.tracks.has(id);
  }

  ensureFrame() {
    if (this.frame || !this.tracks.size || this.destroyed) return;
    this.frame = this.requestFrame((now) => this.tick(now));
  }

  stopFrameIfIdle() {
    if (this.tracks.size || !this.frame) return;
    this.cancelFrame(this.frame);
    this.frame = 0;
  }

  tick(now) {
    this.frame = 0;
    if (this.destroyed) return;
    let changed = false;
    let updatesShadow = false;
    for (const [id, track] of [...this.tracks]) {
      if (now < track.beginsAt) continue;
      const elapsed = Math.max(0, now - track.beginsAt);
      const progress = track.repeat
        ? (elapsed % track.duration) / track.duration
        : Math.min(1, elapsed / track.duration);
      track.update?.(progress);
      changed = true;
      updatesShadow ||= track.updatesShadow;
      if (track.repeat) continue;
      if (progress < 1) continue;
      this.tracks.delete(id);
      track.complete?.();
    }
    if (changed) this.onFrame?.(updatesShadow);
    this.ensureFrame();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tracks.clear();
    this.lastKeys.clear();
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
  }
}
