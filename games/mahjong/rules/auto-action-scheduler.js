/**
 * Keeps delayed local actions tied to the table state that scheduled them.
 * Cancelling advances the generation as well as clearing the browser timer,
 * so a callback already queued by the event loop cannot act on a newer turn.
 */
export function createMahjongAutoActionScheduler(timerHost = globalThis) {
  // Window timer functions are Web-IDL methods. Some embedded browser hosts
  // reject a detached `setTimeout(...)` / `clearTimeout(...)` call with
  // "Illegal invocation", so retain the host receiver for both operations.
  const setTimer =
    typeof timerHost?.setTimeout === "function"
      ? timerHost.setTimeout.bind(timerHost)
      : (callback, delay) => globalThis.setTimeout(callback, delay);
  const clearTimer =
    typeof timerHost?.clearTimeout === "function"
      ? timerHost.clearTimeout.bind(timerHost)
      : (timer) => globalThis.clearTimeout(timer);
  let timer;
  let generation = 0;

  function cancel() {
    generation += 1;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }

  function schedule(callback, delay = 0) {
    cancel();
    const scheduledGeneration = ++generation;
    timer = setTimer(() => {
      if (scheduledGeneration !== generation) return;
      timer = undefined;
      callback(scheduledGeneration);
    }, delay);
    return scheduledGeneration;
  }

  return {
    cancel,
    schedule,
    isCurrent(generationToCheck) {
      return generationToCheck === generation;
    },
  };
}

/**
 * A public projection can say that the local player still has a claim option
 * even while an earlier claimant must answer first. Claim order is private, so
 * the worker must always inspect the authoritative claimIndex in that phase.
 */
export function shouldScheduleMahjongAiTurn(state) {
  if (state?.phase === "claiming") return true;
  const viewerSeat = Number(state?.viewerSeat) || 1;
  return Number(state?.turnIndex) !== viewerSeat;
}
