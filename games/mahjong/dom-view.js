import { CLAIM_LABELS, PLAYERS, POSITIONS } from "./constants.js";
import {
  activeSeat,
  asArray,
  claimPreviewTiles,
  doraIndicatorSlots,
  doraTypeCounts,
  eventMessage,
  isRedFive,
  orderedHand,
  partitionClaimActions,
  riverDisplayEntries,
  roundLabel,
  resultDetailPageCount,
  resultScoreRows,
  seatWind,
  tenpaiWaitsForDiscard,
  tileFace,
  tileType,
} from "./game-format.js";
import {
  MELD_SIDEWAYS_BOTTOM_INSET,
  MELD_SCALE,
  meldDisplayLayout,
  TILE_SIZE,
} from "./render/three-layout.js";
import { tileFaceFrameIndex } from "./render/tile-texture-map.js";

const RESULT_TILE_WIDTH_PX = 33;
const RESULT_TILE_HEIGHT_PX = 47;

export class MahjongDomView {
  constructor({ onAction, onSelectTile, onDiscardTile }) {
    this.onAction = onAction;
    this.onSelectTile = onSelectTile;
    this.onDiscardTile = onDiscardTile;
    this.lastEventKey = "";
    this.elements = collectElements();
    this.elements.actionBar.append(
      this.elements.abort,
      this.elements.claims,
      this.elements.riichi,
      this.elements.tsumo,
      this.elements.pass,
      this.elements.cancelRiichi,
      this.elements.furiten,
    );
  }

  render(
    state,
    events,
    selectedTileId,
    playerName,
    {
      showResult = true,
      preserveResult = false,
      resultPage = 0,
      riichiMode = false,
      defaultNames = {},
      playerNameIsAuthoritative = false,
    } = {},
  ) {
    const { elements } = this;
    this.doraCounts = doraTypeCounts(state);
    elements.message.classList.remove("is-error");
    const currentRound = roundLabel(state.roundWind, state.handNumber);
    elements.consoleRound.textContent = currentRound;
    elements.matchType.textContent =
      state.matchType === "hanchan" ? "四人南" : "四人東";
    elements.honba.textContent = String(Number(state.honba) || 0);
    elements.riichiSticks.textContent = String(Number(state.riichiSticks) || 0);
    elements.wall.textContent = `余牌 ${state.wallCount}`;
    elements.dora.replaceChildren(
      ...doraIndicatorSlots(state).map((indicator, index) => {
        const tile = indicator
          ? createTile(indicator.type, "dora", indicator.red)
          : createTileBack();
        tile.classList.add(
          "dora-slot",
          indicator ? "is-revealed" : "is-concealed",
        );
        tile.dataset.slot = String(index + 1);
        if (indicator) {
          tile.setAttribute(
            "aria-label",
            `第 ${index + 1} 张宝牌指示牌：${tile.getAttribute("aria-label")}`,
          );
        } else {
          tile.removeAttribute("aria-hidden");
          tile.setAttribute(
            "aria-label",
            `第 ${index + 1} 张宝牌指示牌尚未翻开`,
          );
        }
        return tile;
      }),
    );
    this.renderTypeHighlights(selectedTileId);
    this.renderStations(
      state,
      playerName,
      defaultNames,
      playerNameIsAuthoritative,
    );
    this.riichiMode = riichiMode;
    this.renderHands(state, selectedTileId, riichiMode);
    this.renderTenpaiPreview(state, selectedTileId);
    this.renderRivers(state, events);
    this.renderMelds(state);
    this.renderActions(state, selectedTileId, riichiMode);
    this.renderStatus(state, events, playerName);
    if (!preserveResult) {
      this.renderResult(state, playerName, showResult, resultPage);
    }
  }

  renderSelection(
    state,
    selectedTileId,
    playerName,
    { riichiMode = false } = {},
  ) {
    this.riichiMode = riichiMode;
    this.updateHandSelection(selectedTileId);
    this.renderTypeHighlights(selectedTileId);
    this.renderTenpaiPreview(state, selectedTileId);
    return this.visualUi(playerName, selectedTileId);
  }

