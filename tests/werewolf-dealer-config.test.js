import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizedConfig } from "../games/werewolf-dealer/role-config.js";

test("Werewolf dealer migrates legacy White God names in stored presets", () => {
  const legacyName = String.fromCodePoint(0x767d, 0x75f4);
  const config = normalizedConfig({
    presetId: "saved",
    name: `预女猎${legacyName.slice(0, 1)}`,
    rules: `包含${legacyName}`,
    roles: [
      {
        id: "white_god",
        name: legacyName,
        copy: `${legacyName}出局后翻牌`,
        team: "god",
        count: 1,
      },
    ],
  });

  assert.equal(config.roles[0].name, "白神");
  assert.equal(config.roles[0].copy, "白神出局后翻牌");
  assert.equal(config.rules, "包含白神");
  assert.equal(config.name, "预女猎白");
});
