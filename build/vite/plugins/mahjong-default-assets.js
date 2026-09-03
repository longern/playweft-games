import { normalizeMahjongDefaultAssetConfig } from "../../../games/mahjong/theme/default-assets.js";

export function mahjongDefaultAssets() {
  return {
    name: "mahjong-default-assets",
    async config() {
      const sourceUrl = String(
        process.env.MAHJONG_DEFAULT_ASSET_CONFIG_URL || "",
      ).trim();
      if (!sourceUrl) return undefined;
      let response;
      try {
        response = await fetch(sourceUrl);
      } catch (error) {
        console.warn(
          `无法读取麻将默认素材配置，使用内置配置：${error.message}`,
        );
        return undefined;
      }
      if (!response.ok) {
        console.warn(
          `无法读取麻将默认素材配置，使用内置配置：HTTP ${response.status}`,
        );
        return undefined;
      }
      let value;
      try {
        value = await response.json();
      } catch {
        console.warn("麻将默认素材配置不是有效 JSON，使用内置配置");
        return undefined;
      }
      const config = normalizeMahjongDefaultAssetConfig(value);
      const assetCount = Object.values(config.catalog).reduce(
        (count, entries) => count + entries.length,
        0,
      );
      if (!assetCount && !config.assetPacks.length) {
        console.warn("麻将默认素材配置没有可用素材，使用内置配置");
        return undefined;
      }
      return {
        define: {
          // The client module normalizes the injected source exactly once.
          // Injecting `config` here would normalize an already-normalized
          // object again and discard fields such as matchBgm.
          __MAHJONG_DEFAULT_ASSET_CONFIG__: JSON.stringify(value),
        },
      };
    },
  };
}