  renderTenpaiPreview(state, selectedTileId) {
    const waits = tenpaiWaitsForDiscard(state?.legalActions, selectedTileId);
    const { tenpaiPreview, tenpaiWaits } = this.elements;
    tenpaiPreview.hidden = waits.length === 0;
    tenpaiWaits.style.setProperty(
      "--tenpai-wait-columns",
      String(Math.min(7, waits.length)),
    );
    tenpaiWaits.replaceChildren(
      ...waits.map((wait) => {
        const item = document.createElement("span");
        item.className = "tenpai-wait";
        item.setAttribute(
          "aria-label",
          `${tileFace(wait.type).label}，剩余 ${wait.remaining} 张`,
        );
        const tile = createTile(wait.type, "tenpai-wait");
        markDora(tile, wait.type, this.doraCounts);
        tile.setAttribute("aria-hidden", "true");
        const count = document.createElement("small");
        count.className = "tenpai-wait-count";
        count.classList.toggle("is-empty", wait.remaining === 0);
        count.textContent = `${wait.remaining} 张`;
        item.append(tile, count);
        return item;
      }),
    );
  }

  updateHandSelection(selectedTileId) {
    const selectedType = selectedTileId ? tileType(selectedTileId) : 0;
    for (const tile of this.elements.hand.querySelectorAll("[data-tile-id]")) {
      const tileId = Number(tile.dataset.tileId) || 0;
      tile.setAttribute("aria-selected", String(tileId === selectedTileId));
      tile.classList.toggle("is-selected", tileId === selectedTileId);
      tile.classList.toggle(
        "is-type-match",
        tileId !== selectedTileId &&
          selectedType > 0 &&
          tileType(tileId) === selectedType,
      );
    }
  }

  renderTypeHighlights(selectedTileId) {
    const selectedType = selectedTileId ? tileType(selectedTileId) : 0;
    for (const tile of this.elements.dora.querySelectorAll("[data-type]")) {
      tile.classList.toggle(
        "is-type-match",
        Number(tile.dataset.type) === selectedType,
      );
    }
  }

  visualUi(playerName, selectedTileId) {
    return {
      selectedTileId,
      playerName,
      roundLabel: this.elements.consoleRound.textContent,
      heading: this.elements.heading.textContent,
      message: this.elements.message.textContent,
    };
  }

  setPlayerAvatar(position, source) {
    const image = this.elements.stations[position]?.querySelector(
      "[data-player-avatar]",
    );
    if (!image) return;
    const nextSource = typeof source === "string" && source ? source : "";
    if (!nextSource) {
      image.hidden = true;
      image.removeAttribute("src");
      delete image.dataset.source;
      return;
    }
    if (image.dataset.source === nextSource) return;

    image.hidden = true;
    image.dataset.source = nextSource;
    image.onload = () => {
      if (image.dataset.source === nextSource) image.hidden = false;
    };
    image.onerror = () => {
      if (image.dataset.source !== nextSource) return;
      image.hidden = true;
      image.removeAttribute("src");
      delete image.dataset.source;
    };
    image.src = nextSource;
  }

  renderStations(
    state,
    playerName,
    defaultNames = {},
    playerNameIsAuthoritative = false,
  ) {
    POSITIONS.forEach((position, index) => {
      const seat = index + 1;
      const station = this.elements.stations[position];
      const playerId = state.players[seat - 1];
      const stateName = state.playerNames?.[seat - 1];
      const fallbackName = defaultNames[portraitSlotForPosition(position)];
      const name =
        stateName && stateName !== PLAYERS[seat - 1].name
          ? stateName
          : fallbackName || stateName || PLAYERS[seat - 1].name || "玩家";
      station.querySelector("[data-name]").textContent =
        seat === 1 && playerNameIsAuthoritative ? playerName : name;
      const wind = seatWind(state, seat);
      const windBadge = station.querySelector("[data-wind]");
      windBadge.textContent = wind;
      windBadge.classList.toggle("is-east", wind === "東");
      const consoleScore = this.elements.consoleScores[seat - 1];
      consoleScore.textContent = String(Number(state.scores?.[seat - 1] ?? 0));
      consoleScore.classList.toggle(
        "is-active",
        activeSeat(state) === seat && state.phase !== "hand_ended",
      );
      station.classList.toggle(
        "is-active",
        activeSeat(state) === seat && state.phase !== "hand_ended",
      );
      station.classList.toggle(
        "is-winner",
        asArray(state.winners).includes(playerId),
      );
    });
  }

