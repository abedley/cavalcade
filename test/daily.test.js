import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computerAction } from '../src/ai.js';
import { seededRandom } from '../src/cards.js';
import { dateOfKey, dayKey, msUntilMidnight, seedForDay } from '../src/daily.js';
import { Game, GameEvent, Phase } from '../src/game.js';

test('dayKey uses the local calendar date', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 0, 0, 0)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59, 59, 999)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 12)), '2026-12-31');
  assert.equal(dayKey(dateOfKey('2026-10-12')), '2026-10-12');
});

test('the seed is fixed for a day and changes at midnight', () => {
  const lateNight = new Date(2026, 9, 12, 23, 59, 59);
  const morning = new Date(2026, 9, 12, 7, 0);
  const nextDay = new Date(2026, 9, 13, 0, 0, 0);
  assert.equal(seedForDay(dayKey(lateNight)), seedForDay(dayKey(morning)));
  assert.notEqual(seedForDay(dayKey(lateNight)), seedForDay(dayKey(nextDay)));
  assert.equal(msUntilMidnight(lateNight), 1000);
  // A fixed value, so a change to the hash (which would change everyone's deal) is caught.
  assert.equal(seedForDay('2026-10-12'), 1626743479);
});

test('a year of days gets a year of different seeds', () => {
  const seeds = new Set();
  for (let d = 0; d < 365; d++) seeds.add(seedForDay(dayKey(new Date(2026, 0, 1 + d))));
  assert.equal(seeds.size, 365);
});

/** Plays a whole game with computer moves for every player; returns everything it emitted. */
function playOut(seed, cardsPerColor) {
  const game = new Game({ players: ['You', 'CPU'], cardsPerColor, random: seededRandom(seed) });
  const events = [];
  for (const type of Object.values(GameEvent)) game.on(type, (payload) => events.push([type, payload]));
  game.start();
  while (game.getState().phase !== Phase.FINISHED) {
    const state = game.getState();
    const player = state.phase === Phase.PLAY ? state.currentPlayer : state.players.findIndex((p) => !p.hasDiscarded);
    game.dispatch(computerAction(game.getStateFor(player), player));
  }
  return events;
}

test('the same daily seed and the same moves give the same game', () => {
  const seed = seedForDay('2026-10-12');
  for (const perSuit of [5, 7, 11]) {
    const first = playOut(seed, perSuit);
    assert.deepEqual(playOut(seed, perSuit), first);
    assert.ok(first.some(([type]) => type === GameEvent.GAME_OVER));
  }
  assert.notDeepEqual(playOut(seedForDay('2026-10-13'), 7), playOut(seed, 7));
});
