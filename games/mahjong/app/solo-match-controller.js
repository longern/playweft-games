import { createLocalLuaGame } from "../workers/local-game-worker-client.js";
import { HUMAN_ID, PLAYERS } from "../rules/constants.js";
import {
  mahjongOpeningDealerSeat,
  mahjongPlayersByOpeningWind,
} from "../rules/seat-order.js";
import { createMahjongSoloSave, readMahjongSoloSave, writeMahjongSoloSave } from "../replay/solo-save.js";
import { replayMahjongSoloSave } from "../replay/solo-replay.js";

export function createMahjongSoloMatchController({
  elements,
  getGame,
  setGame,
  getGameInitializing,
  setGameInitializing,
  getPlayerName,
  setPlayerName,
  getAutoActions,
  setAutoActions,
  getSoloSave,
  setSoloSave,
  tableController,
  themeController,
  settingsDialog,
  visualRendererReady,
  beginSetupExit,
  selectedMatchRules,
  resetAutoActions,
  syncAutoActionControls,
  scheduleAi,
  showLoadingError,
  showSetup,
  showSetupRecoveryError,
}) {
  function canonicalSoloPlayers(randomSeed, playerNames) {
    const viewerOrder = PLAYERS.map((player, index) => ({
      ...player,
      name: playerNames[index] ?? player.name,
    }));
    return mahjongPlayersByOpeningWind(
      viewerOrder,
      mahjongOpeningDealerSeat(randomSeed),
    );
  }

  function soloGameOptions({ randomSeed, matchId, matchType, rules, playerNames }) {
    return {
      sourceUrl: "./game.lua",
      players: canonicalSoloPlayers(randomSeed, playerNames),
      playerId: HUMAN_ID,
      randomSeed,
      matchId,
      viewerRelativeProjection: true,
      settings: {
        matchType,
        rules,
        // players[] is already opening East/South/West/North.
        initialDealerSeat: 1,
        canonicalMatchSeats: true,
      },
    };
  }

  async function initialize(matchType = "east") {
    if (getGame() || getGameInitializing()) return;
    setGameInitializing(true);
    tableController.syncMatchMusic();
    const rules = selectedMatchRules();
    elements.loading.classList.remove("is-active", "is-error");
    elements.loadingMessage.hidden = true;
    elements.loading.hidden = false;
    void elements.loadingSpinner.offsetWidth;
    const setupExit = beginSetupExit();
    const randomSeed = crypto.randomUUID().replaceAll("-", "");
    const matchId = `solo-${crypto.randomUUID()}`;
    try {
      await themeController.ready;
      await themeController.rerollPortraits(randomSeed);
      const defaultNames = themeController.getDefaultNames?.() || {};
      const opponentNames = {
        right: defaultNames.right || PLAYERS[1].name,
        opposite: defaultNames.opposite || PLAYERS[2].name,
        left: defaultNames.left || PLAYERS[3].name,
      };
      const playerNames = [
        getPlayerName(),
        opponentNames.right,
        opponentNames.opposite,
        opponentNames.left,
      ];
      const playerPresentations =
        themeController.getPaipuPlayerPresentations?.(PLAYERS) || {};
      const gamePreparation = createLocalLuaGame(
        soloGameOptions({
          randomSeed,
          matchId,
          matchType,
          rules,
          playerNames,
        }),
      );
      const [createdGame] = await Promise.all([
        gamePreparation,
        setupExit,
        visualRendererReady,
      ]);
      setGame(createdGame);
      resetAutoActions({ persist: false });
      const save = createMahjongSoloSave({
        randomSeed,
        matchId,
        matchType,
        rules,
        playerName: getPlayerName(),
        autoActions: getAutoActions(),
        opponentPortraits: themeController.getPortraits(),
        opponentNames,
        playerPresentations,
      });
      setSoloSave(save);
      writeMahjongSoloSave(save);
      await tableController.refresh(createdGame.initialProjection, {
        animateDealIn: true,
      });
      elements.app.setAttribute("aria-busy", "false");
      elements.setup.hidden = true;
      elements.loading.hidden = true;
      settingsDialog.setSoloMatchActive(true);
      settingsDialog.setEndMatchLabel("结束本局");
      scheduleAi({ afterDealIn: true });
    } catch (error) {
      console.error(error);
      await setupExit;
      showLoadingError("牌桌准备失败，请刷新页面重试");
    } finally {
      setGameInitializing(false);
    }
  }

  async function resumeSavedMatch() {
    if (getGame() || getGameInitializing()) return;
    const save = getSoloSave();
    if (!save) return;
    setGameInitializing(true);
    elements.loading.classList.remove("is-active", "is-error");
    elements.loadingMessage.hidden = true;
    elements.loading.hidden = false;
    void elements.loadingSpinner.offsetWidth;
    elements.setup.hidden = true;
    let restored;
    try {
      const playerNames = PLAYERS.map((player, index) =>
        index === 0
          ? save.playerName || getPlayerName()
          : save.opponentNames[["right", "opposite", "left"][index - 1]] ||
            player.name,
      );
      restored = await createLocalLuaGame(
        soloGameOptions({
          randomSeed: save.randomSeed,
          matchId: save.matchId,
          matchType: save.matchType,
          rules: save.rules,
          playerNames,
        }),
      );
      const projection = await replayMahjongSoloSave({
        game: restored,
        save,
        playerId: HUMAN_ID,
      });
      await visualRendererReady;
      setGame(restored);
      await themeController.applyMatchPortraits(
        save.opponentPortraits,
        save.randomSeed,
      );
      // Rebind score-sheet presentations to the stable player IDs after a
      // saved match restores its canonical opening-wind player order.
      themeController.getPaipuPlayerPresentations?.(PLAYERS);
      if (!save.playerPresentations || !Object.keys(save.playerPresentations).length) {
        const playerPresentations =
          themeController.getPaipuPlayerPresentations?.(PLAYERS) || {};
        setSoloSave?.({ ...save, playerPresentations });
        writeMahjongSoloSave({ ...save, playerPresentations });
      }
      if (save.playerName) setPlayerName(save.playerName);
      setAutoActions({ ...save.autoActions });
      syncAutoActionControls();
      await tableController.refresh(projection);
      tableController.syncMatchMusic();
      elements.app.setAttribute("aria-busy", "false");
      elements.setup.hidden = true;
      elements.loading.hidden = true;
      settingsDialog.setSoloMatchActive(true);
      settingsDialog.setEndMatchLabel("结束本局");
      scheduleAi();
    } catch (error) {
      console.error(error);
      restored?.close();
      if (getGame() === restored) setGame(undefined);
      tableController.reset();
      settingsDialog.setSoloMatchActive(false);
      showSetup();
      elements.loading.hidden = true;
      showSetupRecoveryError(
        error instanceof Error && error.message
          ? error.message
          : "Failed to restore saved game.",
      );
    } finally {
      setGameInitializing(false);
    }
  }

  return { initialize, resumeSavedMatch };
}