  renderHands(state, selectedTileId, riichiMode = false) {
    const hand = orderedHand(state.ownHand, state.drawnTile);
    const forbiddenTypes = new Set(
      asArray(state.legalActions?.forbiddenDiscardTypes),
    );
    const riichiTiles = new Set(
      asArray(state.legalActions?.riichiTiles).map(Number),
    );
    this.elements.hand.replaceChildren(
      ...hand.map((tileId) => {
        const tile = createTile(tileType(tileId), "hand", isRedFive(tileId));
        tile.dataset.tileId = String(tileId);
        tile.type = "button";
        tile.setAttribute("role", "option");
        tile.setAttribute("aria-selected", String(tileId === selectedTileId));
        tile.classList.toggle("is-selected", tileId === selectedTileId);
        tile.classList.toggle(
          "is-type-match",
          tileId !== selectedTileId &&
            selectedTileId > 0 &&
            tileType(tileId) === tileType(selectedTileId),
        );
        tile.classList.toggle("is-drawn", tileId === Number(state.drawnTile));
        tile.classList.toggle(
          "is-riichi-choice",
          riichiMode && riichiTiles.has(tileId),
        );
        tile.classList.toggle(
          "is-riichi-blocked",
          riichiMode && !riichiTiles.has(tileId),
        );
        const discardable =
          state.legalActions?.canDiscard &&
          !forbiddenTypes.has(tileType(tileId)) &&
          (!riichiMode || riichiTiles.has(tileId));
        tile.setAttribute("aria-disabled", String(!discardable));
        tile.addEventListener("click", () => this.onSelectTile(tileId));
        if (discardable) {
          tile.addEventListener("dblclick", () => this.onDiscardTile(tileId));
        }
        return tile;
      }),
    );

    for (let seat = 2; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const count = Number(state.handCounts[state.players[seat - 1]] || 0);
      this.elements.opponentHands[position].replaceChildren(
        ...Array.from({ length: count }, () => createTileBack()),
      );
    }
  }

  renderRivers(state, events) {
    const latest = [...events]
      .reverse()
      .find((event) => event.type === "discarded");
    for (let seat = 1; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const river = asArray(state.discards?.[state.players[seat - 1]]);
      this.elements.rivers[position].replaceChildren(
        ...riverDisplayEntries(river).map(({ discard, sourceIndex }) => {
          const tile = createTile(discard.type, "river");
          tile.dataset.riichi = String(discard.riichi === true);
          tile.classList.toggle(
            "is-latest",
            latest?.playerIndex === seat && sourceIndex === river.length - 1,
          );
          return tile;
        }),
      );
    }
  }

  renderMelds(state) {
    for (let seat = 1; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const groups = asArray(state.melds?.[state.players[seat - 1]]);
      this.elements.melds[position].replaceChildren(
        ...groups.map((meld) => {
          const group = document.createElement("div");
          group.className = `meld-group meld-${meld.kind}`;
          group.title = CLAIM_LABELS[meld.kind] ?? meld.kind;
          group.append(
            ...asArray(meld.tiles).map((type) => createTile(type, "meld")),
          );
          return group;
        }),
      );
    }
  }

