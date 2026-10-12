import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seededRandom } from '../src/cards.js';
import { ActionType, Game, GameEvent, Phase } from '../src/game.js';

function newGame(players = ['Ann', 'Bob'], seed = 1) {
  const game = new Game({ players, random: seededRandom(seed) });
  game.start();
  return game;
}

function playFirstCard(game) {
  const state = game.getState();
  const player = state.currentPlayer;
  return game.dispatch({ type: ActionType.PLAY_CARD, player, cardId: state.players[player].hand[0].id });
}

test('rejects invalid player counts', () => {
  assert.throws(() => new Game({ players: ['solo'] }), RangeError);
  assert.throws(() => new Game({ players: Array(7).fill('p') }), RangeError);
});

test('start deals hands and parade and emits state', () => {
  const game = new Game({ players: ['Ann', 'Bob', 'Cy'], random: seededRandom(7) });
  const states = [];
  game.on(GameEvent.STATE, (s) => states.push(s));
  game.start();
  assert.equal(states.length, 1);
  const [state] = states;
  assert.equal(state.phase, Phase.PLAY);
  assert.equal(state.parade.length, 6);
  assert.ok(state.players.every((p) => p.hand.length === 5));
  assert.equal(state.deckCount, 66 - 6 - 15);
});

test('playing a card updates parade, refills hand and advances turn', () => {
  const game = newGame();
  const before = game.getState();
  const player = before.currentPlayer;
  const card = before.players[player].hand[0];
  let played;
  game.on(GameEvent.CARD_PLAYED, (e) => (played = e));

  assert.equal(game.dispatch({ type: ActionType.PLAY_CARD, player, cardId: card.id }), true);
  const after = game.getState();
  assert.deepEqual(after.parade.at(-1), card);
  assert.equal(after.players[player].hand.length, 5);
  assert.equal(after.players[player].collected.length, played.removed.length);
  assert.equal(after.parade.length, 7 - played.removed.length);
  assert.equal(after.currentPlayer, (player + 1) % 2);
  assert.equal(after.deckCount, before.deckCount - 1);
});

test('invalid actions are rejected without changing state', () => {
  const game = newGame();
  const before = game.getState();
  const errors = [];
  game.on(GameEvent.INVALID_ACTION, (e) => errors.push(e.message));
  const other = (before.currentPlayer + 1) % 2;

  assert.equal(game.dispatch({ type: ActionType.PLAY_CARD, player: other, cardId: before.players[other].hand[0].id }), false);
  assert.equal(game.dispatch({ type: ActionType.PLAY_CARD, player: before.currentPlayer, cardId: 'nope' }), false);
  assert.equal(game.dispatch({ type: ActionType.DISCARD_CARDS, player: 0, cardIds: [] }), false);
  assert.equal(game.dispatch({ type: 'bogus' }), false);
  assert.equal(errors.length, 4);
  assert.deepEqual(game.getState(), before);
});

test('getStateFor hides opponents\' hands', () => {
  const game = newGame();
  const view = game.getStateFor(0);
  assert.equal(view.players[0].hand.length, 5);
  assert.equal(view.players[1].hand, undefined);
  assert.equal(view.players[1].handCount, 5);
});

test('state returned to listeners cannot mutate the game', () => {
  const game = newGame();
  game.getState().players[0].hand.length = 0;
  assert.equal(game.getState().players[0].hand.length, 5);
});

