import {
  activateMahjongAssetPack,
  configureMahjongAssetPackAppearance,
  configureMahjongDefaultPackAppearance,
  createMahjongAssetPack,
  deactivateMahjongAssetPacks,
  deleteMahjongAssetPack,
  getMahjongAssetUrl,
  getMahjongConfiguredAssetPacks,
  getMahjongDefaultNames,
  getMahjongDefaultPack,
  getMahjongMatchMusicCopyright,
  getMahjongMatchMusicUrl,
  getMahjongRiichiMusicUrl,
  initializeMahjongAssetPacks,
  listMahjongAssetPacks,
  rerollMahjongAssetPackPortraits,
} from "./asset-packs.js";

const DEFAULT_VISUAL_PACK_ID = "__default__";

/**
 * Owns asset-pack persistence, settings UI, and applying visual assets to the
 * renderers. It deliberately does not own a Mahjong game or its projection.
 */
export function createMahjongThemeController({
  document = window.document,
  window: browserWindow = window,
  isStandalone,
  confirm,
  themeElements,
  appearanceElements,
  copyrightElement,
  waitForRenderers,
  setRendererAppearance,
  setPlayerAvatar,
  hasPlatformAvatar = () => false,
  onAssetsChanged,
} = {}) {
  let visualPacks = [];
  const assetPacksReady = initializeMahjongAssetPacks().catch(() => new Map());

  const onUploadChange = async () => {
    const archive = themeElements.upload.files?.[0];
    themeElements.upload.value = "";
    if (!archive) return;
    themeElements.feedback.textContent = "正在保存主题包…";
    try {
      visualPacks = await createMahjongAssetPack(archive);
      renderThemePacks();
      themeElements.feedback.textContent = "已导入并启用主题包。";
    } catch (error) {
      themeElements.feedback.textContent =
        error instanceof Error ? error.message : "导入主题包失败";
    }
  };

  const onThemeListClick = async (event) => {
    const button = event.target.closest("button");
    const id = button?.dataset.packId;
    const action = button?.dataset.packAction;
    const packUrl = button?.dataset.packUrl;
    if (!action) return;
    if (action === "download") {
      if (!packUrl) return;
      const configuredPack = getMahjongConfiguredAssetPacks().find(
        (pack) => pack.url === packUrl,
      );
      if (!configuredPack) return;
      themeElements.feedback.textContent = `正在下载「${configuredPack.name}」…`;
      try {
        const response = await fetch(configuredPack.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const archive = {
          name: `${configuredPack.name}.zip`,
          size: blob.size,
          arrayBuffer: () => blob.arrayBuffer(),
        };
        visualPacks = await createMahjongAssetPack(archive, {
          sourceUrl: configuredPack.url,
        });
        renderThemePacks();
        themeElements.feedback.textContent = "已下载并启用主题包。";
      } catch (error) {
        themeElements.feedback.textContent =
          error instanceof Error
            ? `主题包下载失败：${error.message}`
            : "主题包下载失败";
      }
      return;
    }
    if (!id) return;
    if (action === "delete") {
      const message = "删除这个麻将主题包？此操作无法恢复。";
      const confirmed = isStandalone
        ? browserWindow.confirm(message)
        : await confirm?.(message);
      if (!confirmed) return;
    }
    themeElements.feedback.textContent =
      action === "delete" ? "正在删除…" : "正在切换主题包…";
    try {
      visualPacks =
        action === "delete"
          ? await deleteMahjongAssetPack(id)
          : id === DEFAULT_VISUAL_PACK_ID
            ? await deactivateMahjongAssetPacks()
            : await activateMahjongAssetPack(id);
      renderThemePacks();
      themeElements.feedback.textContent =
        action === "delete"
          ? "已删除主题包。"
          : id === DEFAULT_VISUAL_PACK_ID
            ? "已切回默认主题。"
            : "已启用主题包。";
    } catch {
      themeElements.feedback.textContent =
        action === "delete" ? "删除主题包失败" : "切换主题包失败";
    }
  };

  const onAppearanceChange = async (event) => {
    const select = event.target.closest("select[data-appearance-key]");
    const activePack = getActiveVisualPack();
    if (!select || !activePack) return;
    const appearance = structuredClone(activePack.appearance);
    const key = select.dataset.appearanceKey;
    if (key.startsWith("portrait:")) {
      appearance.portraits[key.slice("portrait:".length)] = select.value;
    } else if (key === "voice") {
      appearance.voice = select.value === "on";
    } else {
      appearance[key] = select.value;
    }
    appearanceElements.feedback.textContent = "正在应用装扮配置…";
    try {
      if (activePack.isDefault) {
        configureMahjongDefaultPackAppearance(appearance);
      } else {
        visualPacks = await configureMahjongAssetPackAppearance(
          activePack.id,
          appearance,
        );
      }
      renderThemePacks();
      appearanceElements.feedback.textContent = "已应用装扮配置。";
    } catch (error) {
      appearanceElements.feedback.textContent =
        error instanceof Error ? error.message : "装扮配置失败";
    }
  };

  const onAssetPackChanged = () => {
    void applyVisualPack();
    syncDefaultMusicCopyright();
    applyPackAvatars();
    onAssetsChanged?.();
  };

  themeElements.upload.addEventListener("change", onUploadChange);
  themeElements.list.addEventListener("click", onThemeListClick);
  appearanceElements.controls.addEventListener("change", onAppearanceChange);
  browserWindow.addEventListener("mahjong:asset-pack-changed", onAssetPackChanged);

  async function refreshThemePacks() {
    try {
      await assetPacksReady;
      visualPacks = await listMahjongAssetPacks();
    } catch {
      visualPacks = [];
    }
    renderThemePacks();
  }

  async function applyVisualPack() {
    await waitForRenderers?.();
    await setRendererAppearance?.({
      tablecloth: getMahjongAssetUrl("tablecloth"),
      tileBack: getMahjongAssetUrl("tile-back"),
    });
  }

  function applyPackAvatars() {
    const portraitSlotByPosition = {
      bottom: "self",
      right: "right",
      top: "opposite",
      left: "left",
    };
    for (const [position, portraitSlot] of Object.entries(portraitSlotByPosition)) {
      if (position === "bottom" && hasPlatformAvatar()) continue;
      setPlayerAvatar?.(position, getMahjongAssetUrl(`portrait-${portraitSlot}`));
    }
  }

  function syncDefaultMusicCopyright() {
    if (!copyrightElement) return;
    const copyright = getMahjongMatchMusicCopyright();
    copyrightElement.textContent = copyright;
    copyrightElement.hidden = !copyright;
  }

  function renderThemePacks() {
    const defaultPack = getMahjongDefaultPack();
    defaultPack.active = !visualPacks.some((pack) => pack.active);
    const packs = [defaultPack, ...visualPacks];
    const localItems = packs.map((pack) => {
      const item = document.createElement("li");
      item.classList.toggle("is-active", pack.active);
      const details = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = pack.name;
      const summary = document.createElement("small");
      summary.textContent = pack.isDefault
        ? "内置主题包"
        : `${pack.assetNames.length} 项装扮内容`;
      details.append(title, summary);
      const actions = document.createElement("span");
      actions.className = "settings-theme-actions";
      if (pack.active) {
        const active = document.createElement("em");
        active.textContent = "使用中";
        actions.append(active);
      } else {
        actions.append(createVisualPackButton("使用", "activate", pack.id));
      }
      if (!pack.isDefault) actions.append(createVisualPackButton("删除", "delete", pack.id));
      item.append(details, actions);
      return item;
    });
    const downloadedUrls = new Set(
      visualPacks.map((pack) => pack.sourceUrl).filter(Boolean),
    );
    const remoteItems = getMahjongConfiguredAssetPacks()
      .filter((pack) => !downloadedUrls.has(pack.url))
      .map((pack) => {
        const item = document.createElement("li");
        item.className = "is-remote";
        const details = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = pack.name;
        const summary = document.createElement("small");
        summary.textContent = "在线主题包";
        details.append(title, summary);
        const actions = document.createElement("span");
        actions.className = "settings-theme-actions";
        const download = createVisualPackButton("下载", "download");
        download.dataset.packUrl = pack.url;
        actions.append(download);
        item.append(details, actions);
        return item;
      });
    themeElements.list.replaceChildren(...localItems, ...remoteItems);
    renderAppearanceSettings();
  }

  function renderAppearanceSettings() {
    const pack = getActiveVisualPack();
    const catalog = pack?.catalog;
    if (!pack || !catalog) {
      appearanceElements.controls.hidden = false;
      appearanceElements.controls.replaceChildren(
        createAppearanceEmptyState("暂无可配置的主题内容，请先选择一个主题包。"),
      );
      return;
    }
    const portraitLabels = {
      self: "自己",
      right: "右手边",
      opposite: "对家",
      left: "左手边",
    };
    const controls = document.createDocumentFragment();
    const portraitGroup = document.createElement("fieldset");
    portraitGroup.className = "settings-appearance-choice-group";
    const portraitLegend = document.createElement("legend");
    portraitLegend.textContent = "四家角色";
    portraitGroup.append(portraitLegend);
    for (const [position, label] of Object.entries(portraitLabels)) {
      portraitGroup.append(
        createAppearanceSelect(
          label,
          `portrait:${position}`,
          catalog.portraits,
          pack.appearance.portraits[position],
        ),
      );
    }
    if (catalog.portraits.length) controls.append(portraitGroup);

    const surfaceGroup = document.createElement("fieldset");
    surfaceGroup.className = "settings-appearance-choice-group";
    const surfaceLegend = document.createElement("legend");
    surfaceLegend.textContent = "牌桌画面";
    surfaceGroup.append(surfaceLegend);
    for (const [label, key, options, selected] of [
      ["桌布", "tablecloth", catalog.tablecloths, pack.appearance.tablecloth],
      ["背景", "tableBackground", catalog.tableBackgrounds, pack.appearance.tableBackground],
      ["牌背", "tileBack", catalog.tileBacks, pack.appearance.tileBack],
    ]) {
      if (options.length) surfaceGroup.append(createAppearanceSelect(label, key, options, selected));
    }
    if (surfaceGroup.childElementCount > 1) controls.append(surfaceGroup);
    if (catalog.lobbyBackgrounds.length) {
      const lobbyGroup = document.createElement("fieldset");
      lobbyGroup.className = "settings-appearance-choice-group";
      const lobbyLegend = document.createElement("legend");
      lobbyLegend.textContent = "大厅";
      lobbyGroup.append(lobbyLegend);
      lobbyGroup.append(createAppearanceSelect(
        "大厅背景",
        "lobbyBackground",
        catalog.lobbyBackgrounds,
        pack.appearance.lobbyBackground,
      ));
      controls.append(lobbyGroup);
    }
    if (
      catalog.matchBgm.length ||
      catalog.riichiBgm.length ||
      catalog.voices.length
    ) {
      const soundGroup = document.createElement("fieldset");
      soundGroup.className = "settings-appearance-choice-group";
      const soundLegend = document.createElement("legend");
      soundLegend.textContent = "声音";
      soundGroup.append(soundLegend);
      if (catalog.matchBgm.length) soundGroup.append(createAppearanceSelect(
        "对局音乐", "matchBgm", catalog.matchBgm, pack.appearance.matchBgm, "不播放",
      ));
      if (catalog.riichiBgm.length) soundGroup.append(createAppearanceSelect(
        "立直音乐", "riichiBgm", catalog.riichiBgm, pack.appearance.riichiBgm, "不切换",
      ));
      if (catalog.voices.length) soundGroup.append(createAppearanceSelect(
        "角色语音", "voice",
        [{ id: "on", label: "播放" }, { id: "off", label: "不播放" }],
        pack.appearance.voice ? "on" : "off",
      ));
      controls.append(soundGroup);
    }
    if (controls.childElementCount) {
      const heading = document.createElement("h3");
      heading.textContent = `当前主题包：${pack.name}`;
      appearanceElements.controls.replaceChildren(heading, controls);
    } else {
      appearanceElements.controls.replaceChildren(
        createAppearanceEmptyState("当前主题包没有可配置的装扮内容。"),
      );
    }
    appearanceElements.controls.hidden = false;
  }

  function getActiveVisualPack() {
    return visualPacks.find((candidate) => candidate.active) || getMahjongDefaultPack();
  }

  function createAppearanceEmptyState(message) {
    const empty = document.createElement("p");
    empty.className = "settings-appearance-empty";
    empty.textContent = message;
    return empty;
  }

  function createAppearanceSelect(label, key, options, selected, emptyLabel = "") {
    const row = document.createElement("label");
    row.className = "settings-appearance-choice";
    const text = document.createElement("span");
    text.textContent = label;
    const select = document.createElement("select");
    select.dataset.appearanceKey = key;
    if (emptyLabel) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = emptyLabel;
      option.selected = !selected;
      select.append(option);
    }
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      element.selected = option.id === selected;
      select.append(element);
    }
    row.append(text, select);
    return row;
  }

  function createVisualPackButton(label, action, id = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.packAction = action;
    if (id) button.dataset.packId = id;
    button.textContent = label;
    return button;
  }

  return {
    ready: assetPacksReady,
    refreshThemePacks,
    applyVisualPack,
    applyPackAvatars,
    syncDefaultMusicCopyright,
    rerollPortraits: rerollMahjongAssetPackPortraits,
    getAssetUrl: getMahjongAssetUrl,
    getDefaultNames: getMahjongDefaultNames,
    getMatchMusicUrl: getMahjongMatchMusicUrl,
    getRiichiMusicUrl: getMahjongRiichiMusicUrl,
    destroy() {
      themeElements.upload.removeEventListener("change", onUploadChange);
      themeElements.list.removeEventListener("click", onThemeListClick);
      appearanceElements.controls.removeEventListener("change", onAppearanceChange);
      browserWindow.removeEventListener("mahjong:asset-pack-changed", onAssetPackChanged);
    },
  };
}
