/**
 * Deduplicates completed paipu writes while a room can deliver the same final
 * projection more than once.
 */
export function createMahjongCompletedPaipuSaver({ save } = {}) {
  if (typeof save !== "function") throw new TypeError("Paipu saver requires a save function");
  const inFlight = new Map();
  const saved = new Set();

  return function saveCompletedPaipu(record) {
    if (record?.status !== "completed" || typeof record.id !== "string" || !record.id) {
      return Promise.resolve({ saved: false, reason: "incomplete" });
    }
    if (saved.has(record.id)) {
      return Promise.resolve({ saved: false, reason: "duplicate" });
    }
    const previous = inFlight.get(record.id);
    if (previous) return previous;
    const pending = Promise.resolve()
      .then(async () => {
        const result = await save(record);
        if (result?.saved !== false) saved.add(record.id);
        return result;
      })
      .finally(() => {
        if (inFlight.get(record.id) === pending) inFlight.delete(record.id);
      });
    inFlight.set(record.id, pending);
    return pending;
  };
}
