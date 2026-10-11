export const COLORS = Object.freeze(['red', 'blue', 'green', 'yellow', 'purple', 'black']);
export const MAX_CARDS_PER_COLOR = 11;

/**
 * Builds a Parade deck with one card of each value 0..cardsPerColor-1 in each
 * of six colors. The standard deck is 11 per color (values 0-10, 66 cards).
 */
export function createDeck(cardsPerColor = MAX_CARDS_PER_COLOR) {
  const deck = [];
  for (const color of COLORS) {
    for (let value = 0; value < cardsPerColor; value++) {
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
