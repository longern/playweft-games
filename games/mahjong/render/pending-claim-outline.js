import { Vector2 } from "three";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";

export function shouldShowPendingClaimOutline(state, ui = {}) {
  return state?.phase === "claiming" &&
    ui.readOnly !== true &&
    ui.actionInFlight !== true &&
    Array.isArray(state?.legalActions?.claims) &&
    state.legalActions.claims.length > 0;
}

export function createPendingClaimOutlinePass(scene, camera, resolution) {
  const pass = new OutlinePass(
    new Vector2(resolution.width, resolution.height),
    scene,
    camera,
  );
  pass.visibleEdgeColor.set("#ffd86a");
  pass.hiddenEdgeColor.set("#ffd86a");
  pass.edgeStrength = 3.2;
  pass.edgeThickness = 4;
  pass.edgeGlow = 0.2;
  pass.pulsePeriod = 0;
  pass.selectedObjects = [];
  return pass;
}

export function setPendingClaimOutlineBreath(pass, pulse) {
  const value = Math.max(0, Math.min(1, Number(pulse) || 0));
  pass.edgeStrength = 2.9 + 0.7 * value;
  pass.edgeGlow = 0.16 + 0.16 * value;
}
