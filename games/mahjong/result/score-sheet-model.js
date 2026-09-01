import { resultScoreSheetRows } from "../rules/game-format.js";

const INITIAL_WINDS = ["東", "南", "西", "北"];

/**
 * Produces the fixed columns used by a match score sheet. The table state is
 * viewer-oriented, but the score sheet is always arranged by the winds from
 * the opening hand. Keeping the player ID, name, score index, and character
 * presentation together prevents a later media update from mixing views.
 */
export function createMahjongScoreSheetModel(
  state,
  {
    playerNames = [],
    viewerPlayerId = state?.viewerPlayerId,
  } = {},
) {
  const localPlayerId = String(viewerPlayerId || "");
  const columns = [1, 2, 3, 4].map((seat, index) => {
    const playerId = String(state?.players?.[seat - 1] || "");
    const context = {
      playerId,
      seat,
      wind: INITIAL_WINDS[index],
    };
    return {
      ...context,
      isLocal: Boolean(localPlayerId && playerId === localPlayerId),
      name: String(playerNames[seat - 1] || `玩家${seat}`),
    };
  });
  return {
    columns,
    selfColumnIndex: columns.findIndex((column) => column.isLocal),
    rows: resultScoreSheetRows(state),
    viewerPlayerId,
  };
}

/**
 * Resolve the media for the already-fixed columns. This is intentionally
 * separate from model creation: a platform image may finish loading after the
 * sheet is visible, while its player ID and wind column must remain unchanged.
 */
export function scoreSheetPortraitSources(model, getPlayerPresentation) {
  return (model?.columns || []).map((column) =>
    normalizePlayerPresentation(
      getPlayerPresentation?.({ playerId: column.playerId }),
    ),
  );
}

function normalizePlayerPresentation(value) {
  return {
    source: typeof value?.source === "string" ? value.source : "",
    fallbackSource:
      typeof value?.fallbackSource === "string" ? value.fallbackSource : "",
    builtinCharacterId:
      typeof value?.builtinCharacterId === "string"
        ? value.builtinCharacterId
        : "",
  };
}