  renderActions(state, selectedTileId, riichiMode = false) {
    const legal = state.legalActions ?? {};
    const { elements } = this;
    elements.claims.replaceChildren();
    elements.cancelRiichi.hidden = !riichiMode;
    if (riichiMode) {
      elements.pass.hidden = true;
      elements.abort.hidden = true;
      elements.tsumo.hidden = true;
      elements.riichi.hidden = true;
      elements.furiten.hidden = true;
      elements.actionHint.textContent = "选择一张牌宣言立直";
      return;
    }
    const claims = asArray(legal.claims);
    const {
      chi: chiClaims,
      pon: ponClaims,
      immediate: immediateClaims,
    } = partitionClaimActions(claims);
    if (chiClaims.length > 0) {
      elements.claims.append(this.createGroupedClaimAction(chiClaims, "chi"));
    }
    if (ponClaims.length > 0) {
      elements.claims.append(this.createGroupedClaimAction(ponClaims, "pon"));
    }
    for (const claim of immediateClaims) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `claim-action claim-${claim.kind}`;
      button.textContent = CLAIM_LABELS[claim.kind] ?? claim.kind;
      button.addEventListener("click", () =>
        this.onAction({ type: "claim", option: claim.option }),
      );
      elements.claims.append(button);
    }
    for (const kan of asArray(legal.selfKans)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "claim-action claim-kan";
      button.textContent = CLAIM_LABELS[kan.kind] ?? "杠";
      button.addEventListener("click", () =>
        this.onAction({
          type: "kan",
          kind: kan.kind,
          tileType: kan.tileType,
        }),
      );
      elements.claims.append(button);
    }
    const canClaim = claims.length > 0;
    elements.pass.hidden = !canClaim;
    elements.abort.hidden = !legal.canAbortNine;
    elements.tsumo.hidden = !legal.canTsumo;
    elements.riichi.hidden = !legal.canRiichi;
    elements.riichi.disabled = false;
    elements.furiten.hidden = !state.furiten;
    elements.actionHint.textContent = canClaim
      ? "有人打出了你需要的牌"
      : legal.canDiscard
        ? "向上拖动手牌，进入出牌区后松手打出"
        : state.phase === "hand_ended"
          ? "本局已结束"
          : "等待其他玩家";
  }

  createGroupedClaimAction(claims, kind) {
    const group = document.createElement("div");
    group.className = "claim-action-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `claim-action claim-${kind}`;
    const label = CLAIM_LABELS[kind] ?? kind;
    button.textContent = label;
    group.append(button);

    if (claims.length === 1) {
      button.addEventListener("click", () =>
        this.onAction({ type: "claim", option: claims[0].option }),
      );
      return group;
    }

    const layer = document.createElement("div");
    layer.className = "claim-choice-layer";
    layer.hidden = true;
    layer.tabIndex = -1;
    const picker = document.createElement("div");
    picker.id = `${kind}-choice-popover`;
    picker.className = "claim-choice-popover";
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", `选择${label}法`);
    picker.setAttribute("aria-modal", "true");
    const list = document.createElement("div");
    list.className = "claim-choice-list";
    list.style.setProperty(
      "--claim-choice-columns",
      String(Math.min(3, claims.length)),
    );
    for (const claim of claims) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "claim-choice";
      const preview = claimPreviewTiles(claim);
      choice.setAttribute(
        "aria-label",
        `${label}：${preview.map((tile) => `${tile.red ? "赤" : ""}${tileFace(tile.type).label}`).join("、")}`,
      );
      choice.append(
        ...preview.map((tile) => {
          const element = createTile(tile.type, "claim-choice", tile.red);
          markDora(element, tile.type, this.doraCounts);
          element.setAttribute("aria-hidden", "true");
          return element;
        }),
      );
      choice.addEventListener("click", () =>
        this.onAction({ type: "claim", option: claim.option }),
      );
      list.append(choice);
    }
    picker.append(list);
    layer.append(picker);
    group.append(layer);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", picker.id);
    button.setAttribute("aria-expanded", "false");
    const setOpen = (open) => {
      layer.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) list.querySelector("button")?.focus();
      else button.focus();
    };
    button.addEventListener("click", () => setOpen(layer.hidden));
    layer.addEventListener("click", (event) => {
      if (event.target === layer) setOpen(false);
    });
    layer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
    return group;
  }

  renderStatus(state, events, playerName) {
    if (state.phase === "hand_ended") return;
    const seat = activeSeat(state);
    const name =
      seat === 1
        ? playerName
        : state.playerNames?.[seat - 1] || PLAYERS[seat - 1]?.name;
    this.elements.heading.textContent =
      state.phase === "claiming"
        ? seat === 1
          ? "可以鸣牌"
          : seat > 0
            ? `${name} 正在考虑`
            : "等待其他玩家确认"
        : seat === 1
          ? "轮到你出牌"
          : `${name} 的回合`;

    const event = [...events]
      .reverse()
      .find((item) => item.type !== "claim_passed");
    const key = event ? JSON.stringify(event) : "";
    if (event && key !== this.lastEventKey) {
      this.lastEventKey = key;
      this.elements.message.textContent = eventMessage(
        state,
        event,
        playerName,
      );
      this.elements.message.classList.remove("is-pulsing");
      void this.elements.message.offsetWidth;
      this.elements.message.classList.add("is-pulsing");
    } else if (!event) {
      this.elements.message.textContent = state.furiten
        ? "振听中：不能荣和，但仍可自摸"
        : "一番缚 · 赤宝牌各一枚";
    }
  }

  renderResult(state, playerName, showResult = true, pageIndex = 0) {
    const { elements } = this;
    const ended = state.phase === "hand_ended";
    elements.result.hidden = !ended || !showResult;
    if (!ended) return;
    elements.rematch.textContent = "继续";
    const detailCount = resultDetailPageCount(state);
    const safePage = Math.max(0, Math.min(detailCount, Number(pageIndex) || 0));
    if (safePage >= detailCount) {
      this.renderResultScores(state, playerName);
      return;
    }

    elements.resultDetailContent.hidden = false;
    elements.resultScoreContent.hidden = true;
    const results = asArray(state.results).length
      ? asArray(state.results)
      : [state.result ?? {}];
    const result = results[safePage] ?? {};
    const winnerIndex =
      Number(result.winnerIndex) ||
      state.players.indexOf(state.winners?.[safePage]) + 1 ||
      Number(state.winnerIndex) ||
      1;
    const winnerName = playerDisplayName(state, winnerIndex, playerName);
    elements.resultDetailHands.hidden = state.winType === "nagashi";
    elements.resultDetailHands.replaceChildren(
      createResultHand(state, winnerIndex, winnerName, false, this.doraCounts),
    );
    elements.resultDetailYaku.hidden = false;
    elements.resultDetailYaku.replaceChildren(
      ...asArray(result.yaku).map((yaku) => {
        const item = document.createElement("span");
        const name = document.createElement("i");
        const yakuValue = document.createElement("b");
        name.textContent = yaku.name;
        yakuValue.textContent = yaku.han >= 13 ? "役满" : `${yaku.han}番`;
        item.append(name, yakuValue);
        return item;
      }),
    );
  }

  renderResultScores(state, playerName) {
    const { elements } = this;
    elements.resultDetailContent.hidden = true;
    elements.resultScoreContent.hidden = false;
    elements.resultKicker.textContent = state.draw ? "流局结算" : "本局结算";
    elements.resultTitle.textContent = "点数结算";
    const summary = state.draw
      ? `${state.abortiveReason || "流局"} · ${state.result?.payment ?? "不听罚符结算"}`
      : state.matchEnded
        ? state.endReason || "对局结束"
        : "";
    elements.resultSummary.textContent = summary;
    elements.resultSummary.hidden = !summary;
    elements.resultScoreDelta.textContent = "";
    elements.resultScoreDelta.hidden = true;
    elements.resultScoreList.replaceChildren(
      ...resultScoreRows(state, playerName).map((score) => {
        const item = document.createElement("span");
        item.className = "result-score-row";
        const name = document.createElement("i");
        const delta = document.createElement("b");
        name.textContent = `${score.name}　${score.before} → ${score.after}`;
        delta.textContent = `${score.delta >= 0 ? "+" : ""}${score.delta}`;
        item.append(name, delta);
        return item;
      }),
    );
  }
}

