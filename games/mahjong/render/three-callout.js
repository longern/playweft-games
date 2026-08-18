import {
  CanvasTexture,
  Group,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;
const ENTRY_PORTION = 0.18;
const EXIT_PORTION = 0.72;
const MAX_CONCURRENT_CALLOUTS = 3;
const MULTI_CALLOUT_SCALE = 0.78;

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

const MULTI_ACTION_CALLOUT_TARGETS = Object.freeze({
  1: Object.freeze({ x: 0, y: -205 }),
  2: Object.freeze({ x: 430, y: 20 }),
  3: Object.freeze({ x: 0, y: 215 }),
  4: Object.freeze({ x: -430, y: 20 }),
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

export function actionCalloutEvents(events) {
  const candidates = (Array.isArray(events) ? events : []).filter((event) =>
    actionCalloutDescriptor(event)
  );
  const latest = candidates.at(-1);
  if (!latest) return [];
  if (latest.type !== "won") return [latest];
  return candidates.filter(
    (event) => event.type === "won" && event.method === latest.method,
  );
}

export class ThreeActionCallout {
  constructor(animations) {
    this.animations = animations;
    this.group = new Group();
    this.group.name = "action-callouts";
    this.slots = Array.from(
      { length: MAX_CONCURRENT_CALLOUTS },
      (_, index) => createCalloutSlot(index),
    );
    this.group.add(...this.slots.map((slot) => slot.sprite));
  }

  showLatest(events, scope = "") {
    const calloutEvents = actionCalloutEvents(events);
    if (!calloutEvents.length) return;
    const key = calloutEvents
      .map((event) => actionCalloutKey(event, scope))
      .join("|");
    if (!this.animations.claim("action-callout", key)) return;
    this.show(calloutEvents.map(actionCalloutDescriptor));
  }

  show(descriptors) {
    this.cancel();
    const active = (Array.isArray(descriptors) ? descriptors : [descriptors])
      .filter(Boolean)
      .slice(0, this.slots.length)
      .map((descriptor, index) => {
        const slot = this.slots[index];
        drawCallout(slot.context, descriptor);
        slot.texture.needsUpdate = true;
        slot.sprite.visible = true;
        slot.material.opacity = 0;
        return { descriptor, slot };
      });
    if (!active.length) return;
    const multiple = active.length > 1;
    const targets = multiple
      ? MULTI_ACTION_CALLOUT_TARGETS
      : ACTION_CALLOUT_TARGETS;
    const layoutScale = multiple ? MULTI_CALLOUT_SCALE : 1;
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
        for (const { descriptor, slot } of active) {
          const origin =
            SEAT_ORIGINS[descriptor.playerIndex] ?? SEAT_ORIGINS[1];
          const target = targets[descriptor.playerIndex] ?? targets[1];
          slot.sprite.position.x =
            target.x + origin.x * 310 * travel + impactJitter;
          slot.sprite.position.y =
            target.y + origin.y * 235 * travel;
          slot.sprite.scale.set(
            ACTION_CALLOUT_SIZE.width * scale * layoutScale,
            ACTION_CALLOUT_SIZE.height * scale * layoutScale,
            1,
          );
          slot.material.rotation = origin.x * -0.055 * travel;
          slot.material.opacity =
            Math.min(1, entering * 3) * (1 - exiting ** 2);
        }
      },
      complete: () => {
        for (const { slot } of active) slot.sprite.visible = false;
      },
    });
  }

  cancel() {
    this.animations.cancel("action-callout");
    for (const slot of this.slots) slot.sprite.visible = false;
  }

  destroy() {
    this.cancel();
    for (const slot of this.slots) {
      slot.texture.dispose();
      slot.material.dispose();
    }
  }
}

function createCalloutSlot(index) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new Sprite(material);
  sprite.name = `action-callout-${index + 1}`;
  sprite.position.z = 800;
  sprite.renderOrder = 1000 + index;
  sprite.visible = false;
  return { canvas, context, texture, material, sprite };
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
