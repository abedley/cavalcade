import { COLORS, createDeck, MAX_CARDS_PER_COLOR, shuffle } from './cards.js';
import { Emitter } from './emitter.js';
import { hasAllColors, resolvePlay, score } from './rules.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 5;
export const PARADE_SIZE = 6;
export const DISCARD_COUNT = 2;

export const Phase = Object.freeze({
  PLAY: 'play',
  DISCARD: 'discard',
  FINISHED: 'finished',
});

export const ActionType = Object.freeze({
  PLAY_CARD: 'playCard',
  DISCARD_CARDS: 'discardCards',
});

export const GameEvent = Object.freeze({
  /** Emitted with the new state after every successful action (and on start). */
  STATE: 'state',
  /** Emitted with `{ player, card, removed, drew }` after a card is played. */
  CARD_PLAYED: 'cardPlayed',
  /** Emitted with `{ triggeredBy, reason }` when the final round begins. */
  FINAL_ROUND: 'finalRound',
  /** Emitted with the scoring results when the game ends. */
  GAME_OVER: 'gameOver',
  /** Emitted with `{ action, message }` when an action is rejected. */
  INVALID_ACTION: 'invalidAction',
});

/** Smallest deck that still leaves at least one card to draw after dealing. */
export function minCardsPerColor(playerCount) {
  return Math.ceil((playerCount * HAND_SIZE + PARADE_SIZE + 1) / COLORS.length);
}

export class InvalidActionError extends Error {
  name = 'InvalidActionError';
}

/**
 * A game of Parade driven by player actions.
 *
 * Send input with `dispatch(action)`; listen for updates with `on(event, fn)`.
 *
 *   const game = new Game({ players: ['Ann', 'Bob'] });
 *   game.on('state', (state) => render(state));
 *   game.start();
 *   game.dispatch({ type: 'playCard', player: 0, cardId: 'red-3' });
 */
export class Game extends Emitter {
  #players;
  #deck;
  #parade = [];
  #phase = null;
  #currentPlayer = 0;
  #finalRound = null;
  #discards = new Map();
  #lastTurn = null;
  #results = null;
  #random;
  #cardsPerColor;

