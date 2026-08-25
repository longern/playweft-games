import assert from "node:assert/strict";
import { test } from "node:test";

import { createMahjongTransientNotice } from "../games/mahjong/app/transient-notice.js";

test("mahjong transient notices replace an earlier message and hide after the latest timeout", () => {
  const timers = [];
  const classes = new Set();
  const element = {
    hidden: true,
    textContent: "",
    offsetWidth: 1,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
  const window = {
    setTimeout(callback) {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  };
  const notice = createMahjongTransientNotice({
    element,
    window,
    duration: 1,
    transitionDuration: 1,
  });

  notice.show("first");
  notice.show("instruction quota exceeded");
  assert.equal(element.textContent, "instruction quota exceeded");
  assert.equal(element.hidden, false);
  assert.equal(classes.has("is-visible"), true);
  assert.equal(timers[0].cleared, true);

  timers[1].callback();
  timers[2].callback();
  assert.equal(element.hidden, true);
});
