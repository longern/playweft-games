const BRIDGE_VERSION = 1;

/**
 * Announces metadata to a Playweft host without making a room or runtime
 * dependency. A top-level game page stays entirely local.
 */
export function createPlayweftSoloClient({ descriptor }) {
  let port;
  let destroyed = false;

  if (window.parent === window) {
    return { destroy() {} };
  }

  const announceReady = () => {
    if (!destroyed) {
      window.parent.postMessage(
        { type: "playweft:bridge-ready", version: BRIDGE_VERSION },
        "*",
      );
    }
  };
  const probe = window.setInterval(announceReady, 500);

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
    port.start();
    port.postMessage({ type: "descriptor", descriptor });
  }

  window.addEventListener("message", receiveBridge);
  announceReady();

  return {
    destroy() {
      destroyed = true;
      window.clearInterval(probe);
      window.removeEventListener("message", receiveBridge);
      port?.close();
    },
  };
}
