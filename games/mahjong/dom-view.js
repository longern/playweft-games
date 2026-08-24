import { CLAIM_LABELS, PLAYERS, POSITIONS } from "./constants.js";
import {
  activeSeat,
  asArray,
  canDiscardHandTile,
  claimPreviewTiles,
  doraIndicatorSlots,
  doraTypeCounts,
  eventMessage,
  isRedFive,
  orderedHand,
  partitionClaimActions,
  playerDisplayName,
  riverDisplayEntries,
  roundLabel,
  resultDetailPageCount,
  seatWind,
  tenpaiDiscardFuriten,
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
import { traditionalDrawReason, traditionalYakuName } from "./yaku-display.js";

const RESULT_TILE_WIDTH_PX = 33;
const RESULT_TILE_HEIGHT_PX = 47;

export class MahjongDomView {
  constructor({ onAction, onSelectTile, onDiscardTile }) {
    this.onAction = onAction;
    this.onSelectTile = onSelectTile;
    this.onDiscardTile = onDiscardTile;
    this.lastEventKey = "";
    this.countdownDeadlineAt = 0;
    this.countdownServerTime = 0;
    this.countdownLocalTime = 0;
    this.countdownTimer = 0;
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
      showDrawReveal = false,
      preserveResult = false,
      resultPage = 0,
      riichiMode = false,
      showGameHints = true,
      defaultNames = {},
      playerNameIsAuthoritative = false,
      serverTime = 0,
    } = {},
  ) {
    const { elements } = this;
    this.showGameHints = showGameHints;
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
    this.renderCountdown(state, serverTime);
    this.renderStatus(state, events, playerName, {
      defaultNames,
      playerNameIsAuthoritative,
    });
    this.renderDrawReveal(state, showDrawReveal);
    if (!preserveResult) {
      this.renderResult(state, playerName, showResult, resultPage, {
        defaultNames,
        playerNameIsAuthoritative,
      });
    }
  }

  renderSelection(
    state,
    selectedTileId,
    playerName,
    { riichiMode = false, showGameHints = true } = {},
  ) {
    this.riichiMode = riichiMode;
    this.showGameHints = showGameHints;
    this.updateHandSelection(selectedTileId);
    this.renderTypeHighlights(selectedTileId);
    this.renderTenpaiPreview(state, selectedTileId);
    return this.visualUi(playerName, selectedTileId);
  }

  renderTenpaiPreview(state, selectedTileId) {
    if (!this.showGameHints) {
      this.elements.tenpaiPreview.hidden = true;
      return;
    }
    const waits = tenpaiWaitsForDiscard(state?.legalActions, selectedTileId);
    const { tenpaiPreview, tenpaiWaits } = this.elements;
    tenpaiPreview.hidden = waits.length === 0;
    tenpaiPreview.classList.toggle(
      "is-furiten",
      waits.length > 0 &&
        tenpaiDiscardFuriten(state?.legalActions, selectedTileId),
    );
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
          `${tileFace(wait.type).label}，剩余 ${wait.remaining} 张${wait.noYaku ? "，荣和无役" : ""}`,
        );
        const tile = createTile(wait.type, "tenpai-wait");
        markDora(tile, wait.type, this.doraCounts);
        tile.setAttribute("aria-hidden", "true");
        const count = document.createElement("small");
        count.className = "tenpai-wait-count";
        count.classList.toggle("is-empty", wait.remaining === 0);
        count.textContent = `${wait.remaining} 张`;
        if (wait.noYaku) {
          const noYaku = document.createElement("small");
          noYaku.className = "tenpai-no-yaku";
          noYaku.textContent = "无役";
          noYaku.setAttribute("aria-hidden", "true");
          item.append(noYaku);
        }
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
        this.showGameHints &&
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
        this.showGameHints && Number(tile.dataset.type) === selectedType,
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
    const avatar = this.elements.stations[position]?.querySelector(
      "[data-player-avatar]",
    );
    if (!avatar) return;
    const nextSource = typeof source === "string" && source ? source : "";
    if (!nextSource) {
      avatar.classList.add("is-default-portrait");
      avatar.style.removeProperty("background-image");
      delete avatar.dataset.source;
      delete avatar.dataset.pendingSource;
      document.dispatchEvent(new Event("mahjong:player-avatar-changed"));
      return;
    }
    if (
      avatar.dataset.source === nextSource ||
      avatar.dataset.pendingSource === nextSource
    )
      return;

    avatar.dataset.pendingSource = nextSource;
    const preload = new Image();
    preload.onload = () => {
      if (avatar.dataset.pendingSource !== nextSource) return;
      avatar.dataset.source = nextSource;
      delete avatar.dataset.pendingSource;
      avatar.classList.remove("is-default-portrait");
      avatar.style.backgroundImage = `url(${JSON.stringify(nextSource)})`;
      document.dispatchEvent(new Event("mahjong:player-avatar-changed"));
    };
    preload.onerror = () => {
      if (avatar.dataset.pendingSource !== nextSource) return;
      delete avatar.dataset.pendingSource;
    };
    preload.src = nextSource;
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
    const riichiDeclared = state.riichi?.[state.players?.[0]] === true;
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
          canDiscardHandTile({
            canDiscard: state.legalActions?.canDiscard,
            riichiDeclared,
            drawnTile: state.drawnTile,
            tileId,
          }) &&
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
    elements.furiten.hidden = !this.showGameHints || !state.furiten;
    elements.actionHint.textContent = canClaim
      ? "有人打出了你需要的牌"
      : legal.canDiscard
        ? "向上拖动手牌，进入出牌区后松手打出"
        : state.phase === "hand_ended"
          ? "本局已结束"
          : "等待其他玩家";
  }

  renderCountdown(state, serverTime) {
    const element = this.elements.countdown;
    const deadline = Number(state?.turnDeadlineAt);
    const syncedServerTime = Number(serverTime);
    if (
      !element ||
      !Number.isFinite(deadline) ||
      deadline <= 0 ||
      !Number.isFinite(syncedServerTime) ||
      syncedServerTime <= 0 ||
      state?.phase === "hand_ended"
    ) {
      this.stopCountdown();
      return;
    }
    if (
      this.countdownDeadlineAt !== deadline ||
      this.countdownServerTime !== syncedServerTime
    ) {
      this.countdownDeadlineAt = deadline;
      this.countdownServerTime = syncedServerTime;
      this.countdownLocalTime = Date.now();
    }
    this.updateCountdown();
    if (!this.countdownTimer) {
      this.countdownTimer = globalThis.setInterval(() => this.updateCountdown(), 250);
    }
  }

  updateCountdown() {
    const element = this.elements.countdown;
    if (!element || !this.countdownDeadlineAt || !this.countdownServerTime) return;
    const estimatedServerTime =
      this.countdownServerTime + (Date.now() - this.countdownLocalTime);
    const remainingMs = Math.max(0, this.countdownDeadlineAt - estimatedServerTime);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    element.textContent = `${remainingSeconds}秒`;
    element.classList.toggle("is-urgent", remainingSeconds <= 5);
    element.hidden = false;
  }

  stopCountdown() {
    if (this.countdownTimer) {
      globalThis.clearInterval(this.countdownTimer);
      this.countdownTimer = 0;
    }
    this.countdownDeadlineAt = 0;
    this.countdownServerTime = 0;
    this.countdownLocalTime = 0;
    if (this.elements.countdown) {
      this.elements.countdown.hidden = true;
      this.elements.countdown.classList.remove("is-urgent");
      this.elements.countdown.textContent = "";
    }
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
          if (this.showGameHints) markDora(element, tile.type, this.doraCounts);
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

  renderStatus(
    state,
    events,
    playerName,
    { defaultNames = {}, playerNameIsAuthoritative = false } = {},
  ) {
    if (state.phase === "hand_ended") return;
    const seat = activeSeat(state);
    const name = playerDisplayName(state, seat, {
      playerName,
      defaultNames,
      playerNameIsAuthoritative,
    });
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
        { defaultNames, playerNameIsAuthoritative },
      );
      this.elements.message.classList.remove("is-pulsing");
      void this.elements.message.offsetWidth;
      this.elements.message.classList.add("is-pulsing");
    } else if (!event) {
      this.elements.message.textContent =
        this.showGameHints && state.furiten
          ? "振听中：不能荣和，但仍可自摸"
          : "一番缚 · 赤宝牌各一枚";
    }
  }

  renderResult(
    state,
    playerName,
    showResult = true,
    pageIndex = 0,
    { defaultNames = {}, playerNameIsAuthoritative = false } = {},
  ) {
    const { elements } = this;
    const ended = state.phase === "hand_ended";
    // Start warming the result scene as soon as a hand ends. Keeping it in
    // the render tree gives the backdrop time to paint before the entrance
    // animation starts, while inert and aria-hidden keep it non-interactive.
    elements.result.hidden = !ended;
    elements.result.inert = !ended || !showResult;
    elements.result.setAttribute("aria-hidden", String(!ended || !showResult));
    elements.result.classList.toggle("is-warming", ended && !showResult);
    elements.result.classList.toggle("is-entering", ended && showResult);
    if (!ended) return;
    const detailCount = resultDetailPageCount(state);
    const safePage = Math.max(0, Math.min(detailCount, Number(pageIndex) || 0));
    const rematchLabel = "继续";
    elements.rematch.setAttribute("aria-label", rematchLabel);
    elements.rematchLabel.textContent = rematchLabel;
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
    const winnerName = playerDisplayName(state, winnerIndex, {
      playerName,
      defaultNames,
      playerNameIsAuthoritative,
    });
    elements.resultDetailHands.hidden = false;
    elements.resultDetailHands.replaceChildren(
      createResultHand(state, winnerIndex, winnerName, false, this.doraCounts),
    );
    elements.resultDetailYaku.hidden = false;
    elements.resultDetailYaku.replaceChildren(
      ...asArray(result.yaku).map((yaku) => {
        const item = document.createElement("span");
        const name = document.createElement("i");
        const yakuValue = document.createElement("b");
        name.textContent = traditionalYakuName(yaku.name);
        yakuValue.textContent =
          state.winType === "nagashi"
            ? "滿貫"
            : yaku.han >= 13
              ? "役满"
              : `${yaku.han}番`;
        item.append(name, yakuValue);
        return item;
      }),
    );
  }

  renderDrawReveal(state, visible = false) {
    const { elements } = this;
    const abortive = state?.result?.abortive === true;
    const nagashi = state?.winType === "nagashi";
    const exhaustive =
      state?.phase === "hand_ended" && state?.draw === true && !abortive;
    elements.drawReveal.hidden =
      !visible || (!abortive && !exhaustive && !nagashi);
    if (elements.drawReveal.hidden) return;
    elements.drawRevealReason.textContent = traditionalDrawReason(
      abortive
        ? state.abortiveReason || state.result?.reason || "途中流局"
        : "荒牌流局",
    );
    const waitsBySeat = exhaustive ? asArray(state.result?.tenpaiWaits) : [];
    elements.drawRevealTenpai.forEach((label) => {
      const seat = Number(label.dataset.drawTenpaiSeat);
      const waits = asArray(waitsBySeat[seat - 1]).map(Number);
      label.hidden = waits.length === 0;
      label.replaceChildren(
        ...waits.map((type) => {
          const tile = createTile(type, "draw-reveal-wait");
          tile.setAttribute("aria-hidden", "true");
          return tile;
        }),
      );
      if (!label.hidden) {
        label.setAttribute(
          "aria-label",
          `听牌：${waits.map((type) => tileFace(type).label).join("、")}`,
        );
      }
    });
  }

  renderResultScores(state, playerName) {
    const { elements } = this;
    elements.resultDetailContent.hidden = true;
    elements.resultScoreContent.hidden = false;
  }
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
    gameHints: document.querySelector("#game-hints-setting"),
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
    countdown: document.querySelector("#action-countdown"),
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
    drawReveal: document.querySelector("#draw-reveal"),
    drawRevealReason: document.querySelector("#draw-reveal-reason"),
    drawRevealTenpai: [...document.querySelectorAll("[data-draw-tenpai-seat]")],
    resultStage: document.querySelector(".result-page-stage"),
    resultTrack: document.querySelector(".result-page-track"),
    resultDetailContent: document.querySelector("#result-detail-content"),
    resultScoreContent: document.querySelector("#result-score-content"),
    resultDetailHands: document.querySelector("#result-hands"),
    resultDetailYaku: document.querySelector("#result-yaku"),
    rematch: document.querySelector("#rematch-button"),
    rematchLabel: document.querySelector("#rematch-button-label"),
    matchSummary: document.querySelector("#match-summary"),
    matchSummaryRows: document.querySelector("#match-summary-rows"),
    matchSummaryPhotoCrop: document.querySelector("#match-summary-photo-crop"),
    matchSummaryPhotoImage: document.querySelector(
      "#match-summary-photo-image",
    ),
    matchSummaryRematch: document.querySelector("#match-summary-rematch"),
    matchSummarySetup: document.querySelector("#match-summary-setup"),
    setup: document.querySelector("#setup-panel"),
    setupRecoveryError: document.querySelector("#setup-recovery-error"),
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
