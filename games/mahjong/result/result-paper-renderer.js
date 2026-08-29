import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { TILE_PHYSICAL_MM } from "../render/three-layout.js";
import { visibleScoreSheetRows } from "../rules/game-format.js";
import { traditionalYakuName } from "../rules/yaku-display.js";

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
const PAPER_SCORE_TOP = 444;
const PAPER_SCORE_HEIGHT = 58;
const PAPER_TEXTURE_SCALE = 2;
const PAPER_TEXT_SIZE = 50;
const PAPER_TEXT_COLOR = "#11100e";
const PAPER_VALUE_COLOR = "#173f61";
const PAPER_SELF_COLUMN_COLOR = "rgba(122, 178, 214, 0.24)";
const PAPER_GRID_COLOR = "rgba(78, 96, 102, 0.3)";
const PAPER_GRID_EDGE_COLOR = "rgba(78, 96, 102, 0.38)";
const SCORE_SHEET_TOP = 72;
const SCORE_SHEET_BOTTOM = 634;
const SCORE_SHEET_HEADER_HEIGHT = 54;
const SCORE_SHEET_ROW_COUNT = 8;
const INSTANT_PHOTO_SCALE = 0.675;
const INSTANT_PHOTO_WIDTH =
  (72 / TILE_PHYSICAL_MM.height) * INSTANT_PHOTO_SCALE;
const INSTANT_PHOTO_HEIGHT =
  (86 / TILE_PHYSICAL_MM.height) * INSTANT_PHOTO_SCALE;
const INSTANT_PHOTO_EDGE_OVERLAP = 0.7;
const INSTANT_PHOTO_THICKNESS = 0.022;
const INSTANT_PHOTO_PAPER_CLEARANCE = 0.024;
const INSTANT_PHOTO_TILT_RADIANS = Object.freeze([
  -0.021,
  0.014,
  -0.01,
  0.017,
]);
const INSTANT_PHOTO_POSITION_OFFSETS = Object.freeze([
  Object.freeze({ x: -0.028, z: 0.014 }),
  Object.freeze({ x: 0.018, z: -0.011 }),
  Object.freeze({ x: -0.013, z: 0.021 }),
  Object.freeze({ x: 0.024, z: 0.007 }),
]);
const INSTANT_PHOTO_TEXTURE_SIZE = Object.freeze({ width: 216, height: 258 });
const INSTANT_PHOTO_IMAGE_INSET = Object.freeze({
  left: 15,
  right: 15,
  top: 15,
});
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
    this.photoCards = new Group();
    this.photoCards.visible = false;
    this.object = new Group();
    this.object.add(this.paper, this.photoCards);
    this.createInstantPhotos();
  }

  get object3d() {
    return this.object;
  }

  createInstantPhotos() {
    this.photoBodyGeometry = new BoxGeometry(
      INSTANT_PHOTO_WIDTH,
      INSTANT_PHOTO_THICKNESS,
      INSTANT_PHOTO_HEIGHT,
    );
    this.photoBodyMaterial = new MeshStandardMaterial({
      color: "#f4f1e7",
      roughness: 0.92,
      metalness: 0,
    });

    for (let index = 0; index < 4; index += 1) {
      const card = new Group();
      const offset = INSTANT_PHOTO_POSITION_OFFSETS[index];
      card.position.set(
        scoreSheetPlayerCentre(index) + offset.x,
        INSTANT_PHOTO_PAPER_CLEARANCE,
        -RESULT_PAPER_DEPTH / 2 -
          INSTANT_PHOTO_HEIGHT / 2 +
          INSTANT_PHOTO_EDGE_OVERLAP +
          offset.z,
      );
      card.rotation.y = INSTANT_PHOTO_TILT_RADIANS[index];
      const photo = new Mesh(this.photoBodyGeometry, [
        this.photoBodyMaterial,
        this.photoBodyMaterial,
        this.photoBodyMaterial,
        this.photoBodyMaterial,
        this.photoBodyMaterial,
        this.photoBodyMaterial,
      ]);
      photo.position.y = INSTANT_PHOTO_THICKNESS / 2;
      photo.castShadow = true;
      photo.receiveShadow = true;
      card.add(photo);
      this.photoCards.add(card);
    }
  }

  instantPhotoWindowCorners(index) {
    const card = this.photoCards.children[index];
    if (!card) return [];
    const left =
      -INSTANT_PHOTO_WIDTH / 2 +
      (INSTANT_PHOTO_IMAGE_INSET.left / INSTANT_PHOTO_TEXTURE_SIZE.width) *
        INSTANT_PHOTO_WIDTH;
    const right =
      INSTANT_PHOTO_WIDTH / 2 -
      (INSTANT_PHOTO_IMAGE_INSET.right / INSTANT_PHOTO_TEXTURE_SIZE.width) *
        INSTANT_PHOTO_WIDTH;
    const top =
      -INSTANT_PHOTO_HEIGHT / 2 +
      (INSTANT_PHOTO_IMAGE_INSET.top / INSTANT_PHOTO_TEXTURE_SIZE.height) *
        INSTANT_PHOTO_HEIGHT;
    const bottom = top + right - left;
    const surfaceY = INSTANT_PHOTO_THICKNESS;
    return [
      card.localToWorld(new Vector3(left, surfaceY, top)),
      card.localToWorld(new Vector3(right, surfaceY, top)),
      card.localToWorld(new Vector3(right, surfaceY, bottom)),
      card.localToWorld(new Vector3(left, surfaceY, bottom)),
    ];
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
    drawYakuTable(context, yaku, logicalWidth, { winType });
    drawResultScore(context, logicalWidth, { fu, han, total, winType });
    this.paperTexture.needsUpdate = true;
    this.paper.visible = true;
    this.photoCards.visible = false;
  }

  renderScoreSheet({ playerNames = [], selfColumnIndex = -1, rows = [] } = {}) {
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
    drawScoreSheet(context, logicalWidth, {
      playerNames,
      selfColumnIndex,
      rows,
    });
    this.paperTexture.needsUpdate = true;
    this.paper.visible = true;
    this.photoCards.visible = true;
  }

  hide() {
    this.paper.visible = false;
    this.photoCards.visible = false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hide();
    this.paperGeometry?.dispose();
    this.paperTopMaterial?.dispose();
    this.paperTexture?.dispose();
    this.paperSurfaceTexture?.dispose();
    this.photoBodyGeometry?.dispose();
    this.photoBodyMaterial?.dispose();
  }
}

