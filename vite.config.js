import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        "pig-dice": resolve(import.meta.dirname, "pig-dice/index.html"),
        "pig-dice-help": resolve(
          import.meta.dirname,
          "pig-dice/help.html",
        ),
        "connect-four": resolve(
          import.meta.dirname,
          "connect-four/index.html",
        ),
        "connect-four-help": resolve(
          import.meta.dirname,
          "connect-four/help.html",
        ),
      },
    },
  },
});
