import { ActionType, DISCARD_COUNT, GameEvent, HAND_SIZE, Phase } from './game.js';
import { createDeck, MAX_CARDS_PER_COLOR } from './cards.js';
import { hasAllColors, resolvePlay, score } from './rules.js';

/*
 * The computer player is tuned for the game the web page plays: one against
 * one, 7 cards per suit. With more players it falls back to the greedy choice.
 *
 * It never sees hidden information. Every choice starts from `publicView`, which
 * copies out only what that player could see at the table, so even when it is
 * handed the full game state it cannot read the opponent's hand, the order of
 * the deck or the opponent's discards.
 */

/** How many plays ahead the computer looks: its own, the opponent's reply, and its next. */
export const LOOKAHEAD = 3;

/** Cards each player adds to their collection at the end: 2 of the final 4. */
const KEPT_AT_END = HAND_SIZE - 1 - DISCARD_COUNT;

/** What player `me` can see: the parade, every collection, the deck size, the final round and its own hand. */
function publicView(state, me) {
  return {
    players: state.players.length,
    cardsPerColor: state.cardsPerColor ?? MAX_CARDS_PER_COLOR,
    parade: state.parade,
    collected: state.players.map((p) => p.collected),
    hand: state.players[me].hand,
    deck: state.deckCount ?? Infinity,
    finalTurns: state.finalRound?.turnsRemaining ?? null,
  };
}

const withCards = (collected, who, cards) => collected.map((c, i) => (i === who ? [...c, ...cards] : c));
const ownScore = (collected, me) => score(collected).scores[me].score;

/**
 * What the computer minimises in a two-player game: its score minus the
 * opponent's. Pushing cards onto the opponent, or breaking their majority, is as
 * good as avoiding cards itself; minimising its own score alone plays little
 * better than greedy.
 */
function margin(collected, me) {
  const { scores } = score(collected);
  return scores[me].score - scores[1 - me].score;
}

/** The two cards of `hand` to keep at the end and the value they leave (the rest are discarded). */
function bestKeep(collected, hand, me, value) {
  if (hand.length <= KEPT_AT_END) return { kept: hand, value: value(withCards(collected, me, hand), me) };
  let best = null;
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const kept = [hand[i], hand[j]];
      const v = value(withCards(collected, me, kept), me);
      if (!best || v < best.value) best = { kept, value: v };
    }
  }
  return best;
}

/** Cards `me` hasn't seen: the opponent's hand and the deck, in no known order. */
function unseenCards(view) {
  const seen = new Set([...view.parade, ...view.collected.flat(), ...view.hand].map((c) => c.id));
  return createDeck(view.cardsPerColor).filter((c) => !seen.has(c.id));
}

/**
 * The expected margin after `player` plays `card`, looking `plies` more plays
 * ahead. Follows the game's end rules: the deck shrinks by one per play until
 * the final round, which gives each player one more turn before the discard.
 */
function afterPlay(sim, me, player, card, plies) {
  const { parade, removed } = resolvePlay(sim.parade, card);
  const collected = withCards(sim.collected, player, removed);
  let { deck, finalTurns } = sim;
  if (finalTurns !== null) {
    finalTurns--;
  } else {
    if (deck > 0) deck--;
    if (deck === 0 || hasAllColors(collected[player])) finalTurns = 2;
  }
  const next = {
    parade,
    collected,
    deck,
    finalTurns,
    // Cards drawn along the way are unknown, so the search only plays cards already in hand.
    // (Averaging over the unknown draw was tried and made no difference.)
    hand: player === me ? sim.hand.filter((c) => c.id !== card.id) : sim.hand,
    unseen: player === me ? sim.unseen : sim.unseen.filter((c) => c.id !== card.id),
  };
  // The opponent's kept cards are unknown, so only the computer's own are counted.
  if (finalTurns === 0) return bestKeep(collected, next.hand, me, margin).value;
  if (plies === 0) return margin(collected, me);
  return turnValue(next, me, 1 - player, plies);
}

/**
 * On its own turn the computer plays its best card. The opponent's hand is
 * hidden, so their reply is averaged over every card they might hold: any card
 * not yet seen. (Modelling them as greedy instead was tried and played worse.)
 */
