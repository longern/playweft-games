import {
  PRESETS,
  addCustomGod,
  clonePreset,
  normalizedConfig,
  roleCount,
} from "./role-config.js";
import { createOverlayDialog } from "../../src/components/overlay-dialog.js";

const STORAGE_KEY = "playweft:werewolf-dealer:solo-preferences:v1";
const MAX_FAVORITES_ON_HOME = 4;

export function startSoloDealer({ root, setConnection }) {
  document.body.classList.add("is-solo-mode");
  const preferences = loadPreferences();
  const initialConfig = initialLayout(preferences);
  let state = {
    phase: "setup",
    playerCount: clampPlayerCount(
      preferences.playerCount ?? roleCount(initialConfig),
    ),
    config: initialConfig,
    roles: [],
    viewed: [],
    activeIndex: null,
  };
  let pickerSelectedId = state.config.presetId;
  let editorDraft;
  let lastFocusedElement;
  let quickLayoutIds = buildQuickLayoutIds(preferences, state.config);

  root.innerHTML = soloShell();
  const $ = (id) => root.querySelector(`#${id}`);
  const elements = {
    setup: $("solo-setup"),
    deal: $("solo-deal"),
    grid: $("solo-card-grid"),
    progress: $("solo-progress"),
    playerCount: $("solo-player-count"),
    decrease: $("solo-count-decrease"),
    increase: $("solo-count-increase"),
    quickLayouts: $("solo-quick-layouts"),
    selectedName: $("solo-selected-name"),
    selectedMeta: $("solo-selected-meta"),
    selectedRoles: $("solo-selected-roles"),
    configFeedback: $("solo-config-feedback"),
    start: $("solo-start"),
    openPicker: $("solo-open-picker"),
    openEditor: $("solo-open-editor"),
    picker: $("solo-layout-picker"),
    pickerSearch: $("solo-layout-search"),
    pickerGrid: $("solo-layout-grid"),
    pickerEmpty: $("solo-layout-empty"),
    pickerUse: $("solo-layout-use"),
    editor: $("solo-role-editor"),
    editorTitle: $("solo-editor-title"),
    editorName: $("solo-layout-name"),
    editorRoles: $("solo-editor-roles"),
    editorRules: $("solo-editor-rules"),
    editorFeedback: $("solo-editor-feedback"),
    editorSave: $("solo-editor-save"),
    editorDelete: $("solo-editor-delete"),
    privacy: $("solo-privacy"),
    privacyTitle: $("solo-privacy-title"),
    reveal: $("solo-reveal"),
    roleFlip: $("solo-role-flip"),
    roleCard: $("solo-role-card"),
    roleMark: $("solo-role-mark"),
    roleName: $("solo-role-name"),
    roleCopy: $("solo-role-copy"),
    cover: $("solo-cover"),
  };
  const dialogControllers = new Map([
    [
      elements.picker,
      createOverlayDialog({
        root: elements.picker,
        surface: elements.picker.querySelector(".solo-dialog-panel"),
        closeButtons: elements.picker.querySelectorAll("[data-close-dialog]"),
        initialFocus: () => elements.pickerSearch,
        returnFocus: () => lastFocusedElement,
      }),
    ],
    [
      elements.editor,
      createOverlayDialog({
        root: elements.editor,
        surface: elements.editor.querySelector(".solo-dialog-panel"),
        closeButtons: elements.editor.querySelectorAll("[data-close-dialog]"),
        initialFocus: () => elements.editorName,
        returnFocus: () => lastFocusedElement,
      }),
    ],
  ]);

  setConnection("live", "本机单机发牌");

  elements.decrease.addEventListener("click", () => adjustPlayerCount(-1));
  elements.increase.addEventListener("click", () => adjustPlayerCount(1));
  elements.quickLayouts.addEventListener("click", handleLayoutCardClick);
  elements.openPicker.addEventListener("click", openLayoutPicker);
  elements.openEditor.addEventListener("click", openRoleEditor);
  elements.start.addEventListener("click", startDealing);
  $("solo-reset").addEventListener("click", resetToSetup);

  elements.pickerSearch.addEventListener("input", renderLayoutPicker);
  elements.pickerGrid.addEventListener("click", handlePickerClick);
  elements.pickerUse.addEventListener("click", confirmPickedLayout);
  elements.editorName.addEventListener("input", readEditorDraft);
  elements.editorRules.addEventListener("input", readEditorDraft);
  elements.editorRoles.addEventListener("input", readEditorDraft);
  elements.editorRoles.addEventListener("click", handleEditorRoleClick);
  $("solo-editor-add-role").addEventListener("click", addEditorRole);
  elements.editorSave.addEventListener("click", saveRoleEditor);
  elements.editorDelete.addEventListener("click", deleteCustomLayout);

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

  function adjustPlayerCount(change) {
    state.playerCount = clampPlayerCount(state.playerCount + change);
    preferences.playerCount = state.playerCount;
    persistPreferences(preferences, state.config);
    renderSetup();
  }

  function handleLayoutCardClick(event) {
    const favorite = event.target.closest("[data-favorite-layout]");
    if (favorite) {
      toggleFavorite(favorite.dataset.favoriteLayout);
      return;
    }
    const select = event.target.closest("[data-select-layout]");
    if (select) selectLayout(select.dataset.selectLayout);
  }

  function openLayoutPicker() {
    pickerSelectedId = state.config.presetId;
    elements.pickerSearch.value = "";
    renderLayoutPicker();
    openDialog(elements.picker);
  }

  function handlePickerClick(event) {
    const favorite = event.target.closest("[data-favorite-layout]");
    if (favorite) {
      toggleFavorite(favorite.dataset.favoriteLayout);
      renderLayoutPicker();
      return;
    }
    const select = event.target.closest("[data-select-layout]");
    if (!select) return;
    pickerSelectedId = select.dataset.selectLayout;
    renderLayoutPicker();
  }

  function confirmPickedLayout() {
    if (!pickerSelectedId) return;
    ensureQuickLayoutVisible(pickerSelectedId);
    selectLayout(pickerSelectedId);
    closeDialog(elements.picker);
  }

  function selectLayout(id) {
    const layout = findLayout(id, preferences.customLayouts);
    if (!layout) return;
    state.config = cloneConfig(layout);
    state.playerCount = clampPlayerCount(roleCount(layout));
    preferences.playerCount = state.playerCount;
    preferences.lastSelectedId = id;
    persistPreferences(preferences, state.config);
    renderSetup();
  }

  function toggleFavorite(id) {
    const index = preferences.favorites.indexOf(id);
    if (index >= 0) preferences.favorites.splice(index, 1);
    else preferences.favorites.unshift(id);
    preferences.favorites = preferences.favorites.slice(0, 12);
    quickLayoutIds = buildQuickLayoutIds(preferences, state.config);
    persistPreferences(preferences, state.config);
    renderSetup();
  }

  function ensureQuickLayoutVisible(id) {
    if (quickLayoutIds.includes(id)) return;
    quickLayoutIds = [id, ...quickLayoutIds].slice(0, MAX_FAVORITES_ON_HOME);
  }

  function openRoleEditor() {
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
    editorDraft.roles = [...elements.editorRoles.querySelectorAll("[data-role-row]")].map(
      (row) => {
        const name = row.querySelector("[data-role-name]").value;
        return {
          id: row.dataset.roleId,
          name,
          mark: name.trim().slice(0, 1),
          team: row.dataset.team,
          copy: row.dataset.copy,
          count: Number(row.querySelector("[data-role-count]").value),
        };
      },
    );
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
    elements.editorRoles.querySelector("[data-role-row]:last-child [data-role-name]")?.focus();
  }

  function renderRoleEditor() {
    if (!editorDraft) return;
    elements.editorName.value = editorDraft.name;
    elements.editorRules.value = editorDraft.rules;
    elements.editorRoles.innerHTML = editorDraft.roles
      .map((role, index) => editorRoleRow(role, index))
      .join("");
    updateEditorFeedback();
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
    if (roleCount(editorDraft) !== state.playerCount || !editorDraft.name.trim()) {
      return;
    }
    const config = normalizedConfig(editorDraft);
    config.presetId = editorDraft.presetId;
    const existingIndex = preferences.customLayouts.findIndex(
      (layout) => layout.presetId === config.presetId,
    );
    if (existingIndex >= 0) preferences.customLayouts[existingIndex] = config;
    else preferences.customLayouts.unshift(config);
    state.config = cloneConfig(config);
    ensureQuickLayoutVisible(config.presetId);
    preferences.lastSelectedId = config.presetId;
    persistPreferences(preferences, state.config);
    closeDialog(elements.editor);
    renderSetup();
  }

  function deleteCustomLayout() {
    if (!editorDraft || !window.confirm(`删除“${editorDraft.name}”吗？`)) return;
    const id = editorDraft.presetId;
    preferences.customLayouts = preferences.customLayouts.filter(
      (layout) => layout.presetId !== id,
    );
    preferences.favorites = preferences.favorites.filter((item) => item !== id);
    state.config = clonePreset();
    state.playerCount = roleCount(state.config);
    quickLayoutIds = buildQuickLayoutIds(preferences, state.config);
    preferences.lastSelectedId = state.config.presetId;
    persistPreferences(preferences, state.config);
    closeDialog(elements.editor);
    renderSetup();
  }

  function startDealing() {
    const config = normalizedConfig(state.config);
    const count = roleCount(config);
    if (count !== state.playerCount) {
      elements.configFeedback.textContent = roleCountMessage(
        count,
        state.playerCount,
      );
      return;
    }
    markLayoutUsed(config.presetId);
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

  function markLayoutUsed(id) {
    preferences.lastSelectedId = id;
    persistPreferences(preferences, state.config);
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
    persistPreferences(preferences, state.config);
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
    elements.setup.hidden = !inSetup;
    elements.deal.hidden = inSetup;
    elements.privacy.hidden = !["privacy", "reveal"].includes(state.phase);
    if (inSetup) {
      renderSetup();
      return;
    }
    renderDeal();
  }

  function renderSetup() {
    const count = roleCount(state.config);
    elements.playerCount.textContent = `${state.playerCount} 人`;
    elements.decrease.disabled = state.playerCount <= 6;
    elements.increase.disabled = state.playerCount >= 12;
    elements.quickLayouts.innerHTML = quickLayouts(
      quickLayoutIds,
      preferences.customLayouts,
    )
      .map((layout) => layoutCard(layout, { compact: true }))
      .join("");
    elements.selectedName.textContent = state.config.name;
    elements.selectedMeta.textContent = layoutMeta(state.config);
    elements.selectedRoles.innerHTML = state.config.roles
      .filter((role) => role.count > 0)
      .map(
        (role) =>
          `<span class="solo-role-chip" data-team="${escapeHtml(role.team)}">${escapeHtml(role.name)} ×${role.count}</span>`,
      )
      .join("");
    elements.configFeedback.textContent = roleCountMessage(
      count,
      state.playerCount,
    );
    elements.configFeedback.dataset.ready = String(count === state.playerCount);
    elements.configFeedback.hidden = count === state.playerCount;
    elements.start.disabled = count !== state.playerCount;
  }

  function renderLayoutPicker() {
    const query = elements.pickerSearch.value.trim().toLocaleLowerCase("zh-CN");
    const layouts = orderedLayouts(preferences).filter((layout) => {
      if (!query) return true;
      const haystack = [
        layout.name,
        layout.rules,
        ...layout.roles.map((role) => role.name),
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(query);
    });
    elements.pickerGrid.innerHTML = layouts
      .map((layout) => layoutCard(layout, { selectedId: pickerSelectedId }))
      .join("");
    elements.pickerEmpty.hidden = layouts.length > 0;
    elements.pickerUse.disabled = !pickerSelectedId;
    elements.pickerUse.textContent = "确定";
  }

  function renderDeal() {
    const viewedCount = state.viewed.filter(Boolean).length;
    elements.progress.textContent =
      viewedCount === state.roles.length
        ? `全部 ${state.roles.length} 位玩家都已查看身份，可以开始游戏。`
        : `${state.config.name} · 已查看 ${viewedCount} / ${state.roles.length} · 点击自己的编号牌查看身份`;
    elements.grid.innerHTML = state.roles
      .map(
        (_, index) =>
          `<button class="solo-deal-card${state.viewed[index] ? " is-viewed" : ""}" type="button" data-card-index="${index}" ${state.viewed[index] ? "disabled" : ""}><span class="solo-card-number">${index + 1}</span><span class="solo-card-state">${state.viewed[index] ? "✓ 已查看" : "点击抽牌"}</span></button>`,
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
    if (state.activeIndex == null) return;
    elements.privacyTitle.textContent = `${state.activeIndex + 1} 号玩家`;
    if (state.phase === "privacy") {
      elements.privacy.dataset.stage = "privacy";
      elements.reveal.hidden = false;
      elements.roleFlip.hidden = false;
      elements.roleFlip.classList.remove("is-revealed");
      elements.cover.hidden = true;
      return;
    }
    const role = state.roles[state.activeIndex];
    elements.privacy.dataset.stage = "reveal";
    elements.reveal.hidden = true;
    elements.roleFlip.hidden = false;
    elements.roleFlip.classList.add("is-revealed");
    elements.roleCard.dataset.role = role.id;
    elements.roleMark.textContent = role.mark || role.name.slice(0, 1);
    elements.roleName.textContent = role.name;
    elements.roleCopy.textContent =
      role.copy || state.config.rules || "请按当前版型规则行动。";
    elements.cover.hidden = false;
  }

  function layoutCard(layout, { compact = false, selectedId } = {}) {
    const id = layout.presetId ?? layout.id;
    const favorite = preferences.favorites.includes(id);
    const selected = (selectedId ?? state.config.presetId) === id;
    const custom = !PRESETS.some((preset) => preset.id === id);
    return `<article class="solo-layout-card${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}">
      <button class="solo-layout-main" type="button" data-select-layout="${escapeHtml(id)}" aria-pressed="${selected}">
        <span class="solo-layout-card-top"><strong>${escapeHtml(layout.name)}</strong><span>${roleCount(layout)} 人</span></span>
        <span class="solo-layout-team-summary">${escapeHtml(layoutMeta(layout))}</span>
        ${compact ? "" : `<span class="solo-layout-description">${escapeHtml(layout.rules || "自定义身份配置")}</span>`}
        <span class="solo-layout-tags">${custom ? "<em>自定义</em>" : ""}</span>
      </button>
      <button class="solo-favorite-action${favorite ? " is-favorite" : ""}" type="button" data-favorite-layout="${escapeHtml(id)}" aria-label="${favorite ? "取消收藏" : "收藏"}${escapeHtml(layout.name)}" aria-pressed="${favorite}">${favorite ? "★" : "☆"}</button>
    </article>`;
  }

  function openDialog(dialog) {
    lastFocusedElement = document.activeElement;
    dialogControllers.get(dialog)?.setOpen(true);
  }

  function closeDialog(dialog) {
    dialogControllers.get(dialog)?.setOpen(false);
  }
}

function initialLayout(preferences) {
  const draft = sanitizeStoredConfig(preferences.draft);
  if (draft) return draft;
  return cloneConfig(
    findLayout(preferences.lastSelectedId, preferences.customLayouts) ?? PRESETS[0],
  );
}

function buildQuickLayoutIds(preferences, currentConfig) {
  const ids = [
    ...preferences.favorites,
    ...PRESETS.map((preset) => preset.id),
    ...preferences.customLayouts.map((layout) => layout.presetId),
  ];
  if (!ids.slice(0, MAX_FAVORITES_ON_HOME).includes(currentConfig.presetId)) {
    ids.unshift(currentConfig.presetId);
  }
  return [...new Set(ids)].slice(0, MAX_FAVORITES_ON_HOME);
}

function quickLayouts(ids, customLayouts) {
  const layouts = [];
  for (const id of ids) {
    const layout = findLayout(id, customLayouts);
    if (layout) layouts.push(layout);
  }
  return layouts;
}

function orderedLayouts(preferences) {
  const layouts = [...preferences.customLayouts, ...PRESETS];
  const score = (layout) => {
    const id = layout.presetId ?? layout.id;
    const favorite = preferences.favorites.indexOf(id);
    if (favorite >= 0) return favorite;
    return 1000 + layouts.indexOf(layout);
  };
  return [...layouts].sort((left, right) => score(left) - score(right));
}

function findLayout(id, customLayouts = []) {
  if (!id) return undefined;
  return (
    customLayouts.find((layout) => layout.presetId === id) ??
    PRESETS.find((preset) => preset.id === id)
  );
}

function layoutMeta(config) {
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
  return `<div class="solo-role-row" data-role-row data-role-id="${escapeHtml(role.id)}" data-team="${escapeHtml(role.team)}" data-copy="${escapeHtml(role.copy)}">
    <input data-role-name value="${escapeHtml(role.name)}" aria-label="身份名称">
    <div class="solo-role-count" aria-label="${escapeHtml(role.name)}数量">
      <button type="button" data-adjust-role="-1" data-role-index="${index}" aria-label="减少${escapeHtml(role.name)}">−</button>
      <input data-role-count type="number" min="0" max="12" value="${role.count}" aria-label="${escapeHtml(role.name)}数量">
      <button type="button" data-adjust-role="1" data-role-index="${index}" aria-label="增加${escapeHtml(role.name)}">＋</button>
    </div>
    <button class="solo-role-remove" type="button" data-remove-role="${index}" aria-label="删除${escapeHtml(role.name)}">×</button>
  </div>`;
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
  return {
    presetId: config.presetId ?? config.id,
    name: config.name,
    rules: config.rules ?? "",
    roles: config.roles.map((role) => ({ ...role })),
  };
}

function loadPreferences() {
  const fallback = {
    playerCount: 12,
    lastSelectedId: PRESETS[0].id,
    favorites: [],
    customLayouts: [],
    draft: undefined,
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      playerCount: clampPlayerCount(parsed.playerCount),
      lastSelectedId:
        typeof parsed.lastSelectedId === "string"
          ? parsed.lastSelectedId
          : fallback.lastSelectedId,
      favorites: stringList(parsed.favorites),
      customLayouts: Array.isArray(parsed.customLayouts)
        ? parsed.customLayouts.map(sanitizeStoredConfig).filter(Boolean)
        : [],
      draft: sanitizeStoredConfig(parsed.draft),
    };
  } catch {
    return fallback;
  }
}

function persistPreferences(preferences, draft) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        playerCount: preferences.playerCount,
        lastSelectedId: preferences.lastSelectedId,
        favorites: preferences.favorites,
        customLayouts: preferences.customLayouts,
        draft: cloneConfig(draft),
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

function soloShell() {
  return `<section id="solo-setup" class="solo-setup-panel">
    <div class="solo-config-shell">
      <section class="solo-count-section solo-group" aria-labelledby="solo-count-title">
        <strong id="solo-count-title">游戏人数</strong>
        <div class="solo-count-stepper" role="group" aria-label="选择游戏人数">
          <button id="solo-count-decrease" type="button" aria-label="减少一人">−</button>
          <output id="solo-player-count" aria-live="polite">12 人</output>
          <button id="solo-count-increase" type="button" aria-label="增加一人">＋</button>
        </div>
      </section>

      <section class="solo-layout-section solo-group" aria-labelledby="solo-layout-title">
        <div class="solo-section-heading">
          <strong id="solo-layout-title">常用版型</strong>
          <button id="solo-open-picker" class="solo-text-action" type="button">全部版型 <span aria-hidden="true">›</span></button>
        </div>
        <div id="solo-quick-layouts" class="solo-layout-grid solo-quick-layouts"></div>
      </section>

      <section class="solo-selected-layout solo-group" aria-labelledby="solo-selected-name">
        <div class="solo-selected-heading">
          <div><strong>身份配置</strong><h3 id="solo-selected-name"></h3><p id="solo-selected-meta"></p></div>
          <button id="solo-open-editor" class="solo-text-action" type="button">编辑 <span aria-hidden="true">›</span></button>
        </div>
        <div id="solo-selected-roles" class="solo-role-summary"></div>
      </section>

      <p id="solo-config-feedback" class="solo-config-feedback" role="status" aria-live="polite"></p>
      <div class="solo-action-bar"><button id="solo-start" class="solo-primary-action" type="button">开始发牌</button></div>
    </div>
  </section>

  <section id="solo-deal" class="solo-deal-panel" hidden>
    <div class="solo-deal-heading"><h2>请选择自己的编号</h2><p id="solo-progress"></p></div>
    <div id="solo-card-grid" class="solo-card-grid"></div>
    <button id="solo-reset" class="redeal-action solo-reset-action" type="button">重新配置并发牌</button>
  </section>

  <dialog id="solo-layout-picker" class="overlay-dialog overlay-dialog--sheet-narrow solo-dialog" aria-labelledby="solo-picker-title">
    <section class="overlay-dialog__surface solo-dialog-panel solo-picker-panel" tabindex="-1">
      <header class="solo-dialog-header"><h2 id="solo-picker-title">选择版型</h2><button type="button" data-close-dialog aria-label="关闭版型列表">×</button></header>
      <label class="solo-search-field"><span class="sr-only">搜索版型</span><input id="solo-layout-search" type="search" placeholder="搜索版型或身份名称"></label>
      <div id="solo-layout-grid" class="solo-layout-grid solo-all-layouts"></div>
      <p id="solo-layout-empty" class="solo-empty-state" hidden>没有找到匹配的版型。</p>
      <footer class="solo-dialog-footer"><button class="solo-secondary-action" type="button" data-close-dialog>取消</button><button id="solo-layout-use" class="solo-primary-action" type="button">确定</button></footer>
    </section>
  </dialog>

  <dialog id="solo-role-editor" class="overlay-dialog overlay-dialog--sheet-narrow solo-dialog" aria-labelledby="solo-editor-title">
    <section class="overlay-dialog__surface solo-dialog-panel solo-editor-panel" tabindex="-1">
      <header class="solo-dialog-header"><h2 id="solo-editor-title">编辑身份</h2><button type="button" data-close-dialog aria-label="关闭身份编辑">×</button></header>
      <div class="solo-editor-scroll">
        <label class="solo-field"><span>版型名称</span><input id="solo-layout-name" maxlength="40"></label>
        <div class="solo-editor-label"><strong>身份列表</strong></div>
        <div id="solo-editor-roles" class="solo-role-list"></div>
        <button id="solo-editor-add-role" class="solo-secondary-action solo-add-role" type="button">＋ 添加自定义神职</button>
        <label class="solo-field"><span>规则说明（可选）</span><textarea id="solo-editor-rules" rows="4" maxlength="1000"></textarea></label>
      </div>
      <p id="solo-editor-feedback" class="solo-config-feedback" role="status" aria-live="polite"></p>
      <footer class="solo-dialog-footer solo-editor-footer"><button id="solo-editor-delete" class="solo-danger-action" type="button">删除版型</button><span></span><button class="solo-secondary-action" type="button" data-close-dialog>取消</button><button id="solo-editor-save" class="solo-primary-action" type="button">保存</button></footer>
    </section>
  </dialog>

  <div id="solo-privacy" class="solo-privacy" data-stage="privacy" hidden>
    <div class="solo-privacy-card">
      <h2 id="solo-privacy-title">1 号玩家</h2>
      <p class="solo-privacy-prompt">确认周围无人看到屏幕后再翻牌</p>
      <div id="solo-role-flip" class="solo-role-flip">
        <div class="solo-role-flip-inner">
          <div class="solo-identity-card-back" aria-hidden="true"><span>?</span><strong>身份牌</strong></div>
          <div id="solo-role-card" class="solo-identity-card"><span id="solo-role-mark" class="solo-identity-emblem">?</span><strong id="solo-role-name">身份</strong><p id="solo-role-copy"></p></div>
        </div>
      </div>
      <div class="solo-role-actions">
        <button id="solo-reveal" class="solo-primary-action" type="button">翻开身份牌</button>
        <button id="solo-cover" class="solo-primary-action" type="button" hidden>盖回身份</button>
      </div>
    </div>
  </div>`;
}
