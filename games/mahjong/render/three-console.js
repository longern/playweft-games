import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import { activeSeat } from "../game-format.js";

const TEXTURE_WIDTH = 640;
const TEXTURE_HEIGHT = 416;

export class ThreeTableConsole {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEXTURE_WIDTH;
    this.canvas.height = TEXTURE_HEIGHT;
    this.context = this.canvas.getContext("2d");
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    this.geometry = new PlaneGeometry(142, 92);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.position.set(0, 0, -80);
    this.mesh.renderOrder = 3;
  }

  resize(viewportHeight) {
    this.mesh.position.y = viewportHeight * 0.03;
  }

  update(state, ui) {
    const context = this.context;
    context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
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
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

function drawPanel(context) {
  context.save();
  context.shadowColor = "rgba(0, 0, 0, .42)";
  context.shadowBlur = 22;
  context.shadowOffsetY = 12;
  roundedRect(context, 16, 16, TEXTURE_WIDTH - 32, TEXTURE_HEIGHT - 32, 42);
  context.fillStyle = "rgba(3, 24, 23, .97)";
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = 5;
  context.strokeStyle = "rgba(226, 194, 115, .68)";
  context.stroke();
  roundedRect(context, 28, 28, TEXTURE_WIDTH - 56, TEXTURE_HEIGHT - 56, 32);
  context.lineWidth = 2;
  context.strokeStyle = "rgba(255, 255, 255, .08)";
  context.stroke();
  context.restore();
}

function drawCore(context, state, ui) {
  roundedRect(context, 164, 124, 312, 168, 27);
  context.fillStyle = "rgba(0, 12, 12, .34)";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "rgba(232, 203, 132, .18)";
  context.stroke();

  drawText(context, ui.roundLabel, 320, 176, {
    color: "#f2d17d",
    font: '800 43px "PingFang SC", sans-serif',
  });
  drawText(context, `余牌 ${Number(state.wallCount) || 0}`, 320, 241, {
    color: "#fff1c9",
    font: '850 56px "PingFang SC", sans-serif',
  });
}

function drawScores(context, state) {
  const active = activeSeat(state) - 1;
  const placements = [
    { x: 320, y: 352, rotation: 0 },
    { x: 526, y: 208, rotation: Math.PI / 2 },
    { x: 320, y: 64, rotation: 0 },
    { x: 114, y: 208, rotation: -Math.PI / 2 },
  ];
  placements.forEach((placement, index) => {
    drawText(context, String(Number(state.scores?.[index] ?? 0)), placement.x, placement.y, {
      color: index === active ? "#ffdc78" : "rgba(249, 237, 204, .9)",
      font: `${index === active ? 900 : 760} 44px "Roboto Slab", ui-monospace, monospace`,
      rotation: placement.rotation,
      shadow: index === active,
    });
  });
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
