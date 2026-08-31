import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMahjongScoreSheetModel,
  scoreSheetPortraitSources,
} from "../games/mahjong/result/score-sheet-model.js";

test("score sheet keeps every opening-wind column tied to one player across score and portrait updates", () => {
  const presentations = new Map([
    ["viewer", { source: "viewer-portrait" }],
    ["north", { source: "north-portrait" }],
    ["east", { source: "east-portrait" }],
    ["south", { source: "south-portrait" }],
  ]);
  const state = {
    players: ["viewer", "north", "east", "south"],
    initialDealerIndex: 3,
    scoreHistory: [
      { scores: [25000, 25000, 25000, 25000] },
      { scores: [23000, 26000, 31000, 20000] },
    ],
  };
  const model = createMahjongScoreSheetModel(state, {
    playerNames: ["你", "北家", "东家", "南家"],
    viewerPlayerId: "viewer",
    getPlayerPresentation: ({ playerId }) => presentations.get(playerId),
  });

  assert.deepEqual(
    model.columns.map(({ wind, playerId, name }) => [wind, playerId, name]),
    [
      ["東", "viewer", "你"],
      ["南", "north", "北家"],
      ["西", "east", "东家"],
      ["北", "south", "南家"],
    ],
  );
  assert.equal(model.selfColumnIndex, 0);
  assert.deepEqual(model.rows[0].scores, [23000, 26000, 31000, 20000]);

  presentations.set("south", {
    source: "south-platform-portrait",
    fallbackSource: "south-theme-portrait",
  });
  const southColumn = scoreSheetPortraitSources(
    model,
    ({ playerId }) => presentations.get(playerId),
  )[3];
  assert.deepEqual(southColumn, {
    source: "south-platform-portrait",
    fallbackSource: "south-theme-portrait",
    builtinCharacterId: "",
  });
  assert.deepEqual(
    scoreSheetPortraitSources(model, ({ playerId }) => presentations.get(playerId))
      .map(({ source }) => source),
    [
      "viewer-portrait",
      "north-portrait",
      "east-portrait",
      "south-platform-portrait",
    ],
  );
});
