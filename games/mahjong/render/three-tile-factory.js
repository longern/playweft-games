import {
  AdditiveBlending,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  UnsignedByteType,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TILE_FACE_NAMES, tileFaceFrameIndex } from "./tile-texture-map.js";
import { TILE_SIZE } from "./three-layout.js";

const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 5;
const DORA_HALO_RENDER_ORDER = 0;
const DORA_LIGHTBOX_RENDER_ORDER = 1;
const DORA_EMISSION_RENDER_ORDER = 2;
const MATCH_HIGHLIGHT_RENDER_ORDER = 5;
const TSUMOGIRI_WASH_RENDER_ORDER = 6;
const DISABLED_WASH_RENDER_ORDER = 10;
export const DORA_BREATH_DURATION_MS = 2800;
const DORA_BREATH_MIN_INTENSITY = 0.5;
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
    });
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
    this.matchHighlightGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width + 0.006,
      TILE_SIZE.height + 0.006,
      // Its front surface must sit beyond the printed face plane (+0.008),
      // otherwise that opaque plane depth-tests the blue selection wash away.
      TILE_SIZE.depth + 0.024,
      TILE_EDGE_SEGMENTS,
      TILE_EDGE_RADIUS + 0.002,
    );
    this.matchHighlightMaterial = new MeshBasicMaterial({
      // Android Chrome's visible tap feedback reads as a short translucent
      // blue overlay. Applying it to the complete tile body keeps this
      // recognition cue physical, matching the tsumogiri wash instead of
      // outlining only the face.
      color: new Color("#4285f4"),
      transparent: true,
      opacity: 0.24,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.doraLightboxGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width + 0.01,
      TILE_SIZE.height + 0.01,
      TILE_SIZE.depth + 0.01,
      TILE_EDGE_SEGMENTS,
      TILE_EDGE_RADIUS + 0.004,
    );
    this.doraLightboxMaterial = createDoraLightboxMaterial();
    this.doraEmissionGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width + 0.014,
      TILE_SIZE.height + 0.014,
      TILE_SIZE.depth + 0.014,
      TILE_EDGE_SEGMENTS,
      TILE_EDGE_RADIUS + 0.006,
    );
    this.doraEmissionMaterial = createDoraEmissionMaterial();
    this.doraHaloGeometry = new PlaneGeometry(
      TILE_SIZE.width * 1.38,
      TILE_SIZE.height * 1.34,
    );
    this.doraHaloTexture = createDoraHaloTexture();
    this.doraHaloMaterial = new MeshBasicMaterial({
      map: this.doraHaloTexture,
      color: new Color("#ffe16a"),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.disabledWashMaterial = new MeshBasicMaterial({
      color: new Color("#050807"),
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      toneMapped: false,
    });
    this.tsumogiriWashMaterial = new MeshBasicMaterial({
      color: new Color("#343a37"),
      transparent: true,
      opacity: 0.16,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.disabledGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width + 0.024,
      TILE_SIZE.height + 0.024,
      TILE_SIZE.depth + 0.024,
      TILE_EDGE_SEGMENTS,
      TILE_EDGE_RADIUS + 0.006,
    );
    this.tsumogiriWashGeometry = new RoundedBoxGeometry(
      TILE_SIZE.width + 0.006,
      TILE_SIZE.height + 0.006,
      // Match the selection wash: this front surface must clear the printed
      // face plane, otherwise only the tile sides receive the tsumogiri tint.
      TILE_SIZE.depth + 0.024,
      TILE_EDGE_SEGMENTS,
      TILE_EDGE_RADIUS + 0.002,
    );
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
      const glow = new Mesh(
        this.matchHighlightGeometry,
        this.matchHighlightMaterial,
      );
      glow.visible = highlight === "match";
      glow.renderOrder = MATCH_HIGHLIGHT_RENDER_ORDER;
      glow.userData.tileRoot = tile;
      tile.userData.matchHighlight = glow;
      tile.add(glow);
      const frame = tileFaceFrameIndex(type, red);
      const face = new Mesh(this.faceGeometries[frame], this.faceMaterial);
      face.position.z = TILE_SIZE.depth / 2 + 0.008;
      face.userData.tileRoot = tile;
      tile.add(face);
      if (dora) {
        this.trackDoraTile();
        const halo = new Mesh(this.doraHaloGeometry, this.doraHaloMaterial);
        // This sits behind the tile's front surface, so the opaque porcelain
        // hides its centre. Only the soft falloff beyond the silhouette is
        // visible: a gold aura, never a graphic outline.
        halo.position.z = TILE_SIZE.depth / 2 - 0.004;
        halo.renderOrder = DORA_HALO_RENDER_ORDER;
        halo.userData.tileRoot = tile;
        tile.add(halo);
        const lightbox = new Mesh(
          this.doraLightboxGeometry,
          this.doraLightboxMaterial,
        );
        // A second, slightly larger tile shell turns every porcelain surface
        // into the gold diffuser: face, sides, and rounded edges. The shader
        // cuts away the rear-facing surface so the blue tile back stays blue.
        // The printed face remains above this shell in its ordinary colours.
        lightbox.renderOrder = DORA_LIGHTBOX_RENDER_ORDER;
        lightbox.userData.tileRoot = tile;
        tile.add(lightbox);
        const emission = new Mesh(
          this.doraEmissionGeometry,
          this.doraEmissionMaterial,
        );
        // This shell uses the same front-and-side shape as the colour layer,
        // so it lifts their luminance together instead of making the face look
        // detached from the white tile edge. The rear face is still discarded.
        emission.renderOrder = DORA_EMISSION_RENDER_ORDER;
        emission.userData.tileRoot = tile;
        tile.add(emission);
      }
      if (dimmed) {
        const wash = new Mesh(this.disabledGeometry, this.disabledWashMaterial);
        // Transparent objects are otherwise sorted by their object origins. The
        // face plane sits in front of this rounded box's origin, so it can be
        // painted after the wash even though the box surface is physically
        // closer to the camera. Force the full-tile wash to be composited last.
        wash.renderOrder = DISABLED_WASH_RENDER_ORDER;
        wash.userData.tileRoot = tile;
        tile.add(wash);
      }
    }
    if (tsumogiri) {
      const wash = new Mesh(
        this.tsumogiriWashGeometry,
        this.tsumogiriWashMaterial,
      );
      // This thin rounded shell tints the complete physical tile—face, body,
      // edges, and back—rather than behaving like a dora face sticker. It
      // still depth-tests against every other tile, while not writing depth so
      // another translucent treatment can retain its natural occlusion.
      wash.renderOrder = TSUMOGIRI_WASH_RENDER_ORDER;
      wash.userData.tileRoot = tile;
      tile.add(wash);
    }
    return tile;
  }

  setMatchHighlight(tile, visible) {
    if (tile?.userData?.matchHighlight) {
      tile.userData.matchHighlight.visible = visible === true;
    }
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
    this.doraLightboxMaterial.uniforms.intensity.value = value;
    this.doraEmissionMaterial.uniforms.intensity.value = value;
    this.doraHaloMaterial.opacity = 0.045 * value;
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
    this.matchHighlightGeometry.dispose();
    this.doraHaloGeometry.dispose();
    this.doraEmissionGeometry.dispose();
    this.disabledGeometry.dispose();
    this.tsumogiriWashGeometry.dispose();
    for (const geometry of this.faceGeometries) geometry.dispose();
    this.shellMaterial.dispose();
    this.backMaterial.dispose();
    this.faceMaterial.dispose();
    this.matchHighlightMaterial.dispose();
    this.doraLightboxGeometry.dispose();
    this.doraLightboxMaterial.dispose();
    this.doraEmissionMaterial.dispose();
    this.doraHaloMaterial.dispose();
    this.doraHaloTexture.dispose();
    this.disabledWashMaterial.dispose();
    this.tsumogiriWashMaterial.dispose();
    this.faceAtlas?.dispose();
    this.customBackTexture?.dispose();
  }
}

