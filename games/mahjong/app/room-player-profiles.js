const PROFILE_RETRY_DELAY_MS = 3000;

export function createMahjongRoomPlayerProfiles({
  isRoom,
  getState,
  onChanged,
  onOwnAvatarChanged,
} = {}) {
  let client;
  let capabilities = new Set();
  const profiles = new Map();
  const requests = new Set();
  const retryAt = new Map();
  const retryTimers = new Map();
  const requestVersions = new Map();
  let ownAvatarSource = "";
  let ownAvatarRequestVersion = 0;

  function setContext({ nextClient, nextCapabilities } = {}) {
    client = nextClient;
    capabilities = new Set(
      Array.isArray(nextCapabilities) ? nextCapabilities : [],
    );
  }

  function request(state, { force = false, playerIds } = {}) {
    if (
      !isRoom?.() ||
      !client ||
      !capabilities.has("room.players.getProfile")
    ) return;
    const aiIds = new Set(Object.keys(state?.aiPlayers || {}));
    const requestedIds = playerIds
      ? [...new Set(playerIds)]
      : Array.isArray(state?.players)
        ? state.players
        : [];
    for (const playerId of requestedIds) {
      if (typeof playerId !== "string" || !playerId || aiIds.has(playerId)) {
        continue;
      }
      if (!force && profiles.has(playerId)) continue;
      if (requests.has(playerId)) continue;
      if (!force && (retryAt.get(playerId) || 0) > Date.now()) continue;
      requestProfile(playerId);
    }
  }

  function requestProfile(playerId) {
    const version = (requestVersions.get(playerId) || 0) + 1;
    requestVersions.set(playerId, version);
    requests.add(playerId);
    void client
      .getRoomPlayerProfile({ playerId, fields: ["name", "avatar"] })
      .then((profile) => {
        if (requestVersions.get(playerId) !== version) return;
        const name = typeof profile?.name === "string"
          ? profile.name.trim()
          : "";
        const avatarSource = typeof profile?.avatar?.src === "string"
          ? profile.avatar.src
          : null;
        profiles.set(playerId, { name, avatarSource });
        retryAt.delete(playerId);
        const retryTimer = retryTimers.get(playerId);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimers.delete(playerId);
      })
      .catch(() => {
        if (requestVersions.get(playerId) !== version) return;
        retryAt.set(playerId, Date.now() + PROFILE_RETRY_DELAY_MS);
        const retryTimer = retryTimers.get(playerId);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimers.set(
          playerId,
          setTimeout(() => {
            retryTimers.delete(playerId);
            request(getState?.(), { force: true, playerIds: [playerId] });
          }, PROFILE_RETRY_DELAY_MS),
        );
      })
      .finally(() => {
        if (requestVersions.get(playerId) !== version) return;
        requests.delete(playerId);
        onChanged?.();
      });
  }

  function handleChanged({ playerId } = {}) {
    if (typeof playerId !== "string" || !playerId) return;
    profiles.delete(playerId);
    retryAt.delete(playerId);
    requestVersions.set(playerId, (requestVersions.get(playerId) || 0) + 1);
    requests.delete(playerId);
    const retryTimer = retryTimers.get(playerId);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimers.delete(playerId);
    request(getState?.(), { force: true, playerIds: [playerId] });
  }

  function requestOwnAvatar({ initialSource, reset = false } = {}) {
    const version = ++ownAvatarRequestVersion;
    if (typeof initialSource === "string" || reset) {
      ownAvatarSource = typeof initialSource === "string" ? initialSource : "";
      onOwnAvatarChanged?.(ownAvatarSource);
    }
    if (!client || !capabilities.has("user.getProfile")) return;
    void client
      .getUserProfile({ fields: ["avatar"] })
      .then((profile) => {
        if (version !== ownAvatarRequestVersion) return;
        const source = profile?.avatar?.src;
        ownAvatarSource = typeof source === "string" ? source : "";
        onOwnAvatarChanged?.(ownAvatarSource);
      })
      .catch(() => {
        if (version === ownAvatarRequestVersion) {
          onOwnAvatarChanged?.(ownAvatarSource);
        }
      });
  }

  return {
    setContext,
    request,
    handleChanged,
    requestOwnAvatar,
    get(playerId) {
      return profiles.get(playerId);
    },
  };
}
