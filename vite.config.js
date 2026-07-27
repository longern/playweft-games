import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        "pig-dice": resolve(import.meta.dirname, "pig-dice/index.html"),
        "pig-dice-help": resolve(import.meta.dirname, "pig-dice/help.html"),
        "connect-four": resolve(import.meta.dirname, "connect-four/index.html"),
        "connect-four-help": resolve(
          import.meta.dirname,
          "connect-four/help.html",
        ),
        "texas-holdem": resolve(import.meta.dirname, "texas-holdem/index.html"),
        "texas-holdem-help": resolve(
          import.meta.dirname,
          "texas-holdem/help.html",
        ),
        "dou-dizhu": resolve(import.meta.dirname, "dou-dizhu/index.html"),
        "dou-dizhu-help": resolve(import.meta.dirname, "dou-dizhu/help.html"),
        "werewolf-dealer": resolve(
          import.meta.dirname,
          "werewolf-dealer/index.html",
        ),
        "werewolf-dealer-help": resolve(
          import.meta.dirname,
          "werewolf-dealer/help.html",
        ),
        uno: resolve(import.meta.dirname, "uno/index.html"),
        "uno-help": resolve(import.meta.dirname, "uno/help.html"),
        sudoku: resolve(import.meta.dirname, "sudoku/index.html"),
        "sudoku-help": resolve(import.meta.dirname, "sudoku/help.html"),
      },
    },
  },
});
