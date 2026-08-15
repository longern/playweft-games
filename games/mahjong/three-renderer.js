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
import feltTextureUrl from "./assets/felt-texture-v1.jpg?url";
import { POSITIONS } from "./constants.js";
import {
  asArray,
  isRedFive,
  opponentHandLayout,
  splitDrawnTile,
  tileType,
} from "./game-format.js";
import {
  handTransform,
  MELD_GROUP_GAP,
  MELD_SCALE,
  meldDisplayLayout,
  meldTransform,
  ownHandOverlayTransform,
  ownMeldOverlayTransform,
  riverTransform,
  TILE_SIZE,
} from "./render/three-layout.js";
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
    this.renderer.toneMappingExposure = 0.91;
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
    this.camera = new PerspectiveCamera(33, 1, 0.1, 80);
    this.camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
    this.camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);

    this.overlayScene = new Scene();
    this.overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    this.overlayCamera.position.set(0, 0, 1000);
    this.overlayCamera.lookAt(0, 0, 0);
    this.ownHandLayer = new Group();
    this.tableConsole = new ThreeTableConsole();
    this.overlayScene.add(this.tableConsole.mesh);
    this.overlayScene.add(this.ownHandLayer);

    const textureLoader = new TextureLoader();
    const [faceAtlas, feltTexture] = await Promise.all([
      textureLoader.loadAsync(tileFacesUrl),
      textureLoader.loadAsync(feltTextureUrl),
    ]);

    this.addLighting();
    this.addOverlayLighting();
    this.table = new ThreeMahjongTable({
      anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
      feltTexture,
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

    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerLeave = () => this.setHoveredTile(null);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.onPointerLeave);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.ready = true;
    if (this.pendingRender) this.render(...this.pendingRender);
    else this.drawFrame();
  }

  addLighting() {
    this.scene.add(
      new HemisphereLight(0xfff3dc, 0x28564c, 1.22),
      new AmbientLight(0xd2d7d3, 1.02),
    );
    const overheadFill = new SpotLight(0xffedcf, 115, 46, 0.93, 0.74, 1.35);
    overheadFill.name = "table-overhead-fill";
    overheadFill.position.set(0, 16, -1.5);
    overheadFill.target.position.set(0, 0, -1.5);

    const overhead = new SpotLight(0xffedcf, 60, 46, 0.93, 0.74, 1.35);
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
    overhead.shadow.radius = 5;
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
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.viewport = { width, height };
    this.camera.aspect = width / height;
    this.camera.fov = width / height < 1.5 ? 39 : 33;
    this.camera.updateProjectionMatrix();
    this.overlayCamera.left = -width / 2;
    this.overlayCamera.right = width / 2;
    this.overlayCamera.top = height / 2;
    this.overlayCamera.bottom = -height / 2;
    this.overlayCamera.updateProjectionMatrix();
    this.tableConsole.resize(height);
    this.drawFrame();
  }

  render(state, events, ui) {
    if (!this.ready) {
      this.pendingRender = [state, events, ui];
      return;
    }
    this.pendingRender = null;
    this.state = state;
    this.ui = ui;
    this.pickableTiles.length = 0;
    this.setHoveredTile(null);
    Object.values(this.layers).forEach(clearGroup);
    clearGroup(this.ownHandLayer);
    this.tableConsole.update(state, ui);
    this.drawHands(state, ui.selectedTileId);
    this.drawRivers(state);
    this.drawMelds(state);
    this.drawFrame();
  }

  drawHands(state, selectedTileId) {
    const { rack, drawn } = splitDrawnTile(state.ownHand, state.lastDrawn);
    const forbiddenTypes = new Set(asArray(state.legalActions?.forbiddenDiscardTypes));
    rack.forEach((tileId, index) => {
      this.addOwnTile(
        tileId,
        index,
        false,
        selectedTileId,
        !forbiddenTypes.has(tileType(tileId)),
      );
    });
    if (drawn != null) {
      this.addOwnTile(
        drawn,
        rack.length,
        true,
        selectedTileId,
        !forbiddenTypes.has(tileType(drawn)),
      );
    }

    for (let seat = 2; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const playerId = state.players[seat - 1];
      const count = Number(state.handCounts?.[playerId] || 0);
      const meldCount = asArray(state.melds?.[playerId]).length;
      const layout = opponentHandLayout(
        count,
        meldCount,
        Number(state.drawnPlayerIndex) === seat,
      );
      for (let index = 0; index < layout.rackCount; index += 1) {
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

  addOwnTile(tileId, index, drawn, selectedTileId, discardable = true) {
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
    });
    tile.position.set(transform.x, transform.y, transform.z);
    tile.rotation.x = transform.tilt;
    tile.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
    tile.userData.baseY = transform.y;
    tile.userData.lift = transform.lift;
    tile.position.y += Number(tileId) === Number(selectedTileId) ? tile.userData.lift : 0;
    this.ownHandLayer.add(tile);
    if (discardable) this.pickableTiles.push(tile);
  }

  drawRivers(state) {
    for (let seat = 1; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const river = asArray(state.discards?.[state.players[seat - 1]]);
      river.forEach((discard, index) => {
        if (discard.claimed) return;
        const transform = riverTransform(position, index, discard.riichi === true);
        const slot = new Group();
        slot.position.set(transform.x, transform.y, transform.z);
        slot.rotation.y = transform.yaw;
        const tile = this.tileFactory.create({ type: discard.type, red: discard.red === true });
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
      let alongOffset = 0;
      for (const meld of melds) {
        const display = meldDisplayLayout(meld, seat);
        display.entries.forEach((entry) => {
          if (seat === 1) {
            this.addOwnMeldTile(entry, alongOffset + entry.along);
            return;
          }
          const transform = meldTransform(
            position,
            alongOffset + entry.along,
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
          });
          tile.rotation.x = entry.faceDown ? Math.PI / 2 : -Math.PI / 2;
          slot.add(tile);
          this.layers.melds.add(slot);
        });
        alongOffset += display.span + MELD_GROUP_GAP;
      }
    }
  }

  addOwnMeldTile(entry, offset) {
    const transform = ownMeldOverlayTransform(
      offset,
      this.viewport.width,
      this.viewport.height,
      entry,
    );
    const slot = new Group();
    slot.position.set(transform.x, transform.y, transform.z);
    slot.rotation.z = transform.rotationZ;
    slot.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
    const tile = this.tileFactory.create({
      type: entry.type,
      red: entry.red,
      concealed: entry.faceDown,
    });
    if (entry.faceDown) tile.rotation.y = Math.PI;
    slot.add(tile);
    this.ownHandLayer.add(slot);
  }

  handlePointerMove(event) {
    const tile = this.pickTile(event);
    this.setHoveredTile(tile);
    this.renderer.domElement.style.cursor = tile && this.state?.legalActions?.canDiscard
      ? "pointer"
      : "default";
  }

  handlePointerUp(event) {
    if (!this.state?.legalActions?.canDiscard) return;
    const tile = this.pickTile(event);
    const tileId = Number(tile?.userData.tileId || 0);
    if (!tileId) return;
    const now = performance.now();
    if (this.lastTap.tileId === tileId && now - this.lastTap.time < 340) {
      this.callbacks.onDiscardTile(tileId);
      this.lastTap = { tileId: 0, time: 0 };
      return;
    }
    this.lastTap = { tileId, time: now };
    this.callbacks.onSelectTile(tileId);
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
    this.resizeObserver?.disconnect();
    this.renderer?.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer?.domElement.removeEventListener("pointerleave", this.onPointerLeave);
    this.renderer?.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer?.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer?.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.tileFactory?.destroy();
    this.tableConsole?.destroy();
    this.table?.destroy();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

function applyStandingTransform(tile, transform) {
  tile.position.set(transform.x, transform.y, transform.z);
  tile.rotation.y = transform.yaw;
}

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}
