const POSITIONS = ["bottom", "right", "top", "left"];
const PORTRAIT_SLOTS = {
  bottom: "self",
  right: "right",
  top: "opposite",
  left: "left",
};

export function createMahjongRoomPlayerIdentities({
  isRoom,
  getState,
  getRoomPlayerId,
  getProfile,
  themeController,
  domView,
} = {}) {
  let applyRequest = 0;
  let ownAvatarSource = "";

  async function apply(state = getState?.()) {
    if (!isRoom?.() || !Array.isArray(state?.players)) return false;
    const request = ++applyRequest;
    const aiIds = Object.keys(state.aiPlayers || {});
    const seed = String(
      state.portraitSeed ?? state.seed ?? state.lobbySeed ?? "",
    );
    const fallbackAssignments =
      themeController.getOnlineAiPortraitAssignments(aiIds, seed);
    const platformPlaceholder = themeController.getDefaultAssetUrl(
      "portrait-self",
    );
    const avatars = {};
    const fallbackAvatars = {};
    const names = {};
    for (const [index, playerId] of state.players.entries()) {
      const position = POSITIONS[index];
      if (!position || !playerId) continue;
      const fallbackUrl = themeController.getAssetUrl(
        `portrait-${PORTRAIT_SLOTS[position]}`,
      );
      fallbackAvatars[position] = fallbackUrl;
      if (state.aiPlayers?.[playerId]) {
        const references = [
          state.aiPortraits?.[playerId],
          fallbackAssignments[playerId],
        ];
        let source = null;
        for (const reference of references) {
          source = await themeController.resolveOnlinePortrait(reference);
          if (source) break;
        }
        avatars[position] = source || fallbackUrl;
        continue;
      }
      const profile = getProfile?.(playerId);
      const preference = state.avatarPreferences?.[playerId] ?? {
        kind: "platform",
      };
      if (preference.kind === "theme") {
        avatars[position] =
          (await themeController.resolveOnlinePortrait(preference)) ||
          platformPlaceholder;
      } else {
        avatars[position] =
          profile?.avatarSource ||
          (playerId === getRoomPlayerId?.() ? ownAvatarSource : "") ||
          platformPlaceholder;
      }
      if (profile?.name) names[position] = profile.name;
    }
    if (request !== applyRequest) return false;
    return domView.applyPlayerIdentityState({
      avatars,
      names,
      fallbackAvatars,
    });
  }

  function setPlatformAvatar(source) {
    ownAvatarSource = typeof source === "string" ? source : "";
    const applied = themeController.setPlatformAvatar(ownAvatarSource);
    if (!isRoom?.() || !getState?.()) return applied;
    return Promise.resolve(applied).then(() => apply());
  }

  return { apply, setPlatformAvatar };
}
