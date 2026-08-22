import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SpotLight,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  WebGLRenderer,
} from "three";
import tileFacesUrl from "./assets/tiles/riichi-faces.webp?url";
import tileFacesPlaceholderUrl from "./assets/tiles/riichi-faces-placeholder.webp?url";
import feltSkinUrl from "./assets/felt-skin-moonwave-v1.jpg?url";
import { afterWindowLoad } from "./deferred-visual-assets.js";
import { POSITIONS } from "./constants.js";
import { MAHJONG_VIEWPORT } from "./fixed-viewport.js";
import {
  asArray,
  canDiscardHandTile,
  doraTypeCounts,
  isRedFive,
  opponentHandLayout,
  riverDisplayEntries,
  splitRevealedHand,
  tileType,
} from "./game-format.js";
import {
  handTransform,
  MELD_GROUP_GAP,
  MELD_SCALE,
  meldDisplayLayout,
  meldRightExtension,
  ownHandDoubleClickSafeBounds,
  meldTransform,
  ownHandOverlayTransform,
  OWN_HAND_DRAG,
  presentedHandTransform,
  presentedTileHingeTransform,
  RIVER_TILE_GAP,
  riverGridPosition,
  riverTransform,
  TILE_SIZE,
} from "./render/three-layout.js";
import { planarTileJitter } from "./render/three-tile-jitter.js";
import {
  ACTION_CALLOUT_DURATION_MS,
  ThreeActionCallout,
} from "./render/three-callout.js";
import {
  doraBreathIntensity,
  DORA_BREATH_DURATION_MS,
  ThreeTileFactory,
} from "./render/three-tile-factory.js";
import { ThreeTableConsole } from "./render/three-console.js";
import { ThreeMahjongTable } from "./render/three-table.js";
import { ThreeAnimationController } from "./render/three-animation-controller.js";
import { ThreeKeyedSceneLayer } from "./render/three-keyed-scene-layer.js";
import {
  HAND_REVEAL_FALL_DURATION_MS,
  NEW_HAND_DEAL_DURATION_MS,
  OWN_HAND_CROSSFADE_DURATION_MS,
  OWN_DRAW_ENTRY_DURATION_MS,
  OWN_TILE_HOVER_DURATION_MS,
  OWN_TILE_HOVER_LIFT,
  OWN_TILE_SELECTION_DURATION_MS,
  handRevealStartDelay,
  handRevealFallProgress,
  newHandDealProgress,
  ownHandCrossfadeProgress,
  ownDrawEntryKey,
  ownDrawEntryProgress,
  ownTileSelectionProgress,
  shouldCrossfadeOwnHand,
} from "./render/three-motion.js";

const CAMERA_TARGET = Object.freeze({ x: 0, y: 0.05, z: 0.4 });
const CAMERA_POSITION = Object.freeze({ x: 0, y: 15.558, z: 15.908 });