function scoreSheetPlayerCentre(index) {
  const tableWidth = PAPER_TEXTURE_VIEWPORT.width - PAPER_MARGIN_X * 2;
  const scoreWidth = (tableWidth - 96 - 74) / 4;
  const logicalX = PAPER_MARGIN_X + 96 + 74 + scoreWidth * (index + 0.5);
  return (logicalX / PAPER_TEXTURE_VIEWPORT.width - 0.5) * RESULT_PAPER_WIDTH;
}

function drawResultScore(context, width, { fu, han, total, winType }) {
  const nagashi = winType === "nagashi";
  const fields = [
    {
      value: nagashi ? "" : fu,
      unit: nagashi ? "" : "符",
      lineWidth: 104,
      numberSize: 36,
    },
    {
      value: nagashi ? "" : han,
      unit: nagashi ? "" : "番",
      lineWidth: 104,
      numberSize: 36,
    },
    { value: total, unit: "点", lineWidth: 204, numberSize: 64 },
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

    context.fillStyle = PAPER_VALUE_COLOR;
    context.textAlign = "center";
    context.font = paperNumberFont(field.numberSize);
    context.fillText(
      String(field.value ?? 0),
      left + field.lineWidth / 2,
      lineY - 6,
    );

    context.textAlign = "left";
    context.fillStyle = PAPER_TEXT_COLOR;
    context.font = paperFont(unitSize);
    context.fillText(field.unit, lineRight + 10, lineY - 7);
    left = lineRight + unitWidth + 10 + (index < fields.length - 1 ? gap : 0);
  });
  context.textBaseline = "middle";
}

