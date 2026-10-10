import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLORS, createDeck } from '../src/cards.js';
import { hasAllColors, majorities, resolvePlay, score } from '../src/rules.js';

const c = (color, value) => ({ id: `${color}-${value}`, color, value });

test('deck has 66 unique cards', () => {
  const deck = createDeck();
  assert.equal(deck.length, 66);
  assert.equal(new Set(deck.map((card) => card.id)).size, 66);
});

test('resolvePlay protects the last N cards and removes matching color or lower value', () => {
  const parade = [c('red', 9), c('blue', 2), c('green', 8), c('blue', 7), c('red', 1), c('yellow', 0)];
  // Playing blue-3: the last 3 cards are safe; of the first 3, blue-2 (color/value) goes, red-9 and green-8 stay.
  const { parade: next, removed } = resolvePlay(parade, c('blue', 3));
  assert.deepEqual(removed.map((x) => x.id), ['blue-2']);
  assert.deepEqual(next.map((x) => x.id), ['red-9', 'green-8', 'blue-7', 'red-1', 'yellow-0', 'blue-3']);
});

test('resolvePlay with a 0 makes every card a candidate', () => {
  const parade = [c('red', 0), c('blue', 5), c('red', 7)];
  const { removed } = resolvePlay(parade, c('red', 0));
  assert.deepEqual(removed.map((x) => x.id), ['red-0', 'red-7']);
});

test('resolvePlay removes nothing when value covers the whole parade', () => {
  const parade = [c('red', 0), c('red', 1)];
  assert.deepEqual(resolvePlay(parade, c('red', 5)).removed, []);
});

test('hasAllColors', () => {
  assert.equal(hasAllColors(COLORS.map((color) => c(color, 1))), true);
  assert.equal(hasAllColors(COLORS.slice(1).map((color) => c(color, 1))), false);
});

test('two-player majority needs a lead of two', () => {
  const m = majorities([
    [c('red', 1), c('red', 2), c('blue', 3), c('blue', 4)],
    [c('blue', 5)],
  ]);
  assert.deepEqual(m.red, [0]);
  assert.deepEqual(m.blue, []);
});

test('multi-player majority is shared on ties', () => {
  const m = majorities([[c('red', 1)], [c('red', 2)], []]);
  assert.deepEqual(m.red, [0, 1]);
});

test('score counts majority cards as 1 and picks the lowest score', () => {
  const result = score([
    [c('red', 9), c('red', 8), c('blue', 3)], // red majority: 1 + 1 + 3 = 5
    [c('blue', 2), c('green', 4)], // 2 + 4 = 6
  ]);
  assert.deepEqual(result.scores.map((s) => s.score), [5, 6]);
  assert.deepEqual(result.winners, [0]);
});

test('score breaks ties by fewest cards', () => {
  const result = score([
    [c('red', 2), c('red', 3), c('blue', 1)], // red majority: 1 + 1 + 1 = 3, three cards
    [c('blue', 3)], // 3, one card
  ]);
  assert.deepEqual(result.scores.map((s) => s.score), [3, 3]);
  assert.deepEqual(result.winners, [1]);
});
