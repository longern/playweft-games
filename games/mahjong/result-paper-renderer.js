import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import { TILE_PHYSICAL_MM } from "./render/three-layout.js";

const A4_WIDTH_MM = 297;
const A4_HEIGHT_MM = 210;
export const RESULT_PAPER_WIDTH = A4_WIDTH_MM / TILE_PHYSICAL_MM.height;
export const RESULT_PAPER_DEPTH = A4_HEIGHT_MM / TILE_PHYSICAL_MM.height;
const PAPER_TEXTURE_VIEWPORT = Object.freeze({ width: 1000, height: 707 });
const PAPER_EDGE_LIFT = 0.024;
const PAPER_CORNER_LIFT = 0.065;
const PAPER_BUMP_SCALE = 0.004;
const PAPER_MARGIN_X = 54;
const PAPER_MARGIN_Y = 72;
const PAPER_ROW_HEIGHT = 68;
const PAPER_COLUMN_GAP = 64;
const PAPER_TEXTURE_SCALE = 2;
const PAPER_TEXT_SIZE = 32;
const PAPER_TEXT_FONT =
  `700 ${PAPER_TEXT_SIZE}px system-ui, -apple-system, BlinkMacSystemFont, `
  + '"Segoe UI", "Microsoft YaHei", sans-serif';
const PAPER_TEXT_COLOR = "#1d1c18";
const PAPER_VALUE_COLOR = "#173f61";
export class MahjongResultPaper {
  constructor(maxAnisotropy = 1) {
    this.destroyed = false;
    this.paperTextureCanvas = document.createElement("canvas");
    this.paperTexture = new CanvasTexture(this.paperTextureCanvas);
    this.paperTexture.colorSpace = SRGBColorSpace;
    this.paperTexture.anisotropy = Math.min(8, maxAnisotropy);
    this.paperTexture.needsUpdate = true;
    this.paperSurfaceTexture = createPaperSurfaceTexture(maxAnisotropy);
    this.createPaper();
  }

  createPaper() {
    this.paperTopMaterial = new MeshStandardMaterial({
      map: this.paperTexture,
      roughness: 0.98,
      roughnessMap: this.paperSurfaceTexture,
      bumpMap: this.paperSurfaceTexture,
      bumpScale: PAPER_BUMP_SCALE,
      metalness: 0,
      side: DoubleSide,
    });
    this.paperGeometry = createWarpedPaperGeometry(RESULT_PAPER_DEPTH);
    this.paper = new Mesh(this.paperGeometry, this.paperTopMaterial);
    this.paper.castShadow = true;
    this.paper.receiveShadow = true;
    this.paper.position.y = 0.004;
    this.paper.visible = false;
  }

  get object3d() {
    return this.paper;
  }

  render(yaku) {
    const width = PAPER_TEXTURE_VIEWPORT.width * PAPER_TEXTURE_SCALE;
    const height = PAPER_TEXTURE_VIEWPORT.height * PAPER_TEXTURE_SCALE;
    const canvas = this.paperTextureCanvas;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(PAPER_TEXTURE_SCALE, PAPER_TEXTURE_SCALE);
    const logicalHeight = height / PAPER_TEXTURE_SCALE;
    const logicalWidth = width / PAPER_TEXTURE_SCALE;

    paintPaperSurface(context, logicalWidth, logicalHeight);

    context.font = PAPER_TEXT_FONT;
    context.textBaseline = "middle";
    const columnWidth =
      (logicalWidth - PAPER_MARGIN_X * 2 - PAPER_COLUMN_GAP) / 2;
    yaku.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const left =
        PAPER_MARGIN_X + column * (columnWidth + PAPER_COLUMN_GAP);
      const baseline = PAPER_MARGIN_Y + row * PAPER_ROW_HEIGHT + 10;
      const value = item.han >= 13 ? "役满" : `${item.han ?? 0}番`;
      context.fillStyle = PAPER_TEXT_COLOR;
      context.textAlign = "left";
      context.fillText(item.name ?? "", left, baseline);
      context.fillStyle = PAPER_VALUE_COLOR;
      context.textAlign = "right";
      context.fillText(value, left + columnWidth, baseline);
    });
    this.paperTexture.needsUpdate = true;
    this.paper.visible = true;
  }

  hide() {
    this.paper.visible = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hide();
    this.paperGeometry?.dispose();
    this.paperTopMaterial?.dispose();
    this.paperTexture?.dispose();
    this.paperSurfaceTexture?.dispose();
  }
}

