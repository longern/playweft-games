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
import {
  asArray,
  doraTypeCounts,
  resultDetailPageCount,
  resultBasePaymentTotal,
} from "./game-format.js";
import { MELD_GROUP_GAP, TILE_SIZE } from "./render/three-layout.js";
import {
  RESULT_HAND_SHADOW_OPACITY,
  RESULT_MELD_SCALE,
  resultMeldDisplayLayout,
} from "./render/result-hand-layout.js";
import { ThreeTileFactory } from "./render/three-tile-factory.js";
import {
  MahjongResultPaper,
  RESULT_PAPER_DEPTH,
} from "./result-paper-renderer.js";
import {
  RESULT_HAND_KEY_LIGHT_POSITION,
  resultHandCameraDistance,
  resultHandCameraPosition,
  resultHandVerticalFov,
} from "./render/result-hand-camera.js";

const VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const TILE_GAP = 0.035;
const WINNING_TILE_GAP = 0.24;
const MELD_GAP = 0.34;
const VIEW_ASPECT = VIEWPORT.width / VIEWPORT.height;
const VIEW_WIDTH = 14.4;
const CAMERA_TARGET = new Vector3(0, 0.08, 0.8);
const RESULT_HAND_Z = -1.25;
const RESULT_PAPER_Z = 3.45;

export class MahjongResultHandRenderer {
  constructor(host, { handsHost, yakuHost } = {}) {
    this.host = host;
    this.handsHost = handsHost;
    this.yakuHost = yakuHost;
    this.ready = false;
    this.destroyed = false;
    this.pendingRender = null;
    this.lastRender = null;
    this.contextLost = false;
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
    this.renderer.domElement.className = "result-scene-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.onContextLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
    };
    this.onContextRestored = () => {
      this.contextLost = false;
      if (this.lastRender) this.render(...this.lastRender);
      else this.drawFrame();
    };
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(
      resultHandVerticalFov(VIEW_ASPECT),
      VIEW_ASPECT,
      0.1,
      60,
    );
    const cameraPosition = resultHandCameraPosition(
      resultHandCameraDistance(VIEW_WIDTH),
    );
    this.camera.position.set(
      cameraPosition.x,
      cameraPosition.y,
      cameraPosition.z + CAMERA_TARGET.z,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(CAMERA_TARGET);

    this.tiles = new Group();
    this.tiles.position.z = RESULT_HAND_Z;
    this.scene.add(this.tiles);
    this.addLighting();
    this.addShadowPlane();

    this.paper = new MahjongResultPaper(
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.paper.object3d.position.z = RESULT_PAPER_Z;
    this.scene.add(this.paper.object3d);

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
    this.shadowGeometry = new PlaneGeometry(30, RESULT_PAPER_DEPTH + 8);
    this.shadowMaterial = new ShadowMaterial({
      color: 0x000000,
      opacity: RESULT_HAND_SHADOW_OPACITY,
      transparent: true,
      depthWrite: false,
    });
    this.shadowPlane = new Mesh(this.shadowGeometry, this.shadowMaterial);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.set(0, -0.015, 1.8);
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
    this.lastRender = [state, pageIndex];
    if (!this.ready) {
      this.pendingRender = [state, pageIndex];
      return;
    }
    this.pendingRender = null;
    const detailCount = resultDetailPageCount(state);
    const safePage = Math.max(0, Math.min(detailCount, Number(pageIndex) || 0));
    if (
      state?.phase !== "hand_ended" ||
      state.winType === "nagashi" ||
      safePage >= detailCount ||
      this.yakuHost?.classList.contains("is-score-summary")
    ) {
      this.hide();
      return;
    }
    if (this.contextLost) return;

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
    if (!playerId) {
      this.hide();
      return;
    }

    this.host.prepend(this.renderer.domElement);
    this.host.classList.add("is-three-result-rendered");
    this.handsHost?.classList.add("is-three-rendered");
    this.yakuHost?.classList.add("is-paper-rendered");
    this.clearTiles();
    this.buildHand(state, playerId, winnerIndex);
    this.paper.render({
      yaku: asArray(result.yaku),
      winnerName: state.playerNames?.[winnerIndex - 1] || `玩家${winnerIndex}`,
      winType: state.winType,
      fu: result.fu,
      han: result.han,
      total: resultBasePaymentTotal(state, result),
    });
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
    this.tiles.position.set(-cursor / 2, 0, RESULT_HAND_Z);
    return cursor;
  }

  addTile(tileInfo, x, z, scale, doraCounts) {
    const slot = new Group();
    slot.position.set(x, (TILE_SIZE.depth * scale) / 2, z);
    slot.rotation.y = tileInfo.sideways ? Math.PI / 2 : 0;
    slot.scale.setScalar(scale);
    const tile = this.tileFactory.create({
      type: tileInfo.type,
      red: tileInfo.red === true,
      concealed: tileInfo.faceDown === true,
      dora: tileInfo.faceDown !== true && doraCounts.has(Number(tileInfo.type)),
    });
    tile.rotation.x = tileInfo.faceDown ? Math.PI / 2 : -Math.PI / 2;
    slot.add(tile);
    this.tiles.add(slot);
  }

  clearTiles() {
    this.tiles.clear();
    this.tiles.position.set(0, 0, RESULT_HAND_Z);
  }

  hide() {
    this.host.classList.remove("is-three-result-rendered");
    this.handsHost?.classList.remove("is-three-rendered");
    this.yakuHost?.classList.remove("is-paper-rendered");
    this.paper?.hide();
    this.renderer?.domElement.remove();
  }

  drawFrame() {
    if (!this.ready || this.contextLost || this.destroyed) return;
    this.renderer.render(this.scene, this.camera);
  }

  resume() {
    if (!this.ready || this.contextLost || this.destroyed) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.drawFrame();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hide();
    this.renderer?.domElement.removeEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.renderer?.domElement.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.tileFactory?.destroy();
    this.paper?.destroy();
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
