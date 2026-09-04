import { DoubleSide, MeshBasicMaterial } from "three";
import { TILE_FEEDBACK_LAYER } from "./three-tile-feedback.js";

const SCENE_LAYER = 0;

/**
 * Draws tile feedback directly over the tone-mapped framebuffer. A depth-only
 * replay first restores the visible scene surfaces, so feedback still obeys
 * real tile occlusion even though its colour is composed after OutputPass.
 */
export class ThreeTileFeedbackCompositor {
  constructor({ scene, camera, overlayScene, overlayCamera }) {
    this.scene = scene;
    this.camera = camera;
    this.overlayScene = overlayScene;
    this.overlayCamera = overlayCamera;
    this.depthMaterial = new MeshBasicMaterial({
      colorWrite: false,
      depthTest: true,
      depthWrite: true,
      side: DoubleSide,
    });
  }

  render(renderer) {
    const sceneHasFeedback = hasVisibleFeedback(this.scene);
    const overlayHasFeedback = hasVisibleFeedback(this.overlayScene);
    if (!sceneHasFeedback && !overlayHasFeedback) return;

    const renderTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    try {
      if (sceneHasFeedback) {
        this.renderScene(renderer, this.scene, this.camera);
      }
      if (overlayHasFeedback) {
        this.renderScene(renderer, this.overlayScene, this.overlayCamera);
      }
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(renderTarget);
    }
  }

  renderScene(renderer, scene, camera) {
    const cameraLayerMask = camera.layers.mask;
    const overrideMaterial = scene.overrideMaterial;
    renderer.clearDepth();
    try {
      camera.layers.set(SCENE_LAYER);
      scene.overrideMaterial = this.depthMaterial;
      renderer.render(scene, camera);

      scene.overrideMaterial = overrideMaterial;
      camera.layers.set(TILE_FEEDBACK_LAYER);
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = overrideMaterial;
      camera.layers.mask = cameraLayerMask;
    }
  }

  dispose() {
    this.depthMaterial.dispose();
  }
}

export function hasVisibleFeedback(scene) {
  if (!scene) return false;
  let found = false;
  scene.traverseVisible((object) => {
    if (!found && object.layers.isEnabled(TILE_FEEDBACK_LAYER)) found = true;
  });
  return found;
}
