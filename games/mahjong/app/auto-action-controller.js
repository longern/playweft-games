import {
  setMahjongSoloAutoActions,
  writeMahjongSoloSave,
} from "../replay/solo-save.js";

const defaultAutoActions = () => ({
  autoWin: false,
  passClaims: false,
  autoTsumogiri: false,
});

/**
 * Owns the player's automatic-action preferences for the active match.
 *
 * The session decides when an action may run; this controller only owns the
 * preference state, the riichi convenience rule, persistence, and controls.
 */
export function createMahjongAutoActionController({
  elements,
  settingsDialog,
  getMode,
  getSession,
  getRoomController,
  getSoloSave,
  setSoloSave,
  scheduleAi,
}) {
  let autoActions = defaultAutoActions();
  let autoWinAfterRiichiKey = "";
  let autoWinAfterRiichiManuallyDisabled = false;

  function get() {
    return autoActions;
  }

  function set(value) {
    autoActions = { ...defaultAutoActions(), ...value };
  }

  function persist() {
    if (getMode?.() !== "solo") return;
    const save = getSoloSave?.();
    if (!save) return;
    const next = setMahjongSoloAutoActions(save, autoActions);
    if (!next) return;
    setSoloSave?.(next);
    writeMahjongSoloSave(next);
  }

  function syncControls() {
    for (const [button, enabled, label] of [
      [elements.autoWin, autoActions.autoWin, "自动胡牌"],
      [elements.passClaims, autoActions.passClaims, "放弃鸣牌"],
      [elements.autoTsumogiri, autoActions.autoTsumogiri, "自动摸切"],
    ]) {
      button.setAttribute("aria-pressed", String(enabled));
      button.title = `${label}（${enabled ? "开启" : "关闭"}）`;
    }
  }

  function schedule() {
    if (getMode?.() === "room")
      getRoomController?.()?.scheduleAutomaticAction();
    else scheduleAi?.();
  }

  function stateKey(state, event) {
    if (!state || !event) return "";
    return [
      Number(state.roundWind) || 0,
      Number(state.handNumber) || 0,
      Number(state.honba) || 0,
      Number(state.moveCount) || 0,
      Number(event.playerIndex) || 0,
    ].join(":");
  }

  function enableAfterRiichi(state, event) {
    if (!settingsDialog.autoWinAfterRiichiEnabled) return;
    const key = stateKey(state, event);
    if (
      !key ||
      key === autoWinAfterRiichiKey ||
      autoWinAfterRiichiManuallyDisabled
    )
      return;
    autoWinAfterRiichiKey = key;
    if (autoActions.autoWin) return;
    autoActions = { ...autoActions, autoWin: true };
    syncControls();
    persist();
    schedule();
  }

  function toggle(name) {
    if (getMode?.() === "room" && name === "passClaims") {
      void getSession?.()?.dispatch({
        type: "set_pass_claims",
        enabled: !autoActions.passClaims,
      });
      return;
    }
    const enabled = !autoActions[name];
    autoActions = { ...autoActions, [name]: enabled };
    if (name === "autoWin" && !enabled && autoWinAfterRiichiKey) {
      autoWinAfterRiichiManuallyDisabled = true;
    }
    syncControls();
    persist();
    schedule();
  }

  function reset({ persist: shouldPersist = true } = {}) {
    autoActions = defaultAutoActions();
    autoWinAfterRiichiKey = "";
    autoWinAfterRiichiManuallyDisabled = false;
    syncControls();
    if (shouldPersist) persist();
  }

  function syncRoomPassClaims(state) {
    if (getMode?.() !== "room" || typeof state?.passClaimsEnabled !== "boolean")
      return;
    if (autoActions.passClaims === state.passClaimsEnabled) return;
    autoActions = { ...autoActions, passClaims: state.passClaimsEnabled };
    syncControls();
  }

  return {
    enableAfterRiichi,
    get,
    reset,
    set,
    syncControls,
    syncRoomPassClaims,
    toggle,
  };
}
