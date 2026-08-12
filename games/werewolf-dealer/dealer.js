import {
  PRESETS,
  addCustomGod,
  clonePreset,
  normalizedConfig,
  roleCount,
} from "./role-config.js";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Star,
  X,
  createIcons,
} from "lucide";
import { createOverlayDialog } from "../../src/components/overlay-dialog.js";
import { createPresence } from "../../src/components/presence.js";

const STORAGE_KEY = "playweft:werewolf-dealer:dealer-preferences:v1";
const LEGACY_STORAGE_KEY = "playweft:werewolf-dealer:solo-preferences:v1";
const MAX_FAVORITES_ON_HOME = 4;
const DEALER_ICONS = {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Star,
  X,
};
const FEATURED_PRESET_IDS = {
  6: ["basic-6"],
  7: ["basic-7"],
  8: ["basic-8"],
  9: ["basic-9"],
  10: ["basic-10"],
  11: ["basic-11"],
  12: [
    "seer-witch-hunter-white",
    "wolf-king-guard",
    "gargoyle-gravekeeper",
    "mechanical-wolf-psychic",
  ],
};

function setVisible(element, visible) {
  element.hidden = !visible;
}

export function startDealer({ root, setConnection, room }) {
  const isRoom = Boolean(room);
  let canConfigure = room?.canConfigure ?? true;
  document.body.classList.add("is-dealer-config");
  const preferences = loadPreferences();
  let state = {
    phase: "setup",
    playerCount: isRoom
      ? clampPlayerCount(room.playerCount)
      : clampPlayerCount(preferences.playerCount),
    config: room?.config ? cloneConfig(room.config) : null,
    roles: [],
    viewed: [],
    activeIndex: null,
  };
  let pickerSelectedId = null;
  let pickerPresetIds = [];
  let pickerFavoritesChanged = false;
  let editorDraft;
  let lastFocusedElement;
  let rulesExpanded = false;
  let renderedRulesKey = "";
  let quickPresetIds = buildQuickPresetIds(preferences, state.playerCount);

  const template = document.querySelector("#dealer-template");
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error("Missing #dealer-template");
  }
  root.replaceChildren(template.content.cloneNode(true));
  const $ = (id) => root.querySelector(`#${id}`);
  const elements = {
    back: document.querySelector("#dealer-back"),
    setup: $("dealer-setup"),
    configShell: root.querySelector(".dealer-config-shell"),
    deal: $("dealer-deal"),
    grid: $("dealer-card-grid"),
    progress: $("dealer-progress"),
    countSection: $("dealer-count-section"),
    playerCount: $("dealer-player-count"),
    decrease: $("dealer-count-decrease"),
    increase: $("dealer-count-increase"),
    countPicker: $("dealer-player-count-picker"),
    countOptions: root.querySelector(".dealer-count-options"),
    quickPresets: $("dealer-quick-presets"),
    presetSection: root.querySelector(".dealer-preset-section"),
    selectedName: $("dealer-selected-name"),
    selectedCount: $("dealer-selected-count"),
    selectedPreset: $("dealer-selected-preset"),
    selectedRoles: $("dealer-selected-roles"),
    selectedRules: $("dealer-selected-rules-copy"),
    toggleRules: $("dealer-toggle-rules"),
    configFeedback: $("dealer-config-feedback"),
    actionBarPresence: $("dealer-action-bar-presence"),
    start: $("dealer-start"),
    openPicker: $("dealer-open-picker"),
    changePreset: $("dealer-change-preset"),
    openEditor: $("dealer-open-editor"),
    picker: $("dealer-preset-picker"),
    pickerSearch: $("dealer-preset-search"),
    pickerGrid: $("dealer-preset-grid"),
    pickerEmpty: $("dealer-preset-empty"),
    editor: $("dealer-role-editor"),
    editorTitle: $("dealer-editor-title"),
    editorName: $("dealer-preset-name"),
    editorRoles: $("dealer-editor-roles"),
    editorRules: $("dealer-editor-rules"),
    editorFeedback: $("dealer-editor-feedback"),
    editorSave: $("dealer-editor-save"),
    editorDelete: $("dealer-editor-delete"),
    privacyLayer: $("dealer-privacy-layer"),
    privacy: $("dealer-privacy"),
    privacyTitle: $("dealer-privacy-title"),
    reveal: $("dealer-reveal"),
    roleFlip: $("dealer-role-flip"),
    roleCard: $("dealer-role-card"),
    roleMark: $("dealer-role-mark"),
    roleName: $("dealer-role-name"),
    roleCopy: $("dealer-role-copy"),
    cover: $("dealer-cover"),
  };
  const actionBarPresence = createPresence({
    element: elements.actionBarPresence,
    enter: (element, { wasHidden }) => {
      const current = getComputedStyle(element);
      return {
        transform: [
          wasHidden ? "translateY(100%)" : current.transform,
          "translateY(0%)",
        ],
        opacity: [wasHidden ? 0.92 : Number(current.opacity), 1],
      };
    },
    exit: { transform: "translateY(100%)", opacity: 0.92 },
    enterOptions: { duration: 0.2, ease: [0, 0, 0.2, 1] },
    exitOptions: { duration: 0.16, ease: [0.4, 0, 1, 1] },
    clearStyles: ["transform", "opacity"],
  });
  const dialogControllers = new Map([
    [
      elements.countPicker,
      createOverlayDialog({
        root: elements.countPicker,
        surface: elements.countPicker.querySelector(".dealer-dialog-panel"),
        closeButtons: elements.countPicker.querySelectorAll(
          "[data-close-dialog]",
        ),
        returnFocus: () => lastFocusedElement,
      }),
    ],
    [
      elements.picker,
      createOverlayDialog({
        root: elements.picker,
        surface: elements.picker.querySelector(".dealer-dialog-panel"),
        closeButtons: elements.picker.querySelectorAll("[data-close-dialog]"),
        beforeClose: syncPickerFavorites,
        returnFocus: () => lastFocusedElement,
      }),
    ],
    [
      elements.editor,
      createOverlayDialog({
        root: elements.editor,
        surface: elements.editor.querySelector(".dealer-dialog-panel"),
        closeButtons: elements.editor.querySelectorAll("[data-close-dialog]"),
        initialFocus: () => elements.editorName,
        returnFocus: () => lastFocusedElement,
      }),
    ],
  ]);

  setConnection("live", isRoom ? "房间配置中" : "本机单机发牌");

  elements.decrease.addEventListener("click", () => adjustPlayerCount(-1));
  elements.increase.addEventListener("click", () => adjustPlayerCount(1));
  elements.playerCount.addEventListener("click", openPlayerCountPicker);
  elements.countOptions.addEventListener("click", selectPlayerCount);
  elements.quickPresets.addEventListener("click", handlePresetCardClick);
  elements.openPicker.addEventListener("click", openPresetPicker);
  elements.changePreset.addEventListener("click", openPresetPicker);
  elements.back.addEventListener("click", clearPresetSelection);
  elements.openEditor.addEventListener("click", openRoleEditor);
  elements.toggleRules.addEventListener("click", toggleSelectedRules);
  elements.start.addEventListener("click", startDealing);
  $("dealer-reset").addEventListener("click", resetToSetup);

  elements.pickerSearch.addEventListener("input", renderPresetPicker);
  elements.pickerGrid.addEventListener("click", handlePickerClick);
  elements.editorName.addEventListener("input", readEditorDraft);
  elements.editorRules.addEventListener("input", readEditorDraft);
  elements.editorRoles.addEventListener("input", readEditorDraft);
  elements.editorRoles.addEventListener("click", handleEditorRoleClick);
  $("dealer-editor-add-role").addEventListener("click", addEditorRole);
  elements.editorSave.addEventListener("click", saveRoleEditor);
  elements.editorDelete.addEventListener("click", deleteCustomPreset);

  elements.reveal.addEventListener("click", () => {
    if (state.phase !== "privacy") return;
    state.phase = "reveal";
    render();
  });
  elements.cover.addEventListener("click", coverRole);
  elements.privacy.addEventListener("click", (event) => {
    if (event.target !== elements.privacy || state.phase !== "privacy") return;
    state.activeIndex = null;
    state.phase = "dealing";
    render();
  });
  render();

  const controller = {
    update(nextRoom) {
      if (!isRoom || state.phase !== "setup") return;
      canConfigure = nextRoom.canConfigure;
      state.playerCount = clampPlayerCount(nextRoom.playerCount);
      state.config = nextRoom.config ? cloneConfig(nextRoom.config) : null;
      quickPresetIds = buildQuickPresetIds(preferences, state.playerCount);
      render();
    },
    destroy() {
      actionBarPresence.destroy();
      document.body.classList.remove(
        "is-dealer-config",
        "is-dealer-config-setup",
      );
      elements.back.hidden = true;
    },
  };

  function adjustPlayerCount(change) {
    setPlayerCount(state.playerCount + change);
  }

  function setPlayerCount(value) {
    if (isRoom) return;
    state.playerCount = clampPlayerCount(value);
    state.config = null;
    pickerSelectedId = null;
    quickPresetIds = buildQuickPresetIds(preferences, state.playerCount);
    preferences.playerCount = state.playerCount;
    persistPreferences(preferences);
    render();
  }

  function openPlayerCountPicker() {
    elements.countOptions
      .querySelectorAll("[data-player-count]")
      .forEach((option) => {
        const selected =
          Number(option.dataset.playerCount) === state.playerCount;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-selected", String(selected));
      });
    openDialog(elements.countPicker);
  }

  function selectPlayerCount(event) {
    const option = event.target.closest("[data-player-count]");
    if (!option) return;
    setPlayerCount(Number(option.dataset.playerCount));
    closeDialog(elements.countPicker);
  }

  function handlePresetCardClick(event) {
    const favorite = event.target.closest("[data-favorite-preset]");
    if (favorite) {
      const id = favorite.dataset.favoritePreset;
      updateFavoriteButton(favorite, id, toggleFavorite(id));
      return;
    }
    const select = event.target.closest("[data-select-preset]");
    if (select) selectPreset(select.dataset.selectPreset);
  }

  function openPresetPicker() {
    pickerSelectedId = state.config?.presetId ?? null;
    pickerPresetIds = orderedPresets(preferences)
      .filter((preset) => roleCount(preset) === state.playerCount)
      .map((preset) => preset.presetId ?? preset.id);
    pickerFavoritesChanged = false;
    elements.pickerSearch.value = "";
    renderPresetPicker();
    openDialog(elements.picker);
  }

  function handlePickerClick(event) {
    const favorite = event.target.closest("[data-favorite-preset]");
    if (favorite) {
      const id = favorite.dataset.favoritePreset;
      updateFavoriteButton(favorite, id, toggleFavorite(id));
      pickerFavoritesChanged = true;
      return;
    }
    const select = event.target.closest("[data-select-preset]");
    if (!select) return;
    const id = select.dataset.selectPreset;
    pickerSelectedId = id;
    ensureQuickPresetVisible(id);
    selectPreset(id);
    closeDialog(elements.picker);
  }

  function selectPreset(id) {
    if (!canConfigure) return;
    const preset = findPreset(id, preferences.customPresets);
    if (!preset) return;
    state.config = cloneConfig(preset);
    state.playerCount = clampPlayerCount(roleCount(preset));
    preferences.playerCount = state.playerCount;
    persistPreferences(preferences);
    render();
    if (isRoom) room.onConfigure(normalizedConfig(state.config));
  }

  function clearPresetSelection() {
    if (!canConfigure) return;
    state.config = null;
    pickerSelectedId = null;
    render();
    if (isRoom) room.onConfigure(null);
  }

  function toggleFavorite(id) {
    const index = preferences.favorites.indexOf(id);
    if (index >= 0) preferences.favorites.splice(index, 1);
    else preferences.favorites.unshift(id);
    preferences.favorites = preferences.favorites.slice(0, 12);
    persistPreferences(preferences);
    return preferences.favorites.includes(id);
  }

  function updateFavoriteButton(button, id, favorite) {
    const name = findPreset(id, preferences.customPresets)?.name ?? "版型";
    button.classList.toggle("is-favorite", favorite);
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute(
      "aria-label",
      `${favorite ? "取消收藏" : "收藏"}${name}`,
    );
  }

  function syncPickerFavorites() {
    if (!pickerFavoritesChanged) return;
    pickerFavoritesChanged = false;
    quickPresetIds = buildQuickPresetIds(preferences, state.playerCount);
    renderQuickPresets();
  }

  function ensureQuickPresetVisible(id) {
    if (quickPresetIds.includes(id)) return;
    quickPresetIds = [id, ...quickPresetIds].slice(0, MAX_FAVORITES_ON_HOME);
  }

  function openRoleEditor() {
    if (!state.config || !canConfigure) return;
    const sourceIsPreset = PRESETS.some(
      (preset) => preset.id === state.config.presetId,
    );
    editorDraft = cloneConfig(state.config);
    if (sourceIsPreset) {
      editorDraft.presetId = `custom_${crypto.randomUUID().slice(0, 8)}`;
      editorDraft.name = `${editorDraft.name}（自定义）`;
    }
    elements.editorTitle.textContent = "编辑身份";
    elements.editorDelete.hidden = sourceIsPreset;
    renderRoleEditor();
    openDialog(elements.editor);
  }

  function readEditorDraft() {
    if (!editorDraft) return;
    editorDraft.name = elements.editorName.value;
    editorDraft.rules = elements.editorRules.value;
    editorDraft.roles = [
      ...elements.editorRoles.querySelectorAll("[data-role-row]"),
    ].map((row) => {
      const name = row.querySelector("[data-role-name]").value;
      return {
        id: row.dataset.roleId,
        name,
        mark: name.trim().slice(0, 1),
        team: row.dataset.team,
        copy: row.dataset.copy,
        count: Number(row.querySelector("[data-role-count]").value),
      };
    });
    updateEditorFeedback();
  }

  function handleEditorRoleClick(event) {
    const adjust = event.target.closest("[data-adjust-role]");
    if (adjust) {
      readEditorDraft();
      const index = Number(adjust.dataset.roleIndex);
      const role = editorDraft.roles[index];
      if (!role) return;
      role.count = Math.min(
        12,
        Math.max(0, role.count + Number(adjust.dataset.adjustRole)),
      );
      renderRoleEditor();
      return;
    }
    const remove = event.target.closest("[data-remove-role]");
    if (!remove) return;
    readEditorDraft();
    editorDraft.roles.splice(Number(remove.dataset.removeRole), 1);
    renderRoleEditor();
  }

  function addEditorRole() {
    readEditorDraft();
    addCustomGod(editorDraft);
    renderRoleEditor();
    elements.editorRoles
      .querySelector("[data-role-row]:last-child [data-role-name]")
      ?.focus();
  }

  function renderRoleEditor() {
    if (!editorDraft) return;
    elements.editorName.value = editorDraft.name;
    elements.editorRules.value = editorDraft.rules;
    elements.editorRoles.innerHTML = editorDraft.roles
      .map((role, index) => editorRoleRow(role, index))
      .join("");
    updateEditorFeedback();
    renderIcons();
  }

  function updateEditorFeedback() {
    const count = roleCount(editorDraft);
    const validName = Boolean(editorDraft.name.trim());
    elements.editorFeedback.textContent = validName
      ? roleCountMessage(count, state.playerCount)
      : "请填写版型名称。";
    elements.editorFeedback.dataset.ready = String(
      validName && count === state.playerCount,
    );
    elements.editorSave.disabled = !validName || count !== state.playerCount;
  }

  function saveRoleEditor() {
    readEditorDraft();
    if (
      roleCount(editorDraft) !== state.playerCount ||
      !editorDraft.name.trim()
    ) {
      return;
    }
    const config = normalizedConfig(editorDraft);
    config.presetId = editorDraft.presetId;
    const existingIndex = preferences.customPresets.findIndex(
      (preset) => preset.presetId === config.presetId,
    );
    if (existingIndex >= 0) preferences.customPresets[existingIndex] = config;
    else preferences.customPresets.unshift(config);
    state.config = cloneConfig(config);
    ensureQuickPresetVisible(config.presetId);
    persistPreferences(preferences);
    closeDialog(elements.editor);
    render();
    if (isRoom) room.onConfigure(normalizedConfig(state.config));
  }

  function deleteCustomPreset() {
    if (!canConfigure) return;
    if (!editorDraft || !window.confirm(`删除“${editorDraft.name}”吗？`))
      return;
    const id = editorDraft.presetId;
    preferences.customPresets = preferences.customPresets.filter(
      (preset) => preset.presetId !== id,
    );
    preferences.favorites = preferences.favorites.filter((item) => item !== id);
    state.config = null;
    quickPresetIds = buildQuickPresetIds(preferences, state.playerCount);
    persistPreferences(preferences);
    closeDialog(elements.editor);
    render();
    if (isRoom) room.onConfigure(null);
  }

  function startDealing() {
    if (!state.config || !canConfigure) return;
    const config = normalizedConfig(state.config);
    const count = roleCount(config);
    if (count !== state.playerCount) {
      elements.configFeedback.textContent = roleCountMessage(
        count,
        state.playerCount,
      );
      return;
    }
    persistPreferences(preferences);
    if (isRoom) {
      room.onDeal(config);
      return;
    }
    state = {
      phase: "dealing",
      playerCount: state.playerCount,
      config,
      roles: shuffle(expandRoles(config.roles)),
      viewed: Array(state.playerCount).fill(false),
      activeIndex: null,
    };
    render();
  }

  function resetToSetup() {
    state = {
      phase: "setup",
      playerCount: state.playerCount,
      config: cloneConfig(state.config),
      roles: [],
      viewed: [],
      activeIndex: null,
    };
    persistPreferences(preferences);
    render();
  }

  function coverRole() {
    if (state.phase !== "reveal" || state.activeIndex == null) return;
    state.viewed[state.activeIndex] = true;
    state.activeIndex = null;
    state.phase = "dealing";
    render();
  }

  function render() {
    const inSetup = state.phase === "setup";
    const hasSelection = Boolean(state.config);
    document.body.classList.toggle("is-dealer-config-setup", inSetup);
    setVisible(elements.back, inSetup && hasSelection && canConfigure);
    setVisible(elements.setup, inSetup);
    setVisible(elements.deal, !inSetup);
    setVisible(
      elements.privacyLayer,
      ["privacy", "reveal"].includes(state.phase),
    );
    actionBarPresence.setVisible(inSetup && hasSelection);
    if (inSetup) {
      renderSetup();
      return;
    }
    renderDeal();
  }

  function renderSetup() {
    const hasSelection = Boolean(state.config);
    const count = hasSelection ? roleCount(state.config) : 0;
    elements.setup.classList.toggle("has-action-bar", hasSelection);
    elements.configShell.classList.toggle("is-confirming", hasSelection);
    setVisible(elements.countSection, !hasSelection);
    if (isRoom) elements.countSection.hidden = true;
    elements.playerCount.innerHTML = `<span>${state.playerCount} 人</span><i data-lucide="chevron-down" aria-hidden="true"></i>`;
    elements.playerCount.setAttribute(
      "aria-label",
      `当前 ${state.playerCount} 人，点击选择人数`,
    );
    elements.decrease.disabled = state.playerCount <= 6;
    elements.increase.disabled = state.playerCount >= 12;
    renderQuickPresets();
    setVisible(elements.presetSection, !hasSelection);
    setVisible(elements.selectedPreset, hasSelection);
    setVisible(elements.changePreset, canConfigure);
    setVisible(elements.openEditor, canConfigure);
    if (!hasSelection) {
      elements.selectedName.textContent = "";
      elements.selectedRoles.innerHTML = "";
      elements.selectedRules.textContent = "";
      elements.toggleRules.hidden = true;
      elements.configFeedback.hidden = true;
      elements.start.disabled = !canConfigure;
      elements.start.textContent = canConfigure ? "开始发牌" : "等待发牌";
      renderIcons();
      return;
    }
    elements.selectedName.textContent = state.config.name;
    elements.selectedName.title = state.config.name;
    elements.selectedCount.textContent = `${state.playerCount} 人`;
    renderSelectedRoles(state.config.roles);
    renderSelectedRules(state.config);
    elements.configFeedback.textContent = roleCountMessage(
      count,
      state.playerCount,
    );
    elements.configFeedback.dataset.ready = String(count === state.playerCount);
    elements.configFeedback.hidden = count === state.playerCount;
    elements.start.textContent = canConfigure ? "开始发牌" : "等待发牌";
    elements.start.disabled = !canConfigure || count !== state.playerCount;
    renderIcons();
  }

  function renderQuickPresets() {
    elements.quickPresets.innerHTML = quickPresets(
      quickPresetIds,
      preferences.customPresets,
    )
      .map((preset) => presetCard(preset, { compact: true }))
      .join("");
    renderIcons();
  }

  function renderSelectedRoles(roles) {
    const visibleRoles = roles.filter((role) => role.count > 0);
    const factions = [
      {
        id: "wolf",
        label: "狼人",
        roles: visibleRoles.filter((role) => role.team === "wolf"),
      },
      {
        id: "good",
        label: "好人",
        roles: visibleRoles.filter((role) =>
          ["villager", "god"].includes(role.team),
        ),
      },
      {
        id: "other",
        label: "其他",
        roles: visibleRoles.filter(
          (role) => !["wolf", "villager", "god"].includes(role.team),
        ),
      },
    ];

    elements.selectedRoles.replaceChildren(
      ...factions
        .filter((faction) => faction.roles.length > 0)
        .map((faction) => {
          const row = document.createElement("div");
          row.className = "dealer-faction-row";
          row.dataset.faction = faction.id;
          row.setAttribute("aria-label", `${faction.label}身份`);

          const label = document.createElement("span");
          label.className = "dealer-faction-label";
          label.textContent = faction.label;

          const list = document.createElement("div");
          list.className = "dealer-faction-roles";
          list.replaceChildren(
            ...faction.roles.map((role) => {
              const chip = document.createElement("span");
              chip.className = "dealer-role-chip";
              chip.dataset.team = role.team;
              chip.textContent = `${role.name} ×${role.count}`;
              return chip;
            }),
          );
          row.append(label, list);
          return row;
        }),
    );
  }

  function renderSelectedRules(config) {
    const rules = config.rules.trim() || "暂无规则说明";
    const rulesKey = `${config.presetId}:${rules}`;
    if (rulesKey !== renderedRulesKey) {
      renderedRulesKey = rulesKey;
      rulesExpanded = false;
    }

    elements.selectedRules.textContent = rules;
    elements.selectedRules.classList.remove("is-expanded");
    const canExpand =
      elements.selectedRules.scrollHeight >
      elements.selectedRules.clientHeight + 1;
    elements.selectedRules.classList.toggle(
      "is-expanded",
      rulesExpanded && canExpand,
    );
    elements.toggleRules.hidden = !canExpand;
    elements.toggleRules.textContent = rulesExpanded ? "收起" : "展开";
    elements.toggleRules.setAttribute(
      "aria-expanded",
      String(rulesExpanded && canExpand),
    );
  }

  function toggleSelectedRules() {
    if (!state.config) return;
    rulesExpanded = !rulesExpanded;
    renderSelectedRules(state.config);
  }

  function renderPresetPicker() {
    const query = elements.pickerSearch.value.trim().toLocaleLowerCase("zh-CN");
    const presets = pickerPresetIds
      .map((id) => findPreset(id, preferences.customPresets))
      .filter(Boolean)
      .filter((preset) => {
        if (!query) return true;
        const haystack = [
          preset.name,
          preset.rules,
          ...preset.roles.map((role) => role.name),
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN");
        return haystack.includes(query);
      });
    elements.pickerGrid.innerHTML = presets
      .map((preset) => presetCard(preset, { selectedId: pickerSelectedId }))
      .join("");
    elements.pickerEmpty.hidden = presets.length > 0;
    renderIcons();
  }

  function renderDeal() {
    const viewedCount = state.viewed.filter(Boolean).length;
    elements.grid.dataset.density =
      state.roles.length >= 7 ? "dense" : "regular";
    elements.progress.textContent =
      viewedCount === state.roles.length
        ? `全部 ${state.roles.length} 位玩家都已查看身份，可以开始游戏。`
        : `${state.config.name} · 已查看 ${viewedCount} / ${state.roles.length} · 点击自己的编号牌查看身份`;
    elements.grid.innerHTML = state.roles
      .map(
        (_, index) =>
          `<button class="dealer-deal-card${state.viewed[index] ? " is-viewed" : ""}" type="button" data-card-index="${index}" ${state.viewed[index] ? "disabled" : ""}><span class="dealer-card-number">${index + 1}</span><span class="dealer-card-state">${state.viewed[index] ? '<i data-lucide="check"></i>已查看' : "点击抽牌"}</span></button>`,
      )
      .join("");
    elements.grid.querySelectorAll("[data-card-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.cardIndex);
        if (state.viewed[index]) return;
        state.activeIndex = index;
        state.phase = "privacy";
        render();
      });
    });
    renderIcons();
    if (state.activeIndex == null) return;
    elements.privacyTitle.textContent = `${state.activeIndex + 1} 号玩家`;
    if (state.phase === "privacy") {
      elements.privacy.dataset.stage = "privacy";
      elements.reveal.hidden = false;
      elements.roleFlip.classList.remove("is-revealed");
      elements.cover.hidden = true;
      return;
    }
    const role = state.roles[state.activeIndex];
    elements.privacy.dataset.stage = "reveal";
    elements.reveal.hidden = true;
    elements.roleFlip.classList.add("is-revealed");
    elements.roleCard.dataset.role = role.id;
    elements.roleMark.textContent = role.mark || role.name.slice(0, 1);
    elements.roleName.textContent = role.name;
    elements.roleCopy.textContent =
      role.copy || state.config.rules || "请按当前版型规则行动。";
    elements.cover.hidden = false;
  }

  function presetCard(preset, { compact = false, selectedId } = {}) {
    const id = preset.presetId ?? preset.id;
    const favorite = preferences.favorites.includes(id);
    const selected = (selectedId ?? state.config?.presetId) === id;
    const custom = !PRESETS.some((preset) => preset.id === id);
    return `<article class="dealer-preset-card${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}">
      <button class="dealer-preset-main" type="button" data-select-preset="${escapeHtml(id)}" aria-pressed="${selected}">
        <span class="dealer-preset-card-top"><strong title="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</strong>${compact ? "" : `<span>${roleCount(preset)} 人</span>`}</span>
        ${compact ? "" : `<span class="dealer-preset-team-summary">${escapeHtml(presetMeta(preset))}</span>`}
        ${compact ? "" : `<span class="dealer-preset-description">${escapeHtml(preset.rules || "自定义身份配置")}</span>`}
        ${compact ? "" : `<span class="dealer-preset-tags">${custom ? "<em>自定义</em>" : ""}</span>`}
      </button>
      <button class="dealer-favorite-action${favorite ? " is-favorite" : ""}" type="button" data-favorite-preset="${escapeHtml(id)}" aria-label="${favorite ? "取消收藏" : "收藏"}${escapeHtml(preset.name)}" aria-pressed="${favorite}"><i data-lucide="star"></i></button>
    </article>`;
  }

  function openDialog(dialog) {
    lastFocusedElement = document.activeElement;
    dialogControllers.get(dialog)?.setOpen(true);
  }

  function closeDialog(dialog) {
    dialogControllers.get(dialog)?.setOpen(false);
  }

  return controller;
}

