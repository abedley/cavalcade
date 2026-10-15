import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionType, computerAction, Game, seededRandom, seedForDay } from '../src/index.js';
import { ALICE, beamSearch, createMemo, YOU } from '../src/solver.js';

/** Plays `line` through the real engine, with the computer choosing its own moves. */
function replay(seed, line) {
  const game = new Game({ players: ['You', 'Alice'], cardsPerColor: 7, random: seededRandom(seed) });
  game.start();
  const yours = line.moves.filter((m) => m.player === YOU).map((m) => m.cardId);
  const theirs = [];
  game.on('cardPlayed', ({ player, card }) => player === ALICE && theirs.push(card.id));
  while (game.getState().phase !== 'finished') {
    const state = game.getState();
    const action = computerAction(game.getStateFor(ALICE), ALICE);
    if (action && (state.phase === 'discard' || state.currentPlayer === ALICE)) {
      assert.ok(game.dispatch(action));
    } else if (state.phase === 'play') {
      assert.ok(game.dispatch({ type: ActionType.PLAY_CARD, player: YOU, cardId: yours.shift() }));
    } else {
      assert.ok(game.dispatch({ type: ActionType.DISCARD_CARDS, player: YOU, cardIds: line.discard }));
    }
  }
  const { scores } = game.getState().results;
  return { diff: scores[ALICE].score - scores[YOU].score, you: scores[YOU].score, alice: scores[ALICE].score, theirs };
}

test('lines the solver finds play out the same in the game', () => {
  for (const day of ['2026-10-12', '2026-10-15']) {
    const seed = seedForDay(day);
    const line = beamSearch(seed, 3, createMemo());
    const played = replay(seed, line);
    assert.deepEqual(
      { diff: played.diff, you: played.you, alice: played.alice },
      { diff: line.diff, you: line.you, alice: line.alice },
      day,
    );
    assert.deepEqual(played.theirs, line.moves.filter((m) => m.player === ALICE).map((m) => m.cardId), day);
  }
});
