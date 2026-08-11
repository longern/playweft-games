import { PRESETS, addCustomGod, clonePreset, normalizedConfig, roleCount } from "./role-config.js";

export function startSoloDealer({ root, setConnection }) {
  let state = { phase: "setup", config: clonePreset(), roles: [], viewed: [], activeIndex: null };
  root.innerHTML = soloShell();
  const $ = (id) => root.querySelector(`#${id}`);
  const setup = $("solo-setup"), deal = $("solo-deal"), grid = $("solo-card-grid"), progress = $("solo-progress");
  const preset = $("solo-preset"), rules = $("solo-rules"), roleList = $("solo-role-list"), feedback = $("solo-config-feedback");
  const privacy = $("solo-privacy"), privacyTitle = $("solo-privacy-title"), reveal = $("solo-reveal");
  const roleCard = $("solo-role-card"), roleMark = $("solo-role-mark"), roleName = $("solo-role-name"), roleCopy = $("solo-role-copy"), cover = $("solo-cover");
  setConnection("live", "本机单机发牌");

  preset.addEventListener("change", () => { state.config = clonePreset(preset.value); renderConfig(); });
  rules.addEventListener("input", () => { state.config.rules = rules.value; });
  $("solo-add-role").addEventListener("click", () => { state.config.presetId = "custom"; addCustomGod(state.config); renderConfig(); });
  roleList.addEventListener("input", readRoleEditor);
  roleList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-role]");
    if (!remove) return;
    state.config.roles.splice(Number(remove.dataset.removeRole), 1);
    state.config.presetId = "custom";
    renderConfig();
  });
  $("solo-start").addEventListener("click", () => {
    readRoleEditor();
    const config = normalizedConfig(state.config);
    const count = roleCount(config);
    if (count < 6 || count > 12) { feedback.textContent = `身份池当前 ${count} 张，请配置为 6–12 张。`; return; }
    state = { phase: "dealing", config, roles: shuffle(expandRoles(config.roles)), viewed: Array(count).fill(false), activeIndex: null };
    render();
  });
  $("solo-reset").addEventListener("click", () => { state = { phase: "setup", config: structuredClone(state.config), roles: [], viewed: [], activeIndex: null }; render(); });
  reveal.addEventListener("click", () => { if (state.phase === "privacy") { state.phase = "reveal"; render(); } });
  cover.addEventListener("click", () => { if (state.phase !== "reveal" || state.activeIndex == null) return; state.viewed[state.activeIndex] = true; state.activeIndex = null; state.phase = "dealing"; render(); });
  privacy.addEventListener("click", (event) => { if (event.target === privacy && state.phase === "privacy") { state.activeIndex = null; state.phase = "dealing"; render(); } });
  render();

  function readRoleEditor() {
    state.config.roles = [...roleList.querySelectorAll("[data-role-row]")].map((row) => ({
      id: row.dataset.roleId, name: row.querySelector("[data-role-name]").value, mark: row.querySelector("[data-role-name]").value.slice(0,1),
      team: row.dataset.team, copy: row.dataset.copy, count: Number(row.querySelector("[data-role-count]").value),
    }));
    state.config.presetId = "custom";
    feedback.textContent = `身份池 ${roleCount(state.config)} 张`;
  }
  function renderConfig() {
    preset.value = PRESETS.some((p) => p.id === state.config.presetId) ? state.config.presetId : "custom";
    rules.value = state.config.rules;
    roleList.innerHTML = state.config.roles.map((role, index) => `<div class="solo-role-row" data-role-row data-role-id="${escapeHtml(role.id)}" data-team="${escapeHtml(role.team)}" data-copy="${escapeHtml(role.copy)}"><input data-role-name value="${escapeHtml(role.name)}" aria-label="身份名称"><input data-role-count type="number" min="0" max="12" value="${role.count}" aria-label="${escapeHtml(role.name)}数量"><button type="button" data-remove-role="${index}" aria-label="删除${escapeHtml(role.name)}">×</button></div>`).join("");
    feedback.textContent = `身份池 ${roleCount(state.config)} 张`;
  }
  function render() {
    const inSetup = state.phase === "setup";
    setup.hidden = !inSetup; deal.hidden = inSetup; privacy.hidden = !["privacy","reveal"].includes(state.phase);
    if (inSetup) { renderConfig(); return; }
    const viewedCount = state.viewed.filter(Boolean).length;
    progress.textContent = viewedCount === state.roles.length ? `全部 ${state.roles.length} 位玩家都已查看身份，可以开始游戏。` : `${state.config.name} · 已查看 ${viewedCount} / ${state.roles.length} · 点击自己的编号牌查看身份`;
    grid.innerHTML = state.roles.map((_, index) => `<button class="solo-deal-card${state.viewed[index] ? " is-viewed" : ""}" type="button" data-card-index="${index}" ${state.viewed[index] ? "disabled" : ""}><span class="solo-card-number">${index + 1}</span><span class="solo-card-state">${state.viewed[index] ? "✓ 已查看" : "点击抽牌"}</span></button>`).join("");
    grid.querySelectorAll("[data-card-index]").forEach((button) => button.addEventListener("click", () => { const index = Number(button.dataset.cardIndex); if (state.viewed[index]) return; state.activeIndex = index; state.phase = "privacy"; render(); }));
    if (state.activeIndex == null) return;
    privacyTitle.textContent = `${state.activeIndex + 1} 号玩家`;
    if (state.phase === "privacy") { privacy.dataset.stage = "privacy"; reveal.hidden = false; roleCard.hidden = true; cover.hidden = true; return; }
    const role = state.roles[state.activeIndex]; privacy.dataset.stage = "reveal"; reveal.hidden = true; roleCard.hidden = false; roleCard.dataset.role = role.id; roleMark.textContent = role.mark || role.name.slice(0,1); roleName.textContent = role.name; roleCopy.textContent = role.copy || state.config.rules || "请按当前版型规则行动。"; cover.hidden = false;
  }
}

