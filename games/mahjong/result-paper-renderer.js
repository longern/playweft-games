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
const PAPER_HEADING_Y = 76;
const PAPER_TABLE_TOP = 120;
const PAPER_TABLE_BOTTOM = 396;
const PAPER_SCORE_TOP = 416;
const PAPER_SCORE_HEIGHT = 58;
const PAPER_TEXTURE_SCALE = 2;
const PAPER_TEXT_SIZE = 32;
const PAPER_TEXT_COLOR = "#1d1c18";
const PAPER_VALUE_COLOR = "#173f61";
const PAPER_GRID_COLOR = "rgba(78, 96, 102, 0.3)";
const PAPER_GRID_EDGE_COLOR = "rgba(78, 96, 102, 0.38)";
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

  render({
    yaku = [],
    winnerName = "",
    winType = "",
    fu = 0,
    han = 0,
    total = 0,
  } = {}) {
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

    context.textBaseline = "middle";
    drawResultHeading(context, logicalWidth, winnerName, winType);
    drawYakuTable(context, yaku, logicalWidth);
    drawResultScore(context, logicalWidth, { fu, han, total });
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

function drawResultScore(context, width, { fu, han, total }) {
  const fields = [
    { value: fu, unit: "符", lineWidth: 104, numberSize: 30 },
    { value: han, unit: "番", lineWidth: 104, numberSize: 30 },
    { value: total, unit: "点", lineWidth: 176, numberSize: 46 },
  ];
  const unitSize = 22;
  const gap = 34;
  context.font = paperFont(unitSize);
  const unitWidth = context.measureText("点").width;
  const groupWidth = fields.reduce(
    (sum, field) => sum + field.lineWidth + unitWidth + 10,
    gap * (fields.length - 1),
  );
  let left = (width - groupWidth) / 2;
  const lineY = PAPER_SCORE_TOP + PAPER_SCORE_HEIGHT - 10;

  context.textBaseline = "alphabetic";
  fields.forEach((field, index) => {
    const lineRight = left + field.lineWidth;
    context.strokeStyle = "rgba(29, 28, 24, 0.72)";
    context.lineWidth = 1.15;
    context.beginPath();
    context.moveTo(left, lineY);
    context.lineTo(lineRight, lineY);
    context.stroke();

    context.fillStyle = PAPER_TEXT_COLOR;
    context.textAlign = "center";
    context.font = paperNumberFont(field.numberSize);
    context.fillText(String(field.value ?? 0), left + field.lineWidth / 2, lineY - 6);

    context.textAlign = "left";
    context.font = paperFont(unitSize);
    context.fillText(field.unit, lineRight + 10, lineY - 7);
    left = lineRight + unitWidth + 10 + (index < fields.length - 1 ? gap : 0);
  });
  context.textBaseline = "middle";
}

function drawResultHeading(context, width, winnerName, winType) {
  context.fillStyle = "rgba(42, 41, 36, 0.66)";
  context.textAlign = "left";
  context.font = paperFont(20);
  context.fillText("和了人", PAPER_MARGIN_X, PAPER_HEADING_Y);

  context.fillStyle = PAPER_TEXT_COLOR;
  context.font = fittedPaperFont(
    context,
    String(winnerName),
    380,
    34,
    20,
  );
  context.fillText(String(winnerName), PAPER_MARGIN_X + 102, PAPER_HEADING_Y);

  const checkboxes = [
    { label: "自摸", selected: winType === "tsumo" },
    { label: "荣和", selected: winType === "ron" },
  ];
  const checkboxWidth = 116;
  const start = width - PAPER_MARGIN_X - checkboxWidth * checkboxes.length;
  checkboxes.forEach((checkbox, index) => {
    drawResultCheckbox(
      context,
      start + checkboxWidth * index,
      PAPER_HEADING_Y,
      checkbox,
    );
  });
}

function drawResultCheckbox(context, x, y, { label, selected }) {
  const size = 22;
  const boxY = y - size / 2;
  context.fillStyle = selected ? "rgba(43, 104, 116, 0.1)" : "rgba(75, 82, 79, 0.06)";
  context.fillRect(x, boxY, size, size);
  context.strokeStyle = selected ? PAPER_TEXT_COLOR : "rgba(75, 82, 79, 0.32)";
  context.lineWidth = 1.35;
  context.strokeRect(x + 0.7, boxY + 0.7, size - 1.4, size - 1.4);
  if (selected) {
    context.strokeStyle = PAPER_VALUE_COLOR;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x + 4.7, y);
    context.lineTo(x + 9.1, y + 4.7);
    context.lineTo(x + 17.5, y - 5.2);
    context.stroke();
  }
  context.fillStyle = selected ? PAPER_TEXT_COLOR : "rgba(42, 41, 36, 0.42)";
  context.textAlign = "left";
  context.font = paperFont(20);
  context.fillText(label, x + size + 10, y);
}

