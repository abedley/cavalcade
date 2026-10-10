import { COLORS } from './cards.js';

/**
 * Resolves playing `card` onto the end of `parade` (index 0 is the front).
 *
 * The `card.value` cards nearest the end of the parade are safe. Every card
 * before them is removed if it matches the played card's color or has a value
 * less than or equal to the played card's value.
 */
export function resolvePlay(parade, card) {
  const safeStart = Math.max(0, parade.length - card.value);
  const removed = [];
  const kept = [];
  parade.forEach((c, i) => {
    if (i < safeStart && (c.color === card.color || c.value <= card.value)) {
      removed.push(c);
    } else {
      kept.push(c);
    }
  });
  return { parade: [...kept, card], removed };
}

export function hasAllColors(cards) {
  const colors = new Set(cards.map((c) => c.color));
  return COLORS.every((color) => colors.has(color));
}

/**
 * For each color, returns the indices of players holding the majority.
 * With two players a majority needs at least two more cards than the opponent;
 * otherwise every player tied for the most cards (at least one) has it.
 */
export function majorities(collections) {
  const result = {};
  for (const color of COLORS) {
    const counts = collections.map((cards) => cards.filter((c) => c.color === color).length);
    const max = Math.max(...counts);
    if (max === 0) {
      result[color] = [];
    } else if (collections.length === 2) {
      const [a, b] = counts;
      result[color] = a - b >= 2 ? [0] : b - a >= 2 ? [1] : [];
    } else {
      result[color] = counts.flatMap((n, i) => (n === max ? [i] : []));
    }
  }
  return result;
}

/**
 * Scores each player's collected cards. Cards in a color where the player has
 * the majority are worth 1 point each; all others are worth their face value.
 * Lowest score wins; ties are broken by fewest cards, and are shared otherwise.
 */
export function score(collections) {
  const majority = majorities(collections);
  const scores = collections.map((cards, i) => {
    const total = cards.reduce(
      (sum, c) => sum + (majority[c.color].includes(i) ? 1 : c.value),
      0,
    );
    return { player: i, score: total, cardCount: cards.length };
  });
  const best = scores.reduce((a, b) =>
    b.score < a.score || (b.score === a.score && b.cardCount < a.cardCount) ? b : a,
  );
  const winners = scores
    .filter((s) => s.score === best.score && s.cardCount === best.cardCount)
    .map((s) => s.player);
  return { scores, majorities: majority, winners };
}
