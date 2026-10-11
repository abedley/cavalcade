import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachComputerPlayers, chooseCard, chooseDiscards } from '../src/ai.js';
import { seededRandom } from '../src/cards.js';
import { Game, GameEvent, Phase } from '../src/game.js';

const c = (color, value) => ({ id: `${color}-${value}`, color, value });
const player = (hand, collected = []) => ({ name: 'x', hand, collected, hasDiscarded: false });

test('chooseCard picks the play that adds the fewest points', () => {
  const state = {
    parade: [c('red', 9), c('blue', 1), c('green', 8), c('yellow', 2)],
    players: [player([c('red', 0), c('blue', 1), c('purple', 4)]), player([])],
  };
  // red-0 takes red-9 and blue-1 (10 pts); blue-1 takes blue-1 (1 pt); purple-4 takes nothing.
  assert.equal(chooseCard(state, 0), 'purple-4');
});

test('chooseCard accounts for majorities', () => {
  const state = {
    parade: [c('red', 9), c('blue', 3), c('green', 5), c('yellow', 6)],
    // Already two reds ahead of the opponent, so every red is worth 1 point.
    players: [player([c('red', 0), c('blue', 2)], [c('red', 7), c('red', 8)]), player([])],
  };
  // red-0 takes red-9 (+1 thanks to the majority); blue-2 takes blue-3 (+3).
  assert.equal(chooseCard(state, 0), 'red-0');
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
  const stop = attachComputerPlayers(game, [1]);
  game.start();
  await new Promise((r) => setTimeout(r, 20));
  const state = game.getState();
  // Whoever started, it must now be the human's turn and nothing else happens until they move.
  assert.equal(state.currentPlayer, 0);
  const deck = state.deckCount;
  game.dispatch({ type: 'playCard', player: 0, cardId: state.players[0].hand[0].id });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(game.getState().currentPlayer, 0);
  assert.equal(game.getState().deckCount, deck - 2);
  stop();
});
