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

The computer is tuned for the web game: one against one, 7 cards per suit. It looks five plays ahead: its own play, the opponent's reply, its next play, another reply and its play after that. For each card in its hand it works out what the card would take. It averages each opponent reply over every card it hasn't seen, since any of them could be in the opponent's hand, and assumes its own best follow-up each time. If the game would end within those plays, it also counts the two cards it would keep. It picks the card with the lowest expected score *minus the opponent's*, majorities included, and discards the same way. Ties go to the card that takes fewer cards now, then to the higher-value card. It uses no randomness, so the same moves always get the same replies. During the search, collections are kept as per-colour counts and sums, so a move takes about 12ms on average and under a quarter of a second at worst. That thinking time counts towards the CPU's pause before it moves. With more than two players it falls back to the greedy choice.

**No peeking:** every choice starts from a copy of only what that player could see at the table: the parade, both collections, the deck size and its own hand. It never reads the opponent's hand, the deck order or the opponent's discard, even when given the full game state, and a test checks this. Knowing which cards are still unseen is ordinary card counting.

In simulated 7-per-suit games it beats the original greedy computer (which played the card adding the fewest points this turn) in about 72% of games, by about 6 points on average. Searching five plays ahead beats searching three about 59% of the time. Six plays ahead was only slightly better (about 55%) and about ten times slower. Looking ahead while minimising only its own score was barely better than greedy. `chooseCard(state, i, { depth })` sets the lookahead. `chooseGreedyCard`, `chooseDiscards` and `computerAction` are also exported for use without the controller.

Pass `cardsPerColor` (default 11, values 0 to n-1) for a smaller deck and a shorter game, e.g. `new Game({ players, cardsPerColor: 7 })`. The minimum is the smallest deck that still leaves a card to draw after the deal (3 for two players). `minCardsPerColor(playerCount)` returns it.

`game.getState()` returns the full state; `game.getStateFor(i)` hides opponents' hands. Pass `random: seededRandom(n)` to the constructor for reproducible games. `seedForDay(dayKey())` gives the day's seed; `dayKey(date)` is the local date as `YYYY-MM-DD`.

## Rules implemented

- 66 cards: values 0–10 in six colors (configurable down to fewer cards per color). 2–6 players are each dealt 5 cards, and 6 cards start the parade.
- On your turn, play a card to the end of the parade. The parade cards nearest the end, as many as the played card's value, are safe. Every earlier card that matches its color **or** has a value ≤ its value goes into your collection. Then draw.
- The end is triggered when a player has collected all six colors or the deck runs out. Every player (including the one who triggered it) then takes one last turn without drawing.
- Each player secretly discards 2 of their remaining 4 cards and adds the other 2 to their collection. The choices are revealed together: collections only change once everyone has discarded, and `getStateFor` hides other players' `discarded` and `kept` cards until then.
- Scoring: in each color, the player(s) with the most cards score 1 per card in that color (in a 2-player game this requires at least 2 more cards than the opponent). Every other card scores its face value. Lowest score wins; ties go to the player with the fewest cards.

## Playing in the browser

`index.html` is a mobile-first game page: you play a 2-player game against the computer with 7 cards per suit (values 0–6, a 42-card deck; the standard deck is 11). It fills the screen without scrolling, on phones (portrait or landscape) and on desktop. It is served by GitHub Pages at https://abedley.github.io/cavalcade/.

- Tap a card in your hand to preview the play. Cards you would take are lifted and outlined in red, a bar marks the safe zone, and the status line shows how many points the play adds. Tap the card again, or press **Play**, to play it.
- Each player's collection is shown as six suit tiles: the card count, with the suit's face-value total below it. ✓ marks a suit that currently has the majority, so it scores 1 per card instead; the player's points total takes that into account.
- At the end you tap the 2 cards you want to **keep**; the other 2 are discarded.
- **The reveal:** when the game ends, the CPU's last four cards turn face up, split into the two it kept and the two it discarded, and your own are shown the same way. Tap **See results** for the score sheet.
- **Daily deal:** every game on a given day uses that day's seed, so everyone who plays on the same date gets the same shuffle and the same starting player. The date is the player's local date, so the deal changes at their midnight; a game still in progress at midnight finishes on its own day's deal. The computer has no randomness, so the same moves always produce the same game, and **Play again** replays the day's deal.
- **Daily bests:** when a game ends, the page saves your score differential (the CPU's score minus yours, so higher is better). It keeps your best and the number of games for each day. The new-game sheet shows today's best, the results sheet compares each game with it, and the menu lists your bests by day. Records are kept in the browser's local storage.
- The menu has a new-game sheet, a "Show CPU hand" toggle, a Day / Night / Auto theme switch, the rules, and the game log. The results sheet breaks down each suit's cards and points.

The look is a quiet nod to *Alice in Wonderland*:
- **Pages:** parchment with a faint Looking-Glass chessboard by day. At night the background is plum and the cards take their suit colour, in brighter inks that stay easy to tell apart on a dark screen.
- **Cards:** cream playing cards with coloured frames, like the Queen's card soldiers. The suits are ♥ ♦ ♣ ♠, plus a crown (♛) and the Cheshire Cat's crescent (☾).
- **Fonts:** IM Fell English, EB Garamond and Playfair Display, from Google Fonts.

The page is plain HTML, CSS and JS in `index.html` and `ui/`, with no build step. Locally, run `python3 -m http.server` and open http://localhost:8000/. ES modules don't load from `file://`.

## Development

```sh
npm test
```
