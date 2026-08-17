# Playweft bridge handoff challenge

## Scenario

Playweft games communicate with their iframe host through a transferred
`MessagePort`. The host may replace that port while requests or
`game.initialize` are still in flight—for example after a host reload or a
transport recovery.

The current implementation can let an old port affect the new session. Fix the
handoff so a replaced bridge is a strict session boundary.

## Required behavior

Work primarily in:

- `src/playweft-rpc.js`
- `src/playweft-client.js`
- `src/playweft-solo-client.js`

You may add or update tests. Do not change the public return shapes of the
clients or the JSON-RPC wire format.

### RPC peer

1. `connect(nextPort)` starts a new connection generation. Replacing a port
   rejects every request belonging to the old generation with
   `code === "BRIDGE_REPLACED"` and `retryable === true`.
2. After replacement, responses and notifications delivered through an older
   port must be ignored. They must not settle new requests, invoke
   `onNotification`, or otherwise affect the current generation.
3. Two simultaneous calls may not use the same request ID. A duplicate call
   must reject with `code === "DUPLICATE_REQUEST_ID"` without posting a second
   message or disturbing the original request.
4. If `port.postMessage` throws synchronously, remove that request from the
   pending set and reject it with `code === "BRIDGE_SEND_FAILED"` and
   `retryable === true`. A later call may reuse its ID.
5. `destroy()` remains idempotent. It rejects pending requests with
   `BRIDGE_CLOSED`, closes the active port, and prevents all later messages or
   connections from reviving the peer.

### Room and solo clients

1. Treat each accepted bridge port as a new initialization generation.
2. `sendAction()` must return `undefined` until the current room bridge has
   successfully completed `game.initialize`. A replacement immediately makes
   the room client unready until the replacement initialization succeeds.
3. A result or error from an obsolete initialization must not invoke
   `onReady`, `onContext`, or `onError`.
4. State-version filtering is scoped to the current bridge generation. A new
   successfully initialized bridge must be able to emit a lower version for
   the same match, while stale-port notifications remain ignored.
5. After `destroy()`, no callback may fire.

Apply the same obsolete-initialization protection to the solo client.

## Constraints

- Preserve existing behavior covered by `npm test`.
- Do not add runtime dependencies.
- Do not solve the task with timers or arbitrary delays.
- Keep the implementation browser-compatible.
- Add focused regression tests for the behavior you implement.

## Verification

```sh
npm test
node --test model-eval/bridge-handoff/public.test.js
```

The evaluator also runs held-out race and failure-path tests. Passing the
public tests alone is not sufficient.

## Submission

Return a short explanation of the connection-generation invariant, the files
changed, and the test commands run. Do not merely describe a patch—implement
and verify it.
