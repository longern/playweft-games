import { Bookmark, BookmarkCheck, Play, createIcons } from "lucide";

const paipuIcons = { Bookmark, BookmarkCheck, Play };

export function createMahjongPaipuPanel({
  document,
  window,
  elements,
  getGame,
  getPlayMode,
  listMahjongPaipuSummaries,
  setMahjongPaipuPinned,
  onReplay,
}) {
  let openingFrame = 0;
  let closingTimer = 0;
  let open = false;
  let returnFocus = null;

  async function show() {
    if (!elements.panel || getGame() || getPlayMode() !== "solo" || open)
      return;
    if (openingFrame) window.cancelAnimationFrame(openingFrame);
    if (closingTimer) window.clearTimeout(closingTimer);
    openingFrame = 0;
    closingTimer = 0;
    returnFocus = document.activeElement;
    open = true;
    elements.panel.classList.remove("is-open");
    elements.panel.hidden = false;
    await renderList();
    openingFrame = window.requestAnimationFrame(() => {
      openingFrame = 0;
      if (!open) return;
      elements.panel.classList.add("is-open");
      elements.card?.focus({ preventScroll: true });
    });
  }

  function hide({ animate = true, restoreFocus = true } = {}) {
    if (!elements.panel || (!open && elements.panel.hidden)) return;
    if (openingFrame) window.cancelAnimationFrame(openingFrame);
    if (closingTimer) window.clearTimeout(closingTimer);
    openingFrame = 0;
    closingTimer = 0;
    open = false;
    elements.panel.classList.remove("is-open");
    const reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    if (animate && !reducedMotion) {
      closingTimer = window.setTimeout(() => finishClose(restoreFocus), 240);
      return;
    }
    finishClose(restoreFocus);
  }

  function finishClose(restoreFocus) {
    if (open || !elements.panel) return;
    if (closingTimer) window.clearTimeout(closingTimer);
    closingTimer = 0;
    elements.panel.hidden = true;
    elements.list.replaceChildren();
    elements.empty.hidden = true;
    if (restoreFocus) returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  async function renderList() {
    elements.list.replaceChildren();
    elements.empty.hidden = true;
    try {
      const summaries = await listMahjongPaipuSummaries();
      if (!summaries.length) {
        elements.empty.hidden = false;
        return;
      }
      for (const summary of summaries) {
        elements.list.append(renderEntry(summary));
      }
      createIcons({ icons: paipuIcons, root: elements.list });
    } catch (error) {
      console.error("Unable to read Mahjong paipu list", error);
      elements.empty.textContent = "牌谱暂时无法读取";
      elements.empty.hidden = false;
    }
  }

  function renderEntry(summary) {
    const item = document.createElement("li");
    item.className = "paipu-entry";
    const info = document.createElement("div");
    info.className = "paipu-entry-info";
    const players = document.createElement("div");
    players.className = "paipu-entry-players";
    for (const player of summaryPlayers(summary)) {
      const playerEntry = document.createElement("div");
      playerEntry.className = `paipu-entry-player${
        player.isLocal ? " is-local" : ""
      }`;
      const name = document.createElement(player.isLocal ? "strong" : "span");
      name.className = "paipu-entry-player-name";
      name.textContent = player.name || (player.isLocal ? "你" : `玩家${player.seat}`);
      name.title = name.textContent;
      const score = document.createElement(player.isLocal ? "strong" : "span");
      score.className = "paipu-entry-player-score";
      score.textContent = String(player.score);
      playerEntry.append(name, score);
      players.append(playerEntry);
    }
    const meta = document.createElement("div");
    meta.className = "paipu-entry-meta";
    const matchType = document.createElement("span");
    matchType.className = "paipu-entry-match-type";
    matchType.textContent = summary.matchType === "hanchan" ? "南风场" : "东风场";
    const date = document.createElement("time");
    const endedAt = new Date(Number(summary.endedAtMs));
    if (Number.isFinite(endedAt.getTime())) date.dateTime = endedAt.toISOString();
    date.textContent = formatDate(summary.endedAtMs);
    meta.append(matchType, date);
    info.append(players, meta);
    const actions = document.createElement("div");
    actions.className = "paipu-entry-actions";
    const replay = document.createElement("button");
    replay.type = "button";
    replay.className = "paipu-entry-action";
    replay.setAttribute("aria-label", "回放");
    replay.title = "回放";
    replay.innerHTML = '<i data-lucide="play" aria-hidden="true"></i>';
    replay.addEventListener("click", () => void onReplay(summary.id));
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "paipu-entry-action";
    pin.setAttribute("aria-label", summary.pinned ? "取消收藏" : "收藏");
    pin.title = summary.pinned ? "取消收藏" : "收藏";
    pin.setAttribute("aria-pressed", String(summary.pinned));
    pin.innerHTML = `<i data-lucide="${summary.pinned ? "bookmark-check" : "bookmark"}" aria-hidden="true"></i>`;
    pin.addEventListener("click", async () => {
      pin.disabled = true;
      try {
        await setMahjongPaipuPinned(summary.id, !summary.pinned);
        await renderList();
      } catch (error) {
        console.error("Unable to update Mahjong paipu favorite", error);
        pin.disabled = false;
      }
    });
    actions.append(replay, pin);
    item.append(info, actions);
    return item;
  }

  function summaryPlayers(summary) {
    if (Array.isArray(summary?.players) && summary.players.length === 4) {
      return summary.players
        .map((player, index) => ({
          seat: Number(player?.seat) || index + 1,
          id: String(player?.id || ""),
          name: String(player?.name || ""),
          score: Number(player?.score) || 0,
          isLocal: String(player?.id || "") === String(summary?.viewerPlayerId || ""),
        }))
        .sort(
          (left, right) =>
            right.score - left.score || left.seat - right.seat,
        );
    }
    return [];
  }

  function formatDate(value) {
    const date = new Date(Number(value));
    return Number.isFinite(date.getTime())
      ? date.toLocaleString("zh-CN", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "未知时间";
  }

  return { show, hide, renderList, isOpen: () => open };
}
