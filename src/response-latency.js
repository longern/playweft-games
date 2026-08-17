const MAX_SAMPLES_PER_ACTION = 24;
let responseLatencySnapshot = emptySnapshot();

// These Mahjong actions are acknowledged immediately and only require ordinary
// rules validation on the server. Deliberately exclude operations that may
// trigger a potentially expensive computation.
export const IMMEDIATE_RESPONSE_ACTION_TYPES = new Set([
  "discard",
  "claim",
  "pass",
  "riichi",
  "kan",
  "tsumo",
  "abort_nine",
  "next_hand",
  "new_match",
]);

export function shouldMeasureImmediateResponse(action) {
  return IMMEDIATE_RESPONSE_ACTION_TYPES.has(action?.type);
}

function validMilliseconds(milliseconds) {
  return Number.isFinite(milliseconds) && milliseconds >= 0;
}

function emptySnapshot() {
  return { version: 1, actions: {} };
}

export function addResponseLatencySample(
  snapshot,
  actionType,
  milliseconds,
  recordedAt = Date.now(),
) {
  if (
    !IMMEDIATE_RESPONSE_ACTION_TYPES.has(actionType) ||
    !validMilliseconds(milliseconds)
  ) {
    return snapshot ?? emptySnapshot();
  }

  const previous = snapshot?.version === 1 && snapshot.actions
    ? snapshot
    : emptySnapshot();
  const previousSamples = previous.actions[actionType]?.samples ?? [];
  const samples = [...previousSamples, Math.round(milliseconds)].slice(
    -MAX_SAMPLES_PER_ACTION,
  );
  const meanMs = Math.round(
    samples.reduce((total, sample) => total + sample, 0) / samples.length,
  );

  return {
    version: 1,
    actions: {
      ...previous.actions,
      [actionType]: {
        samples,
        lastMs: samples.at(-1),
        meanMs,
        updatedAt: recordedAt,
      },
    },
  };
}

/**
 * Record an action's request-to-response duration for a later presentation
 * decision. This deliberately lives only for the current page lifetime.
 */
export function recordImmediateResponseLatency(
  action,
  milliseconds,
  { recordedAt = Date.now() } = {},
) {
  if (!shouldMeasureImmediateResponse(action) || !validMilliseconds(milliseconds)) {
    return responseLatencySnapshot;
  }

  responseLatencySnapshot = addResponseLatencySample(
    responseLatencySnapshot,
    action.type,
    milliseconds,
    recordedAt,
  );
  return responseLatencySnapshot;
}

export function readImmediateResponseLatency() {
  return responseLatencySnapshot;
}

export function clearImmediateResponseLatency() {
  responseLatencySnapshot = emptySnapshot();
}