for (const players of [['A', 'B'], ['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D', 'E', 'F']]) {
  for (const seed of [1, 2, 3, 42]) {
    test(`full ${players.length}-player game (seed ${seed}) plays to completion`, () => {
      const game = newGame(players, seed);
      let finalRound;
      let results;
      game.on(GameEvent.FINAL_ROUND, (e) => (finalRound = e));
      game.on(GameEvent.GAME_OVER, (r) => (results = r));

      let turnsAfterTrigger = 0;
      while (game.getState().phase === Phase.PLAY) {
        const triggered = Boolean(finalRound);
        assert.equal(playFirstCard(game), true);
        if (triggered) {
          turnsAfterTrigger++;
          assert.equal(game.getState().lastTurn.drew, false);
        }
      }
      assert.ok(finalRound);
      assert.equal(turnsAfterTrigger, players.length);

      const state = game.getState();
      assert.equal(state.phase, Phase.DISCARD);
      assert.ok(state.players.every((p) => p.hand.length === 4));

      // Discarding the same card twice is not allowed.
      const h0 = state.players[0].hand;
      assert.equal(game.dispatch({ type: ActionType.DISCARD_CARDS, player: 0, cardIds: [h0[0].id, h0[0].id] }), false);

      state.players.forEach((p, i) => {
        assert.equal(results, undefined);
        assert.equal(game.dispatch({ type: ActionType.DISCARD_CARDS, player: i, cardIds: [p.hand[0].id, p.hand[1].id] }), true);
        if (i === 0) {
          // Discards stay secret, and collections unchanged, until everyone has chosen.
          const mid = game.getState();
          assert.deepEqual(mid.players[0].collected, p.collected);
          assert.deepEqual(mid.players[0].discarded.map((c) => c.id), [p.hand[0].id, p.hand[1].id]);
          assert.equal(game.getStateFor(1).players[0].discarded, null);
          assert.equal(game.getStateFor(1).players[0].kept, null);
        }
      });

      const end = game.getState();
      assert.equal(end.phase, Phase.FINISHED);
      end.players.forEach((p, i) => {
        assert.deepEqual(p.discarded, state.players[i].hand.slice(0, 2));
        assert.deepEqual(p.kept, state.players[i].hand.slice(2));
        assert.deepEqual(p.collected.slice(-2), p.kept);
      });
      assert.deepEqual(game.getStateFor(1).players[0].discarded, end.players[0].discarded);
      assert.ok(results.winners.length >= 1);
      assert.deepEqual(end.results, results);

      // Every card is accounted for: parade + collections + 2 discards each + deck.
      const total = end.parade.length + end.deckCount
        + end.players.reduce((n, p) => n + p.collected.length + 2, 0);
      assert.equal(total, 66);
    });
  }
}

test('cardsPerColor shrinks the deck', () => {
  const game = new Game({ players: ['A', 'B'], cardsPerColor: 6, random: seededRandom(3) });
  game.start();
  const state = game.getState();
  assert.equal(state.cardsPerColor, 6);
  assert.equal(state.deckCount, 36 - 10 - 6);
  const all = [...state.parade, ...state.players.flatMap((p) => p.hand)];
  assert.ok(all.every((c) => c.value >= 0 && c.value <= 5));
});

test('cardsPerColor is validated', () => {
  assert.throws(() => new Game({ players: ['A', 'B'], cardsPerColor: 12 }), RangeError);
  assert.throws(() => new Game({ players: ['A', 'B'], cardsPerColor: 2 }), RangeError);
  assert.throws(() => new Game({ players: Array(6).fill('p'), cardsPerColor: 6 }), RangeError);
  assert.doesNotThrow(() => new Game({ players: ['A', 'B'], cardsPerColor: 3 }));
});

for (const cardsPerColor of [3, 5, 8]) {
  test(`2-player game with ${cardsPerColor} cards per color plays to completion`, () => {
    const game = new Game({ players: ['A', 'B'], cardsPerColor, random: seededRandom(cardsPerColor) });
    game.start();
    while (game.getState().phase === Phase.PLAY) assert.equal(playFirstCard(game), true);
    game.getState().players.forEach((p, i) =>
      game.dispatch({ type: ActionType.DISCARD_CARDS, player: i, cardIds: [p.hand[0].id, p.hand[1].id] }));
    const end = game.getState();
    assert.equal(end.phase, Phase.FINISHED);
    const total = end.parade.length + end.deckCount + end.players.reduce((n, p) => n + p.collected.length + 2, 0);
    assert.equal(total, cardsPerColor * 6);
  });
}
