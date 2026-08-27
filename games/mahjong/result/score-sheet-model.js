import {
  initialWindSeatOrder,
  resultScoreSheetRows,
} from "../rules/game-format.js";

const INITIAL_WINDS = ["東", "南", "西", "北"];

/**
 * Produces the fixed columns used by a match score sheet. The table state is
 * viewer-oriented, but the score sheet is always arranged by the winds from
 * the opening hand. Keeping the player ID, name, score index, and character
 * presentation together prevents a later media update from mixing views.
 */
export function createMahjongScoreSheetModel(
  state,
  { playerNames = [], getPlayerPresentation } = {},
) {
  const columns = initialWindSeatOrder(state).map((seat, index) => {
    const playerId = String(state?.players?.[seat - 1] || "");
    const context = { playerId, seat, wind: INITIAL_WINDS[index] };
    return {
      ...context,
      name: String(playerNames[seat - 1] || `玩家${seat}`),
      presentation: normalizePlayerPresentation(getPlayerPresentation?.(context)),
    };
  });
  return {
    columns,
    rows: resultScoreSheetRows(state),
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
      getPlayerPresentation?.({
        playerId: column.playerId,
        seat: column.seat,
        wind: column.wind,
      }) || column.presentation,
    ),
  );
}

function normalizePlayerPresentation(value) {
  return {
    source: typeof value?.source === "string" ? value.source : "",
    builtinCharacterId:
      typeof value?.builtinCharacterId === "string"
        ? value.builtinCharacterId
        : "",
  };
}
