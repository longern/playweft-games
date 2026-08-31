import { getMahjongBuiltinCharacterForKey } from "../theme/builtin-characters.js";
import {
  normalizeMahjongPlayerPresentation,
  resolveMahjongPlayerPresentation,
} from "./player-presentation-resolver.js";
import { mahjongPresentationSeat } from "../rules/seat-order.js";

const POSITIONS = ["bottom", "right", "top", "left"];

export function createMahjongRoomPlayerPresentations({
  isRoom,
  getState,
  getRoomPlayerId,
  getProfile,
  themeController,
  domView,
} = {}) {
  let applyRequest = 0;
  let ownPlatformPortraitSource = "";
  let latestState;
  let resolvedPresentations = new Map();
  const presentationSubscribers = new Set();

  function presentationForPlayer(state, playerId) {
    return state?.playerPresentations?.[playerId] || {};
  }

  function builtinCharacterFor(playerId, presentation) {
    return String(presentation?.builtinCharacterId || "") ||
      getMahjongBuiltinCharacterForKey(playerId);
  }

  async function apply(state = getState?.(), { viewerSeat = 1 } = {}) {
    if (!isRoom?.() || !Array.isArray(state?.players)) return false;
    latestState = state;
    const request = ++applyRequest;
    const portraits = {};
    const fallbackPortraits = {};
    const builtinCharacters = {};
    const names = {};
    const nextPresentations = new Map();
    for (const [index, playerId] of state.players.entries()) {
      const position = POSITIONS[
        mahjongPresentationSeat(index + 1, viewerSeat) - 1
      ];
      if (!position || !playerId) continue;
      const presentation = state.aiPlayers?.[playerId]
        ? state.aiPresentations?.[playerId] || {}
        : presentationForPlayer(state, playerId);
      const profile = getProfile?.(playerId);
      const platformSource =
        profile?.platformPortraitSource ||
        (playerId === getRoomPlayerId?.() ? ownPlatformPortraitSource : "");
      const resolved = await resolveMahjongPlayerPresentation({
        playerId,
        presentation,
        platformSource,
        isAi: Boolean(state.aiPlayers?.[playerId]),
        resolveThemePortrait: themeController.resolveCharacterPortrait,
        fallbackBuiltinCharacterId: builtinCharacterFor(playerId, presentation),
      });
      portraits[position] = resolved.source;
      fallbackPortraits[position] = resolved.fallbackSource;
      builtinCharacters[position] = resolved.builtinCharacterId;
      nextPresentations.set(playerId, resolved);
      if (profile?.name) names[position] = profile.name;
    }
    if (request !== applyRequest) return false;
    const changedPlayerIds = changedPresentationPlayerIds(
      resolvedPresentations,
      nextPresentations,
    );
    resolvedPresentations = nextPresentations;
    if (changedPlayerIds.length) {
      for (const listener of presentationSubscribers) {
        listener({ changedPlayerIds });
      }
    }
    return domView.applyPlayerIdentityState({
      portraits,
      fallbackPortraits,
      builtinCharacters,
      names,
    });
  }

  async function resolveCharacterVoice(playerIndex, cue) {
    const playerId = latestState?.players?.[Number(playerIndex) - 1];
    if (!playerId) return "";
    const presentation = latestState.aiPlayers?.[playerId]
      ? latestState.aiPresentations?.[playerId]
      : presentationForPlayer(latestState, playerId);
    const character = normalizeMahjongPlayerPresentation(
      presentation,
      playerId,
    ).themeCharacter;
    if (!character?.packId || !character?.characterId) return "";
    return (await themeController.resolveCharacterVoice?.(character, cue)) || "";
  }

  function setPlatformPortraitSource(source) {
    ownPlatformPortraitSource = typeof source === "string" ? source : "";
    const applied = themeController.setPlatformAvatar(ownPlatformPortraitSource);
    if (!isRoom?.() || !getState?.()) return applied;
    return Promise.resolve(applied).then(() => apply());
  }

  function getPlayerPresentation({ playerId } = {}) {
    const value = resolvedPresentations.get(playerId);
    return value ? { ...value } : undefined;
  }

  function subscribePlayerPresentations(listener) {
    if (typeof listener !== "function") return () => {};
    presentationSubscribers.add(listener);
    return () => presentationSubscribers.delete(listener);
  }

  return {
    apply,
    getPlayerPresentation,
    subscribePlayerPresentations,
    resolveCharacterVoice,
    setPlatformPortraitSource,
  };
}

function changedPresentationPlayerIds(previous, next) {
  const playerIds = new Set([...previous.keys(), ...next.keys()]);
  return [...playerIds].filter((playerId) => {
    const before = previous.get(playerId) || {};
    const after = next.get(playerId) || {};
    return (
      before.source !== after.source ||
      before.fallbackSource !== after.fallbackSource ||
      before.builtinCharacterId !== after.builtinCharacterId
    );
  });
}
