import {
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TILE_FACE_NAMES, tileFaceFrameIndex } from "./tile-texture-map.js";
import {
  doraBreathIntensity,
  DORA_BREATH_DURATION_MS,
  ThreeTileFeedback,
} from "./three-tile-feedback.js";
import { TILE_SIZE } from "./three-layout.js";

export { doraBreathIntensity, DORA_BREATH_DURATION_MS };

const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 5;
export const BACK_LAYER_DEPTH_RATIO = 0.36;
export const TILE_EDGE_SEGMENTS = 7;
// About 2 mm on a 28 mm parlor tile: clearly rounded at game-camera distance
// while retaining the broad, flat face of a real riichi tile.
export const TILE_EDGE_RADIUS = 2 / 28;
export const TILE_BACK_EDGE_RADIUS = 1.6 / 28;

export class ThreeTileFactory {
  constructor(faceAtlas) {
    this.faceAtlas = null;
    this.shellGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width,
      TILE_SIZE.height,
      TILE_SIZE.depth,
      TILE_EDGE_SEGMENTS,
      TILE_EDGE_RADIUS,
    );
    this.backLayerDepth = TILE_SIZE.depth * BACK_LAYER_DEPTH_RATIO;
    this.backGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width + 0.006,
      TILE_SIZE.height + 0.006,
      this.backLayerDepth,
      TILE_EDGE_SEGMENTS,
      TILE_BACK_EDGE_RADIUS,
    );
    this.shellMaterial = new MeshPhysicalMaterial({
      color: new Color("#e9e9e6"),
      roughness: 0.62,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.58,
      toneMapped: false,
    });
    this.doraShellMaterial = this.shellMaterial.clone();
    this.doraShellPeakColor = new Color("#e6d69c");
    this.doraShellBaseColor = this.shellMaterial.color
      .clone()
      .lerp(this.doraShellPeakColor, 0.7);
    this.doraShellMaterial.color.copy(this.doraShellBaseColor);
    this.backMaterial = new MeshPhysicalMaterial({
      color: new Color("#1b569c"),
      roughness: 0.4,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.32,
    });
    this.defaultBackColor = this.backMaterial.color.clone();
    this.customBackTexture = null;
    this.faceMaterial = new MeshPhysicalMaterial({
      map: null,
      transparent: true,
      alphaTest: 0.025,
      color: new Color("#e7e7e4"),
      roughness: 0.68,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.feedbackGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width + 0.006,
      TILE_SIZE.height + 0.006,
      // Its front surface clears the printed face plane while depth testing
      // still respects other tiles.
      TILE_SIZE.depth + 0.024,
      TILE_EDGE_SEGMENTS,
      TILE_EDGE_RADIUS + 0.002,
    );
    this.feedback = new ThreeTileFeedback(this.feedbackGeometry);
    this.faceGeometries = TILE_FACE_NAMES.map((_, index) =>
      createFaceGeometry(index),
    );
    this.doraTileCount = 0;
    this.setFaceAtlas(faceAtlas);
  }

  setFaceAtlas(faceAtlas) {
    if (this.faceAtlas && this.faceAtlas !== faceAtlas) {
      this.faceAtlas.dispose();
    }
    this.faceAtlas = faceAtlas ?? null;
    if (this.faceAtlas) {
      this.faceAtlas.colorSpace = SRGBColorSpace;
      this.faceAtlas.anisotropy = 8;
    }
    this.faceMaterial.map = this.faceAtlas;
    this.faceMaterial.needsUpdate = true;
  }

  create({
    type = 0,
    red = false,
    concealed = false,
    tileId = 0,
    highlight = "",
    dora = false,
    dimmed = false,
    tsumogiri = false,
  } = {}) {
    const tile = new Group();
    tile.userData.tileId = Number(tileId) || 0;
    tile.userData.type = Number(type) || 0;
    const visibleDora = !concealed && Boolean(type) && dora;
    const shell = new Mesh(
      this.shellGeometry,
      visibleDora ? this.doraShellMaterial : this.shellMaterial,
    );
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.userData.tileRoot = tile;
    tile.add(shell);

    const back = new Mesh(this.backGeometry, this.backMaterial);
    back.position.z = -TILE_SIZE.depth / 2 + this.backLayerDepth / 2 - 0.003;
    back.rotation.y = Math.PI;
    back.castShadow = true;
    back.userData.tileRoot = tile;
    tile.add(back);

    if (!concealed && type) {
      const frame = tileFaceFrameIndex(type, red);
      const face = new Mesh(this.faceGeometries[frame], this.faceMaterial);
      face.position.z = TILE_SIZE.depth / 2 + 0.008;
      face.userData.tileRoot = tile;
      tile.add(face);
      if (visibleDora) this.trackDoraTile();
      this.feedback.attach(tile, {
        match: highlight === "match",
        tsumogiri,
        // Dora keeps its persistent shell colour, while the disabled wash still
        // applies so unavailable dora tiles are visually de-emphasized too.
        disabled: dimmed,
      });
    }
    return tile;
  }

  setMatchHighlight(tile, visible) {
    this.feedback.setMatch(tile, visible);
  }

  beginFrame() {
    this.doraTileCount = 0;
  }

  hasDoraTiles() {
    return this.doraTileCount > 0;
  }

  trackDoraTile() {
    this.doraTileCount += 1;
  }

  setDoraGlowIntensity(intensity) {
    const value = Math.max(0, Math.min(1, Number(intensity) || 0));
    this.doraShellMaterial.color
      .copy(this.doraShellBaseColor)
      .lerp(this.doraShellPeakColor, value);
  }

  setBackTexture(texture) {
    if (this.customBackTexture && this.customBackTexture !== texture) {
      this.customBackTexture.dispose();
    }
    this.customBackTexture = texture ?? null;
    if (texture) {
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 8;
      this.backMaterial.map = texture;
      this.backMaterial.color.set("#ffffff");
    } else {
      this.backMaterial.map = null;
      this.backMaterial.color.copy(this.defaultBackColor);
    }
    this.backMaterial.needsUpdate = true;
  }

  destroy() {
    this.shellGeometry.dispose();
    this.backGeometry.dispose();
    this.feedbackGeometry.dispose();
    for (const geometry of this.faceGeometries) geometry.dispose();
    this.shellMaterial.dispose();
    this.doraShellMaterial.dispose();
    this.backMaterial.dispose();
    this.faceMaterial.dispose();
    this.feedback.destroy();
    this.faceAtlas?.dispose();
    this.customBackTexture?.dispose();
  }
}

function createFaceGeometry(index) {
  const geometry = new PlaneGeometry(
    TILE_SIZE.width * 0.89,
    TILE_SIZE.height * 0.91,
  );
  const column = index % ATLAS_COLUMNS;
  const row = Math.floor(index / ATLAS_COLUMNS);
  const u0 = column / ATLAS_COLUMNS;
  const u1 = (column + 1) / ATLAS_COLUMNS;
  const v0 = 1 - (row + 1) / ATLAS_ROWS;
  const v1 = 1 - row / ATLAS_ROWS;
  const uv = geometry.attributes.uv;
  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    uv.setXY(
      vertex,
      u0 + uv.getX(vertex) * (u1 - u0),
      v0 + uv.getY(vertex) * (v1 - v0),
    );
  }
  return geometry;
}
