import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayweftClient } from "../src/playweft-client.js";

test("Playweft client correlates action results and errors with request IDs", () => {
  const windowListeners = new Map();
  const parentMessages = [];
  const portMessages = [];
  const results = [];
  const errors = [];
  const fakePort = {
    onmessage: undefined,
    close() {},
    start() {},
    postMessage(message) {
      portMessages.push(message);
    },
  };
  const fakeWindow = {
    parent: {
      postMessage(message, target) {
        parentMessages.push({ message, target });
      },
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type) {
      windowListeners.delete(type);
    },
  };
  const originalWindow = globalThis.window;
  const originalCrypto = globalThis.crypto;
  globalThis.window = fakeWindow;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "request-123" },
  });

  try {
    const client = createPlayweftClient({
      descriptor: { name: "Test" },
      script: "return true",
      minPlayers: 2,
      maxPlayers: 2,
      onActionResult: (result) => results.push(result),
      onError: (error, code, requestId) =>
        errors.push({ error, code, requestId }),
    });

    assert.deepEqual(parentMessages[0], {
      message: { type: "playweft:bridge-ready", version: 1 },
      target: "*",
    });
    windowListeners.get("message")({
      source: fakeWindow.parent,
      data: { type: "playweft:bridge", version: 1 },
      ports: [fakePort],
    });

    const requestId = client.sendAction({ type: "move", column: 4 });
    assert.equal(requestId, "request-123");
    assert.deepEqual(portMessages.at(-1), {
      type: "action",
      requestId: "request-123",
      action: { type: "move", column: 4 },
    });

    fakePort.onmessage({
      data: {
        type: "action-result",
        requestId: "request-123",
        version: 8,
      },
    });
    fakePort.onmessage({
      data: {
        type: "error",
        code: "ACTION_REJECTED",
        error: "Move rejected",
        requestId: "request-456",
      },
    });
    fakePort.onmessage({
      data: {
        type: "error",
        code: "ROOM_ERROR",
        error: "Connection interrupted",
      },
    });

    assert.deepEqual(results, [
      { requestId: "request-123", version: 8 },
    ]);
    assert.deepEqual(errors, [
      {
        error: "Move rejected",
        code: "ACTION_REJECTED",
        requestId: "request-456",
      },
      {
        error: "Connection interrupted",
        code: "ROOM_ERROR",
        requestId: undefined,
      },
    ]);
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("Playweft client does not create an action request before connecting", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    parent: { postMessage() {} },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    const client = createPlayweftClient({
      descriptor: { name: "Test" },
      script: "return true",
      minPlayers: 2,
      maxPlayers: 2,
    });
    assert.equal(client.sendAction({ type: "move" }), undefined);
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});
