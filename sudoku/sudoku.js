import { analyze as analyzeWithStrategies } from "sudoku-core";

export const SIZE = 9;
export const BOX_SIZE = 3;
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function createEmptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

export function cloneGrid(grid) {
  return grid.map((row) => [...row]);
}

export function candidatesFor(grid, row, column) {
  if (grid[row]?.[column]) return [];
  const used = new Set();
  for (let index = 0; index < SIZE; index += 1) {
    used.add(grid[row][index]);
    used.add(grid[index][column]);
  }
  const boxRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
  const boxColumn = Math.floor(column / BOX_SIZE) * BOX_SIZE;
  for (let r = boxRow; r < boxRow + BOX_SIZE; r += 1) {
    for (let c = boxColumn; c < boxColumn + BOX_SIZE; c += 1) {
      used.add(grid[r][c]);
    }
  }
  return DIGITS.filter((digit) => !used.has(digit));
}

export function isValidGrid(grid) {
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      const value = grid[row][column];
      if (!Number.isInteger(value) || value < 0 || value > SIZE) return false;
      if (!value) continue;
      grid[row][column] = 0;
      const isAllowed = candidatesFor(grid, row, column).includes(value);
      grid[row][column] = value;
      if (!isAllowed) return false;
    }
  }
  return true;
}

export function countSolutions(grid, limit = 2) {
  let solutions = 0;

  function search() {
    if (solutions >= limit) return;
    let target;
    let targetCandidates;
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        if (grid[row][column]) continue;
        const candidates = candidatesFor(grid, row, column);
        if (candidates.length === 0) return;
        if (!targetCandidates || candidates.length < targetCandidates.length) {
          target = { row, column };
          targetCandidates = candidates;
          if (candidates.length === 1) break;
        }
      }
      if (targetCandidates?.length === 1) break;
    }
    if (!target) {
      solutions += 1;
      return;
    }
    for (const digit of targetCandidates) {
      grid[target.row][target.column] = digit;
      search();
      grid[target.row][target.column] = 0;
      if (solutions >= limit) return;
    }
  }

  search();
  return solutions;
}

export function generateSolvedGrid(random = Math.random) {
  const grid = createEmptyGrid();

  function fill() {
    let target;
    let targetCandidates;
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        if (grid[row][column]) continue;
        const candidates = shuffled(candidatesFor(grid, row, column), random);
        if (candidates.length === 0) return false;
        if (!targetCandidates || candidates.length < targetCandidates.length) {
          target = { row, column };
          targetCandidates = candidates;
          if (candidates.length === 1) break;
        }
      }
      if (targetCandidates?.length === 1) break;
    }
    if (!target) return true;
    for (const digit of targetCandidates) {
      grid[target.row][target.column] = digit;
      if (fill()) return true;
      grid[target.row][target.column] = 0;
    }
    return false;
  }

  fill();
  return grid;
}

export function generateVeryHardPuzzle({
  random = Math.random,
  targetClues = 21,
  maxAttempts = 18,
} = {}) {
  let best;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const solution = generateSolvedGrid(random);
    const puzzle = cloneGrid(solution);
    let clues = SIZE * SIZE;
    const positions = shuffled(
      Array.from({ length: SIZE * SIZE }, (_, index) => index),
      random,
    );

    for (const position of positions) {
      if (clues <= targetClues) break;
      const row = Math.floor(position / SIZE);
      const column = position % SIZE;
      const value = puzzle[row][column];
      puzzle[row][column] = 0;
      if (countSolutions(puzzle) === 1) {
        clues -= 1;
      } else {
        puzzle[row][column] = value;
      }
    }

    const difficulty = analyzePuzzle(puzzle);
    const generated = { puzzle, solution, clues, difficulty };
    if (!best || isHarder(generated, best)) best = generated;
  }
  return best;
}

/**
 * Rate the puzzle with a human-technique solver instead of backtracking cost.
 * An incomplete rating means it needs techniques beyond singles, pairs, and
 * pointing eliminations, which is the threshold for our highest difficulty.
 */
export function analyzePuzzle(puzzle) {
  const analysis = analyzeWithStrategies(
    puzzle.flat().map((value) => value || null),
  );
  const usedStrategies = (analysis.usedStrategies ?? []).filter(Boolean);
  const strongestStrategy = usedStrategies.reduce(
    (strongest, strategy) =>
      Math.max(strongest, strategyStrength(strategy.title)),
    0,
  );
  const strategyWork = usedStrategies.reduce(
    (total, strategy) =>
      total + strategyStrength(strategy.title) * strategy.freq,
    0,
  );
  const requiresAdvancedTechniques = !analysis.difficulty;

  return {
    analysis,
    requiresAdvancedTechniques,
    score:
      (requiresAdvancedTechniques ? 1_000_000 : 0) +
      strongestStrategy * 10_000 +
      strategyWork,
  };
}

export function conflictsFor(grid, row, column) {
  const value = grid[row]?.[column];
  if (!value) return false;
  for (let index = 0; index < SIZE; index += 1) {
    if (index !== column && grid[row][index] === value) return true;
    if (index !== row && grid[index][column] === value) return true;
  }
  const boxRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
  const boxColumn = Math.floor(column / BOX_SIZE) * BOX_SIZE;
  for (let r = boxRow; r < boxRow + BOX_SIZE; r += 1) {
    for (let c = boxColumn; c < boxColumn + BOX_SIZE; c += 1) {
      if ((r !== row || c !== column) && grid[r][c] === value) return true;
    }
  }
  return false;
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function isHarder(candidate, current) {
  if (candidate.difficulty.score !== current.difficulty.score) {
    return candidate.difficulty.score > current.difficulty.score;
  }
  return candidate.clues < current.clues;
}

function strategyStrength(title) {
  const strengths = {
    "Open Singles Strategy": 1,
    "Visual Elimination Strategy": 1,
    "Single Candidate Strategy": 2,
    "Naked Pair Strategy": 4,
    "Pointing Elimination Strategy": 5,
    "Hidden Pair Strategy": 6,
  };
  return strengths[title] ?? 0;
}
