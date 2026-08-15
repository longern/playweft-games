import { CLAIM_LABELS, PLAYERS, POSITIONS } from "./constants.js";
import {
  activeSeat,
  asArray,
  claimPreviewTiles,
  doraIndicatorSlots,
  eventMessage,
  isRedFive,
  orderedHand,
  partitionClaimActions,
  roundLabel,
  scoreDeltaSummary,
  seatWind,
  tileFace,
  tileType,
} from "./game-format.js";
import { tileFaceFrameIndex } from "./render/tile-texture-map.js";

export class MahjongDomView {
  constructor({ onAction, onSelectTile, onDiscardTile }) {
    this.onAction = onAction;
    this.onSelectTile = onSelectTile;
    this.onDiscardTile = onDiscardTile;
    this.lastEventKey = "";
    this.elements = collectElements();
  }

  render(state, events, selectedTileId, playerName) {
    const { elements } = this;
    elements.message.classList.remove("is-error");
    const currentRound = roundLabel(state.roundWind, state.handNumber);
    elements.consoleRound.textContent = currentRound;
    elements.matchType.textContent = state.matchType === "hanchan" ? "四人南" : "四人東";
    elements.honba.textContent = String(Number(state.honba) || 0);
    elements.riichiSticks.textContent = String(Number(state.riichiSticks) || 0);
    elements.wall.textContent = `余牌 ${state.wallCount}`;
    elements.dora.replaceChildren(...doraIndicatorSlots(state).map((indicator, index) => {
      const tile = indicator
        ? createTile(indicator.type, "dora", indicator.red)
        : createTileBack();
      tile.classList.add("dora-slot", indicator ? "is-revealed" : "is-concealed");
      tile.dataset.slot = String(index + 1);
      if (indicator) {
        tile.setAttribute(
          "aria-label",
          `第 ${index + 1} 张宝牌指示牌：${tile.getAttribute("aria-label")}`,
        );
      } else {
        tile.removeAttribute("aria-hidden");
        tile.setAttribute("aria-label", `第 ${index + 1} 张宝牌指示牌尚未翻开`);
      }
      return tile;
    }));
    this.renderStations(state, playerName);
    this.renderHands(state, selectedTileId);
    this.renderRivers(state, events);
    this.renderMelds(state);
    this.renderActions(state, selectedTileId);
    this.renderStatus(state, events, playerName);
    this.renderResult(state, playerName);
  }

