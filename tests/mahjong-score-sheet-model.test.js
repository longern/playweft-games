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
    getPlayerPresentation: ({ playerId }) => presentations.get(playerId),
  });

  assert.deepEqual(
    model.columns.map(({ wind, playerId, name }) => [wind, playerId, name]),
    [
      ["東", "east", "东家"],
      ["南", "south", "南家"],
      ["西", "viewer", "你"],
      ["北", "north", "北家"],
    ],
  );
  assert.deepEqual(model.rows[0].scores, [31000, 20000, 23000, 26000]);

  presentations.set("south", { source: "south-platform-portrait" });
  assert.deepEqual(
    scoreSheetPortraitSources(model, ({ playerId }) => presentations.get(playerId))
      .map(({ source }) => source),
    [
      "east-portrait",
      "south-platform-portrait",
      "viewer-portrait",
      "north-portrait",
    ],
  );
});