function buildQuickPresetIds(preferences, playerCount) {
  const ids = [
    ...preferences.favorites.filter(
      (id) =>
        roleCount(
          findPreset(id, preferences.customPresets) ?? { roles: [] },
        ) === playerCount,
    ),
    ...(FEATURED_PRESET_IDS[playerCount] ?? []),
    ...preferences.customPresets
      .filter((preset) => roleCount(preset) === playerCount)
      .map((preset) => preset.presetId),
    ...PRESETS.filter((preset) => roleCount(preset) === playerCount).map(
      (preset) => preset.id,
    ),
  ];
  return [...new Set(ids)].slice(0, MAX_FAVORITES_ON_HOME);
}

function quickPresets(ids, customPresets) {
  const presets = [];
  for (const id of ids) {
    const preset = findPreset(id, customPresets);
    if (preset) presets.push(preset);
  }
  return presets;
}

function orderedPresets(preferences) {
  const presets = [...preferences.customPresets, ...PRESETS];
  const score = (preset) => {
    const id = preset.presetId ?? preset.id;
    const favorite = preferences.favorites.indexOf(id);
    if (favorite >= 0) return favorite;
    return 1000 + presets.indexOf(preset);
  };
  return [...presets].sort((left, right) => score(left) - score(right));
}

function findPreset(id, customPresets = []) {
  if (!id) return undefined;
  return (
    customPresets.find((preset) => preset.presetId === id) ??
    PRESETS.find((preset) => preset.id === id)
  );
}

