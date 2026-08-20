import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { activeSeat } from "../game-format.js";
import { PLAYFIELD_CENTRE_Z, TILE_SIZE } from "./three-layout.js";

const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = Math.round((LOGICAL_WIDTH * 5) / 5.8);
const TEXTURE_SCALE = 2;
const PANEL_BORDER_INSET = 16;

export const TABLE_CONSOLE_SCORE_LAYOUT = Object.freeze({
  panelBorderInset: PANEL_BORDER_INSET,
  edgeInset: 99,
  scoreFontSize: 64,
  stickEdgeInset: 44.5,
  stickWidth: 177,
  stickHeight: 177 / 7,
  stickDotRadius: 8.85,
});

export const TABLE_CONSOLE_CORE_LAYOUT = Object.freeze({
  roundFontSize: 80,
  wallFontSize: 46,
});

export function prepareTableConsoleContext(context, canvas) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
}

export const TABLE_CONSOLE_LAYOUT = Object.freeze({
  width: TILE_SIZE.width * 5.8,
  depth: TILE_SIZE.width * 5,
  height: 0.18,
  centreZ: PLAYFIELD_CENTRE_Z,
  cornerRadius: 0.14,
});

export class ThreeTableConsole {
  constructor({ anisotropy = 1 } = {}) {
    this.group = new Group();
    this.group.name = "table-console";
    this.geometries = [];
    this.materials = [];

    this.canvas = document.createElement("canvas");
    this.canvas.width = LOGICAL_WIDTH * TEXTURE_SCALE;
    this.canvas.height = LOGICAL_HEIGHT * TEXTURE_SCALE;
    this.context = this.canvas.getContext("2d");
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = anisotropy;

    const baseMaterial = this.trackMaterial(
      new MeshPhysicalMaterial({
        color: new Color("#061b1a"),
        roughness: 0.36,
        metalness: 0.12,
        clearcoat: 0.42,
        clearcoatRoughness: 0.34,
      }),
    );
    const faceMaterial = this.trackMaterial(
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: true,
        toneMapped: false,
      }),
    );

    const { width, depth, height, centreZ, cornerRadius } =
      TABLE_CONSOLE_LAYOUT;
    const baseGeometry = this.trackGeometry(
      new RoundedBoxGeometry(width, height, depth, 5, cornerRadius),
    );
    const base = new Mesh(baseGeometry, baseMaterial);
    base.name = "table-console-base";
    base.position.set(0, height / 2 + 0.018, centreZ);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    const faceGeometry = this.trackGeometry(new PlaneGeometry(width, depth));
    this.mesh = new Mesh(faceGeometry, faceMaterial);
    this.mesh.name = "table-console-face";
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, height + 0.024, centreZ);
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
  }

  update(state, ui) {
    const context = this.context;
    prepareTableConsoleContext(context, this.canvas);
    drawPanel(context);
    drawCore(context, state, ui);
    drawScores(context, state);
    this.texture.needsUpdate = true;
  }

  restore(state, ui) {
    if (state && ui) this.update(state, ui);
    else this.texture.needsUpdate = true;
  }

  destroy() {
    this.group.remove(...this.group.children);
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.texture.dispose();
  }

  trackGeometry(geometry) {
    this.geometries.push(geometry);
    return geometry;
  }

  trackMaterial(material) {
    this.materials.push(material);
    return material;
  }
}

function drawPanel(context) {
  context.save();
  roundedRect(context, 16, 16, LOGICAL_WIDTH - 32, LOGICAL_HEIGHT - 32, 42);
  const panelGradient = context.createLinearGradient(
    0,
    16,
    0,
    LOGICAL_HEIGHT - 16,
  );
  panelGradient.addColorStop(0, "rgba(16, 51, 46, .985)");
  panelGradient.addColorStop(0.48, "rgba(3, 26, 25, .99)");
  panelGradient.addColorStop(1, "rgba(1, 15, 16, .995)");
  context.fillStyle = panelGradient;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = "rgba(235, 205, 128, .76)";
  context.stroke();
  roundedRect(context, 28, 28, LOGICAL_WIDTH - 56, LOGICAL_HEIGHT - 56, 32);
  context.lineWidth = 2;
  context.strokeStyle = "rgba(255, 244, 211, .12)";
  context.stroke();
  context.fillStyle = "rgba(238, 202, 116, .5)";
  for (const x of [66, LOGICAL_WIDTH - 66]) {
    context.fillRect(x - 22, 47, 44, 3);
    context.fillRect(x - 22, LOGICAL_HEIGHT - 50, 44, 3);
  }
  context.restore();
}