function playerDisplayName(state, winnerIndex, playerName) {
  const index = Number(winnerIndex) - 1;
  return index === 0
    ? playerName
    : state.playerNames?.[index] ||
        PLAYERS[index]?.name ||
        `玩家${winnerIndex}`;
}

function createResultHand(
  state,
  winnerIndex,
  winnerName,
  showName,
  doraCounts,
) {
  const playerId = state.players?.[winnerIndex - 1];
  const row = document.createElement("section");
  row.className = "result-hand";
  if (showName) {
    const label = document.createElement("strong");
    label.textContent = winnerName;
    row.append(label);
  }

  const tiles = document.createElement("div");
  tiles.className = "result-hand-tiles";
  const concealed = asArray(state.revealedHands?.[playerId]).map(
    normalizeRevealedTile,
  );
  const winning =
    Number(state.winningTile) > 0
      ? { type: Number(state.winningTile), red: state.winningTileRed === true }
      : null;
  tiles.append(
    ...concealed.map((tile) => {
      const element = createTile(tile.type, "result", tile.red);
      markDora(element, tile.type, doraCounts);
      return element;
    }),
  );
  if (winning) {
    const winningTile = createTile(winning.type, "result", winning.red);
    markDora(winningTile, winning.type, doraCounts);
    winningTile.classList.add("is-winning-tile");
    tiles.append(winningTile);
  }
  const resultMelds = asArray(state.melds?.[playerId])
    .map((meld) => createResultMeld(meld, winnerIndex, doraCounts))
    .reverse();
  tiles.append(...resultMelds);
  row.append(tiles);
  return row;
}