function presetMeta(config) {
  const totals = config.roles.reduce(
    (result, role) => {
      const team = ["wolf", "villager", "god", "other"].includes(role.team)
        ? role.team
        : "other";
      result[team] += Math.max(0, Number(role.count) || 0);
      return result;
    },
    { wolf: 0, villager: 0, god: 0, other: 0 },
  );
  return [
    totals.wolf && `${totals.wolf} 狼`,
    totals.villager && `${totals.villager} 民`,
    totals.god && `${totals.god} 神`,
    totals.other && `${totals.other} 特殊`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function editorRoleRow(role, index) {
  return `<div class="dealer-role-row" data-role-row data-role-id="${escapeHtml(role.id)}" data-team="${escapeHtml(role.team)}" data-copy="${escapeHtml(role.copy)}">
    <input data-role-name value="${escapeHtml(role.name)}" aria-label="身份名称">
    <div class="dealer-role-count" aria-label="${escapeHtml(role.name)}数量">
      <button type="button" data-adjust-role="-1" data-role-index="${index}" aria-label="减少${escapeHtml(role.name)}"><i data-lucide="minus"></i></button>
      <input data-role-count type="number" min="0" max="12" value="${role.count}" aria-label="${escapeHtml(role.name)}数量">
      <button type="button" data-adjust-role="1" data-role-index="${index}" aria-label="增加${escapeHtml(role.name)}"><i data-lucide="plus"></i></button>
    </div>
    <button class="dealer-role-remove" type="button" data-remove-role="${index}" aria-label="删除${escapeHtml(role.name)}"><i data-lucide="x"></i></button>
  </div>`;
}

function renderIcons() {
  createIcons({ icons: DEALER_ICONS });
}

function roleCountMessage(count, playerCount) {
  if (count === playerCount) {
    return `身份数 ${count} / ${playerCount}`;
  }
  const difference = Math.abs(playerCount - count);
  return count < playerCount
    ? `身份数 ${count} / ${playerCount}，还差 ${difference} 张`
    : `身份数 ${count} / ${playerCount}，多出 ${difference} 张`;
}

function clampPlayerCount(value) {
  return Math.min(12, Math.max(6, Math.round(Number(value) || 12)));
}

function cloneConfig(config) {
  if (!config) return clonePreset();
  return normalizedConfig({
    presetId: config.presetId ?? config.id,
    name: config.name,
    rules: config.rules ?? "",
    roles: config.roles.map((role) => ({ ...role })),
  });
}

function loadPreferences() {
  const fallback = {
    playerCount: 12,
    favorites: [],
    customPresets: [],
  };
  try {
    const serialized =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(serialized ?? "null");
    if (!parsed || typeof parsed !== "object") return fallback;
    // Read the pre-rename field once so existing saved presets are not lost.
    const legacyCustomPresets = parsed["custom" + "Layouts"];
    const storedCustomPresets = Array.isArray(parsed.customPresets)
      ? parsed.customPresets
      : legacyCustomPresets;
    return {
      playerCount: clampPlayerCount(parsed.playerCount),
      favorites: stringList(parsed.favorites),
      customPresets: Array.isArray(storedCustomPresets)
        ? storedCustomPresets.map(sanitizeStoredConfig).filter(Boolean)
        : [],
    };
  } catch {
    return fallback;
  }
}

function persistPreferences(preferences) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        playerCount: preferences.playerCount,
        favorites: preferences.favorites,
        customPresets: preferences.customPresets,
      }),
    );
  } catch {
    // Local persistence is optional; gameplay remains entirely available.
  }
}

function sanitizeStoredConfig(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.roles)) {
    return undefined;
  }
  const config = normalizedConfig(value);
  if (!config.roles.length) return undefined;
  config.presetId = String(value.presetId || "custom_saved").slice(0, 80);
  return config;
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string"))]
    : [];
}

function expandRoles(roles) {
  return roles.flatMap((role) =>
    Array.from({ length: role.count }, () => ({ ...role, count: undefined })),
  );
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

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}
