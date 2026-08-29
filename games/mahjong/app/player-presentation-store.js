/**
 * Shared player-owned media state for table and result renderers.
 * Consumers address a presentation by stable player ID; seat/position
 * projection remains the responsibility of the caller.
 */
export function createMahjongPlayerPresentationStore() {
  let values = new Map();
  const subscribers = new Set();

  function replace(entries) {
    values = entries instanceof Map ? new Map(entries) : new Map();
    for (const listener of subscribers) listener();
  }

  function clear() {
    if (!values.size) return;
    replace();
  }

  function get({ playerId } = {}) {
    return values.get(String(playerId || ""));
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  return { replace, clear, get, subscribe };
}
