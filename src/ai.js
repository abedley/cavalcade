import { ActionType, DISCARD_COUNT, GameEvent, HAND_SIZE, Phase } from './game.js';
import { createDeck, MAX_CARDS_PER_COLOR } from './cards.js';
import { hasAllColors, resolvePlay, score } from './rules.js';

/** How many plays ahead the computer looks: its own, the opponent's reply, and its next. */
export const LOOKAHEAD = 3;

/** `playerIndex`'s score if each player's collection were scored as it stands. */
function scoreWith(players, playerIndex, extraCards) {
  const collections = players.map((p, i) => (i === playerIndex ? [...p.collected, ...extraCards] : p.collected));
  return score(collections).scores[playerIndex].score;
}

/**
 * What the search minimises for player `who`: their score, or with `margin` their
 * score minus the average of the other players' scores, so handing cards to an
 * opponent counts in their favour.
 */
function valueOf(collected, who, margin) {
  const { scores } = score(collected);
  if (!margin) return scores[who].score;
  const others = scores.reduce((sum, s, i) => (i === who ? sum : sum + s.score), 0);
  return scores[who].score - others / (scores.length - 1);
}

/** Cards `me` can't see: the other players' hands and the deck. Any of them could be played next. */
function unseenCards(state, me) {
  const seen = new Set([
    ...state.parade,
    ...state.players.flatMap((p) => p.collected),
    ...state.players[me].hand,
  ].map((c) => c.id));
  return createDeck(state.cardsPerColor ?? MAX_CARDS_PER_COLOR).filter((c) => !seen.has(c.id));
}

/** Cards each player adds to their collection at the end: 2 of the final 4. */
const KEPT_AT_END = HAND_SIZE - 1 - DISCARD_COUNT;

/**
 * `me`'s value once the game reaches the discard: the best two cards `me` is
 * known to hold join the collection. Other players' discards are unknown.
 */
function scoreAtEnd(sim, me) {
  const hand = sim.hand;
  const withKept = (kept) => valueOf(sim.collected.map((c, i) => (i === me ? [...c, ...kept] : c)), me, sim.margin);
  if (hand.length <= KEPT_AT_END) return withKept(hand);
  let best = Infinity;
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      best = Math.min(best, withKept([hand[i], hand[j]]));
    }
  }
  return best;
}

/**
 * `me`'s expected value after `player` plays `card`, looking `plies` more plays
 * ahead. Mirrors the game's own end rules: the deck shrinks by one per play
 * until the final round, which then gives every player one more turn.
 */
function afterPlay(sim, me, player, card, plies) {
  const { parade, removed } = resolvePlay(sim.parade, card);
  const collected = sim.collected.map((c, i) => (i === player ? [...c, ...removed] : c));
  let { deck, finalTurns } = sim;
  if (finalTurns !== null) {
    finalTurns--;
  } else {
    if (deck > 0) deck--;
    if (deck === 0 || hasAllColors(collected[player])) finalTurns = collected.length;
  }
  const next = {
    margin: sim.margin,
    parade,
    collected,
    deck,
    finalTurns,
    // Cards drawn along the way are unknown, so the search only plays cards already in hand.
    hand: player === me ? sim.hand.filter((c) => c.id !== card.id) : sim.hand,
    unseen: player === me ? sim.unseen : sim.unseen.filter((c) => c.id !== card.id),
  };
  if (finalTurns === 0) return scoreAtEnd(next, me);
  if (plies === 0) return valueOf(collected, me, sim.margin);
  return turnValue(next, me, (player + 1) % collected.length, plies);
}

/**
 * On its own turn `me` plays its best card. Another player's hand is hidden, so
 * their play is averaged over every card they might hold. (Modelling them as
 * greedy instead was tried and played worse.)
 */
function turnValue(sim, me, player, plies) {
  const options = player === me ? sim.hand : sim.unseen;
  if (!options.length) return valueOf(sim.collected, me, sim.margin);
  const values = options.map((card) => afterPlay(sim, me, player, card, plies - 1));
  return player === me ? Math.min(...values) : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Chooses the card to play by looking `depth` plays ahead (default 3: this play,
 * the opponent's reply and the computer's next play) and picking the one with
 * the best expected outcome. By default that is the lowest score relative to the
 * opponent (`margin`), which beats minimising its own score alone, since sending
 * cards the opponent's way is also good. It only uses what this player can see.
 * Ties go to the card that takes fewer cards now, then to the higher-value card,
 * keeping low cards for later.
 */
export function chooseCard(state, playerIndex, { depth = LOOKAHEAD, margin = true } = {}) {
  const { players, parade } = state;
  const sim = {
    margin,
    parade,
    collected: players.map((p) => p.collected),
    hand: players[playerIndex].hand,
    deck: state.deckCount ?? Infinity,
    finalTurns: state.finalRound?.turnsRemaining ?? null,
    unseen: unseenCards(state, playerIndex),
  };
  let best = null;
  for (const card of sim.hand) {
    const option = {
      card,
      value: afterPlay(sim, playerIndex, playerIndex, card, depth - 1),
      taken: resolvePlay(parade, card).removed.length,
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
 * fewer cards, then to the higher-value card. Kept for comparison.
 */
export function chooseGreedyCard(state, playerIndex) {
  const { players, parade } = state;
  const before = scoreWith(players, playerIndex, []);
  let best = null;
  for (const card of players[playerIndex].hand) {
    const { removed } = resolvePlay(parade, card);
    const option = { card, cost: scoreWith(players, playerIndex, removed) - before, taken: removed.length };
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

/** Picks the two cards to discard so the cards kept add the fewest points. */
export function chooseDiscards(state, playerIndex) {
  const { players } = state;
  const hand = players[playerIndex].hand;
  let best = null;
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const kept = hand.filter((_, k) => k !== i && k !== j);
      const total = scoreWith(players, playerIndex, kept);
      if (!best || total < best.total) best = { total, cardIds: [hand[i].id, hand[j].id] };
    }
  }
  return best.cardIds.slice(0, DISCARD_COUNT);
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
