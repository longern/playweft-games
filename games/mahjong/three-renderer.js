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
import feltSkinUrl from "./assets/felt-skin-moonwave-v1.jpg?url";
import feltTextureUrl from "./assets/felt-texture-v1.jpg?url";
import { POSITIONS } from "./constants.js";
import { MAHJONG_VIEWPORT } from "./fixed-viewport.js";
import {
  asArray,
  doraTypeCounts,
  isRedFive,
  opponentHandLayout,
  splitRevealedHand,
  tileType,
} from "./game-format.js";
import {
  handTransform,
  MELD_GROUP_GAP,
  MELD_SCALE,
  meldDisplayLayout,
  meldRightExtension,
  meldTransform,
  ownHandOverlayTransform,
  OWN_HAND_DRAG,
  RIVER_TILE_GAP,
  riverTransform,
  TILE_SIZE,
} from "./render/three-layout.js";
import { planarTileJitter } from "./render/three-tile-jitter.js";
import {
  ACTION_CALLOUT_DURATION_MS,
  ThreeActionCallout,
} from "./render/three-callout.js";
import { ThreeTileFactory } from "./render/three-tile-factory.js";
import { ThreeTableConsole } from "./render/three-console.js";
import { ThreeMahjongTable } from "./render/three-table.js";

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
    this.animationFrame = 0;
    this.dragState = null;
    this.lastTap = { tileId: 0, time: 0 };
    this.contextLost = false;
    this.destroyed = false;
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
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(33, MAHJONG_VIEWPORT.aspect, 0.1, 80);
    this.camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
    this.camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);

    this.overlayScene = new Scene();
    this.overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.overlayCamera.position.set(0, 0, 1000);
    this.overlayCamera.lookAt(0, 0, 0);
    this.ownHandLayer = new Group();
    this.overlayScene.add(this.ownHandLayer);
    this.actionCallout = new ThreeActionCallout(() => this.drawFrame());
    this.overlayScene.add(this.actionCallout.sprite);

    this.tableConsole = new ThreeTableConsole({
      anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    });
    this.scene.add(this.tableConsole.group);

    const textureLoader = new TextureLoader();
    await document.fonts?.load?.(
      `400 300px "Playweft Mahjong Xingshu"`,
      "吃碰杠立直和自摸",
    );
    const [faceAtlas, feltSkin, feltTexture] = await Promise.all([
      textureLoader.loadAsync(tileFacesUrl),
      textureLoader.loadAsync(feltSkinUrl),
      textureLoader.loadAsync(feltTextureUrl),
    ]);

    this.addLighting();
    this.addOverlayLighting();
    this.table = new ThreeMahjongTable({
      anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
      feltTexture: feltSkin,
      feltBumpTexture: feltTexture,
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

    faceAtlas.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.tileFactory = new ThreeTileFactory(faceAtlas);

    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerLeave = () => this.handlePointerLeave();
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onPointerCancel = () => this.cancelDrag();
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.onPointerLeave);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.onPointerCancel);

    this.resize();
    this.ready = true;
    if (this.pendingRender) this.render(...this.pendingRender);
    else this.drawFrame();
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
    this.scene.add(overheadFill, overheadFill.target, overhead, overhead.target);
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
    const viewportChanged = width !== this.viewport?.width || height !== this.viewport?.height;
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
    if (viewportChanged && this.ready && this.state && this.ui) {
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
    this.state = state;
    this.ui = ui;
    this.highlightedType = Number(ui.selectedTileId) > 0 ? tileType(ui.selectedTileId) : 0;
    this.doraCounts = doraTypeCounts(state);
    this.pickableTiles.length = 0;
    this.cancelHandReveal();
    this.revealTiles.length = 0;
    this.setHoveredTile(null);
    Object.values(this.layers).forEach(clearGroup);
    clearGroup(this.ownHandLayer);
    this.tableConsole.update(state, ui);
    this.drawHands(state, ui.selectedTileId);
    this.drawRivers(state);
    this.drawMelds(state);
    this.actionCallout.showLatest(
      events,
      `${state.roundWind}:${state.handNumber}:${state.moveCount}`,
    );
    this.drawFrame();
    if (ui.animateHandReveal && this.revealTiles.length) {
      this.startHandReveal(ui.delayHandRevealForCallout ? ACTION_CALLOUT_DURATION_MS * 0.64 : 0);
    }
  }

  drawHands(state, selectedTileId) {
    const rack = asArray(state.ownHand);
    const drawn = Number(state.drawnTile) || null;
    const revealSeats = new Set(asArray(this.ui?.revealPlayerIndices).map(Number));
    const coveredSeats = new Set(asArray(this.ui?.coveredPlayerIndices).map(Number));
    const animateReveal = this.ui?.animateHandReveal === true;
    const forbiddenTypes = new Set(asArray(state.legalActions?.forbiddenDiscardTypes));
    const riichiMode = this.ui?.riichiMode === true;
    const riichiTiles = new Set(asArray(this.ui?.riichiCandidateTiles).map(Number));
    if (revealSeats.has(1) || coveredSeats.has(1)) {
      this.addPresentedHand(state, "bottom", state.players[0], 1, {
        covered: coveredSeats.has(1),
        animate: animateReveal,
      });
    } else {
      rack.forEach((tileId, index) => {
        this.addOwnTile(
          tileId,
          index,
          false,
          selectedTileId,
          !forbiddenTypes.has(tileType(tileId)) && (!riichiMode || riichiTiles.has(tileId)),
          riichiMode && !riichiTiles.has(tileId),
        );
      });
      if (drawn != null) {
        this.addOwnTile(
          drawn,
          rack.length,
          true,
          selectedTileId,
          !forbiddenTypes.has(tileType(drawn)) && (!riichiMode || riichiTiles.has(drawn)),
          riichiMode && !riichiTiles.has(drawn),
        );
      }
    }

    for (let seat = 2; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const playerId = state.players[seat - 1];
      const revealWinner = state.phase === "hand_ended"
        && state.winType !== "nagashi"
        && asArray(state.winners).includes(playerId);
      if (revealWinner || revealSeats.has(seat) || coveredSeats.has(seat)) {
        this.addPresentedHand(state, position, playerId, seat, {
          covered: coveredSeats.has(seat),
          animate: (revealSeats.has(seat) || coveredSeats.has(seat)) && animateReveal,
        });
        continue;
      }
      const count = Number(state.handCounts?.[playerId] || 0);
      const meldCount = asArray(state.melds?.[playerId]).length;
      const insertionDeferred = Number(this.ui?.deferredHandInsertionSeat) === seat;
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
        ? Array.from({ length: layout.rackCount + 1 }, (_, index) => index)
          .filter((index) => index !== deferredIndex)
        : Array.from({ length: layout.rackCount }, (_, index) => index);
      for (const index of rackSlots) {
        const transform = handTransform(position, index, layout.rackCapacity);
        const tile = this.tileFactory.create({ concealed: true });
        applyStandingTransform(tile, transform);
        this.layers.hands.add(tile);
      }
      if (layout.hasDrawn) {
        const transform = handTransform(
          position,
          layout.rackCapacity,
          layout.rackCapacity,
          { drawn: true },
        );
        const tile = this.tileFactory.create({ concealed: true });
        applyStandingTransform(tile, transform);
        this.layers.hands.add(tile);
      }
    }
  }

  addPresentedHand(state, position, playerId, seat, { covered, animate }) {
    const { rack, drawn } = splitRevealedHand(state, playerId, seat);
    rack.forEach((tile, index) => {
      this.addPresentedTableTile(position, tile, index, false, { covered, animate });
    });
    if (drawn) {
      this.addPresentedTableTile(position, drawn, rack.length, true, { covered, animate });
    }
  }

  addPresentedTableTile(position, tileInfo, index, drawn, { covered, animate }) {
    const transform = handTransform(position, index, index, { drawn });
    const slot = new Group();
    slot.position.set(transform.x, 0, transform.z);
    slot.rotation.y = transform.yaw;
    const tile = this.tileFactory.create({
      type: tileInfo.type,
      red: tileInfo.red,
      concealed: covered,
      dora: !covered && this.doraCounts.has(Number(tileInfo.type)),
    });
    slot.add(tile);
    this.layers.hands.add(slot);
    if (animate) {
      tile.position.y = TILE_SIZE.height / 2;
      this.revealTiles.push({ tile, delay: 0, covered });
      return;
    }
    settlePresentedTile(tile, covered);
  }

  startHandReveal(delay = 0) {
    const startedAt = performance.now() + delay;
    const duration = 480;
    const tick = (now) => {
      let running = false;
      for (const { tile, delay, covered } of this.revealTiles) {
        const progress = Math.max(0, Math.min(1, (now - startedAt - delay) / duration));
        const eased = 1 - (1 - progress) ** 3;
        tile.rotation.x = (covered ? 1 : -1) * Math.PI / 2 * eased;
        tile.position.y = TILE_SIZE.height / 2
          + (TILE_SIZE.depth / 2 - TILE_SIZE.height / 2) * eased;
        tile.position.z = -0.3 * eased;
        if (progress < 1) running = true;
      }
      this.drawFrame();
      if (running) this.animationFrame = window.requestAnimationFrame(tick);
      else this.animationFrame = 0;
    };
    this.animationFrame = window.requestAnimationFrame(tick);
  }

  cancelHandReveal() {
    if (!this.animationFrame) return;
    window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  addOwnTile(tileId, index, drawn, selectedTileId, discardable = true, dimmed = false) {
    const transform = ownHandOverlayTransform(
      index,
      this.viewport.width,
      this.viewport.height,
      { drawn },
    );
    const tile = this.tileFactory.create({
      type: tileType(tileId),
      red: isRedFive(tileId),
      tileId,
      highlight: Number(tileId) === Number(selectedTileId)
        ? ""
        : this.highlightedType === tileType(tileId) ? "match" : "",
      dora: this.doraCounts.has(tileType(tileId)),
      dimmed,
    });
    tile.position.set(transform.x, transform.y, transform.z);
    tile.rotation.x = transform.tilt;
    tile.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
    tile.userData.baseX = transform.x;
    tile.userData.baseY = transform.y;
    tile.userData.lift = transform.lift;
    tile.userData.discardable = discardable;
    tile.position.y += Number(tileId) === Number(selectedTileId) ? tile.userData.lift : 0;
    this.ownHandLayer.add(tile);
    this.pickableTiles.push(tile);
  }

  drawRivers(state) {
    for (let seat = 1; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const river = asArray(state.discards?.[state.players[seat - 1]]);
      const riichiColumns = new Map();
      river.forEach((discard, index) => {
        if (discard.riichi === true && !discard.claimed) {
          riichiColumns.set(Math.floor(index / 6), index % 6);
        }
      });
      river.forEach((discard, index) => {
        if (discard.claimed) return;
        const transform = riverTransform(position, index, discard.riichi === true, {
          riichiColumn: riichiColumns.get(Math.floor(index / 6)) ?? -1,
        });
        const slot = new Group();
        slot.position.set(transform.x, transform.y, transform.z);
        slot.rotation.y = transform.yaw;
        applyPlanarJitter(
          slot,
          transform.yaw,
          planarTileJitter(
            `${seat}:river:${index}:${discard.type}`,
            RIVER_TILE_GAP,
            { width: TILE_SIZE.width, height: TILE_SIZE.height },
          ),
        );
        const tile = this.tileFactory.create({
          type: discard.type,
          red: discard.red === true,
          highlight: this.highlightedType === Number(discard.type) ? "match" : "",
          dora: this.doraCounts.has(Number(discard.type)),
        });
        tile.rotation.x = -Math.PI / 2;
        slot.add(tile);
        this.layers.rivers.add(slot);
      });
    }
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
            { absolute: true },
          );
          const slot = new Group();
          slot.position.set(
            transform.x,
            transform.y + entry.stackLevel * TILE_SIZE.depth * MELD_SCALE,
            transform.z,
          );
          slot.rotation.y = transform.yaw + (entry.sideways ? Math.PI / 2 : 0);
          slot.scale.setScalar(MELD_SCALE);
          const tile = this.tileFactory.create({
            type: entry.type,
            red: entry.red,
            concealed: entry.faceDown,
            highlight: !entry.faceDown && this.highlightedType === Number(entry.type)
              ? "match"
              : "",
            dora: !entry.faceDown && this.doraCounts.has(Number(entry.type)),
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
    if (!tileId || !this.state?.legalActions?.canDiscard || !tile.userData.discardable) return;
    event.preventDefault();
    this.cancelDrag(false);
    this.setHoveredTile(null);
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
      if (!drag.moved && clientDistance < OWN_HAND_DRAG.activationDistance) return;
      drag.moved = true;
      const pointer = this.pointerToOverlay(event, drag.bounds);
      drag.tile.position.x = drag.homeX + pointer.x - drag.startX;
      drag.tile.position.y = drag.homeY + Math.max(0, pointer.y - drag.startY);
      drag.crossed = this.viewport.height / 2 - pointer.y <= OWN_HAND_DRAG.discardLineY;
      this.renderer.domElement.style.cursor = "grabbing";
      this.drawFrame();
      return;
    }
    const tile = this.pickTile(event);
    this.setHoveredTile(this.state?.legalActions?.canDiscard ? tile : null);
    this.renderer.domElement.style.cursor = tile ? "pointer" : "default";
  }

  handlePointerUp(event) {
    const drag = this.dragState;
    if (drag && event.pointerId === drag.pointerId) {
      const { crossed, moved, tileId } = drag;
      this.cancelDrag(false);
      this.drawFrame();
      if (!this.state?.legalActions?.canDiscard) return;
      if (moved) {
        if (crossed) this.callbacks.onDiscardTile(tileId);
        return;
      }
      this.handleTileTap(tileId, true);
      return;
    }
    const tile = this.pickTile(event);
    const tileId = Number(tile?.userData.tileId || 0);
    if (!tileId) return;
    this.handleTileTap(tileId, tile.userData.discardable === true);
  }

  handleTileTap(tileId, discardable) {
    const now = performance.now();
    if (discardable
      && this.state?.legalActions?.canDiscard
      && this.lastTap.tileId === tileId
      && now - this.lastTap.time < 340) {
      this.callbacks.onDiscardTile(tileId);
      this.lastTap = { tileId: 0, time: 0 };
      return;
    }
    this.lastTap = { tileId, time: now };
    this.callbacks.onSelectTile(tileId);
  }

  handlePointerLeave() {
    if (!this.dragState) this.setHoveredTile(null);
  }

  pointerToOverlay(event, bounds = this.renderer.domElement.getBoundingClientRect()) {
    return {
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * this.viewport.width,
      y: (0.5 - (event.clientY - bounds.top) / bounds.height) * this.viewport.height,
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
    if (this.renderer?.domElement) this.renderer.domElement.style.cursor = "default";
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

  setHoveredTile(tile) {
    if (this.hoveredTile === tile) return;
    if (this.hoveredTile && this.hoveredTile.parent) {
      const selected = Number(this.hoveredTile.userData.tileId) === Number(this.ui?.selectedTileId);
      this.hoveredTile.position.y = this.hoveredTile.userData.baseY
        + (selected ? this.hoveredTile.userData.lift : 0);
    }
    this.hoveredTile = tile;
    if (tile && tile.parent && Number(tile.userData.tileId) !== Number(this.ui?.selectedTileId)) {
      tile.position.y = tile.userData.baseY + 8;
    }
    this.drawFrame();
  }

  drawFrame() {
    if (this.contextLost || this.destroyed || !this.renderer || !this.scene || !this.camera) return;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.overlayCamera);
  }

  resume() {
    if (!this.ready || this.contextLost || this.destroyed) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.tableConsole.restore(this.state, this.ui);
    this.resize();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelHandReveal();
    this.cancelDrag(false);
    this.renderer?.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer?.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer?.domElement.removeEventListener("pointerleave", this.onPointerLeave);
    this.renderer?.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer?.domElement.removeEventListener("pointercancel", this.onPointerCancel);
    this.renderer?.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer?.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.tileFactory?.destroy();
    this.actionCallout?.destroy();
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

function settlePresentedTile(tile, covered = false) {
  tile.rotation.x = (covered ? 1 : -1) * Math.PI / 2;
  tile.position.y = TILE_SIZE.depth / 2;
  tile.position.z = -0.3;
}

function applyStandingTransform(tile, transform) {
  tile.position.set(transform.x, transform.y, transform.z);
  tile.rotation.y = transform.yaw;
}

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}