function createWarpedPaperGeometry(depth) {
  const geometry = new PlaneGeometry(RESULT_PAPER_WIDTH, depth, 32, 24);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const nx = Math.abs(x) / (RESULT_PAPER_WIDTH / 2);
    const ny = Math.abs(y) / (depth / 2);
    const xEdgeVariation = 0.68 + Math.sin(y * 0.81 + 0.7) * 0.22;
    const yEdgeVariation = 0.62 + Math.sin(x * 0.73 - 0.45) * 0.24;
    const edgeLift =
      Math.pow(nx, 10) * PAPER_EDGE_LIFT * xEdgeVariation
      + Math.pow(ny, 10) * PAPER_EDGE_LIFT * yEdgeVariation;
    const cornerLift =
      Math.pow(nx * ny, 5)
      * PAPER_CORNER_LIFT
      * (0.82 + Math.sin(x * 0.91 + y * 0.63) * 0.18);
    const surfaceWave =
      Math.sin(x * 1.7 + y * 0.45) * 0.00055
      + Math.sin(y * 2.1 - x * 0.28) * 0.00035;
    positions.setZ(index, Math.max(0, edgeLift + cornerLift + surfaceWave));
  }
  geometry.computeVertexNormals();
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function createPaperSurfaceTexture(maxAnisotropy) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(size, size);
  const random = seededRandom(0x4f6f2d1b);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const fibre =
        Math.sin(y * 0.52 + x * 0.037) * 3.2
        + Math.sin(y * 0.13 - x * 0.071) * 1.8;
      const value = Math.max(
        198,
        Math.min(246, Math.round(226 + fibre + (random() - 0.5) * 22)),
      );
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}

function paintPaperSurface(context, width, height) {
  const wash = context.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, "#e7e5df");
  wash.addColorStop(0.48, "#dfddd6");
  wash.addColorStop(1, "#d5d3cb");
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);

  const random = seededRandom(0x6b91a53d);
  for (let index = 0; index < 34; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = 35 + random() * 115;
    const stain = context.createRadialGradient(x, y, 0, x, y, radius);
    const warm = random() > 0.48;
    stain.addColorStop(
      0,
      warm ? "rgba(93, 80, 58, 0.045)" : "rgba(255, 255, 255, 0.13)",
    );
    stain.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = stain;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  context.lineCap = "round";
  for (let index = 0; index < 2100; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 3 + random() * 23;
    const angle = (random() - 0.5) * 0.34;
    const dark = random() > 0.63;
    context.strokeStyle = dark
      ? `rgba(91, 78, 57, ${0.032 + random() * 0.052})`
      : `rgba(255, 255, 255, ${0.045 + random() * 0.085})`;
    context.lineWidth = 0.34 + random() * 0.56;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }

  for (let index = 0; index < 360; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 18 + random() * 64;
    context.strokeStyle = `rgba(98, 84, 62, ${0.012 + random() * 0.022})`;
    context.lineWidth = 0.45 + random() * 0.35;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + (random() - 0.5) * 2.4);
    context.stroke();
  }

  for (let index = 0; index < 420; index += 1) {
    const shade = random() > 0.52 ? 255 : 111;
    context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.018 + random() * 0.025})`;
    const size = 0.35 + random() * 0.9;
    context.fillRect(random() * width, random() * height, size, size);
  }
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}
