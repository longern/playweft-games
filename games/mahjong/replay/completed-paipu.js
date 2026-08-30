/**
 * Serializes paipu writes while a room can deliver the same result projection
 * more than once. Completed records are deduplicated permanently; intermediate
 * room fragments are keyed by hand so later hands can still be appended.
 */
export function createMahjongCompletedPaipuSaver({ save } = {}) {
  if (typeof save !== "function") throw new TypeError("Paipu saver requires a save function");
  const inFlight = new Map();
  const savedCompleted = new Set();
  const savedFragments = new Set();

  return function saveCompletedPaipu(record) {
    const isRoomFragment = record?.roomFragment === true;
    const isCompleted = record?.status === "completed";
    if ((!isCompleted && !isRoomFragment) || typeof record?.id !== "string" || !record.id) {
      return Promise.resolve({ saved: false, reason: "incomplete" });
    }
    if (isCompleted && savedCompleted.has(record.id)) {
      return Promise.resolve({ saved: false, reason: "duplicate" });
    }

    const handIndex = isRoomFragment
      ? Number(record.hands?.[record.hands.length - 1]?.index)
      : -1;
    const key = isRoomFragment
      ? `${record.id}:${Number.isInteger(handIndex) ? handIndex : "?"}:${record.status}`
      : record.id;
    if (!isCompleted && savedFragments.has(key)) {
      return Promise.resolve({ saved: false, reason: "duplicate" });
    }
    const previous = inFlight.get(key);
    if (previous) return previous;

    const pending = Promise.resolve()
      .then(async () => {
        const result = await save(record);
        if (result?.saved !== false) {
          if (isCompleted) savedCompleted.add(record.id);
          else savedFragments.add(key);
        }
        return result;
      })
      .finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      });
    inFlight.set(key, pending);
    return pending;
  };
}
