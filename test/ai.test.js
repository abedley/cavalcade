import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachComputerPlayers, chooseCard, chooseDiscards, chooseGreedyCard } from '../src/ai.js';
import { seededRandom } from '../src/cards.js';
import { ActionType, Game, GameEvent, Phase } from '../src/game.js';

const c = (color, value) => ({ id: `${color}-${value}`, color, value });
const player = (hand, collected = []) => ({ name: 'x', hand, collected, hasDiscarded: false });
const GREEDY = 'greedy';

test('chooseGreedyCard picks the play that adds the fewest points', () => {
  const state = {
    parade: [c('red', 9), c('blue', 1), c('green', 8), c('yellow', 2)],
    players: [player([c('red', 0), c('blue', 1), c('purple', 4)]), player([])],
  };
  // red-0 takes red-9 and blue-1 (10 pts); blue-1 takes blue-1 (1 pt); purple-4 takes nothing.
  assert.equal(chooseGreedyCard(state, 0), 'purple-4');
});

test('chooseGreedyCard accounts for majorities', () => {
  const state = {
    parade: [c('red', 9), c('blue', 3), c('green', 5), c('yellow', 6)],
    // Already two reds ahead of the opponent, so every red is worth 1 point.
    players: [player([c('red', 0), c('blue', 2)], [c('red', 7), c('red', 8)]), player([])],
  };
  // red-0 takes red-9 (+1 thanks to the majority); blue-2 takes blue-3 (+3).
  assert.equal(chooseGreedyCard(state, 0), 'red-0');
});

/** Plays a game between two move choosers; returns each seat's score. */
function duel(seed, options) {
  const game = new Game({ players: ['a', 'b'], cardsPerColor: 7, random: seededRandom(seed) });
  game.start();
  while (game.getState().phase !== Phase.FINISHED) {
    const s = game.getState();
    if (s.phase === Phase.PLAY) {
      const i = s.currentPlayer;
      const view = game.getStateFor(i);
      const cardId = options[i] === GREEDY ? chooseGreedyCard(view, i) : chooseCard(view, i, options[i]);
      game.dispatch({ type: ActionType.PLAY_CARD, player: i, cardId });
    } else {
      const i = s.players.findIndex((p) => !p.hasDiscarded);
      game.dispatch({ type: ActionType.DISCARD_CARDS, player: i, cardIds: chooseDiscards(game.getStateFor(i), i) });
    }
  }
  return game.getState().results.scores.map((r) => r.score);
}

test('looking ahead beats the greedy choice', () => {
  let wins = 0;
  let losses = 0;
  let margin = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const [ahead0, greedy1] = duel(seed, [{}, GREEDY]);
    const [greedy0, ahead1] = duel(seed, [GREEDY, {}]);
    wins += (ahead0 < greedy1) + (ahead1 < greedy0);
    losses += (ahead0 > greedy1) + (ahead1 > greedy0);
    margin += greedy1 - ahead0 + greedy0 - ahead1;
  }
  assert.ok(wins > losses, `lookahead won ${wins} and lost ${losses} of 80`);
  assert.ok(margin > 0, `total margin ${margin}`);
});

test('the computer never reads the opponent\'s hand or discards', () => {
  for (const seed of [3, 9, 21, 40]) {
    const game = new Game({ players: ['a', 'b'], cardsPerColor: 7, random: seededRandom(seed) });
    game.start();
    for (let t = 0; t < seed % 7; t++) {
      const s = game.getState();
      game.dispatch({ type: ActionType.PLAY_CARD, player: s.currentPlayer, cardId: s.players[s.currentPlayer].hand[0].id });
    }
    const full = game.getState();
    const me = full.currentPlayer;
    const fair = chooseCard(game.getStateFor(me), me);
    // Handing it the full state, or a made-up opponent hand, changes nothing.
    assert.equal(chooseCard(full, me), fair);
    const fake = structuredClone(full);
    fake.players[1 - me].hand = fake.players[me].hand;
    assert.equal(chooseCard(fake, me), fair);
  }

  // Likewise for the discard: the opponent has already chosen, but that stays hidden.
  const game = new Game({ players: ['a', 'b'], cardsPerColor: 7, random: seededRandom(4) });
  game.start();
  while (game.getState().phase === Phase.PLAY) {
    const s = game.getState();
    game.dispatch({ type: ActionType.PLAY_CARD, player: s.currentPlayer, cardId: s.players[s.currentPlayer].hand[0].id });
  }
  game.dispatch({ type: ActionType.DISCARD_CARDS, player: 0, cardIds: chooseDiscards(game.getStateFor(0), 0) });
  const full = game.getState();
  assert.ok(full.players[0].kept);
  assert.deepEqual(chooseDiscards(full, 1), chooseDiscards(game.getStateFor(1), 1));
});

test('the lookahead counts the cards kept at the end', () => {
  // The last play before the discard. Each six takes green-1 (1 point); the zeros take nothing.
  const state = {
    cardsPerColor: 7,
    deckCount: 0,
    finalRound: { triggeredBy: 1, reason: 'deckEmpty', turnsRemaining: 1 },
    parade: [c('green', 1), c('blue', 1), c('blue', 2), c('green', 2), c('green', 3), c('blue', 3), c('green', 5)],
    players: [
      player([c('yellow', 0), c('red', 0), c('purple', 6), c('black', 6), c('blue', 6)]),
      player([], [c('black', 3)]),
    ],
  };
  // Greedy saves the point now but then has to keep a six (+6 in all).
  assert.equal(chooseGreedyCard(state, 0), 'yellow-0');
  // Looking ahead it gives up 1 point to keep both zeros (+1 in all).
  assert.equal(chooseCard(state, 0), 'purple-6');
});

test('chooseDiscards discards the most expensive cards', () => {
  const state = {
    players: [player([c('red', 9), c('blue', 1), c('green', 8), c('yellow', 2)]), player([], [c('purple', 5)])],
  };
  assert.deepEqual(chooseDiscards(state, 0).sort(), ['green-8', 'red-9']);
});

for (const count of [2, 3, 6]) {
  test(`computer players finish a ${count}-player game on their own`, async () => {
    const game = new Game({ players: Array(count).fill('cpu'), random: seededRandom(count) });
    const over = new Promise((resolve) => game.on(GameEvent.GAME_OVER, resolve));
    const phases = [];
    game.on(GameEvent.STATE, (s) => phases.push(s.phase));
    attachComputerPlayers(game, [...Array(count).keys()]);
    game.start();
    const results = await over;
    assert.equal(game.getState().phase, Phase.FINISHED);
    assert.ok(results.winners.length >= 1);
    assert.equal(phases.at(-1), Phase.FINISHED);
  });
}

test('computers wait for the human and then continue', async () => {
  const game = new Game({ players: ['me', 'cpu'], random: seededRandom(5) });
  // Resolves once the game reaches a state where it is the human's turn.
  const humansTurn = () => new Promise((resolve) => {
    if (game.getState().currentPlayer === 0) return resolve();
    const off = game.on(GameEvent.STATE, (s) => s.currentPlayer === 0 && (off(), resolve()));
  });
  const stop = attachComputerPlayers(game, [1]);
  game.start();
  await humansTurn();
  const state = game.getState();
  const deck = state.deckCount;
  game.dispatch({ type: 'playCard', player: 0, cardId: state.players[0].hand[0].id });
  await humansTurn();
  // The computer moved once and is now waiting for the human again.
  assert.equal(game.getState().deckCount, deck - 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(game.getState().deckCount, deck - 2);
  stop();
});
