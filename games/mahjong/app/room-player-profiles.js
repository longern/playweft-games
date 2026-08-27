const PROFILE_RETRY_DELAY_MS = 3000;

export function createMahjongRoomPlayerProfiles({
  isRoom,
  getState,
  onChanged,
  onOwnPlatformPortraitChanged,
} = {}) {
  let client;
  let capabilities = new Set();
  const profiles = new Map();
  const requests = new Set();
  const retryAt = new Map();
  const retryTimers = new Map();
  const requestVersions = new Map();
  let ownPlatformPortraitSource = "";
  let ownPlatformPortraitRequestVersion = 0;

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
        const platformPortraitSource = typeof profile?.avatar?.src === "string"
          ? profile.avatar.src
          : null;
        profiles.set(playerId, { name, platformPortraitSource });
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

  function requestOwnPlatformPortrait({ initialSource, reset = false } = {}) {
    const version = ++ownPlatformPortraitRequestVersion;
    if (typeof initialSource === "string" || reset) {
      ownPlatformPortraitSource = typeof initialSource === "string" ? initialSource : "";
      onOwnPlatformPortraitChanged?.(ownPlatformPortraitSource);
    }
    if (!client || !capabilities.has("user.getProfile")) return;
    void client
      .getUserProfile({ fields: ["avatar"] })
      .then((profile) => {
        if (version !== ownPlatformPortraitRequestVersion) return;
        const source = profile?.avatar?.src;
        ownPlatformPortraitSource = typeof source === "string" ? source : "";
        onOwnPlatformPortraitChanged?.(ownPlatformPortraitSource);
      })
      .catch(() => {
        if (version === ownPlatformPortraitRequestVersion) {
          onOwnPlatformPortraitChanged?.(ownPlatformPortraitSource);
        }
      });
  }

  return {
    setContext,
    request,
    handleChanged,
    requestOwnPlatformPortrait,
    get(playerId) {
      return profiles.get(playerId);
    },
  };
}
