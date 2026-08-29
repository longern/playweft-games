import {
  ACESFilmicToneMapping,
  AmbientLight,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShadowMaterial,
  Raycaster,
  SRGBColorSpace,
  SphereGeometry,
  TextureLoader,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import tileFacesUrl from "../assets/tiles/riichi-faces.webp?url";
import tileFacesPlaceholderUrl from "../assets/tiles/riichi-faces-placeholder.webp?url";
import playerPortraitsUrl from "../assets/player-portraits-v1.jpg?url";
import { afterWindowLoad } from "../theme/deferred-visual-assets.js";
import { getMahjongBuiltinCharacterPosition } from "../theme/builtin-characters.js";
import {
  asArray,
  doraTypeCounts,
  playerDisplayName,
  playerDisplayNames,
  resultDetailPageCount,
  resultBasePaymentTotal,
  resultIndicatorSlots,
} from "../rules/game-format.js";
import {
  createMahjongScoreSheetModel,
  scoreSheetPortraitSources,
} from "./score-sheet-model.js";
import { MELD_GROUP_GAP, TILE_SIZE } from "../render/three-layout.js";
import {
  RESULT_HAND_SHADOW_OPACITY,
  RESULT_MELD_SCALE,
  resultMeldDisplayLayout,
} from "../render/result-hand-layout.js";
import { ThreeAnimationController } from "../render/three-animation-controller.js";
import {
  doraBreathIntensity,
  DORA_BREATH_DURATION_MS,
  ThreeTileFactory,
} from "../render/three-tile-factory.js";
import {
  MahjongResultPaper,
  RESULT_PAPER_DEPTH,
} from "./result-paper-renderer.js";
import {
  RESULT_HAND_KEY_LIGHT_POSITION,
  resultHandCameraDistance,
  resultHandCameraPosition,
  resultHandVerticalFov,
} from "../render/result-hand-camera.js";
import { activateResultStartControl } from "./result-start-control.js";
import { YAKU_FONT_TEXT } from "../rules/yaku-display.js";

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
const RESULT_START_BUTTON_HOME = new Vector3(6.45, 0, 2.9);
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
  RESULT_KEY_LIGHT_DIRECTIONAL_INTENSITY *
  RESULT_KEY_LIGHT_REFERENCE_DISTANCE ** 2;
const SCORE_PORTRAIT_IMAGE_ASPECT = 1;
const DEFAULT_PORTRAIT_POSITIONS = ["0% 0%", "100% 0%", "0% 100%", "100% 100%"];

export class MahjongResultHandRenderer {
  constructor(
    host,
    {
      handsHost,
      yakuHost,
      scoreHost,
      startControlHost,
      onStartButtonClick,
      onBlankDoubleClick,
    } = {},
  ) {
    this.host = host;
    this.handsHost = handsHost;
    this.yakuHost = yakuHost;
    this.scoreHost = scoreHost;
    this.startControlHost = startControlHost;
    this.onStartButtonClick = onStartButtonClick;
    this.onBlankDoubleClick = onBlankDoubleClick;
    this.ready = false;
    this.destroyed = false;
    this.pendingRender = null;
    this.lastRender = null;
    this.startButtonDisabled = false;
    this.contextLost = false;
    this.playerPresentationProvider = null;
    this.unsubscribePlayerPresentations = null;
    this.scoreSheetModel = null;
    this.appearanceVersion = 0;
    this.animations = new ThreeAnimationController(() => this.drawFrame());
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
    this.raycaster = new Raycaster();
    this.pointer = new Vector2();
    this.onResultScenePointerMove = (event) => {
      if (!this.startButton?.object3d.visible) return;
      const hit = this.resultButtonHit(event);
      this.renderer.domElement.style.cursor = hit ? "pointer" : "default";
    };
    this.onResultScenePointerDown = (event) => {
      if (!this.resultButtonHit(event)) return;
      event.preventDefault();
      this.resultButtonPointerId = event.pointerId;
      this.renderer.domElement.setPointerCapture?.(event.pointerId);
      this.animateStartButton(true, () => this.releaseStartButtonAfterPress());
    };
    this.onResultScenePointerUp = (event) => {
      if (this.resultButtonPointerId !== event.pointerId) return;
      this.resultButtonPointerId = null;
      this.renderer.domElement.releasePointerCapture?.(event.pointerId);
      const shouldContinue = this.resultButtonHit(event);
      this.startButtonReleasePending = shouldContinue;
      if (this.startButtonAnimationTarget !== true) {
        this.releaseStartButtonAfterPress();
      }
    };
    this.onResultScenePointerCancel = (event) => {
      if (this.resultButtonPointerId !== event.pointerId) return;
      this.resultButtonPointerId = null;
      this.startButtonReleasePending = false;
      if (this.startButtonAnimationTarget !== true) {
        this.releaseStartButtonAfterPress();
      }
    };
    this.onResultSceneDoubleClick = (event) => {
      if (this.startButtonDisabled) return;
      if (this.resultButtonHit(event)) return;
      this.playStartButtonActivation(() => this.onBlankDoubleClick?.());
    };
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.onResultScenePointerDown,
    );
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.onResultScenePointerMove,
    );
    this.renderer.domElement.addEventListener(
      "pointerup",
      this.onResultScenePointerUp,
    );
    this.renderer.domElement.addEventListener(
      "pointercancel",
      this.onResultScenePointerCancel,
    );
    this.renderer.domElement.addEventListener(
      "dblclick",
      this.onResultSceneDoubleClick,
    );
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
    this.startButton = new MahjongResultStartButton(
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.scene.add(this.startButton.object3d);
    this.startControlHost?.classList.add("is-three-button");
    this.createScorePortraitOverlay();

    const atlas = await new TextureLoader().loadAsync(tileFacesPlaceholderUrl);
    atlas.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.tileFactory = new ThreeTileFactory(atlas);
    this.deferFaceAtlas();
    await Promise.all([
      document.fonts?.load('400 28px "Kalam Score"'),
      document.fonts?.load('400 26px "Mahjong Brush"'),
      document.fonts?.load('400 32px "Mahjong Brush"', YAKU_FONT_TEXT),
    ]);
    this.ready = true;
    if (this.pendingRender) this.render(...this.pendingRender);
  }

  deferFaceAtlas() {
    afterWindowLoad({
      document,
      window,
      callback: () => {
        void this.loadFaceAtlas().catch((error) => {
          console.warn("Mahjong result tile atlas failed to load", error);
        });
      },
    });
  }

  async loadFaceAtlas() {
    const atlas = await new TextureLoader().loadAsync(tileFacesUrl);
    if (this.destroyed) {
      atlas.dispose();
      return;
    }
    atlas.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.tileFactory.setFaceAtlas(atlas);
    this.drawFrame();
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

  render(
    state,
    pageIndex = 0,
    playerName = "你",
    {
      defaultNames = {},
      playerNameIsAuthoritative = false,
      resultPageReady = false,
    } = {},
  ) {
    const options = { defaultNames, playerNameIsAuthoritative, resultPageReady };
    this.lastRender = [state, pageIndex, playerName, options];
    if (!this.ready) {
      this.pendingRender = [state, pageIndex, playerName, options];
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

    this.showStartButton(resultPageReady ? "等待中" : "继续", resultPageReady);

    if (safePage >= detailCount) {
      this.renderScoreSheet(state, playerName, options);
      return;
    }
    this.cancelScoreSheetRender();
    this.hideScorePortraitOverlay();
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
    this.syncDoraBreathing();
    this.paper.render({
      yaku: asArray(result.yaku),
      winnerName: playerDisplayName(state, winnerIndex, {
        playerName,
        ...options,
      }),
      winType: state.winType,
      fu: result.fu,
      han: result.han,
      total: resultBasePaymentTotal(state, result),
    });
    this.drawFrame();
  }

  renderScoreSheet(
    state,
    playerName,
    { defaultNames = {}, playerNameIsAuthoritative = false } = {},
  ) {
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
    const playerNames = playerDisplayNames(state, {
        playerName,
        defaultNames,
        playerNameIsAuthoritative,
      });
    this.scoreSheetModel = createMahjongScoreSheetModel(state, {
      playerNames,
      getPlayerPresentation: (context) =>
        this.playerPresentationProvider?.get?.(context),
    });
    const sheet = {
      playerNames: this.scoreSheetModel.columns.map((column) => column.name),
      selfColumnIndex: this.scoreSheetModel.selfColumnIndex,
      rows: this.scoreSheetModel.rows,
    };
    this.scoreSheetRenderVersion = (this.scoreSheetRenderVersion ?? 0) + 1;
    this.paper.renderScoreSheet(sheet);
    this.syncScoreSheetPortraits();
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

    // The result row is drawn left-to-right, while meld history is stored in
    // call order. Reverse a copy so this presentation step cannot mutate the
    // shared state subsequently consumed by the table renderer.
    const melds = [...asArray(state.melds?.[playerId])].reverse();
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
    this.tileFactory?.beginFrame();
    this.stopDoraBreathing();
    this.tiles.clear();
    this.tiles.position.set(0, 0, RESULT_HAND_Z);
    this.indicators?.clear();
    this.indicators?.position.set(0, 0, RESULT_INDICATORS_Z);
  }

  hide() {
    this.stopDoraBreathing();
    this.cancelStartButtonAnimation();
    this.cancelScoreSheetRender();
    this.hideScorePortraitOverlay();
    this.scoreSheetModel = null;
    this.host.classList.remove("is-three-result-rendered");
    this.scoreHost?.classList.remove("is-three-result-rendered");
    this.handsHost?.classList.remove("is-three-rendered");
    this.yakuHost?.classList.remove("is-paper-rendered");
    this.paper?.hide();
    this.startButton?.hide();
    this.startControlHost?.style.setProperty("visibility", "hidden");
    this.renderer?.domElement.remove();
  }

  syncDoraBreathing() {
    if (!this.tileFactory?.hasDoraTiles()) {
      this.stopDoraBreathing();
      return;
    }
    if (this.animations.has("dora-breath")) return;
    this.animations.play({
      id: "dora-breath",
      duration: DORA_BREATH_DURATION_MS,
      repeat: true,
      update: (progress) => {
        this.tileFactory.setDoraGlowIntensity(doraBreathIntensity(progress));
      },
    });
  }

  stopDoraBreathing() {
    this.tileFactory?.setDoraGlowIntensity(0);
    this.animations.cancel("dora-breath");
  }

  showStartButton(label, disabled = false) {
    this.startButtonDisabled = disabled;
    if (!this.startButton?.object3d.visible) {
      this.cancelStartButtonAnimation();
      this.startButton?.setPressAmount(0);
    }
    this.startButton?.show(label);
    this.startControlHost?.style.setProperty("visibility", "visible");
  }

  animateStartButton(pressed, onComplete) {
    if (!this.startButton || this.destroyed) return;
    this.cancelStartButtonAnimation();
    const from = this.startButton.pressAmount;
    const to = pressed ? 1 : 0;
    const duration = pressed ? 70 : 115;
    this.startButtonAnimationTarget = pressed;
    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = pressed ? 1 - (1 - progress) ** 3 : 1 - (1 - progress) ** 2;
      this.startButton.setPressAmount(from + (to - from) * eased);
      this.drawFrame();
      if (progress < 1) {
        this.startButtonAnimation = window.requestAnimationFrame(step);
        return;
      }
      this.startButtonAnimation = 0;
      this.startButtonAnimationTarget = null;
      onComplete?.();
    };
    this.startButtonAnimation = window.requestAnimationFrame(step);
  }

  cancelStartButtonAnimation() {
    if (!this.startButtonAnimation) return;
    window.cancelAnimationFrame(this.startButtonAnimation);
    this.startButtonAnimation = 0;
    this.startButtonAnimationTarget = null;
  }

  releaseStartButtonAfterPress() {
    if (this.startButtonReleasePending == null) return;
    const shouldContinue = this.startButtonReleasePending;
    this.startButtonReleasePending = null;
    this.animateStartButton(false, () => {
      if (shouldContinue) this.onStartButtonClick?.();
    });
  }

  playStartButtonActivation(onComplete) {
    if (this.startButtonDisabled) return;
    if (!this.startButton?.object3d.visible) {
      onComplete?.();
      return;
    }
    activateResultStartControl({
      startAnimation: () => {
        this.animateStartButton(true, () => {
          this.animateStartButton(false);
        });
      },
      onContinue: onComplete,
    });
  }

  resultButtonHit(event) {
    if (
      this.startButtonDisabled ||
      !this.renderer ||
      !this.camera ||
      !this.startButton?.object3d.visible
    ) {
      return false;
    }
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return (
      this.raycaster.intersectObjects(this.startButton.hitTargets, false)
        .length > 0
    );
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
        const fallbackSource = image.dataset.fallbackSource || "";
        if (fallbackSource && image.dataset.source !== fallbackSource) {
          image.dataset.source = fallbackSource;
          image.src = fallbackSource;
          return;
        }
        crop.classList.add("is-default-portrait");
        crop.style.backgroundImage = `url(${JSON.stringify(playerPortraitsUrl)})`;
        crop.style.backgroundPosition =
          getMahjongBuiltinCharacterPosition(crop.dataset.builtinCharacter) ||
          DEFAULT_PORTRAIT_POSITIONS[index];
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
      const presentation = sources[index] && typeof sources[index] === "object"
        ? sources[index]
        : { source: typeof sources[index] === "string" ? sources[index] : "" };
      const source = presentation.source || "";
      const fallbackSource = presentation.fallbackSource || "";
      const builtinPosition = getMahjongBuiltinCharacterPosition(
        presentation.builtinCharacterId,
      );
      if (presentation.builtinCharacterId) {
        crop.dataset.builtinCharacter = presentation.builtinCharacterId;
      } else {
        delete crop.dataset.builtinCharacter;
      }
      crop.style.backgroundPosition = builtinPosition || DEFAULT_PORTRAIT_POSITIONS[index];
      const useDefault = !source;
      crop.classList.toggle("is-default-portrait", useDefault);
      crop.style.backgroundImage = useDefault
        ? `url(${JSON.stringify(playerPortraitsUrl)})`
        : "";
      if (fallbackSource && fallbackSource !== source) {
        image.dataset.fallbackSource = fallbackSource;
      } else {
        delete image.dataset.fallbackSource;
      }
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

  setPlayerPresentationProvider(provider) {
    this.unsubscribePlayerPresentations?.();
    this.unsubscribePlayerPresentations = null;
    this.playerPresentationProvider = provider || null;
    const subscribe = provider?.subscribe;
    if (typeof subscribe === "function") {
      this.unsubscribePlayerPresentations = subscribe(() => {
        if (this.destroyed || !this.paper?.photoCards.visible) return;
        this.syncScoreSheetPortraits();
      });
    }
  }

  syncScoreSheetPortraits() {
    if (!this.scoreSheetModel) return;
    this.syncScorePortraitOverlay(
      scoreSheetPortraitSources(
        this.scoreSheetModel,
        (context) => this.playerPresentationProvider?.get?.(context),
      ),
    );
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
    this.renderer?.domElement.removeEventListener(
      "pointermove",
      this.onResultScenePointerMove,
    );
    this.renderer?.domElement.removeEventListener(
      "pointerdown",
      this.onResultScenePointerDown,
    );
    this.renderer?.domElement.removeEventListener(
      "pointerup",
      this.onResultScenePointerUp,
    );
    this.renderer?.domElement.removeEventListener(
      "pointercancel",
      this.onResultScenePointerCancel,
    );
    this.renderer?.domElement.removeEventListener(
      "dblclick",
      this.onResultSceneDoubleClick,
    );
    this.unsubscribePlayerPresentations?.();
    this.unsubscribePlayerPresentations = null;
    this.scorePortraitOverlay?.remove();
    this.tileFactory?.destroy();
    this.animations.destroy();
    this.paper?.destroy();
    this.startButton?.destroy();
    this.startControlHost?.classList.remove("is-three-button");
    this.shadowGeometry?.dispose();
    this.shadowMaterial?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}


function scorePortraitCropRect(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const centreX = points.reduce((sum, point) => sum + point.x, 0) / 4;
  const centreY = points.reduce((sum, point) => sum + point.y, 0) / 4;
  const width =
    (distanceBetween(points[0], points[1]) +
      distanceBetween(points[3], points[2])) /
    2;
  const height =
    (distanceBetween(points[0], points[3]) +
      distanceBetween(points[1], points[2])) /
    2;
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

class MahjongResultStartButton {
  constructor(maxAnisotropy = 1) {
    this.object = new Group();
    // Set just beyond the lower-right corner of the score sheet. Because this
    // lives in the result scene, it inherits the same camera perspective as
    // the paper and the felt rather than behaving like a flat HUD control.
    this.object.position.copy(RESULT_START_BUTTON_HOME);
    this.object.visible = false;

    this.baseGeometry = new CylinderGeometry(0.53, 0.56, 0.07, 48);
    this.baseMaterial = new MeshStandardMaterial({
      color: 0x101514,
      roughness: 0.34,
      metalness: 0.72,
    });
    this.base = new Mesh(this.baseGeometry, this.baseMaterial);
    this.base.position.y = 0.035;
    this.base.castShadow = true;
    this.base.receiveShadow = true;
    this.object.add(this.base);

    this.ringGeometry = new TorusGeometry(0.39, 0.045, 12, 48);
    this.ringMaterial = new MeshStandardMaterial({
      color: 0x252b2a,
      roughness: 0.25,
      metalness: 0.84,
    });
    this.ring = new Mesh(this.ringGeometry, this.ringMaterial);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.078;
    this.ring.castShadow = true;
    this.object.add(this.ring);

    this.capGeometry = new SphereGeometry(
      0.35,
      48,
      20,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    );
    this.capMaterial = new MeshPhysicalMaterial({
      color: 0xc70c0c,
      roughness: 0.31,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
      emissive: 0x130000,
      emissiveIntensity: 0.08,
    });
    this.cap = new Mesh(this.capGeometry, this.capMaterial);
    this.capRestY = 0.09;
    this.capPressedY = 0.043;
    this.capRestScaleY = 0.42;
    this.capPressedScaleY = 0.3;
    this.pressAmount = 0;
    this.setPressAmount(0);
    this.cap.castShadow = true;
    this.cap.receiveShadow = true;
    this.object.add(this.cap);
    this.hitTargets = [this.base, this.ring, this.cap];

    this.labelTexture = createResultStartLabelTexture(maxAnisotropy);
    this.labelGeometry = new PlaneGeometry(1.8, 0.42);
    this.labelMaterial = new MeshBasicMaterial({
      map: this.labelTexture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    this.label = new Mesh(this.labelGeometry, this.labelMaterial);
    this.label.rotation.x = -Math.PI / 2;
    this.label.position.set(0, 0.012, 0.9);
    this.object.add(this.label);
    this.setLabel("继续");
  }

  get object3d() {
    return this.object;
  }

  show(label) {
    this.setLabel(label);
    this.object.visible = true;
  }

  hide() {
    this.object.visible = false;
  }

  setLabel(label) {
    const context = this.labelTexture.image.getContext("2d");
    if (!context) return;
    const { width, height } = this.labelTexture.image;
    context.clearRect(0, 0, width, height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font =
      '600 72px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    context.lineWidth = 4;
    context.strokeStyle = "rgba(3, 14, 12, 0.78)";
    context.strokeText(label, width / 2, height / 2 + 1);
    context.fillStyle = "#e8e2cf";
    context.fillText(label, width / 2, height / 2);
    this.labelTexture.needsUpdate = true;
  }

  setPressAmount(amount) {
    this.pressAmount = Math.max(0, Math.min(1, amount));
    this.cap.position.y =
      this.capRestY + (this.capPressedY - this.capRestY) * this.pressAmount;
    this.cap.scale.y =
      this.capRestScaleY +
      (this.capPressedScaleY - this.capRestScaleY) * this.pressAmount;
    this.capMaterial.emissiveIntensity = 0.08 - this.pressAmount * 0.045;
  }

  destroy() {
    this.baseGeometry.dispose();
    this.baseMaterial.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.capGeometry.dispose();
    this.capMaterial.dispose();
    this.labelGeometry.dispose();
    this.labelMaterial.dispose();
    this.labelTexture.dispose();
  }
}

function createResultStartLabelTexture(maxAnisotropy) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

function normalizeTile(tile) {
  if (tile && typeof tile === "object") {
    return { type: Number(tile.type), red: tile.red === true };
  }
  return { type: Number(tile), red: false };
}
