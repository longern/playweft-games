export const DEFAULT_MATCH_MUSIC_URL = String(
  import.meta.env.VITE_MAHJONG_DEFAULT_BGM_URL ?? "",
).trim();

export const DEFAULT_MATCH_MUSIC_COPYRIGHT = String(
  import.meta.env.VITE_MAHJONG_DEFAULT_BGM_COPYRIGHT ?? "",
).trim();

export const DEFAULT_MATCH_MUSIC_VOLUME = 0.32;