function drawScoreSheet(context, width, { playerNames, selfColumnIndex, rows }) {
  const left = PAPER_MARGIN_X;
  const tableWidth = width - PAPER_MARGIN_X * 2;
  const tableHeight = SCORE_SHEET_BOTTOM - SCORE_SHEET_TOP;
  const roundWidth = 96;
  const honbaWidth = 74;
  const scoreWidth = (tableWidth - roundWidth - honbaWidth) / 4;
  const rowHeight =
    (tableHeight - SCORE_SHEET_HEADER_HEIGHT) / SCORE_SHEET_ROW_COUNT;
  const headers = [
    { label: "局", width: roundWidth },
    { label: "本场", width: honbaWidth },
    ...Array.from({ length: 4 }, (_, index) => ({
      label: String(playerNames[index] ?? `玩家${index + 1}`),
      width: scoreWidth,
    })),
  ];

  const selfColumn = Number.isInteger(selfColumnIndex)
    ? selfColumnIndex
    : -1;
  if (selfColumn >= 0 && selfColumn < 4) {
    const selfColumnLeft = left + roundWidth + honbaWidth + scoreWidth * selfColumn;
    context.fillStyle = PAPER_SELF_COLUMN_COLOR;
    context.fillRect(
      selfColumnLeft,
      SCORE_SHEET_TOP,
      scoreWidth,
      tableHeight,
    );
  }

  context.lineCap = "butt";
  context.strokeStyle = PAPER_GRID_EDGE_COLOR;
  context.lineWidth = 1.25;
  context.strokeRect(left, SCORE_SHEET_TOP, tableWidth, tableHeight);
  context.strokeStyle = PAPER_GRID_COLOR;
  context.lineWidth = 0.9;
  context.beginPath();
  const headerBottom = SCORE_SHEET_TOP + SCORE_SHEET_HEADER_HEIGHT;
  context.moveTo(left, headerBottom);
  context.lineTo(left + tableWidth, headerBottom);
  for (let row = 1; row < SCORE_SHEET_ROW_COUNT; row += 1) {
    const y = headerBottom + row * rowHeight;
    context.moveTo(left, y);
    context.lineTo(left + tableWidth, y);
  }
  let cursor = left;
  for (let column = 0; column < headers.length - 1; column += 1) {
    cursor += headers[column].width;
    context.moveTo(cursor, SCORE_SHEET_TOP);
    context.lineTo(cursor, SCORE_SHEET_BOTTOM);
  }
  context.stroke();

  cursor = left;
  context.fillStyle = PAPER_TEXT_COLOR;
  context.textAlign = "center";
  headers.forEach((header) => {
    context.font = fittedPaperFont(
      context,
      header.label,
      header.width - 22,
      24,
      16,
    );
    context.fillText(
      header.label,
      cursor + header.width / 2,
      SCORE_SHEET_TOP + SCORE_SHEET_HEADER_HEIGHT / 2,
    );
    cursor += header.width;
  });

  const visibleRows = visibleScoreSheetRows(rows, SCORE_SHEET_ROW_COUNT);
  visibleRows.forEach((row, rowIndex) => {
    const isLatestRow = rowIndex === visibleRows.length - 1;
    const inkColor = isLatestRow ? PAPER_TEXT_COLOR : "#4a5051";
    const valueColor = isLatestRow ? PAPER_VALUE_COLOR : "#4a6c7c";
    const y = headerBottom + rowHeight * (rowIndex + 0.5);
    cursor = left;
    context.fillStyle = inkColor;
    context.textAlign = "center";
    const round = String(row.round ?? "");
    const wind = round.slice(0, 1);
    const hand = round.slice(1);
    const windFont = scoreSheetWindFont(32);
    const handFont = scoreSheetNumberFont(36);
    context.font = windFont;
    const windWidth = context.measureText(wind).width;
    context.font = handFont;
    const handWidth = context.measureText(hand).width;
    const roundLeft = cursor + (roundWidth - windWidth - handWidth) / 2;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.font = windFont;
    context.fillText(
      wind,
      roundLeft,
      scoreSheetWindBaseline(context, y, windFont),
    );
    context.font = handFont;
    context.fillText(
      hand,
      roundLeft + windWidth,
      scoreSheetInkBaseline(context, hand, y),
    );
    context.textBaseline = "middle";
    cursor += roundWidth;
    context.font = scoreSheetNumberFont(36);
    const honba = String(row.honba ?? 0);
    context.textBaseline = "alphabetic";
    context.fillText(
      honba,
      cursor + honbaWidth / 2,
      scoreSheetInkBaseline(context, honba, y),
    );
    context.textBaseline = "middle";
    cursor += honbaWidth;
    for (let seat = 0; seat < 4; seat += 1) {
      const score = Number(row.scores?.[seat]) || 0;
      const scoreText = String(score);
      const delta = Number(row.deltas?.[seat]) || 0;
      context.fillStyle = inkColor;
      context.font = scoreSheetNumberFont(36);
      context.textAlign = "center";
      context.textBaseline = "alphabetic";
      context.fillText(
        scoreText,
        cursor + scoreWidth / 2,
        scoreSheetInkBaseline(context, scoreText, y),
      );
      context.textBaseline = "middle";
      if (delta) {
        context.fillStyle = valueColor;
        context.font = scoreSheetNumberFont(16, 600);
        context.textAlign = "left";
        context.fillText(
          `${delta > 0 ? "+" : ""}${delta}`,
          cursor + 10,
          y - rowHeight / 2 + 13,
        );
      }
      cursor += scoreWidth;
    }
  });
}

