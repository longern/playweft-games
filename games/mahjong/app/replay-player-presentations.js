import { orientMahjongPaipuRecord } from "../rules/room-state.js";
import { mahjongPresentationPosition } from "../rules/seat-order.js";
import { resolveMahjongPlayerPresentation } from "./player-presentation-resolver.js";

export async function applyMahjongReplayPlayerPresentations({
  record,
  themeController,
  presentationStore,
  domView,
}) {
  if (!record) return false;
  const oriented = orientMahjongPaipuRecord(record, record.viewerPlayerId);
  const portraits = {};
  const fallbackPortraits = {};
  const builtinCharacters = {};
  const resolvedPresentations = new Map();
  const viewerSeat =
    (oriented.players || []).findIndex(
      (player) => player?.id === record.viewerPlayerId,
    ) + 1;
  for (const [index, player] of (oriented.players || []).entries()) {
    const position = mahjongPresentationPosition(index + 1, viewerSeat || 1);
    if (!position) continue;
    const presentation = record.playerPresentations?.[player?.id] || {};
    const resolved = await resolveMahjongPlayerPresentation({
      playerId: player?.id,
      presentation,
      platformSource:
        player?.id === record.viewerPlayerId
          ? themeController.getPlatformAvatarSource?.() || ""
          : "",
      resolveThemePortrait: themeController.resolveCharacterPortrait,
    });
    portraits[position] = resolved.source;
    const fallbackSource = resolved.fallbackSource;
    resolvedPresentations.set(String(player?.id || ""), {
      source: resolved.source,
      ...(fallbackSource ? { fallbackSource } : {}),
      ...(resolved.builtinCharacterId
        ? { builtinCharacterId: resolved.builtinCharacterId }
        : {}),
    });
    fallbackPortraits[position] = fallbackSource;
    builtinCharacters[position] = resolved.builtinCharacterId;
  }
  presentationStore.replace(resolvedPresentations);
  return domView.applyPlayerIdentityState({
    portraits,
    fallbackPortraits,
    builtinCharacters,
  });
}
