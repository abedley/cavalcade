import { chooseCard, chooseDiscards } from './ai.js';
import { createDeck, seededRandom, shuffle } from './cards.js';
import { HAND_SIZE, PARADE_SIZE } from './game.js';
import { hasAllColors, resolvePlay, score } from './rules.js';

/*
 * Searches for the best line you can play against the computer in a given deal.
 *
 * Seat 0 is you and seat 1 is the computer, as in the web game. The deal and the
 * computer are both deterministic, so once the seed is fixed the only choices in
 * the game are yours: which card to play each turn and which two to keep. That
 * makes it a one-player puzzle, and every line can be replayed exactly in `Game`.
 *
 * A full brute force is out of reach. A game gives you 6 to 14 turns of up to 5
 * choices each, about 10^8 to 10^9 lines, and the computer looks five plays ahead
 * at each of its turns. So the search is a beam search: it plays every card from
 * each position it keeps, then keeps the `width` positions where you are furthest
 * ahead, and so on to the end. Wider beams find better lines but take longer.
 * The results are the best lines found, not proven optima.
 *
 * This file mirrors `Game`'s rules for speed (no events, no copies of the whole
 * state); a test replays found lines through `Game` to check they agree.
 */

export const YOU = 0;
export const ALICE = 1;

/** The opening position of the deal for `seed`, exactly as `Game.start()` deals it. */
export function openingPosition(seed, cardsPerColor = 7) {
  const random = seededRandom(seed);
  const deck = shuffle(createDeck(cardsPerColor), random);
  const hands = [deck.splice(0, HAND_SIZE), deck.splice(0, HAND_SIZE)];
  const parade = deck.splice(0, PARADE_SIZE);
  const current = Math.floor(random() * 2);
  return {
    cardsPerColor,
    deck, // never changes; `drawn` counts the cards taken from its front
    drawn: 0,
    hands,
    parade,
    collected: [[], []],
    current,
    finalTurns: null,
    over: false, // every play made; only the keeps are left
    moves: [], // { player, cardId } in order
  };
}

/** The state `seat` would get from `Game.getStateFor(seat)`, as far as the computer reads it. */
function stateFor(pos, seat) {
  return {
    phase: pos.over ? 'discard' : 'play',
    cardsPerColor: pos.cardsPerColor,
    currentPlayer: pos.over ? null : pos.current,
    players: [0, 1].map((i) => ({
      collected: pos.collected[i],
      hand: i === seat ? pos.hands[i] : undefined,
      handCount: pos.hands[i].length,
      hasDiscarded: false,
    })),
    parade: pos.parade,
    deckCount: pos.deck.length - pos.drawn,
    finalRound: pos.finalTurns === null ? null : { turnsRemaining: pos.finalTurns },
  };
}

/** Plays `cardId` for the player to move, following `Game`'s rules. */
export function playCard(pos, cardId) {
  const player = pos.current;
  const hand = pos.hands[player].slice();
  const at = hand.findIndex((c) => c.id === cardId);
  if (at === -1) throw new Error(`${cardId} is not in player ${player}'s hand`);
  const [card] = hand.splice(at, 1);
  const { parade, removed } = resolvePlay(pos.parade, card);
  const collected = pos.collected.slice();
  collected[player] = [...collected[player], ...removed];
  let { drawn, finalTurns } = pos;
  if (finalTurns === null && drawn < pos.deck.length) hand.push(pos.deck[drawn++]);
  const hands = pos.hands.slice();
  hands[player] = hand;
  if (finalTurns !== null) finalTurns--;
  else if (hasAllColors(collected[player]) || drawn === pos.deck.length) finalTurns = 2;
  return {
    ...pos,
    drawn,
    hands,
    parade,
    collected,
    finalTurns,
    over: finalTurns === 0,
    current: finalTurns === 0 ? player : 1 - player,
    moves: [...pos.moves, { player, cardId }],
  };
}

/**
 * Remembers the computer's choices. Its choice depends only on what it can see,
 * so positions it can't tell apart share an answer, and a search that passes the
 * same position again doesn't think twice.
 */