function drawCore(context, state, ui) {
  const { roundFontSize, wallFontSize } = TABLE_CONSOLE_CORE_LAYOUT;
  const centreY = LOGICAL_HEIGHT / 2;
  const coreTop = centreY - 84;
  roundedRect(context, 164, coreTop, 312, 168, 27);
  const coreGradient = context.createLinearGradient(
    0,
    coreTop,
    0,
    coreTop + 168,
  );
  coreGradient.addColorStop(0, "rgba(0, 12, 12, .52)");
  coreGradient.addColorStop(1, "rgba(0, 8, 9, .28)");
  context.fillStyle = coreGradient;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "rgba(232, 203, 132, .18)";
  context.stroke();

  drawText(context, ui.roundLabel, 320, centreY - 34, {
    color: "#f2d17d",
    font: `400 ${roundFontSize}px "Mahjong Brush", "FZKai-Z03", STKaiti, KaiTi, serif`,
  });
  drawText(context, `余牌 ${Number(state.wallCount) || 0}`, 320, centreY + 42, {
    color: "#fff1c9",
    font: `850 ${wallFontSize}px "PingFang SC", sans-serif`,
  });
}

function drawScores(context, state) {
  const active = activeSeat(state) - 1;
  const centreY = LOGICAL_HEIGHT / 2;
  const { edgeInset, scoreFontSize, stickEdgeInset } =
    TABLE_CONSOLE_SCORE_LAYOUT;
  const placements = [
    {
      x: LOGICAL_WIDTH / 2,
      y: LOGICAL_HEIGHT - edgeInset,
      stickX: LOGICAL_WIDTH / 2,
      stickY: LOGICAL_HEIGHT - stickEdgeInset,
      rotation: 0,
    },
    {
      x: LOGICAL_WIDTH - edgeInset,
      y: centreY,
      stickX: LOGICAL_WIDTH - stickEdgeInset,
      stickY: centreY,
      rotation: Math.PI / 2,
    },
    {
      x: LOGICAL_WIDTH / 2,
      y: edgeInset,
      stickX: LOGICAL_WIDTH / 2,
      stickY: stickEdgeInset,
      rotation: 0,
    },
    {
      x: edgeInset,
      y: centreY,
      stickX: stickEdgeInset,
      stickY: centreY,
      rotation: -Math.PI / 2,
    },
  ];
  placements.forEach((placement, index) => {
    const playerId = state.players?.[index];
    if (playerId && state.riichi?.[playerId] === true) {
      drawRiichiStick(
        context,
        placement.stickX,
        placement.stickY,
        placement.rotation,
      );
    }
    drawText(
      context,
      String(Number(state.scores?.[index] ?? 0)),
      placement.x,
      placement.y,
      {
        color: index === active ? "#ffdc78" : "rgba(249, 237, 204, .9)",
        font: `${index === active ? 900 : 760} ${scoreFontSize}px "Roboto Slab", ui-monospace, monospace`,
        rotation: placement.rotation,
        shadow: index === active,
      },
    );
  });
}

function drawRiichiStick(context, x, y, rotation) {
  const { stickWidth, stickHeight, stickDotRadius } =
    TABLE_CONSOLE_SCORE_LAYOUT;
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.shadowColor = "rgba(0, 0, 0, .58)";
  context.shadowBlur = 7;
  context.shadowOffsetY = 3;
  roundedRect(
    context,
    -stickWidth / 2,
    -stickHeight / 2,
    stickWidth,
    stickHeight,
    stickHeight / 2,
  );
  const body = context.createLinearGradient(
    0,
    -stickHeight / 2,
    0,
    stickHeight / 2,
  );
  body.addColorStop(0, "#fffdf2");
  body.addColorStop(0.52, "#e9e5d6");
  body.addColorStop(1, "#b7b2a4");
  context.fillStyle = body;
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(68, 65, 57, .68)";
  context.stroke();
  context.beginPath();
  context.arc(0, 0, stickDotRadius, 0, Math.PI * 2);
  context.fillStyle = "#c63a32";
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(94, 13, 13, .72)";
  context.stroke();
  context.restore();
}

function drawText(context, value, x, y, options) {
  context.save();
  context.translate(x, y);
  context.rotate(options.rotation || 0);
  context.fillStyle = options.color;
  context.font = options.font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (options.shadow) {
    context.shadowColor = "rgba(255, 201, 67, .55)";
    context.shadowBlur = 14;
  }
  context.fillText(String(value), 0, 0);
  context.restore();
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}
