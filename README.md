# Cavalcade

A JavaScript implementation of the card game **Parade**. This first pass is the game engine only, with no UI yet. It is plain ES modules with no dependencies, so it can be loaded directly in a browser (e.g. from GitHub Pages) as well as in Node.

## Usage

```js
import { Game, GameEvent, ActionType } from './src/index.js';

const game = new Game({ players: ['Ann', 'Bob'] });

game.on(GameEvent.STATE, (state) => console.log(state));
game.on(GameEvent.INVALID_ACTION, ({ message }) => console.warn(message));
game.on(GameEvent.GAME_OVER, (results) => console.log(results.winners));

game.start();

// On your turn, play a card from your hand:
game.dispatch({ type: ActionType.PLAY_CARD, player: 0, cardId: 'red-3' });

// After the final round, every player picks 2 cards to discard:
game.dispatch({ type: ActionType.DISCARD_CARDS, player: 0, cardIds: ['blue-7', 'green-9'] });
```

### Events

| Event           | Payload                                          |
| --------------- | ------------------------------------------------ |
| `state`         | Full game state, after `start()` and every valid action |
| `cardPlayed`    | `{ player, card, removed, drew }`                |
| `finalRound`    | `{ triggeredBy, reason }` (`'allColors'` or `'deckEmpty'`) |
| `gameOver`      | `{ scores, majorities, winners }`                |
| `invalidAction` | `{ action, message }`. State is unchanged        |

`game.getState()` returns the full state; `game.getStateFor(i)` hides opponents' hands. Pass `random: seededRandom(n)` to the constructor for reproducible games.

## Rules implemented

- 66 cards: values 0–10 in six colors. 2–6 players are each dealt 5 cards, and 6 cards start the parade.
- On your turn, play a card to the end of the parade. The parade cards nearest the end, as many as the played card's value, are safe. Every earlier card that matches its color **or** has a value ≤ its value goes into your collection. Then draw.
- The end is triggered when a player has collected all six colors or the deck runs out. Every player (including the one who triggered it) then takes one last turn without drawing.
- Each player discards 2 of their remaining 4 cards and adds the other 2 to their collection.
- Scoring: in each color, the player(s) with the most cards score 1 per card in that color (in a 2-player game this requires at least 2 more cards than the opponent). Every other card scores its face value. Lowest score wins; ties go to the player with the fewest cards.

## Debug board

`index.html` is a bare-bones hot-seat page for trying the engine in a browser. It is served by GitHub Pages at https://abedley.github.io/cavalcade/. Tapping a card previews which parade cards it would take; tapping it again plays it. Locally, run `python3 -m http.server` and open http://localhost:8000/. ES modules don't load from `file://`.

## Development

```sh
npm test
```