function turnValue(sim, me, player, plies) {
  const options = player === me ? sim.hand : sim.unseen;
  if (!options.length) return margin(sim.collected, me);
  const values = options.map((card) => afterPlay(sim, me, player, card, plies - 1));
  return player === me ? Math.min(...values) : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Chooses the card to play by looking `depth` plays ahead (default 3: this play,
 * the opponent's reply and the computer's next play), counting the cards it
 * would keep if the game ends within that horizon, and picking the play with the
 * lowest expected margin. Ties go to the card that takes fewer cards now, then
 * to the higher-value card, keeping low cards for later.
 */
export function chooseCard(state, playerIndex, { depth = LOOKAHEAD } = {}) {
  const view = publicView(state, playerIndex);
  if (view.players !== 2) return chooseGreedyCard(state, playerIndex);
  const sim = { ...view, unseen: unseenCards(view) };
  let best = null;
  for (const card of view.hand) {
    const option = {
      card,
      value: afterPlay(sim, playerIndex, playerIndex, card, depth - 1),
      taken: resolvePlay(view.parade, card).removed.length,
    };
    if (
      !best
      || option.value < best.value - 1e-9
      || (Math.abs(option.value - best.value) <= 1e-9 && (option.taken < best.taken
        || (option.taken === best.taken && card.value > best.card.value)))
    ) {
      best = option;
    }
  }
  return best.card.id;
}

/**
 * The original greedy choice: the card that adds the fewest points to this
 * player's score this turn, majorities included. Ties go to the card that takes
 * fewer cards, then to the higher-value card. Used with more than two players,
 * and kept for comparison.
 */
export function chooseGreedyCard(state, playerIndex) {
  const view = publicView(state, playerIndex);
  const before = ownScore(view.collected, playerIndex);
  let best = null;
  for (const card of view.hand) {
    const { removed } = resolvePlay(view.parade, card);
    const option = { card, cost: ownScore(withCards(view.collected, playerIndex, removed), playerIndex) - before, taken: removed.length };
    if (
      !best
      || option.cost < best.cost
      || (option.cost === best.cost && option.taken < best.taken)
      || (option.cost === best.cost && option.taken === best.taken && card.value > best.card.value)
    ) {
      best = option;
    }
  }
  return best.card.id;
}

/**
 * Picks the two cards to discard so the two kept leave the best margin (with
 * more than two players, the fewest points). The opponent's choice is hidden
 * until both have discarded.
 */
export function chooseDiscards(state, playerIndex) {
  const view = publicView(state, playerIndex);
  const value = view.players === 2 ? margin : ownScore;
  const { kept } = bestKeep(view.collected, view.hand, playerIndex, value);
  return view.hand.filter((c) => !kept.includes(c)).map((c) => c.id).slice(0, DISCARD_COUNT);
}

/** Returns the action a computer player would take now, or null if it has nothing to do. */
export function computerAction(state, playerIndex) {
  if (state.phase === Phase.PLAY && state.currentPlayer === playerIndex) {
    return { type: ActionType.PLAY_CARD, player: playerIndex, cardId: chooseCard(state, playerIndex) };
  }
  if (state.phase === Phase.DISCARD && !state.players[playerIndex].hasDiscarded) {
    return { type: ActionType.DISCARD_CARDS, player: playerIndex, cardIds: chooseDiscards(state, playerIndex) };
  }
  return null;
}

/**
 * Makes `playerIndices` computer-controlled: whenever the game emits a state in
 * which one of them has a move, it plays that move after `delay` ms. Moves are
 * always made asynchronously so other `state` listeners see every state in order.
 * Returns a function that stops the computer players.
 */
export function attachComputerPlayers(game, playerIndices, { delay = 0 } = {}) {
  let timer = null;

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      for (const i of playerIndices) {
        // Each computer sees only what that player could see.
        const action = computerAction(game.getStateFor(i), i);
        if (action) {
          game.dispatch(action); // emits a new state, which schedules the next move
          return;
        }
      }
    }, delay);
  };

  const off = game.on(GameEvent.STATE, schedule);
  if (game.getState().phase !== null) schedule();

  return () => {
    off();
    clearTimeout(timer);
    timer = null;
  };
}