function createResultMeld(meld, winnerIndex, doraCounts) {
  const group = document.createElement("span");
  group.className = "result-meld";
  const display = meldDisplayLayout(meld, winnerIndex);
  const normalExtent = TILE_SIZE.width * MELD_SCALE;
  const pixelsPerUnit = RESULT_TILE_WIDTH_PX / normalExtent;
  group.style.setProperty(
    "--result-meld-width",
    `${display.span * pixelsPerUnit + 3}px`,
  );
  const resultMeldHeight = display.entries.reduce((height, entry) => {
    const baseInward = entry.sideways ? MELD_SIDEWAYS_BOTTOM_INSET : 0;
    const inward = (entry.inward - baseInward) * pixelsPerUnit;
    const tileHeight = entry.sideways
      ? RESULT_TILE_WIDTH_PX
      : RESULT_TILE_HEIGHT_PX;
    return Math.max(height, inward + tileHeight);
  }, RESULT_TILE_HEIGHT_PX);
  group.style.setProperty("--result-meld-height", `${resultMeldHeight}px`);
  for (const entry of display.entries) {
    const tile = createTile(entry.type, "result", entry.red);
    if (!entry.faceDown) markDora(tile, entry.type, doraCounts);
    const centreFromRight = entry.along + normalExtent / 2;
    const centreFromLeft = display.span - centreFromRight;
    tile.style.setProperty(
      "--result-meld-x",
      `${centreFromLeft * pixelsPerUnit + 1.5}px`,
    );
    const baseInward = entry.sideways ? MELD_SIDEWAYS_BOTTOM_INSET : 0;
    tile.style.setProperty(
      "--result-meld-inward",
      `${(entry.inward - baseInward) * pixelsPerUnit}px`,
    );
    tile.classList.toggle("is-sideways", entry.sideways);
    tile.classList.toggle("is-face-down", entry.faceDown);
    if (entry.faceDown) tile.setAttribute("aria-label", "暗杠牌背");
    group.append(tile);
  }
  return group;
}

function normalizeRevealedTile(tile) {
  if (tile && typeof tile === "object") {
    return { type: Number(tile.type), red: tile.red === true };
  }
  return { type: Number(tile), red: false };
}