  /**
   * @param {object} options
   * @param {string[]} options.players Player names, 2-6 of them.
   * @param {number} [options.cardsPerColor=11] Cards in each color (values 0..n-1). Smaller
   *   decks give shorter games; the deck must still leave cards to draw after the deal.
   * @param {() => number} [options.random=Math.random]
   */
  constructor({ players, cardsPerColor = MAX_CARDS_PER_COLOR, random = Math.random } = {}) {
    super();
    if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new RangeError(`Parade needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
    }
    const minCards = minCardsPerColor(players.length);
    if (!Number.isInteger(cardsPerColor) || cardsPerColor < minCards || cardsPerColor > MAX_CARDS_PER_COLOR) {
      throw new RangeError(
        `cardsPerColor must be ${minCards}-${MAX_CARDS_PER_COLOR} for ${players.length} players`,
      );
    }
    this.#cardsPerColor = cardsPerColor;
    this.#random = random;
    this.#players = players.map((name) => ({ name: String(name), hand: [], collected: [] }));
  }

  /** Shuffles, deals hands and the starting parade, then emits the initial state. */
  start() {
    if (this.#phase !== null) throw new Error('Game has already started');
    this.#deck = shuffle(createDeck(this.#cardsPerColor), this.#random);
    for (const player of this.#players) player.hand = this.#deck.splice(0, HAND_SIZE);
    this.#parade = this.#deck.splice(0, PARADE_SIZE);
    this.#currentPlayer = Math.floor(this.#random() * this.#players.length);
    this.#phase = Phase.PLAY;
    this.#emitState();
    return this.getState();
  }

  /**
   * Applies a player action. Invalid actions emit `invalidAction` and return
   * `false` without changing state; valid ones emit `state` and return `true`.
   */
  dispatch(action) {
    try {
      switch (action?.type) {
        case ActionType.PLAY_CARD:
          this.#playCard(action);
          break;
        case ActionType.DISCARD_CARDS:
          this.#discardCards(action);
          break;
        default:
          throw new InvalidActionError(`Unknown action type: ${action?.type}`);
      }
    } catch (error) {
      if (!(error instanceof InvalidActionError)) throw error;
      this.emit(GameEvent.INVALID_ACTION, { action, message: error.message });
      return false;
    }
    this.#emitState();
    return true;
  }

  /** Full game state, including every hand. Returns a fresh copy each call. */
  getState() {
    return structuredClone({
      phase: this.#phase,
      cardsPerColor: this.#cardsPerColor,
      currentPlayer: this.#phase === Phase.PLAY ? this.#currentPlayer : null,
      players: this.#players.map((p, i) => ({
        ...p,
        hasDiscarded: this.#discards.has(i),
        // The two cards thrown away and the two added to the collection, once chosen.
        discarded: this.#discards.get(i)?.discarded ?? null,
        kept: this.#discards.get(i)?.kept ?? null,
      })),
      parade: this.#parade,
      deckCount: this.#deck?.length ?? 0,
      finalRound: this.#finalRound,
      lastTurn: this.#lastTurn,
      results: this.#results,
    });
  }

  /**
   * State as seen by one player: other players' hands are hidden, only their sizes
   * shown, and so are their discards until everyone has chosen.
   */
  getStateFor(playerIndex) {
    const state = this.getState();
    state.players = state.players.map((p, i) =>
      i === playerIndex || state.phase === Phase.FINISHED
        ? p
        : { ...p, hand: undefined, handCount: p.hand.length, discarded: null, kept: null },
    );
    return state;
  }

  #playCard({ player, cardId }) {
    this.#assertPhase(Phase.PLAY);
    if (player !== this.#currentPlayer) {
      throw new InvalidActionError(`It is not player ${player}'s turn`);
    }
    const p = this.#players[player];
    const card = this.#takeFromHand(p, cardId);

    const { parade, removed } = resolvePlay(this.#parade, card);
    this.#parade = parade;
    p.collected.push(...removed);

    let drew = false;
    if (!this.#finalRound && this.#deck.length > 0) {
      p.hand.push(this.#deck.shift());
      drew = true;
    }

    this.#lastTurn = { player, card, removed, drew };
    this.emit(GameEvent.CARD_PLAYED, structuredClone(this.#lastTurn));

    if (this.#finalRound) {
      this.#finalRound.turnsRemaining--;
    } else if (hasAllColors(p.collected) || this.#deck.length === 0) {
      // Every player, including the one who triggered the end, gets one more turn.
      const reason = this.#deck.length === 0 ? 'deckEmpty' : 'allColors';
      this.#finalRound = { triggeredBy: player, reason, turnsRemaining: this.#players.length };
      this.emit(GameEvent.FINAL_ROUND, { triggeredBy: player, reason });
    }

    if (this.#finalRound?.turnsRemaining === 0) {
      this.#phase = Phase.DISCARD;
    } else {
      this.#currentPlayer = (this.#currentPlayer + 1) % this.#players.length;
    }
  }

  /**
   * Each player picks two cards to discard; the rest of their hand is added to
   * their collection. The choices are secret until everyone has made theirs, so
   * collections only change once the last player has discarded.
   */
  #discardCards({ player, cardIds }) {
    this.#assertPhase(Phase.DISCARD);
    const p = this.#players[player];
    if (!p) throw new InvalidActionError(`No such player: ${player}`);
    if (this.#discards.has(player)) throw new InvalidActionError(`Player ${player} already discarded`);
    if (!Array.isArray(cardIds) || cardIds.length !== DISCARD_COUNT || new Set(cardIds).size !== DISCARD_COUNT) {
      throw new InvalidActionError(`Must discard exactly ${DISCARD_COUNT} different cards`);
    }
    for (const id of cardIds) {
      if (!p.hand.some((c) => c.id === id)) throw new InvalidActionError(`Card ${id} is not in hand`);
    }
    this.#discards.set(player, {
      discarded: p.hand.filter((c) => cardIds.includes(c.id)),
      kept: p.hand.filter((c) => !cardIds.includes(c.id)),
    });
    p.hand = [];

    if (this.#discards.size === this.#players.length) {
      this.#players.forEach((pl, i) => pl.collected.push(...this.#discards.get(i).kept));
      this.#phase = Phase.FINISHED;
      this.#results = score(this.#players.map((pl) => pl.collected));
      this.emit(GameEvent.GAME_OVER, structuredClone(this.#results));
    }
  }

  #takeFromHand(player, cardId) {
    const index = player.hand.findIndex((c) => c.id === cardId);
    if (index === -1) throw new InvalidActionError(`Card ${cardId} is not in hand`);
    return player.hand.splice(index, 1)[0];
  }

  #assertPhase(phase) {
    if (this.#phase !== phase) {
      throw new InvalidActionError(`Action not allowed during phase: ${this.#phase ?? 'not started'}`);
    }
  }

  #emitState() {
    this.emit(GameEvent.STATE, this.getState());
  }
}
