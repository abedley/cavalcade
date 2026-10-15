import { createMemo, expand } from '../src/solver.js';

// Expands batches of positions for the solver page. The computer's choices are
// remembered for as long as the worker searches the same deal.
let memo = null;
let memoSeed = null;

self.onmessage = ({ data: { id, seed, positions } }) => {
  if (seed !== memoSeed) {
    memo = createMemo();
    memoSeed = seed;
  }
  const before = memo.stats.thought;
  const { children, lines } = expand(positions, memo);
  self.postMessage({ id, children, lines, thought: memo.stats.thought - before });
};
