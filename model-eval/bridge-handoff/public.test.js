import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayweftClient } from "../../src/playweft-client.js";
import { createPlayweftRpcPeer } from "../../src/playweft-rpc.js";

function createPort({ throwOnPost = false } = {}) {
  return {
    onmessage: undefined,
    messages: [],
    closed: false,
    close() {
      this.closed = true;
    },
    start() {},
    postMessage(message) {
      if (throwOnPost) throw new Error("transport unavailable");
      this.messages.push(message);
    },
    emit(data) {
      this.onmessage?.({ data });
    },
  };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function settleWithin(promise, milliseconds = 50) {
  return Promise.race([
    promise.then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error }),
    ),
    new Promise((resolve) =>
      setTimeout(() => resolve({ status: "timeout" }), milliseconds),
    ),
  ]);
}

test("a stale port cannot resolve a request in the replacement generation", async () => {
  const first = createPort();
  const second = createPort();
  const rpc = createPlayweftRpcPeer();

  rpc.connect(first);
  const abandoned = rpc.call("old.request", undefined, "shared-id");
  rpc.connect(second);
  await assert.rejects(
    abandoned,
    (error) => error.code === "BRIDGE_REPLACED" && error.retryable === true,
  );

  const current = rpc.call("new.request", undefined, "shared-id");
  first.emit(rpcResult("shared-id", "stale"));
  second.emit(rpcResult("shared-id", "fresh"));

  assert.equal(await current, "fresh");
  rpc.destroy();
});

test("duplicate request IDs reject without replacing the original request", async () => {
  const port = createPort();
  const rpc = createPlayweftRpcPeer();
  rpc.connect(port);

  const original = rpc.call("first", undefined, "duplicate-id");
  const duplicate = rpc.call("second", undefined, "duplicate-id");
  const duplicateOutcome = await settleWithin(duplicate);

  assert.equal(duplicateOutcome.status, "rejected");
  assert.equal(duplicateOutcome.error.code, "DUPLICATE_REQUEST_ID");
  assert.equal(port.messages.length, 1);

  port.emit(rpcResult("duplicate-id", "original-result"));
  assert.equal(await original, "original-result");
  rpc.destroy();
});

test("room actions are gated by initialization for every bridge generation", async () => {
  const listeners = new Map();
  const first = createPort();
  const second = createPort();
  const ids = ["initialize-one", "action-one", "initialize-two", "action-two"];
  const fakeWindow = {
    parent: { postMessage() {} },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const originalWindow = globalThis.window;
  const originalCrypto = globalThis.crypto;
  globalThis.window = fakeWindow;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => ids.shift() },
  });

  const connect = (port) =>
    listeners.get("message")({
      source: fakeWindow.parent,
      data: { type: "playweft:bridge", version: 1 },
      ports: [port],
    });

  try {
    const client = createPlayweftClient();
    connect(first);
    assert.equal(client.sendAction({ type: "move" }), undefined);

    first.emit(
      rpcResult("initialize-one", {
        mode: "room",
        protocolVersion: 1,
        capabilities: [],
        playerId: "player-one",
      }),
    );
    await Promise.resolve();
    assert.equal(client.sendAction({ type: "move" }), "action-one");

    connect(second);
    assert.equal(client.sendAction({ type: "move" }), undefined);

    second.emit(
      rpcResult("initialize-two", {
        mode: "room",
        protocolVersion: 1,
        capabilities: [],
        playerId: "player-two",
      }),
    );
    await Promise.resolve();
    assert.equal(client.sendAction({ type: "move" }), "action-two");
    client.destroy();
  } finally {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});

test("a synchronous send failure is retryable and releases its request ID", async () => {
  const broken = createPort({ throwOnPost: true });
  const working = createPort();
  const rpc = createPlayweftRpcPeer();
  rpc.connect(broken);

  await assert.rejects(
    rpc.call("request", undefined, "reusable-id"),
    (error) => error.code === "BRIDGE_SEND_FAILED" && error.retryable === true,
  );

  rpc.connect(working);
  const retried = rpc.call("request", undefined, "reusable-id");
  working.emit(rpcResult("reusable-id", "ok"));
  assert.equal(await retried, "ok");
  rpc.destroy();
});
