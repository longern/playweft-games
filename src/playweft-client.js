const BRIDGE_VERSION = 1;

/** Connect a static game entry to its Playweft iframe host. */
export function createPlayweftClient({
  descriptor,
  script,
  minPlayers,
  maxPlayers,
  onReady,
  onState,
  onError,
}) {
  let port;
  let playerId;
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
    if (message?.type === "error") {
      onError?.(message.error, message.code);
      return;
    }
    if (message?.type !== "state") return;
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
      version: message.version,
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
    port.postMessage({ type: "descriptor", descriptor });
    port.postMessage({
      type: "initialize",
      initialization: {
        runtime: "lua",
        script,
        minPlayers,
        maxPlayers,
      },
    });
  }

  window.addEventListener("message", receiveBridge);
  announceReady();

  return {
    sendAction(action) {
      if (!port) return false;
      port.postMessage({ type: "action", action });
      return true;
    },
    destroy() {
      destroyed = true;
      window.clearInterval(probe);
      window.removeEventListener("message", receiveBridge);
      port?.close();
    },
  };
}
