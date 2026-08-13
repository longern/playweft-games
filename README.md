# Playweft Games

Nine lightweight multiplayer games and one standalone game for the sibling
[`playweft`](../playweft) platform. They share one Vite build and expose
independent, versioned Playweft game packages.

Each package is described by `/<game>/playweft.json`. Its Manifest contains
the `start_url`, localized catalogue metadata, supported modes, room player
limits, and authoritative Lua entry. Playweft bridge v1 fetches and validates
the Manifest before opening the game iframe.

| Game | Players | Local entry | Production build |
| --- | --- | --- | --- |
| Pig Dice | 2 | `http://localhost:5174/pig-dice/` | `dist/pig-dice/index.html` |
| Connect Four | 2 | `http://localhost:5174/connect-four/` | `dist/connect-four/index.html` |
| Texas Hold'em | 2–6 | `http://localhost:5174/texas-holdem/` | `dist/texas-holdem/index.html` |
| 斗地主 | 3 | `http://localhost:5174/dou-dizhu/` | `dist/dou-dizhu/index.html` |
| Werewolf dealer | 6-12 | `http://localhost:5174/werewolf-dealer/` | `dist/werewolf-dealer/index.html` |
| UNO | 2–4 | `http://localhost:5174/uno/` | `dist/uno/index.html` |
| Sudoku | 1 | `http://localhost:5174/sudoku/` | `dist/sudoku/index.html` |
| 围棋 | 1–2 | `http://localhost:5174/go/` | `dist/go/index.html` |
| 五子棋 | 2 | `http://localhost:5174/gomoku/` | `dist/gomoku/index.html` |
| 中国象棋 | 2 | `http://localhost:5174/xiangqi/` | `dist/xiangqi/index.html` |

## Run locally

Install dependencies once:

```sh
npm install
```

Start the Playweft Worker and web app from `../playweft`, then start the shared
game development server from this repository:

```sh
npm run dev
```

Open `http://localhost:5174/` to browse the game list. Sudoku, Xiangqi and the
local-AI Dou Dizhu mode open directly as solo games; paste a game's directory URL or
its explicit `playweft.json` URL into Playweft. The multiplayer games
use the platform-owned lobby; Texas Hold'em supports two to six seated players,
斗地主 supports one local player with two computer opponents or exactly three
room players, the Werewolf dealer supports six to twelve, and
UNO supports two to four.
围棋和中国象棋同时支持双人房间与单终端双方轮流行棋的 Solo 模式。

## Verify and build

```sh
npm run check
npm run build
```

The generated `dist` directory is one static deployment with ten game
packages. Each room package contains its `playweft.json`, client, help page and
`game.lua`; Sudoku contains the same package metadata without a server entry.

`public/_headers` enables CORS only for the featured list and game Manifests,
which the top-level Playweft page fetches in the browser. Lua entries are
fetched server-side by the Playweft Worker and do not need CORS.
