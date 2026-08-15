import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const TABLE_GEOMETRY = Object.freeze({
  width: 28,
  depth: 25,
  centreZ: -1.5,
  railWidth: 0.78,
  railHeight: 0.5,
  baseHeight: 0.42,
});

export const DEFAULT_TABLE_THEME = Object.freeze({
  feltBase: "#06483f",
  feltDark: "#022d2a",
  feltLight: "#27786a",
  woodBase: "#35180f",
  woodDark: "#160a07",
  woodLight: "#6d3821",
  trim: "#9b7443",
});

export class ThreeMahjongTable {
  constructor({ anisotropy = 1, feltTexture, theme = DEFAULT_TABLE_THEME } = {}) {
    this.group = new Group();
    this.group.name = "mahjong-table";
    this.geometries = [];
    this.materials = [];
    this.textures = [];

    if (!feltTexture) throw new Error("A photographic felt texture is required");
    feltTexture.colorSpace = SRGBColorSpace;
    feltTexture.anisotropy = anisotropy;
    feltTexture.wrapS = RepeatWrapping;
    feltTexture.wrapT = RepeatWrapping;
    feltTexture.repeat.set(1, 1);
    this.textures.push(feltTexture);

    const woodTexture = createWoodTexture(theme);
    woodTexture.anisotropy = anisotropy;
    woodTexture.wrapS = RepeatWrapping;
    woodTexture.wrapT = RepeatWrapping;
    woodTexture.repeat.set(2.8, 1);
    this.textures.push(woodTexture);

    const feltMaterial = this.trackMaterial(new MeshPhysicalMaterial({
      color: new Color("#ccd4ce"),
      map: feltTexture,
      bumpMap: feltTexture,
      bumpScale: 0.012,
      roughness: 0.96,
      metalness: 0,
      clearcoat: 0.012,
      clearcoatRoughness: 0.94,
    }));
    const woodMaterial = this.trackMaterial(new MeshPhysicalMaterial({
      color: new Color("#ffffff"),
      map: woodTexture,
      roughness: 0.43,
      metalness: 0,
      clearcoat: 0.42,
      clearcoatRoughness: 0.36,
    }));
    const baseMaterial = this.trackMaterial(new MeshPhysicalMaterial({
      color: new Color(theme.woodDark),
      roughness: 0.58,
      clearcoat: 0.2,
      clearcoatRoughness: 0.52,
    }));
    const trimMaterial = this.trackMaterial(new MeshPhysicalMaterial({
      color: new Color(theme.trim),
      roughness: 0.34,
      metalness: 0.22,
      clearcoat: 0.38,
    }));

    this.addBase(baseMaterial);
    this.addFelt(feltMaterial);
    this.addRails(woodMaterial, trimMaterial);
  }

  addBase(material) {
    const { width, depth, centreZ, baseHeight } = TABLE_GEOMETRY;
    const geometry = this.trackGeometry(new RoundedBoxGeometry(
      width + 0.34,
      baseHeight,
      depth + 0.34,
      4,
      0.16,
    ));
    const base = new Mesh(geometry, material);
    base.name = "table-base";
    base.position.set(0, -baseHeight / 2 - 0.04, centreZ);
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);
  }

  addFelt(material) {
    const { width, depth, centreZ, railWidth } = TABLE_GEOMETRY;
    const geometry = this.trackGeometry(new PlaneGeometry(
      width - railWidth * 1.25,
      depth - railWidth * 1.25,
      1,
      1,
    ));
    const felt = new Mesh(geometry, material);
    felt.name = "table-felt";
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(0, 0.012, centreZ);
    felt.receiveShadow = true;
    this.group.add(felt);
  }

  addRails(woodMaterial, trimMaterial) {
    const { width, depth, centreZ, railWidth, railHeight } = TABLE_GEOMETRY;
    const longRailGeometry = this.trackGeometry(new RoundedBoxGeometry(
      width,
      railHeight,
      railWidth,
      4,
      0.14,
    ));
    const sideRailGeometry = this.trackGeometry(new RoundedBoxGeometry(
      railWidth,
      railHeight,
      depth - railWidth * 1.25,
      4,
      0.14,
    ));
    const railY = railHeight / 2 - 0.055;
    const farZ = centreZ - (depth - railWidth) / 2;
    const nearZ = centreZ + (depth - railWidth) / 2;
    const sideX = (width - railWidth) / 2;

    for (const [name, geometry, x, z] of [
      ["far", longRailGeometry, 0, farZ],
      ["near", longRailGeometry, 0, nearZ],
      ["left", sideRailGeometry, -sideX, centreZ],
      ["right", sideRailGeometry, sideX, centreZ],
    ]) {
      const rail = new Mesh(geometry, woodMaterial);
      rail.name = `table-rail-${name}`;
      rail.position.set(x, railY, z);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.group.add(rail);
    }

    const trimThickness = 0.055;
    const trimHeight = 0.045;
    const longTrimGeometry = this.trackGeometry(new BoxGeometry(
      width - railWidth * 1.8,
      trimHeight,
      trimThickness,
    ));
    const sideTrimGeometry = this.trackGeometry(new BoxGeometry(
      trimThickness,
      trimHeight,
      depth - railWidth * 1.8,
    ));
    const trimY = 0.075;
    const innerZ = (depth / 2) - railWidth * 1.03;
    const innerX = (width / 2) - railWidth * 1.03;
    for (const [geometry, x, z] of [
      [longTrimGeometry, 0, centreZ - innerZ],
      [longTrimGeometry, 0, centreZ + innerZ],
      [sideTrimGeometry, -innerX, centreZ],
      [sideTrimGeometry, innerX, centreZ],
    ]) {
      const trim = new Mesh(geometry, trimMaterial);
      trim.position.set(x, trimY, z);
      trim.receiveShadow = true;
      this.group.add(trim);
    }
  }

  trackGeometry(geometry) {
    this.geometries.push(geometry);
    return geometry;
  }

  trackMaterial(material) {
    this.materials.push(material);
    return material;
  }

  destroy() {
    this.group.remove(...this.group.children);
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
  }
}

function createWoodTexture(theme) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, theme.woodDark);
  gradient.addColorStop(0.42, theme.woodLight);
  gradient.addColorStop(0.72, theme.woodBase);
  gradient.addColorStop(1, theme.woodDark);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const random = seededRandom(0x574f4f44);
  for (let line = 0; line < 95; line += 1) {
    const baseY = random() * canvas.height;
    const amplitude = 0.8 + random() * 4.8;
    const frequency = 0.012 + random() * 0.022;
    context.strokeStyle = random() > 0.5
      ? `rgba(227, 159, 91, ${0.025 + random() * 0.08})`
      : `rgba(18, 4, 2, ${0.04 + random() * 0.12})`;
    context.lineWidth = 0.45 + random() * 1.15;
    context.beginPath();
    for (let x = 0; x <= canvas.width; x += 6) {
      const y = baseY + Math.sin(x * frequency + line) * amplitude;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
