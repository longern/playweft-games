/**
 * Single owner for application-level match state.
 *
 * Mode controllers may request transitions through this API, but do not share
 * mutable module variables with one another. Rendering and transport receive
 * read callbacks from this coordinator instead.
 */
export function createMahjongMatchCoordinator({
  initialMode = null,
  onModeChange,
} = {}) {
  let mode = initialMode;
  let game;
  let initializing = false;
  let replayState = null;
  let playerName = "你";
  let playerNameIsAuthoritative = false;
  let roomPlayerId = "";
  let ending = false;
  let destroyed = false;

  function setMode(nextMode) {
    const previousMode = mode;
    mode = nextMode;
    onModeChange?.(nextMode, previousMode);
  }

  function beginEnding() {
    if (ending) return false;
    ending = true;
    return true;
  }

  function endEnding() {
    ending = false;
  }

  function destroy() {
    if (destroyed) return false;
    destroyed = true;
    return true;
  }

  return {
    beginEnding,
    destroy,
    endEnding,
    getGame: () => game,
    getMode: () => mode,
    getPlayerName: () => playerName,
    getReplayState: () => replayState,
    getRoomPlayerId: () => roomPlayerId,
    isDestroyed: () => destroyed,
    isEnding: () => ending,
    isGameInitializing: () => initializing,
    playerNameIsAuthoritative: () => playerNameIsAuthoritative,
    setGame: (nextGame) => {
      game = nextGame;
    },
    setGameInitializing: (nextInitializing) => {
      initializing = nextInitializing;
    },
    setMode,
    setPlayerName: (nextPlayerName) => {
      playerName = nextPlayerName;
    },
    setPlayerNameIsAuthoritative: (nextValue) => {
      playerNameIsAuthoritative = nextValue;
    },
    setReplayState: (nextReplayState) => {
      replayState = nextReplayState;
    },
    setRoomPlayerId: (nextPlayerId) => {
      roomPlayerId = nextPlayerId;
    },
  };
}