  renderSelection(state, selectedTileId, playerName) {
    this.renderHands(state, selectedTileId);
    this.renderActions(state, selectedTileId);
    return this.visualUi(playerName, selectedTileId);
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

  renderStations(state, playerName) {
    POSITIONS.forEach((position, index) => {
      const seat = index + 1;
      const station = this.elements.stations[position];
      const playerId = state.players[seat - 1];
      const name = state.playerNames?.[seat - 1] || PLAYERS[seat - 1].name;
      station.querySelector("[data-name]").textContent = seat === 1 ? playerName : name;
      station.querySelector("[data-wind]").textContent = seatWind(state, seat);
      const detail = station.querySelector("[data-detail]");
      const riichi = state.riichi?.[playerId] === true;
      detail.textContent = riichi ? "立直" : "";
      detail.hidden = !riichi;
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

  renderHands(state, selectedTileId) {
    const hand = orderedHand(state.ownHand, state.lastDrawn);
    const forbiddenTypes = new Set(asArray(state.legalActions?.forbiddenDiscardTypes));
    this.elements.hand.replaceChildren(
      ...hand.map((tileId) => {
        const tile = createTile(tileType(tileId), "hand", isRedFive(tileId));
        tile.dataset.tileId = String(tileId);
        tile.type = "button";
        tile.setAttribute("role", "option");
        tile.setAttribute("aria-selected", String(tileId === selectedTileId));
        tile.classList.toggle("is-selected", tileId === selectedTileId);
        tile.classList.toggle("is-drawn", tileId === Number(state.lastDrawn));
        tile.classList.toggle(
          "is-riichi-choice",
          asArray(state.legalActions?.riichiTiles).includes(tileId),
        );
        tile.disabled = !state.legalActions?.canDiscard || forbiddenTypes.has(tileType(tileId));
        tile.addEventListener("click", () => this.onSelectTile(tileId));
        tile.addEventListener("dblclick", () => this.onDiscardTile(tileId));
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
    const latest = [...events].reverse().find((event) => event.type === "discarded");
    for (let seat = 1; seat <= 4; seat += 1) {
      const position = POSITIONS[seat - 1];
      const river = asArray(state.discards?.[state.players[seat - 1]]);
      this.elements.rivers[position].replaceChildren(
        ...river.map((discard, index) => {
          const tile = createTile(discard.type, "river");
          tile.dataset.riichi = String(discard.riichi === true);
          tile.classList.toggle("is-claimed", discard.claimed);
          tile.classList.toggle(
            "is-latest",
            latest?.playerIndex === seat && index === river.length - 1,
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

  renderActions(state, selectedTileId) {
    const legal = state.legalActions ?? {};
    const { elements } = this;
    elements.claims.replaceChildren();
    const claims = asArray(legal.claims);
    const { chi: chiClaims, immediate: immediateClaims } = partitionClaimActions(claims);
    for (const claim of immediateClaims) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `claim-action claim-${claim.kind}`;
      button.textContent = CLAIM_LABELS[claim.kind] ?? claim.kind;
      button.addEventListener("click", () =>
        this.onAction({ type: "claim", option: claim.option }));
      elements.claims.append(button);
    }
    if (chiClaims.length > 0) {
      elements.claims.append(this.createChiAction(chiClaims));
    }
    for (const kan of asArray(legal.selfKans)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "claim-action";
      button.textContent = CLAIM_LABELS[kan.kind] ?? "杠";
      button.addEventListener("click", () => this.onAction({
        type: "kan",
        kind: kan.kind,
        tileType: kan.tileType,
      }));
      elements.claims.append(button);
    }
    const canClaim = claims.length > 0;
    elements.pass.hidden = !canClaim;
    elements.abort.hidden = !legal.canAbortNine;
    elements.tsumo.hidden = !legal.canTsumo;
    elements.riichi.hidden = !legal.canRiichi;
    elements.riichi.disabled = !asArray(legal.riichiTiles).includes(selectedTileId);
    elements.furiten.hidden = !state.furiten;
    elements.discard.hidden = canClaim || legal.canTsumo;
    elements.discard.disabled = !legal.canDiscard || selectedTileId === 0;
    elements.actionHint.textContent = canClaim
      ? "有人打出了你需要的牌"
      : legal.canDiscard
        ? selectedTileId
          ? "再次点击或按“打出”确认"
          : "选择一张手牌"
        : state.phase === "hand_ended"
          ? "本局已结束"
          : "等待其他玩家";
  }

  createChiAction(claims) {
    const group = document.createElement("div");
    group.className = "claim-action-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "claim-action claim-chi";
    button.textContent = CLAIM_LABELS.chi;
    group.append(button);

    if (claims.length === 1) {
      button.addEventListener("click", () =>
        this.onAction({ type: "claim", option: claims[0].option }));
      return group;
    }

    const layer = document.createElement("div");
    layer.className = "claim-choice-layer";
    layer.hidden = true;
    layer.tabIndex = -1;
    const picker = document.createElement("div");
    picker.id = "chi-choice-popover";
    picker.className = "claim-choice-popover";
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", "选择吃法");
    picker.setAttribute("aria-modal", "true");
    const heading = document.createElement("strong");
    heading.textContent = "选择吃法";
    const list = document.createElement("div");
    list.className = "claim-choice-list";
    list.style.setProperty("--claim-choice-columns", String(Math.min(3, claims.length)));
    for (const claim of claims) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "claim-choice";
      const preview = claimPreviewTiles(claim);
      choice.setAttribute(
        "aria-label",
        `吃：${preview.map((tile) => `${tile.red ? "赤" : ""}${tileFace(tile.type).label}`).join("、")}`,
      );
      choice.append(...preview.map((tile) => {
        const element = createTile(tile.type, "claim-choice", tile.red);
        element.setAttribute("aria-hidden", "true");
        return element;
      }));
      choice.addEventListener("click", () =>
        this.onAction({ type: "claim", option: claim.option }));
      list.append(choice);
    }
    picker.append(heading, list);
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
    const name = seat === 1
      ? playerName
      : state.playerNames?.[seat - 1] || PLAYERS[seat - 1]?.name;
    this.elements.heading.textContent = state.phase === "claiming"
      ? seat === 1 ? "可以鸣牌" : `${name} 正在考虑`
      : seat === 1 ? "轮到你出牌" : `${name} 的回合`;

    const event = [...events].reverse().find((item) => item.type !== "claim_passed");
    const key = event ? JSON.stringify(event) : "";
    if (event && key !== this.lastEventKey) {
      this.lastEventKey = key;
      this.elements.message.textContent = eventMessage(state, event, playerName);
      this.elements.message.classList.remove("is-pulsing");
      void this.elements.message.offsetWidth;
      this.elements.message.classList.add("is-pulsing");
    } else if (!event) {
      this.elements.message.textContent = state.furiten
        ? "振听中：不能荣和，但仍可自摸"
        : "一番缚 · 赤宝牌各一枚";
    }
  }

  renderResult(state, playerName) {
    const { elements } = this;
    const ended = state.phase === "hand_ended";
    elements.result.hidden = !ended;
    if (!ended) return;
    if (state.draw) {
      const abortive = Boolean(state.result?.abortive);
      elements.resultKicker.textContent = abortive ? "途中流局" : "牌山摸尽";
      elements.resultTitle.textContent = state.abortiveReason || "流局";
      elements.resultSummary.textContent = `${state.result?.payment ?? "不听罚符结算"}。${state.matchEnded ? state.endReason || "对局结束。" : "准备下一局。"}`;
      elements.resultYaku.textContent = scoreDeltaSummary(state, playerName);
      elements.rematch.textContent = state.matchEnded ? "同规则再战" : "下一局";
      return;
    }
    const winnerName = state.winnerIndex === 1
      ? playerName
      : state.playerNames?.[state.winnerIndex - 1] || PLAYERS[state.winnerIndex - 1].name;
    const winnerNames = asArray(state.winners).map((id) => {
      const index = state.players.indexOf(id);
      return index === 0
        ? playerName
        : state.playerNames?.[index] || PLAYERS[index]?.name;
    });
    elements.resultKicker.textContent = state.winType === "tsumo"
      ? "自摸和牌"
      : state.winType === "nagashi" ? "流局满贯" : "荣和";
    elements.resultTitle.textContent = winnerNames.length > 1
      ? `${winnerNames.join("、")} 和牌`
      : state.winnerIndex === 1 ? "你赢了" : `${winnerName} 和牌`;
    const result = state.result ?? {};
    const value = result.limit || `${result.han ?? 0} 番 ${result.fu ?? 0} 符`;
    elements.resultSummary.textContent = `${value} · ${result.payment ?? "已结算"}`;
    const allResults = asArray(state.results).length ? asArray(state.results) : [result];
    elements.resultYaku.replaceChildren(
      ...allResults.flatMap((scored, scoreIndex) => asArray(scored.yaku).map((yaku) => {
        const item = document.createElement("span");
        const prefix = allResults.length > 1 ? `${winnerNames[scoreIndex]}：` : "";
        item.textContent = `${prefix}${yaku.name} ${yaku.han >= 13 ? "役满" : `${yaku.han}番`}`;
        return item;
      })),
    );
    const delta = document.createElement("b");
    delta.textContent = scoreDeltaSummary(state, playerName);
    elements.resultYaku.append(delta);
    elements.rematch.textContent = state.matchEnded ? "同规则再战" : "下一局";
  }
}

function collectElements() {
  return {
    app: document.querySelector("#mahjong-app"),
    loading: document.querySelector("#loading-panel"),
    loadingMessage: document.querySelector("#loading-message"),
    stage: document.querySelector("#mahjong-stage"),
    consoleRound: document.querySelector("#console-round"),
    matchType: document.querySelector(".match-type-label"),
    honba: document.querySelector("#honba-count"),
    riichiSticks: document.querySelector("#riichi-stick-count"),
    wall: document.querySelector("#wall-count"),
    consoleScores: [...document.querySelectorAll("[data-console-score]")]
      .sort((left, right) => Number(left.dataset.consoleScore) - Number(right.dataset.consoleScore)),
    dora: document.querySelector("#dora-list"),
    heading: document.querySelector("#turn-heading"),
    message: document.querySelector("#table-message"),
    actionHint: document.querySelector("#action-hint"),
    claims: document.querySelector("#claim-actions"),
    pass: document.querySelector("#pass-button"),
    abort: document.querySelector("#abort-button"),
    tsumo: document.querySelector("#tsumo-button"),
    riichi: document.querySelector("#riichi-button"),
    discard: document.querySelector("#discard-button"),
    furiten: document.querySelector("#furiten-badge"),
    hand: document.querySelector("#hand-bottom"),
    result: document.querySelector("#result-panel"),
    resultKicker: document.querySelector("#result-kicker"),
    resultTitle: document.querySelector("#result-title"),
    resultSummary: document.querySelector("#result-summary"),
    resultYaku: document.querySelector("#result-yaku"),
    rematch: document.querySelector("#rematch-button"),
    setup: document.querySelector("#setup-panel"),
    opponentHands: {
      top: document.querySelector("#hand-top"),
      right: document.querySelector("#hand-right"),
      left: document.querySelector("#hand-left"),
    },
    rivers: Object.fromEntries(POSITIONS.map((position) => [
      position,
      document.querySelector(`#river-${position}`),
    ])),
    melds: Object.fromEntries(POSITIONS.map((position) => [
      position,
      document.querySelector(`#meld-${position}`),
    ])),
    stations: Object.fromEntries(POSITIONS.map((position) => [
      position,
      document.querySelector(`#player-${position}`),
    ])),
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
