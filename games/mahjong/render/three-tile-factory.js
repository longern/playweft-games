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
import { TILE_SIZE } from "./three-layout.js";

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
    faceAtlas.colorSpace = SRGBColorSpace;
    faceAtlas.anisotropy = 8;
    this.faceAtlas = faceAtlas;
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
      color: new Color("#e9e3cf"),
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.32,
      clearcoatRoughness: 0.36,
    });
    this.backMaterial = new MeshPhysicalMaterial({
      color: new Color("#1b63b7"),
      roughness: 0.32,
      metalness: 0,
      clearcoat: 0.52,
      clearcoatRoughness: 0.24,
    });
    this.faceMaterial = new MeshPhysicalMaterial({
      map: faceAtlas,
      transparent: true,
      alphaTest: 0.025,
      roughness: 0.52,
      metalness: 0,
      clearcoat: 0.18,
      clearcoatRoughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.faceGeometries = TILE_FACE_NAMES.map((_, index) => createFaceGeometry(index));
  }

  create({ type = 0, red = false, concealed = false, tileId = 0 } = {}) {
    const tile = new Group();
    tile.userData.tileId = Number(tileId) || 0;
    const shell = new Mesh(this.shellGeometry, this.shellMaterial);
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
    }
    return tile;
  }

  destroy() {
    this.shellGeometry.dispose();
    this.backGeometry.dispose();
    for (const geometry of this.faceGeometries) geometry.dispose();
    this.shellMaterial.dispose();
    this.backMaterial.dispose();
    this.faceMaterial.dispose();
    this.faceAtlas.dispose();
  }
}

function createFaceGeometry(index) {
  const geometry = new PlaneGeometry(TILE_SIZE.width * 0.89, TILE_SIZE.height * 0.91);
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