export function createMemo(limit = 400000) {
  const choices = new Map();
  return {
    stats: { thought: 0, remembered: 0 },
    choose(pos) {
      const key = [
        pos.drawn,
        pos.finalTurns,
        pos.parade.map((c) => c.id).join(','),
        pos.collected.map((cards) => cards.map((c) => c.id).sort().join(',')).join('|'),
        pos.hands[ALICE].map((c) => c.id).join(','),
      ].join('/');
      let cardId = choices.get(key);
      if (cardId) {
        this.stats.remembered++;
      } else {
        this.stats.thought++;
        cardId = chooseCard(stateFor(pos, ALICE), ALICE);
        if (choices.size >= limit) choices.clear();
        choices.set(key, cardId);
      }
      return cardId;
    },
  };
}

/** Lets the computer play until it is your turn or the plays are over. */
export function advance(pos, memo) {
  while (!pos.over && pos.current === ALICE) pos = playCard(pos, memo.choose(pos));
  return pos;
}

/** Your possible plays from `pos` (it must be your turn). */
export const yourOptions = (pos) => pos.hands[YOU].map((c) => c.id);

/** How far ahead you are now: the computer's score minus yours, majorities included. */
export function lead(pos) {
  const { scores } = score(pos.collected);
  return scores[ALICE].score - scores[YOU].score;
}

/**
 * Ends a finished line: the computer keeps its two cards as it would in the
 * game (it can't see yours), and you keep the two that leave you furthest ahead.
 * Returns the line with its final scores. `diff` is the computer's score minus
 * yours, so higher is better for you, as in the daily bests.
 */
export function finishLine(pos) {
  const aliceDiscards = chooseDiscards(stateFor(pos, ALICE), ALICE);
  const aliceKept = pos.hands[ALICE].filter((c) => !aliceDiscards.includes(c.id));
  const hand = pos.hands[YOU];
  let best = null;
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const kept = [hand[i], hand[j]];
      const { scores } = score([[...pos.collected[YOU], ...kept], [...pos.collected[ALICE], ...aliceKept]]);
      const line = {
        diff: scores[ALICE].score - scores[YOU].score,
        you: scores[YOU].score,
        alice: scores[ALICE].score,
        moves: pos.moves,
        keep: kept.map((c) => c.id),
        discard: hand.filter((c) => !kept.includes(c)).map((c) => c.id),
        aliceDiscard: aliceDiscards,
      };
      if (!best || isBetter(line, best)) best = line;
    }
  }
  return best;
}

/** Higher differential wins; then your lower score; then the shorter line. */
export function isBetter(a, b) {
  if (a.diff !== b.diff) return a.diff > b.diff;
  if (a.you !== b.you) return a.you < b.you;
  return a.moves.length < b.moves.length;
}

/**
 * One step of the beam search: from each position (on your turn) tries every card
 * you hold and lets the computer reply. Returns the positions still in play, with
 * how far you lead in each, and the finished lines, with your best keep.
 */
export function expand(positions, memo) {
  const children = [];
  const lines = [];
  for (const pos of positions) {
    for (const cardId of yourOptions(pos)) {
      const child = advance(playCard(pos, cardId), memo);
      if (child.over) lines.push(finishLine(child));
      else children.push({ pos: child, lead: lead(child) });
    }
  }
  return { children, lines };
}

/**
 * Keeps the `width` positions where you lead by the most, one of each when
 * different orders of play reach the same position.
 */
export function selectBeam(children, width) {
  const unique = new Map();
  for (const child of children) {
    const { pos } = child;
    const key = [
      pos.parade.map((c) => c.id).join(','),
      ...pos.hands.map((cards) => cards.map((c) => c.id).sort().join(',')),
      ...pos.collected.map((cards) => cards.map((c) => c.id).sort().join(',')),
    ].join('/');
    if (!unique.has(key)) unique.set(key, child);
  }
  return [...unique.values()]
    .sort((a, b) => b.lead - a.lead)
    .slice(0, width)
    .map((child) => child.pos);
}

/**
 * Beam search over the whole deal: at each of your turns it tries every card
 * from each kept position and keeps the `width` positions where you lead by the
 * most. Returns the best finished line found.
 */
export function beamSearch(seed, width, memo = createMemo()) {
  let best = null;
  let frontier = [advance(openingPosition(seed), memo)];
  while (frontier.length) {
    const { children, lines } = expand(frontier, memo);
    for (const line of lines) if (!best || isBetter(line, best)) best = line;
    frontier = selectBeam(children, width);
  }
  return best;
}
