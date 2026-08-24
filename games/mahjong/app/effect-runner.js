/**
 * Runs presentation-only work outside the authoritative Mahjong action path.
 * A browser integration such as audio, animation, or WebGL must never turn an
 * already accepted game action into a failed turn.
 */
export function createMahjongEffectRunner({
  onError = (label, error) => console.error(`Mahjong ${label} effect failed`, error),
} = {}) {
  function report(label, error) {
    try {
      onError(label, error);
    } catch {
      // Error reporting itself is also presentation-only.
    }
  }

  function run(label, effect) {
    try {
      const value = effect();
      if (value && typeof value.then === "function") {
        void value.catch((error) => report(label, error));
      }
      return value;
    } catch (error) {
      report(label, error);
      return undefined;
    }
  }

  function runAll(effects) {
    for (const [label, effect] of effects) run(label, effect);
  }

  return { run, runAll };
}
