import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMahjongMatchMusicActive,
  MahjongMatchMusic,
} from "../games/mahjong/match-music.js";

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

test("mahjong pauses BGM after a hand and resumes it within the next-hand gesture", async () => {
  const audio = new FakeAudio();
  const { music, frames } = createMusic(audio);
  const source = "https://example.com/match.mp3";
  music.setSource(source);
  music.play();
  await Promise.resolve();
  assert.equal(audio.paused, false);

  const pausesBeforeHandEnd = audio.pauseCalls;
  music.mute({ fade: true });
  const finishFade = [...frames.values()][0];
  finishFade(Number.MAX_SAFE_INTEGER);
  assert.equal(audio.paused, true);
  assert.equal(audio.pauseCalls, pausesBeforeHandEnd + 1);

  music.primeForNextHand(source);
  await Promise.resolve();
  assert.equal(audio.paused, false);
  assert.equal(music.gain, 0);
  assert.equal(audio.playCalls, 2);

  music.play({ fadeIn: true });
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
  music.setSource(source);
  music.play();
  await Promise.resolve();

  music.mute({ fade: true });
  assert.equal(frames.size, 1);
  music.primeForNextHand(source);

  assert.equal(frames.size, 0);
  assert.equal(audio.paused, false);
  assert.equal(
    audio.playCalls,
    1,
    "an already-running player is not restarted just because the result fade was interrupted",
  );
});
