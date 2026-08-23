export function isMahjongMatchMusicActive({
  gameInitializing,
  game,
  playMode,
  state,
}) {
  return Boolean(gameInitializing || game || (playMode === "room" && state));
}

export class MahjongMatchMusic {
  #audio;
  #getVolumeScale;
  #fadeDuration;
  #requestFrame;
  #cancelFrame;
  #fadeFrame = 0;
  #gain = 1;
  #playRequest = 0;
  #blockedByAutoplay = false;

  constructor({
    audio,
    getVolumeScale,
    fadeDuration,
    requestFrame = requestAnimationFrame,
    cancelFrame = cancelAnimationFrame,
  }) {
    this.#audio = audio;
    this.#getVolumeScale = getVolumeScale;
    this.#fadeDuration = fadeDuration;
    this.#requestFrame = requestFrame;
    this.#cancelFrame = cancelFrame;
    this.applyVolume();
  }

  get blockedByAutoplay() {
    return this.#blockedByAutoplay;
  }

  get gain() {
    return this.#gain;
  }

  applyVolume() {
    this.#audio.volume = Math.min(
      1,
      Math.max(0, this.#getVolumeScale() * this.#gain),
    );
  }

  setSource(source) {
    if (this.#audio.src === source) return false;
    this.#playRequest += 1;
    this.cancelFade();
    this.#audio.pause();
    this.#audio.src = source;
    return true;
  }

  stop() {
    this.#playRequest += 1;
    this.cancelFade();
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#setGain(1);
    this.#blockedByAutoplay = false;
  }

  suspend() {
    this.cancelFade();
    this.#audio.pause();
  }

  mute({ fade = false } = {}) {
    this.#playRequest += 1;
    if (fade) {
      this.fadeTo(0, { pauseWhenSilent: true });
      return;
    }
    this.cancelFade();
    this.#setGain(0);
    this.#audio.pause();
  }

  play({ fadeIn = false } = {}) {
    this.cancelFade();
    this.#setGain(fadeIn ? 0 : 1);
    if (!this.#audio.paused) {
      this.#blockedByAutoplay = false;
      if (fadeIn) this.fadeTo(1);
      return;
    }
    this.#requestPlayback({ fadeIn, keepMuted: false });
  }

  /**
   * Must be called directly from the user action that begins the next hand.
   * It keeps a paused player alive at zero gain, so the asynchronous result
   * exit cannot turn the following `play()` into a new autoplay request.
   */
  primeForNextHand(source) {
    if (!source) return;
    this.setSource(source);
    this.cancelFade();
    this.#setGain(0);
    if (!this.#audio.paused) {
      this.#blockedByAutoplay = false;
      return;
    }
    this.#requestPlayback({ fadeIn: false, keepMuted: true });
  }

  resumeIfBlocked({ fadeIn = false } = {}) {
    if (!this.#blockedByAutoplay) return;
    this.play({ fadeIn });
  }

  cancelFade() {
    if (this.#fadeFrame) this.#cancelFrame(this.#fadeFrame);
    this.#fadeFrame = 0;
  }

  fadeTo(targetGain, { pauseWhenSilent = false } = {}) {
    this.cancelFade();
    const initialGain = this.#gain;
    if (initialGain === targetGain) {
      if (pauseWhenSilent && targetGain === 0) this.#audio.pause();
      return;
    }
    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / this.#fadeDuration);
      const easedProgress = progress * progress * (3 - 2 * progress);
      this.#setGain(initialGain + (targetGain - initialGain) * easedProgress);
      if (progress < 1) {
        this.#fadeFrame = this.#requestFrame(step);
        return;
      }
      this.#fadeFrame = 0;
      if (pauseWhenSilent && targetGain === 0) this.#audio.pause();
    };
    this.#fadeFrame = this.#requestFrame(step);
  }

  #requestPlayback({ fadeIn, keepMuted }) {
    const playRequest = ++this.#playRequest;
    void this.#audio.play().then(
      () => {
        if (playRequest !== this.#playRequest) return;
        this.#blockedByAutoplay = false;
        if (keepMuted) return;
        if (fadeIn) this.fadeTo(1);
      },
      (error) => {
        if (playRequest !== this.#playRequest) return;
        this.#blockedByAutoplay = error?.name === "NotAllowedError";
      },
    );
  }

  #setGain(gain) {
    this.#gain = Math.min(1, Math.max(0, gain));
    this.applyVolume();
  }
}
