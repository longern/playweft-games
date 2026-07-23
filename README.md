# Playweft Games

Six lightweight multiplayer games and one standalone game for the sibling
[`playweft`](../playweft) platform. They share one Vite build and expose
independent HTML entry points and Playweft descriptors.

| Game | Players | Local entry | Production build |
| --- | --- | --- | --- |
| Pig Dice | 2 | `http://localhost:5174/pig-dice/` | `dist/pig-dice/index.html` |
| Connect Four | 2 | `http://localhost:5174/connect-four/` | `dist/connect-four/index.html` |
| Texas Hold'em | 2–6 | `http://localhost:5174/texas-holdem/` | `dist/texas-holdem/index.html` |
| 斗地主 | 3 | `http://localhost:5174/dou-dizhu/` | `dist/dou-dizhu/index.html` |
| Werewolf dealer | 6-12 | `http://localhost:5174/werewolf-dealer/` | `dist/werewolf-dealer/index.html` |
| UNO | 2–4 | `http://localhost:5174/uno/` | `dist/uno/index.html` |
| Sudoku | 1 | `http://localhost:5174/sudoku/` | `dist/sudoku/index.html` |

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

Open `http://localhost:5174/` to browse the game list. Sudoku opens directly as
a standalone game; paste a multiplayer game's matching local entry URL into
Playweft to create a room. The multiplayer games
use the platform-owned lobby; Texas Hold'em supports two to six seated players,
斗地主 requires exactly three, the Werewolf dealer supports six to twelve, and
UNO supports two to four.

## Verify and build

```sh
npm run check
npm run build
```

The generated `dist` directory is one static deployment with seven game URLs.
