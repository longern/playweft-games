# Playweft Games

Two lightweight multiplayer games for the sibling
[`playweft`](../playweft) platform. They share one Vite build and expose two
independent HTML entry points and Playweft descriptors.

| Game | Players | Local entry | Production build |
| --- | --- | --- | --- |
| Pig Dice | 2 | `http://localhost:5174/pig-dice/` | `dist/pig-dice/index.html` |
| Connect Four | 2 | `http://localhost:5174/connect-four/` | `dist/connect-four/index.html` |

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

Paste the matching local entry URL into Playweft to create a room. Both games
use the platform-owned lobby and require exactly two seated players.

## Verify and build

```sh
npm run check
npm run build
```

The generated `dist` directory is one static deployment with two game URLs.
