const BRIDGE_VERSION = 1;

/** Connect a static game entry to its Playweft iframe host. */
export function createPlayweftClient({
  descriptor,
  script,
  minPlayers,
  maxPlayers,
  liveRoom = false,
  onReady,
  onState,
  onActionResult,
  onError,
}) {
  let port;
  let playerId;
  let latestMatchId;
  let latestVersion = -1;
  let destroyed = false;

  const announceReady = () => {
    if (!destroyed) {
      window.parent.postMessage(
        { type: "playweft:bridge-ready", version: BRIDGE_VERSION },
        "*",
      );
    }
  };
  const probe = window.setInterval(announceReady, 500);

  function receivePlatformMessage(event) {
    const message = event.data;
    if (message?.type === "ready") {
      playerId = message.playerId;
      onReady?.({ playerId, phase: message.phase });
      return;
    }
    if (message?.type === "action-result") {
      if (message.accepted === false) {
        onError?.(
          message.error?.message ?? "Action rejected",
          message.error?.code ?? "ACTION_REJECTED",
          message.requestId,
        );
        return;
      }
      onActionResult?.({
        requestId: message.requestId,
        accepted: true,
        matchId: message.matchId,
        version: message.version,
      });
      return;
    }
    if (message?.type === "error") {
      onError?.(message.error, message.code, message.requestId);
      return;
    }
    if (message?.type !== "state") return;
    if (message.matchId !== latestMatchId) {
      latestMatchId = message.matchId;
      latestVersion = -1;
    }
    if (
      typeof message.version === "number" &&
      message.version <= latestVersion
    ) {
      return;
    }
    if (typeof message.version === "number") latestVersion = message.version;
    onState?.({
      state: message.state,
      events: Array.isArray(message.events) ? message.events : [],
      matchId: message.matchId,
      version: message.version,
      serverTime: message.serverTime,
      playerId,
    });
  }

  function receiveBridge(event) {
    if (
      event.source !== window.parent ||
      event.data?.type !== "playweft:bridge" ||
      event.data?.version !== BRIDGE_VERSION
    ) {
      return;
    }
    const [nextPort] = event.ports;
    if (!nextPort) return;

    port?.close();
    port = nextPort;
    window.clearInterval(probe);
    port.onmessage = receivePlatformMessage;
    port.start();
    port.postMessage({
      type: "descriptor",
      descriptor: {
        ...descriptor,
        modes: descriptor.modes ?? ["room"],
        liveRoom,
      },
    });
    port.postMessage({
      type: "initialize",
      initialization: {
        runtime: "lua",
        script,
        minPlayers,
        maxPlayers,
        liveRoom,
      },
    });
  }

  window.addEventListener("message", receiveBridge);
  announceReady();

  return {
    sendAction(action) {
      if (!port) return undefined;
      const requestId = crypto.randomUUID();
      port.postMessage({ type: "action", requestId, action });
      return requestId;
    },
    destroy() {
      destroyed = true;
      window.clearInterval(probe);
      window.removeEventListener("message", receiveBridge);
      port?.close();
    },
  };
}
