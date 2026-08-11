const ROLE_DETAILS = {
  werewolf: { name: "狼人", mark: "W", copy: "每晚与同伴确认目标。" },
  villager: { name: "平民", mark: "V", copy: "观察发言，在白天投票。" },
  seer: { name: "预言家", mark: "S", copy: "每晚可以查验一位玩家。" },
  witch: { name: "女巫", mark: "P", copy: "持有解药与毒药，各限一次。" },
  hunter: { name: "猎人", mark: "H", copy: "出局时可发动猎枪。" },
  white_god: { name: "白神", mark: "G", copy: "被投出后翻牌，立即离场。" },
};

export function startSoloDealer({ root, setConnection }) {
  let state = createSetupState(8);
  root.innerHTML = soloShell();

  const playerCount = root.querySelector("#solo-player-count");
  const startButton = root.querySelector("#solo-start");
  const setup = root.querySelector("#solo-setup");
  const deal = root.querySelector("#solo-deal");
  const grid = root.querySelector("#solo-card-grid");
  const progress = root.querySelector("#solo-progress");
  const reset = root.querySelector("#solo-reset");
  const privacy = root.querySelector("#solo-privacy");
  const privacyTitle = root.querySelector("#solo-privacy-title");
  const reveal = root.querySelector("#solo-reveal");
  const roleCard = root.querySelector("#solo-role-card");
  const roleMark = root.querySelector("#solo-role-mark");
  const roleName = root.querySelector("#solo-role-name");
  const roleCopy = root.querySelector("#solo-role-copy");
  const cover = root.querySelector("#solo-cover");

  setConnection("live", "本机单机发牌");

  playerCount.addEventListener("change", () => {
    const count = clampCount(Number(playerCount.value));
    playerCount.value = String(count);
    state = createSetupState(count);
  });

  startButton.addEventListener("click", () => {
    const count = clampCount(Number(playerCount.value));
    state = createDealState(count);
    render();
  });

  reset.addEventListener("click", () => {
    state = createSetupState(state.playerCount);
    playerCount.value = String(state.playerCount);
    render();
  });

  reveal.addEventListener("click", () => {
    if (state.phase !== "privacy" || state.activeIndex == null) return;
    state.phase = "reveal";
    render();
  });

  cover.addEventListener("click", () => {
    if (state.phase !== "reveal" || state.activeIndex == null) return;
    state.viewed[state.activeIndex] = true;
    state.activeIndex = null;
    state.phase = "dealing";
    render();
  });

  privacy.addEventListener("click", (event) => {
    if (event.target === privacy && state.phase === "privacy") {
      state.activeIndex = null;
      state.phase = "dealing";
      render();
    }
  });

  render();

  function render() {
    const inSetup = state.phase === "setup";
    setup.hidden = !inSetup;
    deal.hidden = inSetup;
    privacy.hidden = state.phase !== "privacy" && state.phase !== "reveal";

    if (inSetup) return;

    const viewedCount = state.viewed.filter(Boolean).length;
    const completed = viewedCount === state.playerCount;
    progress.textContent = completed
      ? `全部 ${state.playerCount} 位玩家都已查看身份，可以开始游戏。`
      : `已查看 ${viewedCount} / ${state.playerCount} · 点击自己的编号牌查看身份`;

    grid.innerHTML = state.roles
      .map((_, index) => {
        const viewed = state.viewed[index];
        return `<button class="solo-deal-card${viewed ? " is-viewed" : ""}" type="button" data-card-index="${index}" ${viewed ? "disabled" : ""}>
          <span class="solo-card-number">${index + 1}</span>
          <span class="solo-card-state">${viewed ? "✓ 已查看" : "点击抽牌"}</span>
        </button>`;
      })
      .join("");

    grid.querySelectorAll("[data-card-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.cardIndex);
        if (!Number.isInteger(index) || state.viewed[index]) return;
        state.activeIndex = index;
        state.phase = "privacy";
        render();
      });
    });

    if (state.activeIndex == null) return;
    const number = state.activeIndex + 1;
    privacyTitle.textContent = `${number} 号玩家`;

    if (state.phase === "privacy") {
      privacy.dataset.stage = "privacy";
      reveal.hidden = false;
      roleCard.hidden = true;
      cover.hidden = true;
      return;
    }

    const role = state.roles[state.activeIndex];
    const detail = ROLE_DETAILS[role];
    privacy.dataset.stage = "reveal";
    reveal.hidden = true;
    roleCard.hidden = false;
    roleCard.dataset.role = role;
    roleMark.textContent = detail.mark;
    roleName.textContent = detail.name;
    roleCopy.textContent = detail.copy;
    cover.hidden = false;
  }
}

