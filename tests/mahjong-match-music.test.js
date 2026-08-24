import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mahjongMatchMusicTarget,
  mahjongMusicSourceForState,
  isMahjongMatchMusicActive,
  MahjongMatchMusic,
} from "../games/mahjong/theme/match-music.js";

class FakeAudio {
  src = "";
  paused = true;
  volume = 1;
  playCalls = 0;
  pauseCalls = 0;

  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }

  removeAttribute(name) {
    if (name === "src") this.src = "";
  }

  load() {}
}

function createMusic(audio) {
  const frames = new Map();
  let nextFrame = 1;
  return {
    frames,
    music: new MahjongMatchMusic({
      audio,
      getVolumeScale: () => 0.32,
      fadeDuration: 800,
      requestFrame(callback) {
        const id = nextFrame;
        nextFrame += 1;
        frames.set(id, callback);
        return id;
      },
      cancelFrame(id) {
        frames.delete(id);
      },
    }),
  };
}

test("mahjong keeps BGM active while a local game is being created", () => {
  assert.equal(
    isMahjongMatchMusicActive({
      gameInitializing: true,
      game: undefined,
      playMode: "solo",
      state: undefined,
    }),
    true,
  );
  assert.equal(
    isMahjongMatchMusicActive({
      gameInitializing: false,
      game: undefined,
      playMode: "solo",
      state: undefined,
    }),
    false,
  );
});

test("mahjong changes to a riichi track only after a declaration when one is configured", () => {
  const sources = {
    matchSource: "https://example.com/match.mp3",
    riichiSource: "https://example.com/riichi.mp3",
  };
  assert.equal(
    mahjongMusicSourceForState({ ...sources, state: { riichi: {} } }),
    sources.matchSource,
  );
  assert.equal(
    mahjongMusicSourceForState({
      ...sources,
      state: { riichi: { player: true } },
    }),
    sources.riichiSource,
  );
  assert.equal(
    mahjongMusicSourceForState({
      matchSource: sources.matchSource,
      riichiSource: "",
      state: { riichi: { player: true } },
    }),
    sources.matchSource,
  );
});

test("mahjong derives one music target for setup, results, and the next hand", () => {
  const base = {
    gameInitializing: false,
    game: {},
    playMode: "replay",
    matchSource: "https://example.com/match.mp3",
    riichiSource: "",
  };
  assert.deepEqual(
    mahjongMatchMusicTarget({ ...base, state: { phase: "playing" } }),
    { mode: "playing", source: base.matchSource },
  );
  assert.deepEqual(
    mahjongMatchMusicTarget({ ...base, state: { phase: "hand_ended" } }),
    { mode: "muted", source: base.matchSource },
  );
  assert.deepEqual(
    mahjongMatchMusicTarget({
      ...base,
      state: { phase: "hand_ended", riichi: { player: true } },
      transition: "next-hand",
    }),
    { mode: "primed", source: base.matchSource },
  );
  assert.deepEqual(
    mahjongMatchMusicTarget({ ...base, game: undefined, state: undefined }),
    { mode: "stopped", source: "" },
  );
});

test("mahjong pauses BGM after a hand and resumes it within the next-hand gesture", async () => {
  const audio = new FakeAudio();
  const { music, frames } = createMusic(audio);
  const source = "https://example.com/match.mp3";
  music.sync({ mode: "playing", source });
  await Promise.resolve();
  assert.equal(audio.paused, false);

  const pausesBeforeHandEnd = audio.pauseCalls;
  music.sync({ mode: "muted", source }, { fadeOut: true });
  const finishFade = [...frames.values()][0];
  finishFade(Number.MAX_SAFE_INTEGER);
  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, pausesBeforeHandEnd + 1);

  music.sync({ mode: "primed", source });
  await Promise.resolve();
  assert.equal(audio.paused, false);
  assert.equal(music.gain, 0);
  assert.equal(audio.playCalls, 2);

  music.sync({ mode: "playing", source }, { fadeIn: true });
  assert.equal(
    audio.playCalls,
    2,
    "the asynchronously-started hand fades in the primed player without requesting autoplay again",
  );
});

test("mahjong cancels an unfinished result fade when the next hand starts immediately", async () => {
  const audio = new FakeAudio();
  const { music, frames } = createMusic(audio);
  const source = "https://example.com/match.mp3";
  music.sync({ mode: "playing", source });
  await Promise.resolve();

  music.sync({ mode: "muted", source }, { fadeOut: true });
  assert.equal(frames.size, 1);
  music.sync({ mode: "primed", source });

  assert.equal(frames.size, 0);
  assert.equal(audio.paused, false);
  assert.equal(
    audio.playCalls,
    1,
    "an already-running player is not restarted just because the result fade was interrupted",
  );
});

test("mahjong hand-end fade retains the embedded window animation-frame receiver", () => {
  const originalWindow = globalThis.window;
  const frames = new Map();
  const frameHost = {
    nextFrame: 1,
    requestAnimationFrame(callback) {
      assert.equal(this, frameHost);
      const id = this.nextFrame;
      this.nextFrame += 1;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      assert.equal(this, frameHost);
      frames.delete(id);
    },
  };
  globalThis.window = frameHost;
  try {
    const audio = new FakeAudio();
    const music = new MahjongMatchMusic({
      audio,
      getVolumeScale: () => 0.32,
      fadeDuration: 800,
    });

    music.sync(
      { mode: "muted", source: "https://example.com/match.mp3" },
      { fadeOut: true },
    );

    assert.equal(frames.size, 1);
    [...frames.values()][0](Number.MAX_SAFE_INTEGER);
    assert.equal(audio.paused, true);
  } finally {
    globalThis.window = originalWindow;
  }
});
