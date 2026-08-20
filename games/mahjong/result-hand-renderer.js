import {
  ACESFilmicToneMapping,
  AmbientLight,
  Group,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import tileFacesUrl from "./assets/tiles/riichi-faces.webp?url";
import playerPortraitsUrl from "./assets/player-portraits-v1.jpg?url";
import {
  asArray,
  doraTypeCounts,
  resultDetailPageCount,
  resultBasePaymentTotal,
  resultIndicatorSlots,
  resultScoreSheetRows,
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
import { YAKU_FONT_TEXT } from "./yaku-display.js";

const VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const TILE_GAP = 0.01;
const WINNING_TILE_GAP = 0.24;
const MELD_GAP = 0.34;
const VIEW_ASPECT = VIEWPORT.width / VIEWPORT.height;
const VIEW_WIDTH = 16.8;
const CAMERA_TARGET = new Vector3(0, 0.08, 0.8);
const RESULT_HAND_Z = -1.25;
const RESULT_INDICATORS_Z = -2.65;
const RESULT_PAPER_Z = 3.45;
const RESULT_SCORE_PAPER_Z = 1.3;
const RESULT_INDICATOR_SCALE = 1;
const RESULT_INDICATOR_GAP = 0.01;
const RESULT_INDICATOR_GROUP_GAP = 0.42;
const RESULT_INDICATOR_SLOT_COUNT = 5;
const RESULT_KEY_LIGHT_DIRECTIONAL_INTENSITY = 4.6;
const RESULT_KEY_LIGHT_REFERENCE_DISTANCE = Math.hypot(
  RESULT_HAND_KEY_LIGHT_POSITION.x,
  RESULT_HAND_KEY_LIGHT_POSITION.y,
  RESULT_HAND_KEY_LIGHT_POSITION.z - RESULT_HAND_Z,
);
const RESULT_KEY_LIGHT_POINT_INTENSITY =
  RESULT_KEY_LIGHT_DIRECTIONAL_INTENSITY * RESULT_KEY_LIGHT_REFERENCE_DISTANCE ** 2;
const SCORE_PORTRAIT_IMAGE_ASPECT = 1;
const DEFAULT_PORTRAIT_POSITIONS = [
  "0% 0%",
  "100% 0%",
  "0% 100%",
  "100% 100%",
];

export class MahjongResultHandRenderer {
  constructor(host, { handsHost, yakuHost, scoreHost } = {}) {
    this.host = host;
    this.handsHost = handsHost;
    this.yakuHost = yakuHost;
    this.scoreHost = scoreHost;
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
    this.onStationAvatarChanged = () => {
      if (this.destroyed || !this.paper?.photoCards.visible) return;
      this.syncScorePortraitOverlay(renderedStationPortraitSources());
    };
    document.addEventListener(
      "mahjong:player-avatar-changed",
      this.onStationAvatarChanged,
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
    this.indicators = new Group();
    this.indicators.position.z = RESULT_INDICATORS_Z;
    this.scene.add(this.indicators);
    this.addLighting();
    this.addShadowPlane();

    this.paper = new MahjongResultPaper(
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.paper.object3d.position.z = RESULT_PAPER_Z;
    this.scene.add(this.paper.object3d);
    this.createScorePortraitOverlay();

    const atlas = await new TextureLoader().loadAsync(tileFacesUrl);
    atlas.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.tileFactory = new ThreeTileFactory(atlas);
    await Promise.all([
      document.fonts?.load('400 28px "Kalam Score"'),
      document.fonts?.load('400 26px "Playweft Mahjong Xingshu"'),
      document.fonts?.load('700 32px "Mahjong Yaku Xingshu"', YAKU_FONT_TEXT),
    ]);
    this.ready = true;
    if (this.pendingRender) this.render(...this.pendingRender);
  }

  addLighting() {
    this.scene.add(
      new HemisphereLight(0xfff4dc, 0x31564e, 2.2),
      new AmbientLight(0xdde5df, 1.05),
    );
    this.keyLight = new PointLight(
      0xffe8c6,
      RESULT_KEY_LIGHT_POINT_INTENSITY,
      0,
      2,
    );
    this.keyLight.position.set(
      RESULT_HAND_KEY_LIGHT_POSITION.x,
      RESULT_HAND_KEY_LIGHT_POSITION.y,
      RESULT_HAND_KEY_LIGHT_POSITION.z,
    );
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1536, 1536);
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

  render(state, pageIndex = 0, playerName = "你") {
    this.lastRender = [state, pageIndex, playerName];
    if (!this.ready) {
      this.pendingRender = [state, pageIndex, playerName];
      return;
    }
    this.pendingRender = null;
    const detailCount = resultDetailPageCount(state);
    const safePage = Math.max(0, Math.min(detailCount, Number(pageIndex) || 0));
    if (state?.phase !== "hand_ended") {
      this.hide();
      return;
    }
    if (this.contextLost) return;

    if (safePage >= detailCount) {
      this.renderScoreSheet(state, playerName);
      return;
    }
    this.cancelScoreSheetRender();
    this.hideScorePortraitOverlay();
    if (state.winType === "nagashi") {
      this.hide();
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
    if (!playerId) {
      this.hide();
      return;
    }

    this.scoreHost?.classList.remove("is-three-result-rendered");
    this.paper.object3d.position.z = RESULT_PAPER_Z;
    this.host.prepend(this.renderer.domElement);
    this.host.classList.add("is-three-result-rendered");
    this.handsHost?.classList.add("is-three-rendered");
    this.yakuHost?.classList.add("is-paper-rendered");
    this.clearTiles();
    this.buildHand(state, playerId, winnerIndex);
    this.buildIndicators(state, playerId);
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

  renderScoreSheet(state, playerName) {
    if (!this.scoreHost) {
      this.hide();
      return;
    }
    this.host.classList.remove("is-three-result-rendered");
    this.handsHost?.classList.remove("is-three-rendered");
    this.yakuHost?.classList.remove("is-paper-rendered");
    this.clearTiles();
    this.paper.object3d.position.z = RESULT_SCORE_PAPER_Z;
    this.scoreHost.prepend(this.renderer.domElement);
    this.scoreHost.classList.add("is-three-result-rendered");
    const sheet = {
      playerNames: [
        playerName,
        ...Array.from(
          { length: 3 },
          (_, index) => state.playerNames?.[index + 1] ?? `玩家${index + 2}`,
        ),
      ],
      rows: resultScoreSheetRows(state),
      portraitSources: renderedStationPortraitSources(),
    };
    this.scoreSheetRenderVersion = (this.scoreSheetRenderVersion ?? 0) + 1;
    this.paper.renderScoreSheet(sheet);
    this.syncScorePortraitOverlay(sheet.portraitSources);
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

  buildIndicators(state, playerId) {
    const { dora, ura } = resultIndicatorSlots(state, playerId);
    const tileWidth = TILE_SIZE.width * RESULT_INDICATOR_SCALE;
    const groupWidth =
      tileWidth * RESULT_INDICATOR_SLOT_COUNT +
      RESULT_INDICATOR_GAP * (RESULT_INDICATOR_SLOT_COUNT - 1);
    const totalWidth = groupWidth * 2 + RESULT_INDICATOR_GROUP_GAP;
    let cursor = -totalWidth / 2;

    [dora, ura].forEach((indicators, groupIndex) => {
      for (let index = 0; index < RESULT_INDICATOR_SLOT_COUNT; index += 1) {
        const indicator = indicators[index] ?? null;
        const slot = new Group();
        slot.position.set(
          cursor + tileWidth / 2,
          (TILE_SIZE.depth * RESULT_INDICATOR_SCALE) / 2,
          0,
        );
        slot.scale.setScalar(RESULT_INDICATOR_SCALE);
        const tile = this.tileFactory.create({
          type: indicator?.type,
          red: indicator?.red === true,
          concealed: indicator == null,
        });
        tile.rotation.x = indicator == null ? Math.PI / 2 : -Math.PI / 2;
        slot.add(tile);
        this.indicators.add(slot);
        cursor += tileWidth + RESULT_INDICATOR_GAP;
      }
      if (groupIndex === 0) cursor += RESULT_INDICATOR_GROUP_GAP;
    });
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
    this.indicators?.clear();
    this.indicators?.position.set(0, 0, RESULT_INDICATORS_Z);
  }

  hide() {
    this.cancelScoreSheetRender();
    this.hideScorePortraitOverlay();
    this.host.classList.remove("is-three-result-rendered");
    this.scoreHost?.classList.remove("is-three-result-rendered");
    this.handsHost?.classList.remove("is-three-rendered");
    this.yakuHost?.classList.remove("is-paper-rendered");
    this.paper?.hide();
    this.renderer?.domElement.remove();
  }

  cancelScoreSheetRender() {
    this.scoreSheetRenderVersion = (this.scoreSheetRenderVersion ?? 0) + 1;
  }

  createScorePortraitOverlay() {
    if (!this.scoreHost) return;
    this.scorePortraitOverlay = document.createElement("div");
    this.scorePortraitOverlay.className = "result-score-portrait-overlay";
    this.scorePortraitOverlay.setAttribute("aria-hidden", "true");
    this.scorePortraitOverlay.hidden = true;
    this.scorePortraitFrames = Array.from({ length: 4 }, (_, index) => {
      const frame = document.createElement("div");
      frame.className = "result-score-portrait";
      const crop = document.createElement("div");
      crop.className = "result-score-portrait-crop";
      crop.style.backgroundPosition = DEFAULT_PORTRAIT_POSITIONS[index];
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      image.addEventListener("error", () => {
        crop.classList.add("is-default-portrait");
        crop.style.backgroundImage = `url(${JSON.stringify(playerPortraitsUrl)})`;
        image.hidden = true;
        image.removeAttribute("src");
        delete image.dataset.source;
      });
      crop.append(image);
      frame.append(crop);
      this.scorePortraitOverlay.append(frame);
      return { frame, crop, image };
    });
    this.scoreHost.append(this.scorePortraitOverlay);
  }

  syncScorePortraitOverlay(sources = []) {
    if (!this.scorePortraitOverlay || !this.paper?.photoCards.visible) return;
    this.scorePortraitOverlay.hidden = false;
    this.scorePortraitFrames.forEach(({ crop, image }, index) => {
      const source = typeof sources[index] === "string" ? sources[index] : "";
      const useDefault = !source;
      crop.classList.toggle("is-default-portrait", useDefault);
      crop.style.backgroundImage = useDefault
        ? `url(${JSON.stringify(playerPortraitsUrl)})`
        : "";
      if (useDefault) {
        image.hidden = true;
        image.removeAttribute("src");
        delete image.dataset.source;
      } else {
        image.hidden = false;
        if (image.dataset.source !== source) {
          image.dataset.source = source;
          image.src = source;
        }
      }
    });
    this.positionScorePortraitOverlay();
  }

  positionScorePortraitOverlay() {
    if (!this.scorePortraitOverlay || !this.paper?.photoCards.visible) return;
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.scorePortraitFrames.forEach(({ frame, crop }, index) => {
      const corners = this.paper.instantPhotoWindowCorners(index);
      const quad = corners.map((corner) => {
        const point = corner.clone().project(this.camera);
        return {
          x: ((point.x + 1) / 2) * VIEWPORT.width,
          y: ((1 - point.y) / 2) * VIEWPORT.height,
        };
      });
      const cropRect = scorePortraitCropRect(quad);
      if (!cropRect) {
        frame.hidden = true;
        return;
      }
      frame.hidden = false;
      frame.style.clipPath = `polygon(${quad.map(({ x, y }) => `${x}px ${y}px`).join(", ")})`;
      crop.style.left = `${cropRect.left}px`;
      crop.style.top = `${cropRect.top}px`;
      crop.style.width = `${cropRect.width}px`;
      crop.style.height = `${cropRect.height}px`;
    });
  }

  hideScorePortraitOverlay() {
    if (this.scorePortraitOverlay) this.scorePortraitOverlay.hidden = true;
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
    document.removeEventListener(
      "mahjong:player-avatar-changed",
      this.onStationAvatarChanged,
    );
    this.scorePortraitOverlay?.remove();
    this.tileFactory?.destroy();
    this.paper?.destroy();
    this.shadowGeometry?.dispose();
    this.shadowMaterial?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

function renderedStationPortraitSources() {
  return ["bottom", "right", "top", "left"].map((position) => {
    const image = document.querySelector(
      `.player-${position} [data-player-avatar]`,
    );
    if (!image) return "";
    return image.dataset.source || image.currentSrc || "";
  });
}

function scorePortraitCropRect(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const centreX = points.reduce((sum, point) => sum + point.x, 0) / 4;
  const centreY = points.reduce((sum, point) => sum + point.y, 0) / 4;
  const width = (distanceBetween(points[0], points[1]) + distanceBetween(points[3], points[2])) / 2;
  const height = (distanceBetween(points[0], points[3]) + distanceBetween(points[1], points[2])) / 2;
  if (width <= 0 || height <= 0) return null;
  const cropWidth = Math.max(width, height * SCORE_PORTRAIT_IMAGE_ASPECT);
  const cropHeight = cropWidth / SCORE_PORTRAIT_IMAGE_ASPECT;
  return {
    left: centreX - cropWidth / 2,
    top: centreY - cropHeight / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizeTile(tile) {
  if (tile && typeof tile === "object") {
    return { type: Number(tile.type), red: tile.red === true };
  }
  return { type: Number(tile), red: false };
}
