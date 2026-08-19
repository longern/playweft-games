import assert from "node:assert/strict";
import { test } from "node:test";

import {
  automaticMahjongAction,
  sameMahjongAction,
} from "../games/mahjong/auto-actions.js";

test("mahjong automatic actions prioritize winning and preserve ron", () => {
  const claiming = {
    phase: "claiming",
    legalActions: {
      claims: [
        { kind: "pon", option: 2 },
        { kind: "ron", option: 3 },
      ],
    },
  };

  assert.deepEqual(
    automaticMahjongAction(claiming, { autoWin: true, passClaims: true }),
    { type: "claim", option: 3 },
  );
  assert.equal(automaticMahjongAction(claiming, { passClaims: true }), null);
  assert.deepEqual(
    automaticMahjongAction(
      { phase: "playing", legalActions: { canTsumo: true } },
      { autoWin: true },
    ),
    { type: "tsumo" },
  );
});

test("mahjong automatic actions skip calls and discard only a drawn tile", () => {
  assert.deepEqual(
    automaticMahjongAction(
      {
        phase: "claiming",
        legalActions: { claims: [{ kind: "chi", option: 1 }] },
      },
      { passClaims: true },
    ),
    { type: "pass" },
  );
  assert.deepEqual(
    automaticMahjongAction(
      {
        phase: "playing",
        drawnTile: 73,
        legalActions: { canDiscard: true },
      },
      { autoTsumogiri: true },
    ),
    { type: "discard", tileId: 73 },
  );
  assert.equal(
    automaticMahjongAction(
      {
        phase: "playing",
        drawnTile: 0,
        legalActions: { canDiscard: true },
      },
      { autoTsumogiri: true },
    ),
    null,
  );
  assert.equal(
    automaticMahjongAction(
      {
        phase: "playing",
        drawnTile: 73,
        legalActions: { canDiscard: true },
      },
      { autoTsumogiri: true },
      { riichiMode: true },
    ),
    null,
  );
  assert.equal(
    sameMahjongAction(
      { type: "discard", tileId: 73 },
      { type: "discard", tileId: 73 },
    ),
    true,
  );
  assert.equal(sameMahjongAction({ type: "pass" }, { type: "tsumo" }), false);
});
