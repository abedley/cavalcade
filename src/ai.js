import { ActionType, DISCARD_COUNT, GameEvent, Phase } from './game.js';
import { resolvePlay, score } from './rules.js';

/** `playerIndex`'s score if each player's collection were scored as it stands. */
function scoreWith(players, playerIndex, extraCards) {
  const collections = players.map((p, i) => (i === playerIndex ? [...p.collected, ...extraCards] : p.collected));
  return score(collections).scores[playerIndex].score;
}

/**
 * Greedy move choice: play the card that adds the fewest points to this
 * player's current score (majorities included). Ties go to the card that takes
 * fewer cards, then to the higher-value card, keeping low cards for later.
 */
export function chooseCard(state, playerIndex) {
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