function drawYakuTable(context, yaku, width) {
  const entries = yaku;
  const groupCount = entries.length >= 11 ? 3 : 2;
  const rowCount = Math.max(5, Math.ceil(entries.length / groupCount));
  const tableWidth = width - PAPER_MARGIN_X * 2;
  const tableHeight = PAPER_TABLE_BOTTOM - PAPER_TABLE_TOP;
  const groupWidth = tableWidth / groupCount;
  const rowHeight = tableHeight / rowCount;
  const nameWidth = groupWidth * (groupCount === 2 ? 0.7 : 0.66);

  context.lineCap = "butt";
  context.strokeStyle = PAPER_GRID_EDGE_COLOR;
  context.lineWidth = 1.25;
  context.strokeRect(PAPER_MARGIN_X, PAPER_TABLE_TOP, tableWidth, tableHeight);

  context.strokeStyle = PAPER_GRID_COLOR;
  context.lineWidth = 0.9;
  context.beginPath();
  for (let row = 1; row < rowCount; row += 1) {
    const y = PAPER_TABLE_TOP + row * rowHeight;
    context.moveTo(PAPER_MARGIN_X, y);
    context.lineTo(PAPER_MARGIN_X + tableWidth, y);
  }
  for (let column = 1; column < groupCount; column += 1) {
    const x = PAPER_MARGIN_X + column * groupWidth;
    context.moveTo(x, PAPER_TABLE_TOP);
    context.lineTo(x, PAPER_TABLE_TOP + tableHeight);
  }
  for (let column = 0; column < groupCount; column += 1) {
    const x = PAPER_MARGIN_X + column * groupWidth + nameWidth;
    context.moveTo(x, PAPER_TABLE_TOP);
    context.lineTo(x, PAPER_TABLE_TOP + tableHeight);
  }
  context.stroke();

  const preferredNameSize = groupCount === 2 ? PAPER_TEXT_SIZE : 25;
  const preferredValueSize = groupCount === 2 ? 29 : 23;
  entries.forEach((item, index) => {
    const column = index % groupCount;
    const row = Math.floor(index / groupCount);
    const left = PAPER_MARGIN_X + column * groupWidth;
    const baseline = PAPER_TABLE_TOP + row * rowHeight + rowHeight / 2;
    const value = item.han >= 13 ? "役满" : `${item.han ?? 0}番`;
    const nameInset = groupCount === 2 ? 18 : 13;
    const valueInset = groupCount === 2 ? 18 : 12;

    context.fillStyle = PAPER_TEXT_COLOR;
    context.textAlign = "right";
    context.font = fittedPaperFont(
      context,
      String(item.name ?? ""),
      nameWidth - nameInset * 2,
      preferredNameSize,
      17,
    );
    context.fillText(String(item.name ?? ""), left + nameWidth - nameInset, baseline);

    context.fillStyle = PAPER_VALUE_COLOR;
    context.textAlign = "right";
    context.font = paperFont(preferredValueSize);
    context.fillText(value, left + groupWidth - valueInset, baseline);
  });
}

function paperFont(size) {
  return `700 ${size}px system-ui, -apple-system, BlinkMacSystemFont, `
    + '"Segoe UI", "Microsoft YaHei", sans-serif';
}

function paperNumberFont(size) {
  return `700 ${size}px "Bradley Hand", "Segoe Print", "Chalkboard SE", cursive`;
}

function fittedPaperFont(context, text, maxWidth, preferredSize, minimumSize) {
  for (let size = preferredSize; size > minimumSize; size -= 1) {
    const font = paperFont(size);
    context.font = font;
    if (context.measureText(text).width <= maxWidth) return font;
  }
  return paperFont(minimumSize);
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
