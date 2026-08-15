export const HUMAN_ID = "mahjong-player";

export const PLAYERS = [
  { id: HUMAN_ID, name: "你" },
  { id: "mahjong-ai-1", name: "青岚" },
  { id: "mahjong-ai-2", name: "织羽" },
  { id: "mahjong-ai-3", name: "墨池" },
];

export const POSITIONS = ["bottom", "right", "top", "left"];
export const WINDS = ["东", "南", "西", "北"];
export const CLAIM_LABELS = {
  ron: "荣和",
  kan: "大明杠",
  ankan: "暗杠",
  kakan: "加杠",
  pon: "碰",
  chi: "吃",
};
export const RED_FIVE_IDS = new Set([17, 53, 89]);
export const DORA_INDICATOR_SLOT_COUNT = 5;
export const AI_DELAY_MS = 680;
export const AUTO_RIICHI_DISCARD_DELAY_MS = 520;