function createSetupState(playerCount) {
  return {
    phase: "setup",
    playerCount,
    roles: [],
    viewed: [],
    activeIndex: null,
  };
}

function createDealState(playerCount) {
  return {
    phase: "dealing",
    playerCount,
    roles: shuffle(roleDeck(playerCount)),
    viewed: Array(playerCount).fill(false),
    activeIndex: null,
  };
}

function roleDeck(playerCount) {
  const deck = ["seer", "witch", "hunter", "white_god"];
  const wolfCount = Math.max(2, Math.floor(playerCount / 3));
  for (let index = 0; index < wolfCount; index += 1) deck.push("werewolf");
  while (deck.length < playerCount) deck.push("villager");
  return deck;
}

function shuffle(values) {
  const deck = [...values];
  const random = new Uint32Array(deck.length);
  crypto.getRandomValues(random);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = random[index] % (index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function clampCount(value) {
  if (!Number.isFinite(value)) return 8;
  return Math.min(12, Math.max(6, Math.round(value)));
}

function soloShell() {
  return `
    <section id="solo-setup" class="solo-setup-panel">
      <div class="dealer-status">
        <p>单机发牌</p>
        <h2>一台手机完成整桌发牌</h2>
        <p>选择人数后洗牌。每位玩家只点击自己的编号牌，查看后立即盖回并把手机交给下一位。</p>
      </div>
      <div class="solo-setup-card">
        <label for="solo-player-count">玩家人数</label>
        <select id="solo-player-count">
          ${Array.from({ length: 7 }, (_, index) => index + 6)
            .map((count) => `<option value="${count}" ${count === 8 ? "selected" : ""}>${count} 人</option>`)
            .join("")}
        </select>
        <p>角色构成与在线模式一致：预言家、女巫、猎人、白神各 1 名，狼人约占三分之一，其余为平民。</p>
        <button id="solo-start" class="solo-primary-action" type="button">洗牌并开始发牌</button>
      </div>
    </section>

    <section id="solo-deal" class="solo-deal-panel" hidden>
      <div class="dealer-status">
        <p>编号牌堆</p>
        <h2>请选择自己的编号</h2>
        <p id="solo-progress"></p>
      </div>
      <div id="solo-card-grid" class="solo-card-grid" aria-label="身份牌堆"></div>
      <button id="solo-reset" class="redeal-action solo-reset-action" type="button">重新发牌</button>
    </section>

    <div id="solo-privacy" class="solo-privacy" data-stage="privacy" hidden>
      <div class="solo-privacy-card">
        <p>请只让当前玩家看屏幕</p>
        <h2 id="solo-privacy-title">1 号玩家</h2>
        <div class="solo-privacy-prompt">
          <strong>确认周围没人看到屏幕后，再查看身份。</strong>
          <span>查看后请立即盖回，再把手机交给下一位玩家。</span>
        </div>
        <button id="solo-reveal" class="solo-primary-action" type="button">查看我的身份</button>
        <div id="solo-role-card" class="role-card solo-role-card" data-role="hidden" hidden>
          <span id="solo-role-mark" class="role-emblem">?</span>
          <strong id="solo-role-name">身份</strong>
          <p id="solo-role-copy"></p>
        </div>
        <button id="solo-cover" class="solo-primary-action" type="button" hidden>盖回身份</button>
      </div>
    </div>`;
}
