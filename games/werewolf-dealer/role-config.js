export const ROLE_LIBRARY = {
  werewolf: { id: "werewolf", name: "狼人", mark: "W", team: "wolf", copy: "夜晚与狼队共同确认目标。" },
  wolf_king: { id: "wolf_king", name: "狼王", mark: "K", team: "wolf", copy: "狼人阵营的特殊角色，具体技能按所选版型规则执行。" },
  gargoyle: { id: "gargoyle", name: "石像鬼", mark: "G", team: "wolf", copy: "狼人阵营的特殊角色，具体技能按所选版型规则执行。" },
  mechanical_wolf: { id: "mechanical_wolf", name: "机械狼", mark: "M", team: "wolf", copy: "狼人阵营的特殊角色，具体技能按所选版型规则执行。" },
  villager: { id: "villager", name: "平民", mark: "V", team: "villager", copy: "没有夜间技能，通过发言和投票寻找狼人。" },
  seer: { id: "seer", name: "预言家", mark: "S", team: "god", copy: "每晚可以查验一位玩家。" },
  witch: { id: "witch", name: "女巫", mark: "P", team: "god", copy: "持有解药与毒药，具体使用规则按版型执行。" },
  hunter: { id: "hunter", name: "猎人", mark: "H", team: "god", copy: "出局时可按版型规则发动猎枪。" },
  white_god: { id: "white_god", name: "白神", mark: "B", team: "god", copy: "被投出后翻牌并按版型规则结算。" },
  guard: { id: "guard", name: "守卫", mark: "D", team: "god", copy: "每晚守护一位玩家，具体限制按版型规则执行。" },
  knight: { id: "knight", name: "骑士", mark: "N", team: "god", copy: "白天可按版型规则发动决斗。" },
  gravekeeper: { id: "gravekeeper", name: "守墓人", mark: "R", team: "god", copy: "可获得上一轮出局玩家的阵营信息。" },
  psychic: { id: "psychic", name: "通灵师", mark: "T", team: "god", copy: "拥有强化查验能力，具体效果按版型规则执行。" },
  mixed: { id: "mixed", name: "混子", mark: "X", team: "other", copy: "特殊阵营角色，胜负条件按版型规则执行。" },
};

const p = (id, count = 1) => ({ ...ROLE_LIBRARY[id], count });

export const PRESETS = [
  { id: "basic-6", name: "预女双狼", rules: "6 人基础局：2 狼人、2 平民、预言家和女巫。建议采用屠城规则。", roles: [p("werewolf",2),p("villager",2),p("seer"),p("witch")] },
  { id: "basic-7", name: "预女双狼", rules: "7 人基础局：2 狼人、3 平民、预言家和女巫。建议采用屠城规则。", roles: [p("werewolf",2),p("villager",3),p("seer"),p("witch")] },
  { id: "basic-8", name: "预女三狼", rules: "8 人基础局：3 狼人、3 平民、预言家和女巫。建议采用屠城规则。", roles: [p("werewolf",3),p("villager",3),p("seer"),p("witch")] },
  { id: "basic-9", name: "预女猎", rules: "9 人基础局：3 狼人、3 平民、预言家、女巫和猎人。", roles: [p("werewolf",3),p("villager",3),p("seer"),p("witch"),p("hunter")] },
  { id: "basic-10", name: "预女猎", rules: "10 人基础局：3 狼人、4 平民、预言家、女巫和猎人。", roles: [p("werewolf",3),p("villager",4),p("seer"),p("witch"),p("hunter")] },
  { id: "basic-11", name: "预女猎守", rules: "11 人基础局：3 狼人、4 平民、预言家、女巫、猎人和守卫。", roles: [p("werewolf",3),p("villager",4),p("seer"),p("witch"),p("hunter"),p("guard")] },
  { id: "seer-witch-hunter-white", name: "预女猎白", rules: "经典 12 人版型：4 狼、4 民、预言家、女巫、猎人、白神。", roles: [p("werewolf",4),p("villager",4),p("seer"),p("witch"),p("hunter"),p("white_god")] },
  { id: "seer-witch-hunter-white-mixed", name: "预女猎白混", rules: "预女猎白基础上加入混子；可按现场规则调整混子的阵营与胜负条件。", roles: [p("werewolf",4),p("villager",3),p("seer"),p("witch"),p("hunter"),p("white_god"),p("mixed")] },
  { id: "wolf-king-guard", name: "狼王守卫", rules: "3 狼 + 狼王，对阵预言家、女巫、猎人、守卫与 4 名平民。", roles: [p("werewolf",3),p("wolf_king"),p("villager",4),p("seer"),p("witch"),p("hunter"),p("guard")] },
  { id: "wolf-king-knight", name: "狼王骑士", rules: "3 狼 + 狼王，对阵预言家、女巫、猎人、骑士与 4 名平民。", roles: [p("werewolf",3),p("wolf_king"),p("villager",4),p("seer"),p("witch"),p("hunter"),p("knight")] },
  { id: "gargoyle-gravekeeper", name: "石像鬼守墓人", rules: "3 狼 + 石像鬼，对阵预言家、女巫、猎人、守墓人与 4 名平民。", roles: [p("werewolf",3),p("gargoyle"),p("villager",4),p("seer"),p("witch"),p("hunter"),p("gravekeeper")] },
  { id: "mechanical-wolf-psychic", name: "机械狼通灵师", rules: "3 狼 + 机械狼，对阵通灵师、女巫、猎人、守卫与 4 名平民。", roles: [p("werewolf",3),p("mechanical_wolf"),p("villager",4),p("psychic"),p("witch"),p("hunter"),p("guard")] },
];

const LEGACY_WHITE_GOD_NAME = String.fromCodePoint(0x767d, 0x75f4);

function platformSafeText(value) {
  return String(value ?? "").split(LEGACY_WHITE_GOD_NAME).join("白神");
}

export function clonePreset(id = PRESETS[0].id) {
  const preset = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
  return { presetId: preset.id, name: preset.name, rules: preset.rules, roles: preset.roles.map((role) => ({ ...role })) };
}

export function roleCount(config) {
  return config.roles.reduce((sum, role) => sum + Math.max(0, Number(role.count) || 0), 0);
}

export function normalizedConfig(config) {
  const roles = config.roles
    .map((role, index) => {
      const id = String(role.id || `custom_${index + 1}`).slice(0, 40);
      const name = id === "white_god"
        ? "白神"
        : platformSafeText(role.name || "自定义神职").trim().slice(0, 24);
      return {
        id,
        name,
        mark: String(role.mark || name || "?").trim().slice(0, 1).toUpperCase() || "?",
        team: ["wolf", "villager", "god", "other"].includes(role.team) ? role.team : "god",
        copy: platformSafeText(role.copy || "自定义神职，技能按版型规则执行。").trim().slice(0, 160),
        count: Math.max(0, Math.min(12, Math.round(Number(role.count) || 0))),
      };
    })
    .filter((role) => role.count > 0 && role.name);
  return {
    presetId: String(config.presetId || "custom"),
    name: platformSafeText(config.name || "自定义版型").trim().slice(0, 40),
    rules: platformSafeText(config.rules || "").trim().slice(0, 1000),
    roles,
  };
}

export function addCustomGod(config, name = "自定义神职") {
  const suffix = crypto.randomUUID().slice(0, 8);
  config.roles.push({ id: `custom_${suffix}`, name, mark: name.slice(0,1) || "?", team: "god", copy: "自定义神职，技能按版型规则执行。", count: 1 });
}
