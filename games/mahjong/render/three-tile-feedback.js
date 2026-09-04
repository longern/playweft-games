import { Color, Mesh, NormalBlending, ShaderMaterial } from "three";

const FEEDBACK_RENDER_ORDER = 5;
export const TILE_FEEDBACK_LAYER = 1;
const MATCH = 1;
const TSUMOGIRI = 2;
const DISABLED = 4;

export const DORA_BREATH_DURATION_MS = 2000;

const FEEDBACK_STYLE = Object.freeze({
  match: Object.freeze({ color: "#2f73c5", opacity: 0.2 }),
  tsumogiri: Object.freeze({ color: "#4a5968", opacity: 0.16 }),
  disabled: Object.freeze({ color: "#050807", opacity: 0.26 }),
});

/**
 * Owns the single translucent feedback shell used by every visible tile.
 * Transient feedback hides persistent feedback without destroying its state:
 * disabled > matching type > tsumogiri. Dora is intentionally not part of
 * this layer: it changes the lit porcelain shell so printed ink stays intact.
 */
export class ThreeTileFeedback {
  constructor(geometry) {
    this.geometry = geometry;
    this.materials = new Map();
  }

  attach(tile, state = {}) {
    const feedback = {
      match: state.match === true,
      tsumogiri: state.tsumogiri === true,
      disabled: state.disabled === true,
    };
    const mesh = new Mesh(this.geometry, this.materialFor(feedback));
    // The ordinary scene cameras only render layer 0. This layer is replayed
    // directly over the final ACES output by ThreeTileFeedbackCompositor.
    mesh.layers.set(TILE_FEEDBACK_LAYER);
    mesh.renderOrder = FEEDBACK_RENDER_ORDER;
    mesh.userData.tileRoot = tile;
    feedback.mesh = mesh;
    tile.userData.feedback = feedback;
    tile.add(mesh);
    this.apply(tile);
    return mesh;
  }

  setMatch(tile, visible) {
    const feedback = tile?.userData?.feedback;
    if (!feedback || feedback.match === (visible === true)) return;
    feedback.match = visible === true;
    this.apply(tile);
  }

  apply(tile) {
    const feedback = tile?.userData?.feedback;
    if (!feedback) return;
    const mask = effectiveFeedbackMask(feedback);
    feedback.mesh.visible = mask !== 0;
    feedback.mesh.material = this.materialForMask(mask);
  }

  materialFor(state) {
    return this.materialForMask(effectiveFeedbackMask(state));
  }

  materialForMask(mask) {
    if (!this.materials.has(mask)) {
      this.materials.set(mask, createFeedbackMaterial(mask));
    }
    return this.materials.get(mask);
  }

  destroy() {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}

export function doraBreathIntensity(progress) {
  const phase = clamp01(progress);
  return Math.sin(Math.PI * phase) ** 2;
}

export function effectiveFeedbackMask(state = {}) {
  if (state.disabled === true) return DISABLED;
  if (state.match === true) return MATCH;
  return state.tsumogiri === true ? TSUMOGIRI : 0;
}

function createFeedbackMaterial(mask) {
  const material = new ShaderMaterial({
    uniforms: {
      matchColor: { value: new Color(FEEDBACK_STYLE.match.color) },
      tsumogiriColor: { value: new Color(FEEDBACK_STYLE.tsumogiri.color) },
      disabledColor: { value: new Color(FEEDBACK_STYLE.disabled.color) },
      matchOpacity: {
        value: mask & MATCH ? FEEDBACK_STYLE.match.opacity : 0,
      },
      tsumogiriOpacity: {
        value: mask & TSUMOGIRI ? FEEDBACK_STYLE.tsumogiri.opacity : 0,
      },
      disabledOpacity: {
        value: mask & DISABLED ? FEEDBACK_STYLE.disabled.opacity : 0,
      },
      feedbackFade: { value: 1 },
    },
    transparent: true,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 matchColor;
      uniform vec3 tsumogiriColor;
      uniform vec3 disabledColor;
      uniform float matchOpacity;
      uniform float tsumogiriOpacity;
      uniform float disabledOpacity;
      uniform float feedbackFade;

      void layerOver(
        inout vec3 premultiplied,
        inout float opacity,
        vec3 layerColor,
        float layerOpacity
      ) {
        premultiplied = layerColor * layerOpacity +
          premultiplied * (1.0 - layerOpacity);
        opacity = layerOpacity + opacity * (1.0 - layerOpacity);
      }

      void main() {
        vec3 colour = vec3(0.0);
        float opacity = 0.0;

        layerOver(colour, opacity, tsumogiriColor, tsumogiriOpacity);

        layerOver(colour, opacity, matchColor, matchOpacity);
        layerOver(colour, opacity, disabledColor, disabledOpacity);

        float fullOpacity = opacity;
        opacity *= feedbackFade;
        if (opacity < 0.001) discard;
        gl_FragColor = vec4(colour / max(fullOpacity, 0.001), opacity);
        #include <colorspace_fragment>
      }
    `,
  });
  material.name = `mahjong-tile-feedback-${mask}`;
  material.userData.feedbackMask = mask;
  return material;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