function drawResultHeading(context, width, winnerName, winType) {
  context.fillStyle = "rgba(42, 41, 36, 0.66)";
  context.textAlign = "left";
  context.font = paperFont(20);
  context.fillText("和了人", PAPER_MARGIN_X, PAPER_HEADING_Y);

  context.fillStyle = PAPER_TEXT_COLOR;
  context.font = fittedPaperFont(context, String(winnerName), 380, 34, 20);
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
  context.fillStyle = selected
    ? "rgba(43, 104, 116, 0.1)"
    : "rgba(75, 82, 79, 0.06)";
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

function drawYakuTable(context, yaku, width, { winType = "" } = {}) {
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

  const preferredNameSize = groupCount === 2 ? 40 : 32;
  const preferredValueSize = groupCount === 2 ? 29 : 23;
  const preferredNumberSize = groupCount === 2 ? 33 : 26;
  const numberBaselineOffset = groupCount === 2 ? 4 : 3;
  entries.forEach((item, index) => {
    const column = index % groupCount;
    const row = Math.floor(index / groupCount);
    const left = PAPER_MARGIN_X + column * groupWidth;
    const baseline = PAPER_TABLE_TOP + row * rowHeight + rowHeight / 2;
    const nameInset = groupCount === 2 ? 18 : 13;
    const valueInset = groupCount === 2 ? 18 : 12;

    const name = traditionalYakuName(item.name);
    context.fillStyle = PAPER_TEXT_COLOR;
    context.textAlign = "right";
    context.font = fittedYakuFont(
      context,
      name,
      nameWidth - nameInset * 2,
      preferredNameSize,
      groupCount === 2 ? 27 : 23,
    );
    context.fillText(name, left + nameWidth - nameInset, baseline);

    context.textAlign = "right";
    const valueRight = left + groupWidth - valueInset;
    if (winType === "nagashi") {
      context.fillStyle = PAPER_VALUE_COLOR;
      context.font = paperFont(preferredValueSize);
      context.fillText("滿貫", valueRight, baseline);
      return;
    }
    if (item.han >= 13) {
      context.fillStyle = PAPER_VALUE_COLOR;
      context.font = paperFont(preferredValueSize);
      context.fillText("役满", valueRight, baseline);
      return;
    }

    context.fillStyle = PAPER_TEXT_COLOR;
    context.font = paperFont(preferredValueSize);
    const unit = "番";
    const unitWidth = context.measureText(unit).width;
    const spaceWidth = context.measureText(" ").width + 4;
    context.fillText(unit, valueRight, baseline);
    context.fillStyle = PAPER_VALUE_COLOR;
    context.font = paperNumberFont(preferredNumberSize);
    context.fillText(
      String(item.han ?? 0),
      valueRight - unitWidth - spaceWidth,
      baseline + numberBaselineOffset,
    );
  });
}

function paperFont(size) {
  return (
    `700 ${size}px system-ui, -apple-system, BlinkMacSystemFont, ` +
    '"Segoe UI", "Microsoft YaHei", sans-serif'
  );
}

function yakuFont(size) {
  return (
    `700 ${size}px "Mahjong Brush", ` + '"FZKai-Z03", STKaiti, KaiTi, serif'
  );
}

function paperNumberFont(size) {
  return scoreSheetNumberFont(size);
}

function scoreSheetNumberFont(size, weight = 400) {
  return `${weight} ${size}px "Kalam Score", cursive`;
}

function scoreSheetWindFont(size) {
  return `400 ${size}px "Mahjong Brush", "FZKai-Z03", STKaiti, KaiTi, serif`;
}

function scoreSheetWindBaseline(context, centreY, font) {
  context.font = font;
  const winds = ["東", "南", "西", "北"];
  const centreOffset =
    winds.reduce((sum, wind) => {
      const metrics = context.measureText(wind);
      return (
        sum +
        (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2
      );
    }, 0) / winds.length;
  return centreY - centreOffset;
}

function scoreSheetInkBaseline(context, text, centreY) {
  const metrics = context.measureText(text);
  const centreOffset =
    (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
  return centreY - centreOffset;
}

function fittedPaperFont(context, text, maxWidth, preferredSize, minimumSize) {
  for (let size = preferredSize; size > minimumSize; size -= 1) {
    const font = paperFont(size);
    context.font = font;
    if (context.measureText(text).width <= maxWidth) return font;
  }
  return paperFont(minimumSize);
}

function fittedYakuFont(context, text, maxWidth, preferredSize, minimumSize) {
  for (let size = preferredSize; size > minimumSize; size -= 1) {
    const font = yakuFont(size);
    context.font = font;
    if (context.measureText(text).width <= maxWidth) return font;
  }
  return yakuFont(minimumSize);
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
      Math.pow(nx, 10) * PAPER_EDGE_LIFT * xEdgeVariation +
      Math.pow(ny, 10) * PAPER_EDGE_LIFT * yEdgeVariation;
    const cornerLift =
      Math.pow(nx * ny, 5) *
      PAPER_CORNER_LIFT *
      (0.82 + Math.sin(x * 0.91 + y * 0.63) * 0.18);
    const surfaceWave =
      Math.sin(x * 1.7 + y * 0.45) * 0.00055 +
      Math.sin(y * 2.1 - x * 0.28) * 0.00035;
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
        Math.sin(y * 0.52 + x * 0.037) * 3.2 +
        Math.sin(y * 0.13 - x * 0.071) * 1.8;
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