export class MahjongThreeRenderer {
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.ready = false;
    this.pendingRender = null;
    this.pointer = new Vector2();
    this.raycaster = new Raycaster();
    this.pickableTiles = [];
    this.revealTiles = [];
    this.activeHandRevealKey = "";
    this.pendingOwnHandCrossfade = null;
    this.ownHandCrossfade = null;
    this.ownDrawAnimation = null;
    this.ownTileMotions = [];
    this.dealInTiles = [];
    this.dealInAnimation = null;
    this.ownTileRecords = new Map();
    this.activeOwnTileIds = new Set();
    this.highlightableTiles = new Set();
    this.dragState = null;
    this.lastTap = { tileId: 0, time: 0 };
    this.contextLost = false;
    this.destroyed = false;
    this.appearanceVersion = 0;
    this.animations = new ThreeAnimationController(() => {
      if (!this.renderer || this.destroyed) return;
      this.renderer.shadowMap.needsUpdate = true;
      this.drawFrame();
    });
  }

  async init() {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.97;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.autoClear = false;
    this.renderer.domElement.className = "mahjong-three-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.host.append(this.renderer.domElement);
    this.onContextLost = () => {
      this.contextLost = true;
    };
    this.onContextRestored = () => {
      this.contextLost = false;
      this.resume();
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
    this.camera = new PerspectiveCamera(33, MAHJONG_VIEWPORT.aspect, 0.1, 80);
    this.camera.position.set(
      CAMERA_POSITION.x,
      CAMERA_POSITION.y,
      CAMERA_POSITION.z,
    );
    this.camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);

    this.overlayScene = new Scene();
    this.overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.overlayCamera.position.set(0, 0, 1000);
    this.overlayCamera.lookAt(0, 0, 0);
    this.ownHandLayer = new Group();
    this.overlayScene.add(this.ownHandLayer);
    this.actionCallout = new ThreeActionCallout(this.animations);
    this.overlayScene.add(this.actionCallout.group);

    this.tableConsole = new ThreeTableConsole({
      anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    });
    this.scene.add(this.tableConsole.group);

    const textureLoader = new TextureLoader();
    await document.fonts?.load?.(
      `400 300px "Mahjong Brush"`,
      "吃碰杠立直和自摸",
    );
    const faceAtlas = await textureLoader.loadAsync(tileFacesPlaceholderUrl);

    this.addLighting();
    this.addOverlayLighting();
    this.table = new ThreeMahjongTable({
      anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    });
    this.scene.add(this.table.group);
    this.dynamic = new Group();
    this.scene.add(this.dynamic);
    this.layers = Object.fromEntries(
      ["hands", "rivers", "melds"].map((name) => {
        const layer = new Group();
        layer.name = name;
        this.dynamic.add(layer);
        return [name, layer];
      }),
    );
    this.riverLayer = new ThreeKeyedSceneLayer(this.layers.rivers);

    faceAtlas.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.tileFactory = new ThreeTileFactory(faceAtlas);
    this.deferDefaultTextures();

    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerLeave = () => this.handlePointerLeave();
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onPointerCancel = () => {
      this.cancelDrag(false);
      this.setHoveredTile(null, true);
    };
    this.onDoubleClick = (event) => this.handleDoubleClick(event);
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.onPointerDown,
    );
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.onPointerMove,
    );
    this.renderer.domElement.addEventListener(
      "pointerleave",
      this.onPointerLeave,
    );
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener(
      "pointercancel",
      this.onPointerCancel,
    );
    this.renderer.domElement.addEventListener("dblclick", this.onDoubleClick);

    this.resize();
    this.ready = true;
    if (this.pendingRender) this.render(...this.pendingRender);
    else this.drawFrame();
  }

  deferDefaultTextures() {
    afterWindowLoad({
      document,
      window,
      callback: () => {
        void this.loadDefaultTextures().catch((error) => {
          console.warn("Mahjong table textures failed to load", error);
        });
      },
    });
  }

  async loadDefaultTextures() {
    const loader = new TextureLoader();
    const [faceAtlas, feltSkin] = await Promise.all([
      loader.loadAsync(tileFacesUrl),
      loader.loadAsync(feltSkinUrl),
    ]);
    if (this.destroyed) {
      faceAtlas.dispose();
      feltSkin.dispose();
      return;
    }
    faceAtlas.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.tileFactory.setFaceAtlas(faceAtlas);
    this.table.setDefaultFeltTexture(feltSkin);
    this.renderer.shadowMap.needsUpdate = true;
    this.drawFrame();
  }

  async setAppearance({ tablecloth = "", tileBack = "" } = {}) {
    if (!this.ready) return;
    const version = ++this.appearanceVersion;
    const loader = new TextureLoader();
    const [felt, back] = await Promise.all([
      tablecloth ? loader.loadAsync(tablecloth) : null,
      tileBack ? loader.loadAsync(tileBack) : null,
    ]);
    if (version !== this.appearanceVersion || this.destroyed) {
      felt?.dispose();
      back?.dispose();
      return;
    }
    this.table.setFeltTexture(felt);
    this.tileFactory.setBackTexture(back);
    this.renderer.shadowMap.needsUpdate = true;
    this.drawFrame();
  }

  addLighting() {
    this.scene.add(
      new HemisphereLight(0xfff2d8, 0x416d62, 1.62),
      new AmbientLight(0xe2e7e3, 1.3),
    );
    const overheadFill = new SpotLight(0xffedcf, 62, 46, 0.96, 0.86, 1.35);
    overheadFill.name = "table-overhead-fill";
    overheadFill.position.set(0, 16, -1.5);
    overheadFill.target.position.set(0, 0, -1.5);

    const overhead = new SpotLight(0xffedcf, 28, 46, 0.96, 0.86, 1.35);
    overhead.name = "table-overhead-light";
    overhead.position.set(0, 16, -1.5);
    overhead.target.position.set(0, 0, -1.5);
    overhead.castShadow = true;
    overhead.shadow.mapSize.set(2048, 2048);
    overhead.shadow.camera.near = 4;
    overhead.shadow.camera.far = 42;
    overhead.shadow.bias = -0.00012;
    overhead.shadow.normalBias = 0.018;
    overhead.shadow.focus = 0.9;
    overhead.shadow.radius = 7;
    this.scene.add(
      overheadFill,
      overheadFill.target,
      overhead,
      overhead.target,
    );
  }

  addOverlayLighting() {
    this.overlayScene.add(
      new HemisphereLight(0xfff4dc, 0x244a43, 2.35),
      new AmbientLight(0xb9d0c7, 0.8),
    );
    const key = new DirectionalLight(0xffe8c3, 3.8);
    key.position.set(-260, 420, 700);
    this.overlayScene.add(key);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const { width, height, aspect } = MAHJONG_VIEWPORT;
    const viewportChanged =
      width !== this.viewport?.width || height !== this.viewport?.height;
    this.renderer.setSize(width, height, false);
    this.viewport = { width, height };
    this.camera.aspect = aspect;
    this.camera.fov = 33;
    this.camera.updateProjectionMatrix();
    this.overlayCamera.left = -width / 2;
    this.overlayCamera.right = width / 2;
    this.overlayCamera.top = height / 2;
    this.overlayCamera.bottom = -height / 2;
    this.overlayCamera.updateProjectionMatrix();
    if (
      viewportChanged &&
      this.ready &&
      this.state &&
      this.ui &&
      !this.animations.has("hand-reveal")
    ) {
      this.render(this.state, [], this.ui);
      return;
    }
    this.drawFrame();
  }

  render(state, events, ui) {
    if (!this.ready) {
      this.pendingRender = [state, events, ui];
      return;
    }
    this.pendingRender = null;
    this.cancelDrag(false);
    const drawEntryKey = ownDrawEntryKey(state);
    const newDrawEntry = this.animations.claim("own-draw-entry", drawEntryKey);
    this.animateOwnDrawEntry = Boolean(this.state && newDrawEntry);
    if (!drawEntryKey) this.animations.resetKey("own-draw-entry");
    const handRevealKey = String(ui.handRevealKey || "");
    if (
      handRevealKey &&
      handRevealKey === this.activeHandRevealKey &&
      this.animations.has("hand-reveal")
    ) {
      this.state = state;
      this.ui = { ...this.ui, ...ui };
      return;
    }
    this.animateHandReveal = this.animations.claim(
      "hand-reveal",
      handRevealKey,
      ui.animateHandReveal,
    );
    if (!handRevealKey) this.animations.resetKey("hand-reveal");
    const dealInKey = String(ui.dealInKey || "");
    this.animateDealIn = this.animations.claim(
      "new-hand-deal",
      dealInKey,
      ui.animateDealIn,
    );
    if (!dealInKey) this.animations.resetKey("new-hand-deal");
    this.state = state;
    this.ui = ui;
    this.showGameHints = ui.showGameHints !== false;
    this.highlightedType =
      this.showGameHints && Number(ui.selectedTileId) > 0
        ? tileType(ui.selectedTileId)
        : 0;
    this.doraCounts = doraTypeCounts(state);
    this.pickableTiles.length = 0;
    this.cancelHandReveal();
    this.cancelOwnHandCrossfade();
    this.cancelOwnDrawEntry();
    this.cancelOwnTileMotion();
    this.cancelDealIn();
    this.pendingOwnDrawEntryTile = null;
    this.revealTiles.length = 0;
    this.dealInTiles.length = 0;
    // Keep the mesh's current height when a selection transition is
    // interrupted; reconciliation below uses it as the next animation origin.
    this.hoveredTile = null;
    this.tileFactory.beginFrame();
    clearGroup(this.layers.hands);
    clearGroup(this.layers.melds);
    this.activeOwnTileIds.clear();
    this.highlightableTiles.clear();
    this.tableConsole.update(state, ui);
    this.drawHands(state, ui.selectedTileId);
    if (!this.pendingOwnHandCrossfade) this.pruneOwnTiles();
    this.drawRivers(state);
    this.drawMelds(state);
    this.syncDoraBreathing();
    this.actionCallout.showLatest(
      events,
      `${state.roundWind}:${state.handNumber}:${state.honba}:${state.moveCount}`,
    );
    this.renderer.shadowMap.needsUpdate = true;
    this.drawFrame();
    const revealDelay = ui.delayHandRevealForCallout
      ? ACTION_CALLOUT_DURATION_MS
      : 0;
    const handRevealDelay = Math.max(0, Number(ui.handRevealDelay) || 0);
    const crossfadesOwnHand = Boolean(this.pendingOwnHandCrossfade);
    if (this.pendingOwnDrawEntryTile) this.startOwnDrawEntry();
    if (this.ownTileMotions.length) this.startOwnTileMotion();
    if (this.pendingOwnHandCrossfade) {
      this.startOwnHandCrossfade(revealDelay);
    }
    if (this.animateHandReveal && this.revealTiles.length) {
      this.startHandReveal(
        handRevealStartDelay(
          Math.max(revealDelay, handRevealDelay),
          crossfadesOwnHand,
        ),
        handRevealKey,
      );
    }
    if (this.animateDealIn && this.dealInTiles.length) this.startDealIn();
  }

  updateSelection(ui) {
    if (!this.ready || !this.state) {
      if (this.pendingRender) {
        this.pendingRender[2] = { ...this.pendingRender[2], ...ui };
      }
      return;
    }
    this.ui = { ...this.ui, ...ui };
    this.showGameHints = this.ui.showGameHints !== false;
    this.highlightedType =
      this.showGameHints && Number(this.ui.selectedTileId) > 0
        ? tileType(this.ui.selectedTileId)
        : 0;
    this.cancelOwnTileMotion();
    this.queueOwnTileMotions();
    this.updateTypeHighlights();
    this.drawFrame();
    if (this.ownTileMotions.length) this.startOwnTileMotion();
  }

  prepareDealIn() {
    if (!this.ready) return;
    this.cancelOwnHandCrossfade();
    this.cancelOwnDrawEntry();
    this.cancelOwnTileMotion();
    this.cancelDrag(false);
    for (const { tile } of this.ownTileRecords.values()) {
      this.ownHandLayer.remove(tile);
    }
    this.ownTileRecords.clear();
    this.activeOwnTileIds.clear();
    this.pickableTiles.length = 0;
    this.drawFrame();
  }

  updateTypeHighlights() {
    const selectedTileId = Number(this.ui?.selectedTileId) || 0;
    for (const tile of this.highlightableTiles) {
      this.tileFactory.setMatchHighlight(
        tile,
        this.highlightedType > 0 &&
          Number(tile.userData.type) === this.highlightedType &&
          Number(tile.userData.tileId) !== selectedTileId,
      );
    }
  }

  syncDoraBreathing() {
    if (!this.tileFactory.hasDoraTiles()) {
      this.tileFactory.setDoraGlowIntensity(0);
      this.animations.cancel("dora-breath");
      return;
    }
    // Redrawing after any discard must not replace this repeating track: doing
    // so resets its phase and makes every visible dora flash back to the start.
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

  createTile(options) {
    const tile = this.tileFactory.create(options);
    if (tile.userData.matchHighlight) this.highlightableTiles.add(tile);
    return tile;
  }

  drawHands(state, selectedTileId) {
    const rack = asArray(state.ownHand);
    const drawn = Number(state.drawnTile) || null;
    const revealSeats = new Set(
      asArray(this.ui?.revealPlayerIndices).map(Number),
    );
    const coveredSeats = new Set(
      asArray(this.ui?.coveredPlayerIndices).map(Number),
    );
    const animateReveal = this.animateHandReveal === true;
    const crossfadeOwnHand = shouldCrossfadeOwnHand({
      revealed: revealSeats.has(1),
      covered: coveredSeats.has(1),
      animated: animateReveal,
      hasOverlay: this.ownTileRecords.size > 0,
    });
    if (crossfadeOwnHand) this.prepareOwnHandCrossfade();
    const forbiddenTypes = new Set(
      asArray(state.legalActions?.forbiddenDiscardTypes),
    );
    const riichiMode = this.ui?.riichiMode === true;
    const riichiTiles = new Set(
      asArray(this.ui?.riichiCandidateTiles).map(Number),
    );
    const riichiDeclared = state.riichi?.[state.players?.[0]] === true;
    const ownInsertionDeferred =
      Number(this.ui?.deferredHandInsertionSeat) === 1;
    const deferredOwnRackIndex = Math.max(
      0,
      Math.min(rack.length, Number(this.ui?.deferredHandInsertionIndex) || 0),
    );
    if (revealSeats.has(1) || coveredSeats.has(1)) {
      this.addPresentedHand(state, "bottom", state.players[0], 1, {
        covered: coveredSeats.has(1),
        animate: animateReveal,
        crossfade: crossfadeOwnHand,
      });
    } else {
      rack.forEach((tileId, index) => {
        const slotIndex =
          ownInsertionDeferred && index >= deferredOwnRackIndex
            ? index + 1
            : index;
        this.addOwnTile(
          tileId,
          slotIndex,
          false,
          selectedTileId,
          canDiscardHandTile({
            canDiscard: state.legalActions?.canDiscard,
            riichiDeclared,
            drawnTile: drawn,
            tileId,
          }) &&
            !forbiddenTypes.has(tileType(tileId)) &&
            (!riichiMode || riichiTiles.has(tileId)),
          riichiMode && !riichiTiles.has(tileId),
        );
      });
      if (drawn != null) {
        this.addOwnTile(
          drawn,
          rack.length + (ownInsertionDeferred ? 1 : 0),
          true,
          selectedTileId,
          canDiscardHandTile({
            canDiscard: state.legalActions?.canDiscard,
            riichiDeclared,
            drawnTile: drawn,
            tileId: drawn,
          }) &&
            !forbiddenTypes.has(tileType(drawn)) &&
            (!riichiMode || riichiTiles.has(drawn)),
          riichiMode && !riichiTiles.has(drawn),
          this.animateOwnDrawEntry,
        );
      }
    }

    for (let seat = 2; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const playerId = state.players[seat - 1];
      const revealWinner =
        state.phase === "hand_ended" &&
        state.winType !== "nagashi" &&
        asArray(state.winners).includes(playerId);
      if (revealWinner || revealSeats.has(seat) || coveredSeats.has(seat)) {
        this.addPresentedHand(state, position, playerId, seat, {
          covered: coveredSeats.has(seat),
          animate:
            (revealSeats.has(seat) || coveredSeats.has(seat)) && animateReveal,
        });
        continue;
      }
      const count = Number(state.handCounts?.[playerId] || 0);
      const meldCount = asArray(state.melds?.[playerId]).length;
      const insertionDeferred =
        Number(this.ui?.deferredHandInsertionSeat) === seat;
      const layout = opponentHandLayout(
        Math.max(0, count - (insertionDeferred ? 1 : 0)),
        meldCount,
        Number(state.drawnPlayerIndex) === seat || insertionDeferred,
      );
      const deferredIndex = Math.max(
        0,
        Math.min(
          layout.rackCount,
          Number(this.ui?.deferredHandInsertionIndex) || 0,
        ),
      );
      const rackSlots = insertionDeferred
        ? Array.from(
            { length: layout.rackCount + 1 },
            (_, index) => index,
          ).filter((index) => index !== deferredIndex)
        : Array.from({ length: layout.rackCount }, (_, index) => index);
      for (const index of rackSlots) {
        const transform = handTransform(position, index, layout.rackCapacity);
        this.addConcealedHandTile(transform);
      }
      if (layout.hasDrawn) {
        const transform = handTransform(
          position,
          layout.rackCapacity,
          layout.rackCapacity,
          { drawn: true },
        );
        this.addConcealedHandTile(transform);
      }
    }
  }

  addConcealedHandTile(transform) {
    if (!this.animateDealIn) {
      const tile = this.createTile({ concealed: true });
      applyStandingTransform(tile, transform);
      this.layers.hands.add(tile);
      return;
    }
    const slot = new Group();
    slot.position.set(transform.x, 0, transform.z);
    slot.rotation.y = transform.yaw;
    const tile = this.createTile({ concealed: true });
    // A newly dealt closed tile rises by undoing the same edge-hinged motion
    // used when a tile is covered. Keeping the lower edge on the felt avoids
    // the weightless centre-axis spin of the first implementation.
    const hingeTransform = presentedTileHingeTransform(true);
    const hinge = new Group();
    hinge.position.z = hingeTransform.pivotZ;
    hinge.rotation.x = hingeTransform.restingRotationX;
    tile.position.set(0, hingeTransform.tileY, hingeTransform.tileZ);
    hinge.add(tile);
    slot.add(hinge);
    this.layers.hands.add(slot);
    this.dealInTiles.push({
      kind: "stand",
      hinge,
      restingRotationX: hingeTransform.restingRotationX,
    });
  }

  startDealIn() {
    const animation = this.dealInTiles;
    this.dealInAnimation = animation;
    this.animations.play({
      id: "new-hand-deal",
      duration: NEW_HAND_DEAL_DURATION_MS,
      update: (progress) => {
        if (this.dealInAnimation !== animation) return;
        const eased = newHandDealProgress(progress);
        for (const entry of animation) {
          if (entry.kind === "fade") {
            setFadedTileOpacity(entry.materials, eased);
            continue;
          }
          entry.hinge.rotation.x = entry.restingRotationX * (1 - eased);
        }
      },
      complete: () => this.finishDealIn(animation),
    });
  }

  cancelDealIn() {
    this.animations.cancel("new-hand-deal");
    if (this.dealInAnimation) this.finishDealIn(this.dealInAnimation);
  }

  finishDealIn(animation) {
    for (const entry of animation) {
      if (entry.kind === "fade") {
        setFadedTileOpacity(entry.materials, 1);
        restoreTileMaterials(entry.materials);
        continue;
      }
      entry.hinge.rotation.x = 0;
    }
    if (this.dealInAnimation === animation) this.dealInAnimation = null;
  }

  addPresentedHand(
    state,
    position,
    playerId,
    seat,
    { covered, animate, crossfade = false },
  ) {
    const { rack, drawn } = splitRevealedHand(state, playerId, seat);
    rack.forEach((tile, index) => {
      this.addPresentedTableTile(position, tile, index, false, {
        seat,
        covered,
        animate,
        crossfade,
      });
    });
    if (drawn) {
      this.addPresentedTableTile(position, drawn, rack.length, true, {
        seat,
        covered,
        animate,
        crossfade,
      });
    }
  }

  addPresentedTableTile(
    position,
    tileInfo,
    index,
    drawn,
    { seat, covered, animate, crossfade = false },
  ) {
    const transform = presentedHandTransform(position, index, index, {
      drawn,
      covered,
    });
    // A covered local hand falls face-down onto the table. Keep its face mesh
    // for that motion so the player sees their own tiles turn over; its final
    // orientation still leaves the face against the table. Other seats never
    // receive their concealed faces.
    const concealFace = covered && seat !== 1;
    const slot = new Group();
    slot.position.set(transform.x, 0, transform.z);
    slot.rotation.y = transform.yaw;
    const tile = this.createTile({
      type: tileInfo.type,
      red: tileInfo.red,
      concealed: concealFace,
      dora:
        this.showGameHints &&
        !covered &&
        this.doraCounts.has(Number(tileInfo.type)),
    });
    const hingeTransform = presentedTileHingeTransform(covered);
    const hinge = new Group();
    hinge.position.z = hingeTransform.pivotZ;
    tile.position.set(0, hingeTransform.tileY, hingeTransform.tileZ);
    if (crossfade && this.pendingOwnHandCrossfade) {
      this.pendingOwnHandCrossfade.tableMaterials.push(
        ...cloneTileMaterialsForFade(tile),
      );
    }
    hinge.add(tile);
    slot.add(hinge);
    this.layers.hands.add(slot);
    if (animate) {
      this.revealTiles.push({ hinge, delay: 0, covered });
      return;
    }
    settlePresentedTile(hinge, covered);
  }

  startHandReveal(delay = 0, key = "") {
    const revealTiles = this.revealTiles;
    this.activeHandRevealKey = key;
    this.animations.play({
      id: "hand-reveal",
      delay,
      duration: HAND_REVEAL_FALL_DURATION_MS,
      update: (progress) => {
        for (const { hinge, covered } of revealTiles) {
          const eased = handRevealFallProgress(progress);
          const { restingRotationX } = presentedTileHingeTransform(covered);
          hinge.rotation.x = restingRotationX * eased;
        }
      },
      complete: () => {
        if (this.activeHandRevealKey !== key) return;
        this.callbacks?.onHandRevealComplete?.(key);
      },
    });
  }

  cancelHandReveal() {
    this.animations.cancel("hand-reveal");
    this.activeHandRevealKey = "";
  }

  prepareOwnHandCrossfade() {
    const overlayTiles = [];
    for (const [tileId, record] of this.ownTileRecords) {
      overlayTiles.push({
        tileId,
        tile: record.tile,
        materials: cloneTileMaterialsForFade(record.tile, 1),
      });
    }
    this.pendingOwnHandCrossfade = {
      overlayTiles,
      tableMaterials: [],
    };
  }

  startOwnHandCrossfade(delay = 0) {
    const animation = this.pendingOwnHandCrossfade;
    this.pendingOwnHandCrossfade = null;
    if (!animation) return;
    this.ownHandCrossfade = animation;
    this.animations.play({
      id: "own-hand-crossfade",
      delay,
      duration: OWN_HAND_CROSSFADE_DURATION_MS,
      update: (progress) => {
        if (this.ownHandCrossfade !== animation) return;
        const eased = ownHandCrossfadeProgress(progress);
        for (const entry of animation.overlayTiles) {
          setFadedTileOpacity(entry.materials, 1 - eased);
        }
        setFadedTileOpacity(animation.tableMaterials, eased);
      },
      complete: () => this.finishOwnHandCrossfade(animation),
    });
  }

  cancelOwnHandCrossfade() {
    this.animations.cancel("own-hand-crossfade");
    const animation = this.ownHandCrossfade || this.pendingOwnHandCrossfade;
    if (animation) this.finishOwnHandCrossfade(animation);
    this.pendingOwnHandCrossfade = null;
  }

  finishOwnHandCrossfade(animation) {
    setFadedTileOpacity(animation.tableMaterials, 1);
    restoreTileMaterials(animation.tableMaterials);
    for (const entry of animation.overlayTiles) {
      restoreTileMaterials(entry.materials);
      this.ownHandLayer.remove(entry.tile);
      if (this.ownTileRecords.get(entry.tileId)?.tile === entry.tile) {
        this.ownTileRecords.delete(entry.tileId);
      }
    }
    if (this.ownHandCrossfade === animation) this.ownHandCrossfade = null;
    if (this.pendingOwnHandCrossfade === animation) {
      this.pendingOwnHandCrossfade = null;
    }
  }

  addOwnTile(
    tileId,
    index,
    drawn,
    selectedTileId,
    discardable = true,
    dimmed = false,
    animateEntry = false,
  ) {
    const transform = ownHandOverlayTransform(
      index,
      this.viewport.width,
      this.viewport.height,
      { drawn },
    );
    const visualState = {
      type: tileType(tileId),
      red: isRedFive(tileId),
      tileId,
      highlight:
        Number(tileId) === Number(selectedTileId)
          ? ""
          : this.highlightedType === tileType(tileId)
            ? "match"
            : "",
      dora: this.showGameHints && this.doraCounts.has(tileType(tileId)),
      dimmed,
    };
    const visualKey = JSON.stringify({ ...visualState, highlight: undefined });
    const previousRecord = this.ownTileRecords.get(Number(tileId));
    const previousY = previousRecord?.tile.position.y;
    let record = previousRecord;
    const reusesExistingTile = record?.visualKey === visualKey;
    if (!record || record.visualKey !== visualKey) {
      const tile = this.createTile(visualState);
      if (record) this.ownHandLayer.remove(record.tile);
      this.ownHandLayer.add(tile);
      record = { tile, visualKey };
      this.ownTileRecords.set(Number(tileId), record);
      if (this.animateDealIn) {
        // The local hand is rendered by the orthographic overlay, so a fade
        // does not interfere with the tabletop's physical light or shadows.
        const materials = cloneTileMaterialsForFade(tile);
        setFadedTileOpacity(materials, 0);
        this.dealInTiles.push({ kind: "fade", materials });
      }
    }
    if (reusesExistingTile && visualState.dora) this.tileFactory.trackDoraTile();
    const { tile } = record;
    this.highlightableTiles.add(tile);
    this.tileFactory.setMatchHighlight(tile, visualState.highlight === "match");
    const targetY =
      transform.y +
      (Number(tileId) === Number(selectedTileId) ? transform.lift : 0);
    tile.position.set(transform.x, previousY ?? targetY, transform.z);
    tile.rotation.x = transform.tilt;
    tile.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
    tile.userData.baseX = transform.x;
    tile.userData.baseY = transform.y;
    tile.userData.lift = transform.lift;
    tile.userData.discardable = discardable;
    this.activeOwnTileIds.add(Number(tileId));
    this.pickableTiles.push(tile);
    if (animateEntry && !previousRecord) {
      tile.position.y = targetY;
      this.prepareOwnDrawEntry(tile);
    } else if (previousY != null && Math.abs(previousY - targetY) > 0.01) {
      this.ownTileMotions.push({ tile, fromY: previousY, targetY });
    } else {
      tile.position.y = targetY;
    }
  }

  pruneOwnTiles() {
    for (const [tileId, record] of this.ownTileRecords) {
      if (this.activeOwnTileIds.has(tileId)) continue;
      this.ownHandLayer.remove(record.tile);
      this.ownTileRecords.delete(tileId);
    }
  }

  ownTileTargetY(tileId, tile) {
    const selected = Number(tileId) === Number(this.ui?.selectedTileId);
    const hovered = tile === this.hoveredTile;
    return (
      tile.userData.baseY +
      (selected ? tile.userData.lift : hovered ? OWN_TILE_HOVER_LIFT : 0)
    );
  }

  queueOwnTileMotions() {
    for (const [tileId, { tile }] of this.ownTileRecords) {
      const targetY = this.ownTileTargetY(tileId, tile);
      if (Math.abs(tile.position.y - targetY) <= 0.01) continue;
      this.ownTileMotions.push({
        tile,
        fromY: tile.position.y,
        targetY,
      });
    }
  }

  startOwnTileMotion(duration = OWN_TILE_SELECTION_DURATION_MS) {
    const motions = this.ownTileMotions;
    if (!motions.length) return;
    this.animations.play({
      id: "own-tile-motion",
      duration,
      update: (progress) => {
        if (this.ownTileMotions !== motions) return;
        const eased = ownTileSelectionProgress(progress);
        for (const motion of motions) {
          motion.tile.position.y =
            motion.fromY + (motion.targetY - motion.fromY) * eased;
        }
      },
      complete: () => {
        if (this.ownTileMotions === motions) this.ownTileMotions = [];
      },
    });
  }

  cancelOwnTileMotion() {
    this.animations.cancel("own-tile-motion");
    this.ownTileMotions = [];
  }

  prepareOwnDrawEntry(tile) {
    const targetY = tile.position.y;
    tile.position.y += tile.userData.lift;
    const materials = cloneTileMaterialsForFade(tile);
    setFadedTileOpacity(materials, 0);
    this.pendingOwnDrawEntryTile = { tile, targetY, materials };
  }

  startOwnDrawEntry() {
    const animation = this.pendingOwnDrawEntryTile;
    this.pendingOwnDrawEntryTile = null;
    if (!animation) return;
    this.ownDrawAnimation = animation;
    this.animations.play({
      id: "own-draw-entry",
      duration: OWN_DRAW_ENTRY_DURATION_MS,
      update: (progress) => {
        if (this.ownDrawAnimation !== animation) return;
        const eased = ownDrawEntryProgress(progress);
        animation.tile.position.y =
          animation.targetY + animation.tile.userData.lift * (1 - eased);
        setFadedTileOpacity(animation.materials, eased);
      },
      complete: () => this.finishOwnDrawEntry(animation),
    });
  }

  cancelOwnDrawEntry() {
    this.animations.cancel("own-draw-entry");
    if (this.ownDrawAnimation) this.finishOwnDrawEntry(this.ownDrawAnimation);
  }

  finishOwnDrawEntry(animation) {
    animation.tile.position.y = animation.targetY;
    restoreTileMaterials(animation.materials);
    if (this.ownDrawAnimation === animation) this.ownDrawAnimation = null;
  }

  drawRivers(state) {
    const riverEntries = [];
    for (let seat = 1; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const river = asArray(state.discards?.[state.players[seat - 1]]);
      const entries = riverDisplayEntries(river);
      const riichiColumns = new Map();
      entries.forEach(({ discard, displayIndex }) => {
        if (discard.riichi === true) {
          const { column, row } = riverGridPosition(displayIndex);
          riichiColumns.set(row, column);
        }
      });
      entries.forEach(({ discard, sourceIndex, displayIndex }) => {
        const { row } = riverGridPosition(displayIndex);
        const transform = riverTransform(
          position,
          displayIndex,
          discard.riichi === true,
          {
            riichiColumn: riichiColumns.get(row) ?? -1,
          },
        );
        const dora =
          this.showGameHints && this.doraCounts.has(Number(discard.type));
        const highlight =
          this.highlightedType === Number(discard.type) ? "match" : "";
        riverEntries.push({
          key: `${seat}:${sourceIndex}`,
          transform,
          jitter: planarTileJitter(
            `${seat}:river:${sourceIndex}:${discard.type}`,
            RIVER_TILE_GAP,
            { width: TILE_SIZE.width, height: TILE_SIZE.height },
          ),
          options: {
            type: discard.type,
            red: discard.red === true,
            highlight,
            dora,
            tsumogiri: this.showGameHints && discard.tsumogiri === true,
          },
          visualKey: `${discard.type}:${discard.red === true}:${dora}:${this.showGameHints && discard.tsumogiri === true}`,
        });
      });
    }
    this.riverLayer.reconcile(riverEntries, {
      keyOf: (entry) => entry.key,
      create: (entry) => this.createRiverRecord(entry),
      update: (record, entry, lifecycle) =>
        this.updateRiverRecord(record, entry, lifecycle),
    });
  }

  createRiverRecord(entry) {
    const slot = new Group();
    const tile = this.createTile(entry.options);
    tile.rotation.x = -Math.PI / 2;
    slot.add(tile);
    return { node: slot, tile, visualKey: entry.visualKey };
  }

  updateRiverRecord(record, entry, { created }) {
    if (!created && record.visualKey !== entry.visualKey) {
      record.node.remove(record.tile);
      record.tile = this.createTile(entry.options);
      record.tile.rotation.x = -Math.PI / 2;
      record.node.add(record.tile);
      record.visualKey = entry.visualKey;
    } else if (!created && entry.options.dora) {
      // The factory counts dora on creation; retained tiles must be counted on
      // later snapshots so the shared breathing track stays alive.
      this.tileFactory.trackDoraTile();
    }
    this.highlightableTiles.add(record.tile);
    this.tileFactory.setMatchHighlight(
      record.tile,
      entry.options.highlight === "match",
    );
    record.node.position.set(
      entry.transform.x,
      entry.transform.y,
      entry.transform.z,
    );
    record.node.rotation.y = entry.transform.yaw;
    applyPlanarJitter(record.node, entry.transform.yaw, entry.jitter);
  }

  drawMelds(state) {
    for (let seat = 1; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const melds = asArray(state.melds?.[state.players[seat - 1]]);
      const rightExtension = meldRightExtension(melds, seat);
      let alongOffset = 0;
      for (const meld of melds) {
        const display = meldDisplayLayout(meld, seat);
        display.entries.forEach((entry) => {
          const transform = meldTransform(
            position,
            alongOffset + entry.along - rightExtension,
            { absolute: true, inwardOffset: entry.inward },
          );
          const slot = new Group();
          slot.position.set(transform.x, transform.y, transform.z);
          slot.rotation.y = transform.yaw + (entry.sideways ? Math.PI / 2 : 0);
          slot.scale.setScalar(MELD_SCALE);
          const tile = this.createTile({
            type: entry.type,
            red: entry.red,
            concealed: entry.faceDown,
            highlight:
              !entry.faceDown && this.highlightedType === Number(entry.type)
                ? "match"
                : "",
            dora:
              this.showGameHints &&
              !entry.faceDown &&
              this.doraCounts.has(Number(entry.type)),
          });
          tile.rotation.x = entry.faceDown ? Math.PI / 2 : -Math.PI / 2;
          slot.add(tile);
          this.layers.melds.add(slot);
        });
        alongOffset += display.span + MELD_GROUP_GAP;
      }
    }
  }

  handlePointerDown(event) {
    const tile = this.pickTile(event);
    const tileId = Number(tile?.userData.tileId || 0);
    if (
      !tileId ||
      !this.state?.legalActions?.canDiscard ||
      !tile.userData.discardable
    )
      return;
    event.preventDefault();
    this.cancelDrag(false);
    // Freeze the currently rendered hover height. A click or drag continues
    // from this exact position, even when the hover transition is mid-frame.
    this.cancelOwnTileMotion();
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const pointer = this.pointerToOverlay(event, bounds);
    this.dragState = {
      tile,
      tileId,
      pointerId: event.pointerId,
      bounds,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: pointer.x,
      startY: pointer.y,
      homeX: tile.position.x,
      homeY: tile.position.y,
      moved: false,
      crossed: false,
    };
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  handlePointerMove(event) {
    if (this.dragState && event.pointerId === this.dragState.pointerId) {
      const drag = this.dragState;
      const clientDistance = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (!drag.moved && clientDistance < OWN_HAND_DRAG.activationDistance)
        return;
      if (!drag.moved) {
        drag.moved = true;
        this.callbacks.onPreviewDragTile?.(drag.tileId);
      }
      const pointer = this.pointerToOverlay(event, drag.bounds);
      drag.tile.position.x = drag.homeX + pointer.x - drag.startX;
      drag.tile.position.y = drag.homeY + Math.max(0, pointer.y - drag.startY);
      drag.crossed =
        this.viewport.height / 2 - pointer.y <= OWN_HAND_DRAG.discardLineY;
      this.renderer.domElement.style.cursor = "grabbing";
      this.drawFrame();
      return;
    }
    const tile = this.pickTile(event);
    // Selection is available while waiting too. Only pointer-down starts a
    // drag, so hover and the cursor should advertise selection independently
    // from whether this turn may discard.
    this.setHoveredTile(tile);
    this.renderer.domElement.style.cursor = tile
      ? "pointer"
      : "default";
  }

  handlePointerUp(event) {
    const drag = this.dragState;
    if (drag && event.pointerId === drag.pointerId) {
      const { crossed, moved, tileId } = drag;
      this.cancelDrag(false);
      const canDiscard = this.state?.legalActions?.canDiscard === true;
      const hovered = canDiscard ? this.pickTile(event) : null;
      this.setHoveredTile(hovered, moved);
      this.renderer.domElement.style.cursor = hovered ? "pointer" : "default";
      if (!canDiscard) return;
      if (moved) {
        if (crossed) this.callbacks.onDiscardTile(tileId);
        return;
      }
      this.handleTileTap(tileId, true);
      return;
    }
    const tile = this.pickTile(event);
    const tileId = Number(tile?.userData.tileId || 0);
    if (!tileId) {
      this.lastTap = { tileId: 0, time: 0 };
      if (!this.pickTableTile(event)) this.callbacks.onClearSelection?.();
      return;
    }
    this.handleTileTap(tileId, tile.userData.discardable === true);
  }

  handleTileTap(tileId, discardable) {
    const now = performance.now();
    if (
      discardable &&
      this.state?.legalActions?.canDiscard &&
      this.lastTap.tileId === tileId &&
      now - this.lastTap.time < 340
    ) {
      this.callbacks.onDiscardTile(tileId);
      this.lastTap = { tileId: 0, time: 0 };
      return;
    }
    this.lastTap = { tileId, time: now };
    this.callbacks.onSelectTile(tileId);
  }

  handleDoubleClick(event) {
    if (this.pickTile(event) || this.pickTableTile(event)) return;
    const pointer = this.pointerToOverlay(event);
    const safeBounds = ownHandDoubleClickSafeBounds(
      this.viewport.width,
      this.viewport.height,
    );
    if (
      pointer.x >= safeBounds.left &&
      pointer.x <= safeBounds.right &&
      pointer.y >= safeBounds.bottom &&
      pointer.y <= safeBounds.top
    )
      return;
    this.callbacks.onDoubleClickBlank?.();
  }

  handlePointerLeave() {
    if (!this.dragState) this.setHoveredTile(null);
  }

  pointerToOverlay(
    event,
    bounds = this.renderer.domElement.getBoundingClientRect(),
  ) {
    return {
      x:
        ((event.clientX - bounds.left) / bounds.width - 0.5) *
        this.viewport.width,
      y:
        (0.5 - (event.clientY - bounds.top) / bounds.height) *
        this.viewport.height,
    };
  }

  cancelDrag(redraw = true) {
    const drag = this.dragState;
    if (drag?.tile?.parent) {
      drag.tile.position.x = drag.homeX;
      drag.tile.position.y = drag.homeY;
    }
    if (drag && this.renderer?.domElement.hasPointerCapture?.(drag.pointerId)) {
      this.renderer.domElement.releasePointerCapture(drag.pointerId);
    }
    this.dragState = null;
    if (drag?.moved) this.callbacks.onEndDragPreview?.();
    if (drag && this.renderer?.domElement)
      this.renderer.domElement.style.cursor = "default";
    if (redraw) this.drawFrame();
  }

  pickTile(event) {
    if (!this.pickableTiles.length) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.overlayCamera);
    const hit = this.raycaster.intersectObjects(this.pickableTiles, true)[0];
    return hit?.object?.userData.tileRoot ?? null;
  }

  pickTableTile(event) {
    if (!this.layers || !this.camera) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(
      [this.layers.hands, this.layers.rivers, this.layers.melds],
      true,
    )[0];
    return hit?.object?.userData.tileRoot ?? null;
  }

  setHoveredTile(tile, force = false) {
    if (!force && this.hoveredTile === tile) return;
    this.hoveredTile = tile?.parent ? tile : null;
    this.cancelOwnTileMotion();
    this.queueOwnTileMotions();
    this.drawFrame();
    if (this.ownTileMotions.length) {
      this.startOwnTileMotion(OWN_TILE_HOVER_DURATION_MS);
    }
  }

  drawFrame() {
    if (
      this.contextLost ||
      this.destroyed ||
      !this.renderer ||
      !this.scene ||
      !this.camera
    )
      return;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.overlayCamera);
  }

  resume() {
    if (!this.ready || this.contextLost || this.destroyed) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.shadowMap.needsUpdate = true;
    this.tableConsole.restore(this.state, this.ui);
    this.resize();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelHandReveal();
    this.cancelOwnHandCrossfade();
    this.cancelOwnDrawEntry();
    this.cancelOwnTileMotion();
    this.cancelDrag(false);
    this.riverLayer?.clear();
    this.renderer?.domElement.removeEventListener(
      "pointerdown",
      this.onPointerDown,
    );
    this.renderer?.domElement.removeEventListener(
      "pointermove",
      this.onPointerMove,
    );
    this.renderer?.domElement.removeEventListener(
      "pointerleave",
      this.onPointerLeave,
    );
    this.renderer?.domElement.removeEventListener(
      "pointerup",
      this.onPointerUp,
    );
    this.renderer?.domElement.removeEventListener(
      "pointercancel",
      this.onPointerCancel,
    );
    this.renderer?.domElement.removeEventListener(
      "dblclick",
      this.onDoubleClick,
    );
    this.renderer?.domElement.removeEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.renderer?.domElement.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.tileFactory?.destroy();
    this.actionCallout?.destroy();
    this.animations.destroy();
    this.tableConsole?.destroy();
    this.table?.destroy();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

function applyPlanarJitter(slot, yaw, jitter) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  slot.position.x += jitter.along * cos + jitter.across * sin;
  slot.position.z += -jitter.along * sin + jitter.across * cos;
  slot.rotation.y += jitter.yaw;
}

