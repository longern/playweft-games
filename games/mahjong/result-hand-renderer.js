import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import tileFacesUrl from "./assets/tiles/riichi-faces.webp?url";
import { asArray, doraTypeCounts, resultDetailPageCount } from "./game-format.js";
import {
  MELD_GROUP_GAP,
  TILE_SIZE,
} from "./render/three-layout.js";
import {
  RESULT_HAND_SHADOW_OPACITY,
  RESULT_MELD_SCALE,
  resultMeldDisplayLayout,
} from "./render/result-hand-layout.js";
import { ThreeTileFactory } from "./render/three-tile-factory.js";
import {
  RESULT_HAND_KEY_LIGHT_POSITION,
  resultHandCameraDistance,
  resultHandCameraPosition,
  resultHandVerticalFov,
} from "./render/result-hand-camera.js";

const VIEWPORT = Object.freeze({ width: 1080, height: 128 });
const TILE_GAP = 0.035;
const WINNING_TILE_GAP = 0.24;
const MELD_GAP = 0.34;
const VIEW_PADDING = 1.15;
const VIEW_ASPECT = VIEWPORT.width / VIEWPORT.height;
const CAMERA_TARGET = new Vector3(0, 0.08, 0);

export class MahjongResultHandRenderer {
  constructor(host) {
    this.host = host;
    this.ready = false;
    this.destroyed = false;
    this.pendingRender = null;
    this.appearanceVersion = 0;
  }

  async init() {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(VIEWPORT.width, VIEWPORT.height, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = "result-hand-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(
      resultHandVerticalFov(VIEW_ASPECT),
      VIEW_ASPECT,
      0.1,
      40,
    );
    const cameraPosition = resultHandCameraPosition();
    this.camera.position.set(
      cameraPosition.x,
      cameraPosition.y,
      cameraPosition.z,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(CAMERA_TARGET);

    this.tiles = new Group();
    this.scene.add(this.tiles);
    this.addLighting();
    this.addShadowPlane();

    const atlas = await new TextureLoader().loadAsync(tileFacesUrl);
    atlas.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.tileFactory = new ThreeTileFactory(atlas);
    this.ready = true;
    if (this.pendingRender) this.render(...this.pendingRender);
  }

  addLighting() {
    this.scene.add(
      new HemisphereLight(0xfff4dc, 0x31564e, 2.2),
      new AmbientLight(0xdde5df, 1.05),
    );
    this.keyLight = new DirectionalLight(0xffe8c6, 4.6);
    this.keyLight.position.set(
      RESULT_HAND_KEY_LIGHT_POSITION.x,
      RESULT_HAND_KEY_LIGHT_POSITION.y,
      RESULT_HAND_KEY_LIGHT_POSITION.z,
    );
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1536, 1536);
    this.keyLight.shadow.camera.left = -11;
    this.keyLight.shadow.camera.right = 11;
    this.keyLight.shadow.camera.top = 5;
    this.keyLight.shadow.camera.bottom = -5;
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 28;
    this.keyLight.shadow.bias = -0.00012;
    this.keyLight.shadow.normalBias = 0.016;
    this.scene.add(this.keyLight);
  }

