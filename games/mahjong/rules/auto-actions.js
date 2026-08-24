import { asArray } from "./game-format.js";

export function automaticMahjongAction(
  state,
  autoActions,
  { riichiMode = false } = {},
) {
  if (!state || state.phase === "hand_ended" || riichiMode) return null;
  const legal = state.legalActions ?? {};
  const claims = asArray(legal.claims);
  const ronClaim = claims.find((claim) => claim.kind === "ron");
  if (autoActions?.autoWin && ronClaim) {
    return { type: "claim", option: ronClaim.option };
  }
  if (autoActions?.autoWin && legal.canTsumo) return { type: "tsumo" };
  if (
    autoActions?.passClaims &&
    state.phase === "claiming" &&
    claims.length > 0 &&
    !ronClaim
  ) {
    return { type: "pass" };
  }
  if (
    autoActions?.autoTsumogiri &&
    legal.canDiscard &&
    Number(state.drawnTile) > 0
  ) {
    return { type: "discard", tileId: Number(state.drawnTile) };
  }
  return null;
}

export function sameMahjongAction(left, right) {
  return (
    left?.type === right?.type &&
    Number(left?.tileId || 0) === Number(right?.tileId || 0) &&
    Number(left?.option || 0) === Number(right?.option || 0)
  );
}