function createDoraHaloTexture() {
  const width = 160;
  const height = 224;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pointX = x / (width - 1) - 0.5;
      const pointY = y / (height - 1) - 0.5;
      const distance = roundedRectDistance(pointX, pointY, 0.37, 0.4, 0.07);
      // A long, smooth shoulder gives a small light bloom rather than a rim.
      const alpha = 1 - smoothstep(-0.012, 0.15, distance);
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const edgeX = Math.max(Math.abs(x) - (halfWidth - radius), 0);
  const edgeY = Math.max(Math.abs(y) - (halfHeight - radius), 0);
  return Math.hypot(edgeX, edgeY) - radius;
}

function smoothstep(edge0, edge1, value) {
  const progress = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function createDoraLightboxMaterial() {
  return new ShaderMaterial({
    uniforms: {
      lightColor: { value: new Color("#ffe16a") },
      intensity: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vLocalNormal;
      void main() {
        vLocalNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 lightColor;
      uniform float intensity;
      varying vec3 vLocalNormal;

      void main() {
        // The blue back has an outward local normal of -Z. Retain the white
        // side walls, but never tint that rear surface.
        if (vLocalNormal.z < -0.12 || intensity < 0.002) discard;
        gl_FragColor = vec4(lightColor, intensity * 0.12);
      }
    `,
  });
}

function createDoraEmissionMaterial() {
  return new ShaderMaterial({
    uniforms: {
      emissionColor: { value: new Color("#fff0a1") },
      intensity: { value: 0 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vLocalNormal;
      void main() {
        vLocalNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 emissionColor;
      uniform float intensity;
      varying vec3 vLocalNormal;

      void main() {
        if (vLocalNormal.z < -0.12 || intensity < 0.002) discard;
        gl_FragColor = vec4(emissionColor, intensity * 0.085);
      }
    `,
  });
}

export function doraBreathIntensity(progress) {
  const phase = Math.max(0, Math.min(1, Number(progress) || 0));
  const pulse = Math.sin(Math.PI * phase) ** 2;
  return DORA_BREATH_MIN_INTENSITY + (1 - DORA_BREATH_MIN_INTENSITY) * pulse;
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
