export function isMahjongMatchMusicActive({
  gameInitializing,
  game,
  playMode,
  state,
}) {
  return Boolean(gameInitializing || game || (playMode === "room" && state));
}

export function hasMahjongRiichi(state) {
  return Object.values(state?.riichi ?? {}).some(
    (declared) => declared === true,
  );
}

/** Prefer the configured riichi track once any player has declared riichi. */
export function mahjongMusicSourceForState({
  matchSource,
  riichiSource,
  state,
}) {
  return hasMahjongRiichi(state) && riichiSource ? riichiSource : matchSource;
}

export function mahjongMatchMusicTarget({
  gameInitializing,
  game,
  playMode,
  state,
  matchSource,
  riichiSource,
  transition,
}) {
  const source = transition === "next-hand"
    ? matchSource
    : mahjongMusicSourceForState({ matchSource, riichiSource, state });
  if (
    !isMahjongMatchMusicActive({ gameInitializing, game, playMode, state }) ||
    !source
  ) {
    return { mode: "stopped", source: "" };
  }
  if (transition === "next-hand") return { mode: "primed", source };
  if (state?.phase === "hand_ended") return { mode: "muted", source };
  return { mode: "playing", source };
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

  constructor({
    audio,
    getVolumeScale,
    fadeDuration,
    requestFrame = (callback) => window.requestAnimationFrame(callback),
    cancelFrame = (frame) => window.cancelAnimationFrame(frame),
  }) {
    this.#audio = audio;
    this.#getVolumeScale = getVolumeScale;
    this.#fadeDuration = fadeDuration;
    this.#requestFrame = requestFrame;
    this.#cancelFrame = cancelFrame;
    this.applyVolume();
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

  sync({ mode, source }, { fadeIn = false, fadeOut = false } = {}) {
    if (mode === "stopped" || !source) {
      this.#stop();
      return;
    }
    this.#setSource(source);
    if (mode === "muted") {
      this.#mute({ fade: fadeOut });
      return;
    }
    if (mode === "primed") {
      this.#prime();
      return;
    }
    if (mode === "playing") {
      this.#play({ fadeIn });
      return;
    }
    throw new TypeError(`Unknown Mahjong music mode: ${mode}`);
  }

  suspend() {
    this.cancelFade();
    this.#audio.pause();
  }

  cancelFade() {
    if (this.#fadeFrame) this.#cancelFrame(this.#fadeFrame);
    this.#fadeFrame = 0;
  }

  #setSource(source) {
    if (this.#audio.src === source) return;
    this.#playRequest += 1;
    this.cancelFade();
    this.#audio.pause();
    this.#audio.src = source;
  }

  #stop() {
    this.#playRequest += 1;
    this.cancelFade();
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#setGain(1);
  }

  #mute({ fade = false } = {}) {
    this.#playRequest += 1;
    if (fade) {
      this.fadeTo(0, { pauseWhenSilent: true });
      return;
    }
    this.cancelFade();
    this.#setGain(0);
    this.#audio.pause();
  }

  #prime() {
    this.cancelFade();
    this.#setGain(0);
    if (!this.#audio.paused) return;
    this.#ensurePlayback({ fadeIn: false, keepMuted: true });
  }

  #play({ fadeIn = false } = {}) {
    this.cancelFade();
    this.#setGain(fadeIn ? 0 : 1);
    if (!this.#audio.paused) {
      if (fadeIn) this.fadeTo(1);
      return;
    }
    this.#ensurePlayback({ fadeIn, keepMuted: false });
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

  #ensurePlayback({ fadeIn, keepMuted }) {
    const playRequest = ++this.#playRequest;
    void this.#audio
      .play()
      .then(() => {
        if (playRequest !== this.#playRequest || keepMuted) return;
        if (fadeIn) this.fadeTo(1);
      })
      .catch(() => {});
  }

  #setGain(gain) {
    this.#gain = Math.min(1, Math.max(0, gain));
    this.applyVolume();
  }
}
