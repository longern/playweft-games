import { generateVeryHardPuzzle } from "./sudoku.js";

self.addEventListener("message", ({ data }) => {
  if (data?.type !== "generate") return;

  try {
    self.postMessage({
      type: "generated",
      requestId: data.requestId,
      generated: generateVeryHardPuzzle(),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: data.requestId,
      error: error instanceof Error ? error.message : "Unable to generate Sudoku",
    });
  }
});