function collectElements() {
  return {
    app: document.querySelector("#mahjong-app"),
    settingsButton: document.querySelector("#settings-button"),
    autoWin: document.querySelector("#auto-win-button"),
    passClaims: document.querySelector("#pass-claims-button"),
    autoTsumogiri: document.querySelector("#auto-tsumogiri-button"),
    settingsDialog: document.querySelector("#settings-dialog"),
    settingsDialogCard: document.querySelector(".settings-dialog-card"),
    settingsClose: document.querySelector("#settings-close-button"),
    settingsReturn: document.querySelector("#settings-return-button"),
    settingsEndMatch: document.querySelector("#settings-end-match-button"),
    settingsTabs: [...document.querySelectorAll("[data-settings-tab]")],
    settingsPanels: [...document.querySelectorAll("[data-settings-panel]")],
    doubleClickTsumogiri: document.querySelector(
      "#double-click-tsumogiri-setting",
    ),
    doubleClickPass: document.querySelector("#double-click-pass-setting"),
    riverTileVolume: document.querySelector("#discard-volume-setting"),
    riverTileVolumeValue: document.querySelector("#discard-volume-value"),
    musicVolume: document.querySelector("#music-volume-setting"),
    musicVolumeValue: document.querySelector("#music-volume-value"),
    loading: document.querySelector("#loading-panel"),
    loadingSpinner: document.querySelector(".loading-spinner"),
    loadingMessage: document.querySelector("#loading-message"),
    stage: document.querySelector("#mahjong-stage"),
    consoleRound: document.querySelector("#console-round"),
    matchType: document.querySelector(".match-type-label"),
    honba: document.querySelector("#honba-count"),
    riichiSticks: document.querySelector("#riichi-stick-count"),
    wall: document.querySelector("#wall-count"),
    consoleScores: [...document.querySelectorAll("[data-console-score]")].sort(
      (left, right) =>
        Number(left.dataset.consoleScore) - Number(right.dataset.consoleScore),
    ),
    dora: document.querySelector("#dora-list"),
    heading: document.querySelector("#turn-heading"),
    message: document.querySelector("#table-message"),
    actionHint: document.querySelector("#action-hint"),
    actionBar: document.querySelector("#action-bar"),
    tenpaiPreview: document.querySelector("#tenpai-preview"),
    tenpaiWaits: document.querySelector("#tenpai-waits"),
    claims: document.querySelector("#claim-actions"),
    pass: document.querySelector("#pass-button"),
    abort: document.querySelector("#abort-button"),
    tsumo: document.querySelector("#tsumo-button"),
    riichi: document.querySelector("#riichi-button"),
    cancelRiichi: document.querySelector("#cancel-riichi-button"),
    furiten: document.querySelector("#furiten-badge"),
    hand: document.querySelector("#hand-bottom"),
    result: document.querySelector("#result-panel"),
    resultStage: document.querySelector(".result-page-stage"),
    resultTrack: document.querySelector(".result-page-track"),
    resultDetailContent: document.querySelector("#result-detail-content"),
    resultScoreContent: document.querySelector("#result-score-content"),
    resultHeading: document.querySelector("#result-heading"),
    resultKicker: document.querySelector("#result-kicker"),
    resultTitle: document.querySelector("#result-title"),
    resultSummary: document.querySelector("#result-summary"),
    resultDetailHands: document.querySelector("#result-hands"),
    resultDetailYaku: document.querySelector("#result-yaku"),
    resultScoreList: document.querySelector("#result-score-list"),
    resultScoreDelta: document.querySelector("#result-score-delta"),
    rematch: document.querySelector("#rematch-button"),
    setup: document.querySelector("#setup-panel"),
    opponentHands: {
      top: document.querySelector("#hand-top"),
      right: document.querySelector("#hand-right"),
      left: document.querySelector("#hand-left"),
    },
    rivers: Object.fromEntries(
      POSITIONS.map((position) => [
        position,
        document.querySelector(`#river-${position}`),
      ]),
    ),
    melds: Object.fromEntries(
      POSITIONS.map((position) => [
        position,
        document.querySelector(`#meld-${position}`),
      ]),
    ),
    stations: Object.fromEntries(
      POSITIONS.map((position) => [
        position,
        document.querySelector(`#player-${position}`),
      ]),
    ),
  };
}

function createTile(type, size, red = false) {
  const tile = document.createElement(size === "hand" ? "button" : "span");
  const face = tileFace(type);
  tile.className = `mahjong-tile tile-${size} suit-${face.suit}`;
  tile.classList.toggle("is-red-five", red);
  tile.dataset.type = String(type);
  const frame = tileFaceFrameIndex(type, red);
  tile.style.setProperty("--tile-column", String(frame % 8));
  tile.style.setProperty("--tile-row", String(Math.floor(frame / 8)));
  tile.setAttribute("aria-label", face.label);
  const rank = document.createElement("b");
  rank.textContent = face.rank;
  const suit = document.createElement("small");
  suit.textContent = face.mark;
  tile.append(rank, suit);
  return tile;
}

function createTileBack() {
  const tile = document.createElement("span");
  tile.className = "mahjong-tile tile-back";
  tile.setAttribute("aria-hidden", "true");
  return tile;
}

function markDora(tile, type, doraCounts) {
  tile.classList.toggle("is-dora", doraCounts?.has(Number(type)) === true);
}

function portraitSlotForPosition(position) {
  return { bottom: "self", right: "right", top: "opposite", left: "left" }[
    position
  ];
}
