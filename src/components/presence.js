import { animate } from "motion/mini";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function createPresence({
  element,
  enter,
  exit,
  enterOptions,
  exitOptions,
  clearStyles = [],
}) {
  let animation;
  let revision = 0;
  let targetVisible = !element.hidden;

  function cleanUpStyles() {
    clearStyles.forEach((property) => element.style.removeProperty(property));
  }

  function finish(nextVisible, currentRevision) {
    if (currentRevision !== revision) return;
    animation = undefined;
    element.hidden = !nextVisible;
    cleanUpStyles();
  }

  function setVisible(nextVisible) {
    if (nextVisible === targetVisible) return;

    animation?.stop();
    animation = undefined;
    const currentRevision = ++revision;
    const reducedMotion = window.matchMedia(REDUCED_MOTION).matches;
    const wasHidden = element.hidden;
    targetVisible = nextVisible;

    if (nextVisible) {
      element.hidden = false;
      element.style.removeProperty("pointer-events");
    } else {
      element.style.pointerEvents = "none";
    }

    if (reducedMotion) {
      finish(nextVisible, currentRevision);
      return;
    }

    animation = animate(
      element,
      resolveKeyframes(nextVisible ? enter : exit, element, {
        wasHidden,
        nextVisible,
      }),
      nextVisible ? enterOptions : exitOptions,
    );
    animation.then(() => finish(nextVisible, currentRevision));
  }

  return {
    setVisible,
    destroy() {
      revision += 1;
      animation?.stop();
      animation = undefined;
      element.style.removeProperty("pointer-events");
      cleanUpStyles();
    },
  };
}

function resolveKeyframes(definition, element, context) {
  return typeof definition === "function"
    ? definition(element, context)
    : definition;
}
