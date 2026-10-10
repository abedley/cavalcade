export const COLORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple', 'black']);
export const MIN_VALUE = 0;
export const MAX_VALUE = 10;

/** Builds the 66-card Parade deck: one card of each value 0-10 in each of six colors. */
export function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let value = MIN_VALUE; value <= MAX_VALUE; value++) {
      deck.push(Object.freeze({ id: `${color}-${value}`, color, value }));
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. Returns a new array; `random` returns a float in [0, 1). */
export function shuffle(cards, random = Math.random) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Small seedable PRNG (mulberry32) so games can be reproduced in tests or replays. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