function expandRoles(roles) { return roles.flatMap((role) => Array.from({ length: role.count }, () => ({ ...role, count: undefined }))); }
function shuffle(values) { const deck = [...values], random = new Uint32Array(deck.length); crypto.getRandomValues(random); for (let i = deck.length - 1; i > 0; i--) { const j = random[i] % (i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; } return deck; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
function soloShell() { return `<section id="solo-setup" class="solo-setup-panel"><div class="dealer-status"><p>单机发牌</p><h2>选择版型与身份池</h2><p>可直接使用预设，也可以修改数量、删除身份或添加自定义神职。</p></div><div class="solo-setup-card"><label for="solo-preset">默认版型</label><select id="solo-preset">${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}<option value="custom">自定义</option></select><label>身份池</label><div id="solo-role-list" class="solo-role-list"></div><button id="solo-add-role" class="solo-secondary-action" type="button">＋ 添加自定义神职</button><label for="solo-rules">版型规则介绍（可选）</label><textarea id="solo-rules" rows="4" maxlength="1000"></textarea><p id="solo-config-feedback"></p><button id="solo-start" class="solo-primary-action" type="button">洗牌并开始发牌</button></div></section><section id="solo-deal" class="solo-deal-panel" hidden><div class="dealer-status"><p>编号牌堆</p><h2>请选择自己的编号</h2><p id="solo-progress"></p></div><div id="solo-card-grid" class="solo-card-grid"></div><button id="solo-reset" class="redeal-action solo-reset-action" type="button">重新配置并发牌</button></section><div id="solo-privacy" class="solo-privacy" data-stage="privacy" hidden><div class="solo-privacy-card"><p>请只让当前玩家看屏幕</p><h2 id="solo-privacy-title">1 号玩家</h2><div class="solo-privacy-prompt"><strong>确认周围没人看到屏幕后，再查看身份。</strong><span>查看后请立即盖回，再把手机交给下一位玩家。</span></div><button id="solo-reveal" class="solo-primary-action" type="button">查看我的身份</button><div id="solo-role-card" class="role-card solo-role-card" hidden><span id="solo-role-mark" class="role-emblem">?</span><strong id="solo-role-name">身份</strong><p id="solo-role-copy"></p></div><button id="solo-cover" class="solo-primary-action" type="button" hidden>盖回身份</button></div></div>`; }