  addShadowPlane() {
    this.shadowGeometry = new PlaneGeometry(30, 5);
    this.shadowMaterial = new ShadowMaterial({
      color: 0x000000,
      opacity: RESULT_HAND_SHADOW_OPACITY,
      transparent: true,
      depthWrite: false,
    });
    this.shadowPlane = new Mesh(this.shadowGeometry, this.shadowMaterial);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = -0.015;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);
  }

  async setAppearance({ tablecloth = "", tileBack = "" } = {}) {
    if (!this.ready) return;
    const panel = this.host.closest(".result-panel");
    if (tablecloth) {
      panel?.style.setProperty(
        "--result-tablecloth-image",
        `url(${JSON.stringify(tablecloth)})`,
      );
    } else {
      panel?.style.removeProperty("--result-tablecloth-image");
    }
    const version = ++this.appearanceVersion;
    const texture = tileBack
      ? await new TextureLoader().loadAsync(tileBack)
      : null;
    if (version !== this.appearanceVersion || this.destroyed) {
      texture?.dispose();
      return;
    }
    this.tileFactory.setBackTexture(texture);
    this.drawFrame();
  }

  render(state, pageIndex = 0) {
    if (!this.ready) {
      this.pendingRender = [state, pageIndex];
      return;
    }
    this.pendingRender = null;
    const detailCount = resultDetailPageCount(state);
    const safePage = Math.max(
      0,
      Math.min(detailCount, Number(pageIndex) || 0),
    );
    const viewport = this.host.querySelector(".result-hand-3d");
    if (
      !viewport ||
      state?.phase !== "hand_ended" ||
      state.winType === "nagashi" ||
      safePage >= detailCount
    ) {
      this.host.classList.remove("is-three-rendered");
      this.renderer.domElement.remove();
      return;
    }

    const results = asArray(state.results).length
      ? asArray(state.results)
      : [state.result ?? {}];
    const result = results[safePage] ?? {};
    const winnerIndex =
      Number(result.winnerIndex) ||
      state.players.indexOf(state.winners?.[safePage]) + 1 ||
      Number(state.winnerIndex) ||
      1;
    const playerId = state.players?.[winnerIndex - 1];
    if (!playerId) return;

    viewport.append(this.renderer.domElement);
    this.host.classList.add("is-three-rendered");
    this.clearTiles();
    const width = this.buildHand(state, playerId, winnerIndex);
    this.frameHand(width);
    this.drawFrame();
  }

  buildHand(state, playerId, winnerIndex) {
    const doraCounts = doraTypeCounts(state);
    const concealed = asArray(state.revealedHands?.[playerId]).map(
      normalizeTile,
    );
    let cursor = 0;
    for (const tile of concealed) {
      this.addTile(tile, cursor + TILE_SIZE.width / 2, 0, 1, doraCounts);
      cursor += TILE_SIZE.width + TILE_GAP;
    }
    if (Number(state.winningTile) > 0) {
      cursor += WINNING_TILE_GAP;
      this.addTile(
        {
          type: Number(state.winningTile),
          red: state.winningTileRed === true,
        },
        cursor + TILE_SIZE.width / 2,
        0,
        1,
        doraCounts,
      );
      cursor += TILE_SIZE.width;
    } else if (cursor > 0) {
      cursor -= TILE_GAP;
    }

    const melds = asArray(state.melds?.[playerId]).reverse();
    if (melds.length) cursor += MELD_GAP;
    melds.forEach((meld, meldIndex) => {
      const display = resultMeldDisplayLayout(meld, winnerIndex);
      const normalExtent = TILE_SIZE.width * RESULT_MELD_SCALE;
      for (const entry of display.entries) {
        const centreFromRight = entry.along + normalExtent / 2;
        const centreFromLeft = display.span - centreFromRight;
        this.addTile(
          entry,
          cursor + centreFromLeft,
          -entry.inward,
          RESULT_MELD_SCALE,
          doraCounts,
        );
      }
      cursor += display.span;
      if (meldIndex < melds.length - 1) cursor += MELD_GROUP_GAP;
    });
    this.tiles.position.x = -cursor / 2;
    return cursor;
  }

  addTile(tileInfo, x, z, scale, doraCounts) {
    const slot = new Group();
    slot.position.set(x, TILE_SIZE.depth * scale / 2, z);
    slot.rotation.y = tileInfo.sideways ? Math.PI / 2 : 0;
    slot.scale.setScalar(scale);
    const tile = this.tileFactory.create({
      type: tileInfo.type,
      red: tileInfo.red === true,
      concealed: tileInfo.faceDown === true,
      dora:
        tileInfo.faceDown !== true && doraCounts.has(Number(tileInfo.type)),
    });
    tile.rotation.x = tileInfo.faceDown ? Math.PI / 2 : -Math.PI / 2;
    slot.add(tile);
    this.tiles.add(slot);
  }

  frameHand(width) {
    const viewWidth = Math.max(8.2, width + VIEW_PADDING);
    const cameraPosition = resultHandCameraPosition(
      resultHandCameraDistance(viewWidth),
    );
    this.camera.position.set(
      cameraPosition.x,
      cameraPosition.y,
      cameraPosition.z,
    );
    this.camera.lookAt(CAMERA_TARGET);
    this.camera.updateProjectionMatrix();
  }

  clearTiles() {
    this.tiles.clear();
    this.tiles.position.set(0, 0, 0);
  }

  drawFrame() {
    if (!this.ready || this.destroyed) return;
    this.renderer.render(this.scene, this.camera);
  }

  resume() {
    if (!this.ready || this.destroyed) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.drawFrame();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tileFactory?.destroy();
    this.shadowGeometry?.dispose();
    this.shadowMaterial?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

function normalizeTile(tile) {
  if (tile && typeof tile === "object") {
    return { type: Number(tile.type), red: tile.red === true };
  }
  return { type: Number(tile), red: false };
}
