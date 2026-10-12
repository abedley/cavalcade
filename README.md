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

### Computer players

```js
import { attachComputerPlayers } from './src/index.js';

// Players 1 and 2 are computers; they move 500ms after it becomes their turn.
const stop = attachComputerPlayers(game, [1, 2], { delay: 500 });
```

The computer is greedy. Each turn it plays the card that adds the fewest points to its own score, counting colour majorities as the game stands. Ties go to the card that takes fewer cards, then to the higher-value card. At the end it discards the two cards that would cost it the most. It only sees what that player could see (`getStateFor`). `chooseCard`, `chooseDiscards` and `computerAction` are exported for use without the controller.

Pass `cardsPerColor` (default 11, values 0 to n-1) for a smaller deck and a shorter game, e.g. `new Game({ players, cardsPerColor: 7 })`. The minimum is the smallest deck that still leaves a card to draw after the deal (3 for two players). `minCardsPerColor(playerCount)` returns it.

`game.getState()` returns the full state; `game.getStateFor(i)` hides opponents' hands. Pass `random: seededRandom(n)` to the constructor for reproducible games.

## Rules implemented

- 66 cards: values 0–10 in six colors (configurable down to fewer cards per color). 2–6 players are each dealt 5 cards, and 6 cards start the parade.
- On your turn, play a card to the end of the parade. The parade cards nearest the end, as many as the played card's value, are safe. Every earlier card that matches its color **or** has a value ≤ its value goes into your collection. Then draw.
- The end is triggered when a player has collected all six colors or the deck runs out. Every player (including the one who triggered it) then takes one last turn without drawing.
- Each player discards 2 of their remaining 4 cards and adds the other 2 to their collection.
- Scoring: in each color, the player(s) with the most cards score 1 per card in that color (in a 2-player game this requires at least 2 more cards than the opponent). Every other card scores its face value. Lowest score wins; ties go to the player with the fewest cards.

## Playing in the browser

`index.html` is a mobile-first game page: you play a 2-player game against the computer, with a choice of 3–11 cards per suit. It fills the screen without scrolling, on phones (portrait or landscape) and on desktop. It is served by GitHub Pages at https://abedley.github.io/cavalcade/.

- Tap a card in your hand to preview the play. Cards you would take are lifted and outlined in red, a bar marks the safe zone, and the status line shows how many points the play adds. Tap the card again, or press **Play**, to play it.
- Each player's collection is shown as six suit tiles with the card count and the points that suit is worth right now. ✓ marks a suit that currently has the majority, so it scores 1 per card.
- The menu has a new-game sheet (cards per suit, optional seed), a "Show CPU hand" toggle, the rules, and the game log. The results sheet breaks down each suit's cards and points.

The page is plain HTML, CSS and JS in `index.html` and `ui/`, with no build step. Locally, run `python3 -m http.server` and open http://localhost:8000/. ES modules don't load from `file://`.

## Development

```sh
npm test
```