function settlePresentedTile(hinge, covered = false) {
  hinge.rotation.x = presentedTileHingeTransform(covered).restingRotationX;
}

function applyStandingTransform(tile, transform) {
  tile.position.set(transform.x, transform.y, transform.z);
  tile.rotation.y = transform.yaw;
}

function cloneTileMaterialsForFade(tile, initialOpacity = 0) {
  const records = [];
  tile.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const sourceMaterial = object.material;
    const sources = Array.isArray(sourceMaterial)
      ? sourceMaterial
      : [sourceMaterial];
    const clones = sources.map((source) => {
      const clone = source.clone();
      clone.transparent = true;
      clone.depthWrite = false;
      clone.opacity = source.opacity * initialOpacity;
      clone.needsUpdate = true;
      return clone;
    });
    object.material = Array.isArray(sourceMaterial) ? clones : clones[0];
    records.push({
      object,
      sourceMaterial,
      cloneMaterial: object.material,
      targetOpacities: sources.map((source) => source.opacity),
      castShadow: object.castShadow,
    });
  });
  return records;
}

function setFadedTileOpacity(records, value) {
  const opacity = Math.max(0, Math.min(1, Number(value) || 0));
  for (const record of records) {
    const materials = Array.isArray(record.cloneMaterial)
      ? record.cloneMaterial
      : [record.cloneMaterial];
    materials.forEach((material, index) => {
      material.opacity = record.targetOpacities[index] * opacity;
    });
    // WebGL shadow maps are binary: a threshold half way through a fade makes
    // a full-strength shadow visibly pop in. Enable it on the first rendered
    // fade frame instead, while the tile is still effectively invisible.
    record.object.castShadow = record.castShadow && opacity > 0;
  }
}

function restoreTileMaterials(records) {
  for (const record of records) {
    record.object.material = record.sourceMaterial;
    record.object.castShadow = record.castShadow;
    const materials = Array.isArray(record.cloneMaterial)
      ? record.cloneMaterial
      : [record.cloneMaterial];
    for (const material of materials) material.dispose();
  }
}

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}
