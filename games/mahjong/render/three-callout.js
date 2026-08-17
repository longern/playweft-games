import {
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;
const ENTRY_PORTION = 0.18;
const EXIT_PORTION = 0.72;

export const ACTION_CALLOUT_DURATION_MS = 820;
export const ACTION_CALLOUT_SIZE = Object.freeze({
  width: 660,
  height: 330,
  fontSize: 300,
});

const ACTION_STYLES = Object.freeze({
  chi: Object.freeze({ label: "吃", color: "#f1b84b", glow: "#ffd985" }),
  pon: Object.freeze({ label: "碰", color: "#df4d3f", glow: "#ff8975" }),
  kan: Object.freeze({ label: "杠", color: "#5aa8dd", glow: "#a9ddff" }),
  ankan: Object.freeze({ label: "杠", color: "#5aa8dd", glow: "#a9ddff" }),
  kakan: Object.freeze({ label: "杠", color: "#5aa8dd", glow: "#a9ddff" }),
  riichi: Object.freeze({ label: "立直", color: "#edbd45", glow: "#ffe398" }),
  ron: Object.freeze({ label: "和", color: "#d5444d", glow: "#ff8a8f" }),
  tsumo: Object.freeze({ label: "自摸", color: "#d5444d", glow: "#ffb08b" }),
});

const SEAT_ORIGINS = Object.freeze({
  1: Object.freeze({ x: 0, y: -1 }),
  2: Object.freeze({ x: 1, y: 0 }),
  3: Object.freeze({ x: 0, y: 1 }),
  4: Object.freeze({ x: -1, y: 0 }),
});

export const ACTION_CALLOUT_TARGETS = Object.freeze({
  1: Object.freeze({ x: 0, y: -170 }),
  2: Object.freeze({ x: 360, y: 36 }),
  3: Object.freeze({ x: 0, y: 180 }),
  4: Object.freeze({ x: -360, y: 36 }),
});

export function actionCalloutDescriptor(event) {
  const action = event?.type === "claimed"
    ? event.kind
    : event?.type === "riichi"
      ? "riichi"
      : event?.type === "won"
        ? event.method
        : "";
  const style = ACTION_STYLES[action];
  if (!style) return null;
  return {
    ...style,
    action,
    playerIndex: Number(event.playerIndex) || 1,
  };
}

export function actionCalloutKey(event, scope = "") {
  const descriptor = actionCalloutDescriptor(event);
  if (!descriptor) return "";
  return [
    scope,
    descriptor.action,
    descriptor.playerIndex,
    Number(event.fromIndex) || 0,
    Number(event.tile) || 0,
  ].join(":");
}

export class ThreeActionCallout {
  constructor(animations) {
    this.animations = animations;
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEXTURE_WIDTH;
    this.canvas.height = TEXTURE_HEIGHT;
    this.context = this.canvas.getContext("2d");
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.sprite = new Sprite(this.material);
    this.sprite.name = "claim-callout";
    this.sprite.position.z = 800;
    this.sprite.renderOrder = 1000;
    this.sprite.visible = false;
  }

  showLatest(events, scope = "") {
    const event = [...(Array.isArray(events) ? events : [])]
      .reverse()
      .find((candidate) => actionCalloutDescriptor(candidate));
    if (!event) return;
    const key = actionCalloutKey(event, scope);
    if (!this.animations.claim("action-callout", key)) return;
    this.show(actionCalloutDescriptor(event));
  }

  show(descriptor) {
    this.cancel();
    drawCallout(this.context, descriptor);
    this.texture.needsUpdate = true;
    this.sprite.visible = true;
    this.material.opacity = 0;
    const origin = SEAT_ORIGINS[descriptor.playerIndex] ?? SEAT_ORIGINS[1];
    const target = ACTION_CALLOUT_TARGETS[descriptor.playerIndex]
      ?? ACTION_CALLOUT_TARGETS[1];
    this.animations.play({
      id: "action-callout",
      duration: ACTION_CALLOUT_DURATION_MS,
      update: (progress) => {
        const entering = Math.min(1, progress / ENTRY_PORTION);
        const entryEase = easeOutBack(entering);
        const exiting = progress <= EXIT_PORTION
          ? 0
          : (progress - EXIT_PORTION) / (1 - EXIT_PORTION);
        const travel = (1 - entering) ** 3;
        const impactJitter = entering >= 1 && exiting === 0
          ? Math.sin(progress * 92) * (1 - progress) * 3
          : 0;
        const scale = entering < 1
          ? 0.42 + 0.58 * entryEase
          : 1 + 0.13 * exiting;

        this.sprite.position.x =
          target.x + origin.x * 310 * travel + impactJitter;
        this.sprite.position.y = target.y + origin.y * 235 * travel;
        this.sprite.scale.set(
          ACTION_CALLOUT_SIZE.width * scale,
          ACTION_CALLOUT_SIZE.height * scale,
          1,
        );
        this.material.rotation = origin.x * -0.055 * travel;
        this.material.opacity =
          Math.min(1, entering * 3) * (1 - exiting ** 2);
      },
      complete: () => {
        this.sprite.visible = false;
      },
    });
  }

  cancel() {
    this.animations.cancel("action-callout");
    this.sprite.visible = false;
  }

  destroy() {
    this.cancel();
    this.texture.dispose();
    this.material.dispose();
  }
}

function drawCallout(context, descriptor) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  context.save();
  context.translate(TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);
  context.rotate(-0.035);

  const streak = context.createLinearGradient(-430, 0, 430, 0);
  streak.addColorStop(0, "rgba(3, 15, 18, 0)");
  streak.addColorStop(0.16, "rgba(3, 15, 18, 0.86)");
  streak.addColorStop(0.48, "rgba(3, 15, 18, 0.98)");
  streak.addColorStop(0.84, "rgba(3, 15, 18, 0.82)");
  streak.addColorStop(1, "rgba(3, 15, 18, 0)");
  context.fillStyle = streak;
  context.beginPath();
  context.moveTo(-470, -64);
  context.quadraticCurveTo(-170, -130, 470, -76);
  context.lineTo(430, 76);
  context.quadraticCurveTo(110, 126, -440, 72);
  context.closePath();
  context.fill();

  context.globalAlpha = 0.7;
  context.strokeStyle = descriptor.color;
  context.lineWidth = 7;
  for (const offset of [-102, 100]) {
    context.beginPath();
    context.moveTo(-370, offset);
    context.lineTo(370, offset * 0.78);
    context.stroke();
  }
  context.globalAlpha = 1;

  context.textAlign = "center";
  context.textBaseline = "middle";
  const fontSize = descriptor.label.length > 1
    ? ACTION_CALLOUT_SIZE.fontSize * 0.76
    : ACTION_CALLOUT_SIZE.fontSize;
  context.font = `400 ${fontSize}px "Playweft Mahjong Xingshu", serif`;
  context.lineJoin = "round";
  context.miterLimit = 2;
  context.shadowColor = descriptor.glow;
  context.shadowBlur = 34;
  context.strokeStyle = "rgba(1, 10, 13, 0.96)";
  context.lineWidth = 34;
  context.strokeText(descriptor.label, 0, 10);
  context.shadowBlur = 18;
  context.strokeStyle = descriptor.color;
  context.lineWidth = 16;
  context.strokeText(descriptor.label, 0, 10);
  context.shadowBlur = 6;
  context.fillStyle = "#fff8df";
  context.fillText(descriptor.label, 0, 10);
  context.restore();
}

function easeOutBack(progress) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (progress - 1) ** 3 + c1 * (progress - 1) ** 2;
}
