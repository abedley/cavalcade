import {
  ActionType,
  attachComputerPlayers,
  COLORS,
  DISCARD_COUNT,
  Game,
  GameEvent,
  MAX_CARDS_PER_COLOR,
  minCardsPerColor,
  Phase,
  resolvePlay,
  score,
  seededRandom,
} from '../src/index.js';

const HUMAN = 0;
const CPU = 1;
const PLAYERS = ['You', 'CPU'];
const CPU_DELAY_MS = 900;
const SUIT = { red: '♥', blue: '♠', green: '♣', yellow: '★', purple: '◆', black: '●' };
const RULES = `<ul>
  <li>On your turn, play a card from your hand to the end of the parade, then draw.</li>
  <li>Count back from the end of the parade by your card's value: those cards are safe.</li>
  <li>From the rest, you take every card that matches your card's colour or has a value
    less than or equal to it. Tap a card once to see what it would take, and again to play it.</li>
  <li>Taken cards score their face value, but if you hold the most of a colour they score
    1 each (★). With two players you need at least 2 more of that colour than your opponent.</li>
  <li>When someone has collected all six colours, or the deck runs out, each player takes one
    last turn without drawing. Then you discard 2 of your 4 cards; the other 2 join your collection.</li>
  <li>Lowest score wins. Ties go to whoever collected fewer cards.</li>
</ul>`;

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const prefs = loadPrefs();

let game = null;
let state = null;
let seed = null;
let stopComputers = null;
let selected = new Set();
let lastMove = '';
let pendingMove = null;
let resultsTimer = null;

// ---------- Preferences (best effort; the page works without storage) ----------

function loadPrefs() {
  try {
    return { perSuit: MAX_CARDS_PER_COLOR, showCpu: false, ...JSON.parse(localStorage.getItem('cavalcade') ?? '{}') };
  } catch {
    return { perSuit: MAX_CARDS_PER_COLOR, showCpu: false };
  }
}

function savePrefs() {
  try {
    localStorage.setItem('cavalcade', JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

// ---------- Game lifecycle ----------

function newGame({ perSuit = prefs.perSuit, seed: fixedSeed = null } = {}) {
  stopComputers?.();
  clearTimeout(resultsTimer);
  seed = fixedSeed ?? Math.floor(Math.random() * 1e6);
  game = new Game({ players: PLAYERS, cardsPerColor: perSuit, random: seededRandom(seed) });
  selected.clear();
  lastMove = '';
  pendingMove = null;
  $('log').replaceChildren();

  game.on(GameEvent.CARD_PLAYED, onCardPlayed);
  game.on(GameEvent.STATE, (s) => {
    state = s;
    render();
    if (pendingMove) animateMove(pendingMove);
    pendingMove = null;
  });
  game.on(GameEvent.FINAL_ROUND, ({ triggeredBy, reason }) =>
    log(`Final round: ${reason === 'deckEmpty' ? 'the deck ran out' : `${nameOf(triggeredBy)} collected all six colours`}.`));
  game.on(GameEvent.INVALID_ACTION, ({ message }) => log(`Invalid: ${message}`));
  game.on(GameEvent.GAME_OVER, (results) => {
    log(`Game over. ${winnerText(results)}`);
    resultsTimer = setTimeout(showResults, reducedMotion.matches ? 300 : 1100);
  });

  stopComputers = attachComputerPlayers(game, [CPU], { delay: CPU_DELAY_MS });
  game.start();
  $('seedNote').textContent = `Seed ${seed} · ${perSuit} cards per suit`;
  log(`New game (seed ${seed}, ${perSuit} per suit). ${state.currentPlayer === HUMAN ? 'You start.' : 'CPU starts.'}`);
}

const nameOf = (i) => (i === HUMAN ? 'You' : 'CPU');
const fmt = (c) => `${SUIT[c.color]}${c.value}`;
const human = () => state.players[HUMAN];
const myTurn = () => state.phase === Phase.PLAY && state.currentPlayer === HUMAN;
const myDiscard = () => state.phase === Phase.DISCARD && !human().hasDiscarded;

function log(text) {
  const li = document.createElement('li');
  li.textContent = text;
  $('log').prepend(li);
}

function onCardPlayed({ player, card, removed, drew }) {
  const took = removed.length ? `took ${removed.length}` : 'took nothing';
  lastMove = `${nameOf(player)} played ${fmt(card)} and ${took}` + (drew ? '' : ' (no draw)');
  log(`${lastMove}${removed.length ? `: ${removed.map(fmt).join(' ')}` : ''}.`);
  // Remember where things are now, so the next render can animate from here.
  pendingMove = {
    player,
    card,
    removed,
    from: (player === HUMAN
      ? $('hand').querySelector(`[data-id="${card.id}"]`)
      : $('cpuHand').lastElementChild ?? $('cpuHand'))?.getBoundingClientRect(),
    paradeRects: new Map([...$('parade').querySelectorAll('.card[data-id]')]
      .map((el) => [el.dataset.id, el.getBoundingClientRect()])),
  };
}

function scoreWith(extra = []) {
  return score(state.players.map((p, i) => (i === HUMAN ? [...p.collected, ...extra] : p.collected)));
}

function playPreview() {
  if (!myTurn() || selected.size !== 1) return null;
  const card = human().hand.find((c) => selected.has(c.id));
  if (!card) return null;
  const { removed } = resolvePlay(state.parade, card);
  return {
    card,
    removedIds: new Set(removed.map((c) => c.id)),
    safeFrom: Math.max(0, state.parade.length - card.value),
    delta: scoreWith(removed).scores[HUMAN].score - scoreWith().scores[HUMAN].score,
  };
}

function act() {
  if (myTurn() && selected.size === 1) {
    const [cardId] = selected;
    selected.clear();
    game.dispatch({ type: ActionType.PLAY_CARD, player: HUMAN, cardId });
  } else if (myDiscard() && selected.size === DISCARD_COUNT) {
    const cardIds = [...selected];
    selected.clear();
    log(`You discarded ${human().hand.filter((c) => cardIds.includes(c.id)).map(fmt).join(' ')}.`);
    game.dispatch({ type: ActionType.DISCARD_CARDS, player: HUMAN, cardIds });
  } else if (state?.phase === Phase.FINISHED) {
    showResults();
  }
}

function onHandCard(card) {
  if (myTurn()) {
    if (selected.has(card.id)) return act();
    selected = new Set([card.id]);
  } else if (myDiscard()) {
    if (selected.has(card.id)) selected.delete(card.id);
    else if (selected.size < DISCARD_COUNT) selected.add(card.id);
    else selected = new Set([...selected].slice(1).concat(card.id));
  } else {
    return;
  }
  render();
}

// ---------- Rendering ----------

function cardEl(card, { tag = 'div', classes = [] } = {}) {
  const el = document.createElement(tag);
  el.className = ['card', card.color, ...classes].filter(Boolean).join(' ');
  el.dataset.id = card.id;
  el.setAttribute('aria-label', `${card.color} ${card.value}`);
  el.innerHTML = `<span class="corner">${card.value}<i>${SUIT[card.color]}</i></span>`
    + `<span class="suit-big" aria-hidden="true">${SUIT[card.color]}</span>`;
  return el;
}

function backEl() {
  const el = document.createElement('div');
  el.className = 'card back';
  return el;
}

function render() {
  if (!state) return;
  const preview = playPreview();
  const live = score(state.players.map((p) => p.collected));

  $('deck').textContent = state.deckCount;
  const fr = state.finalRound;
  $('finalChip').hidden = !fr || state.phase !== Phase.PLAY;
  if (fr) $('finalChip').textContent = `Final round · ${fr.turnsRemaining} ${fr.turnsRemaining === 1 ? 'turn' : 'turns'} left`;

  renderSide(CPU, live);
  renderSide(HUMAN, live);
  renderParade(preview);
  renderStatus(preview);
  renderHand();
  $('menuResults').hidden = state.phase !== Phase.FINISHED;
}

function renderSide(i, live) {
  const p = state.players[i];
  const el = i === HUMAN ? $('you') : $('cpu');
  el.classList.toggle('active', state.phase === Phase.PLAY && state.currentPlayer === i);
  $(i === HUMAN ? 'youScore' : 'cpuScore').textContent = live.scores[i].score;

  $(i === HUMAN ? 'youTiles' : 'cpuTiles').replaceChildren(...COLORS.map((color) => {
    const cards = p.collected.filter((c) => c.color === color).sort((a, b) => a.value - b.value);
    const flip = live.majorities[color].includes(i);
    const pts = flip ? cards.length : cards.reduce((n, c) => n + c.value, 0);
    const tile = document.createElement('div');
    tile.className = `tile ${color}${cards.length ? '' : ' empty'}${flip ? ' flip' : ''}`;
    tile.dataset.color = color;
    tile.title = cards.length ? `${color}: ${cards.map((c) => c.value).join(', ')}` : `no ${color}`;
    tile.innerHTML = cards.length ? `<b>${cards.length}</b><small>${pts} pt</small>` : `<b>${SUIT[color]}</b>`;
    return tile;
  }));

  if (i === CPU) {
    const showHand = prefs.showCpu && p.hand.length;
    $('cpuHand').classList.toggle('open', Boolean(showHand));
    $('cpuHand').replaceChildren(...(showHand ? p.hand.map((c) => cardEl(c)) : p.hand.map(backEl)));
  } else {
    const n = p.collected.length;
    $('youHint').textContent = n ? `${n} collected` : '';
  }
}

function renderParade(preview) {
  const slots = state.parade.map((c, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    if (preview && i >= preview.safeFrom) slot.classList.add('safe');
    slot.append(cardEl(c, { classes: [preview?.removedIds.has(c.id) && 'taking'] }));
    return slot;
  });
  if (preview) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const ghost = cardEl(preview.card, { classes: ['ghost'] });
    delete ghost.dataset.id;
    slot.append(ghost);
    slots.push(slot);
  }
  const parade = $('parade');
  const { rows, width } = paradeLayout(slots.length, parade.clientWidth - 8, parade.clientHeight);
  parade.style.setProperty('--pw', `${width}px`);
  const perRow = Math.ceil(slots.length / rows);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const line = document.createElement('div');
    line.className = 'parade-row';
    line.append(...slots.slice(r * perRow, (r + 1) * perRow));
    // Round the ends of the safe-zone bar on each line.
    const safe = [...line.children].filter((el) => el.classList.contains('safe'));
    safe[0]?.classList.add('first');
    safe.at(-1)?.classList.add('last');
    lines.push(line);
  }
  parade.replaceChildren(...lines);
}

const CARD_RATIO = 1.4;
const SLOT_PAD = 24; // vertical room per row for the lift and the safe-zone bar
const MIN_STEP = 0.52; // overlapping cards keep at least this much of their width visible

/** Picks the number of rows and the card width that make the parade's cards as big as possible. */
function paradeLayout(count, width, height) {
  const maxCard = Math.min(120, width / 4);
  let best = { rows: 1, width: 24 };
  for (let rows = 1; rows <= 4; rows++) {
    const perRow = Math.ceil(count / rows);
    const byHeight = (height - rows * SLOT_PAD) / rows / CARD_RATIO;
    const byWidth = width / (1 + (perRow - 1) * MIN_STEP);
    const w = Math.floor(Math.min(maxCard, byHeight, byWidth));
    if (w > best.width + 2) best = { rows, width: w };
  }
  return best;
}

function renderStatus(preview) {
  const btn = $('actionBtn');
  const prompt = $('prompt');
  btn.hidden = true;
  btn.disabled = false;
  $('lastMove').textContent = lastMove;

  if (state.phase === Phase.PLAY && state.currentPlayer === CPU) {
    prompt.textContent = 'CPU is thinking…';
  } else if (state.phase === Phase.PLAY && preview) {
    const n = preview.removedIds.size;
    prompt.innerHTML = n
      ? `Takes ${n} ${n === 1 ? 'card' : 'cards'} · ${deltaHtml(preview.delta)}`
      : 'Takes nothing · <span class="delta down">+0</span>';
    btn.hidden = false;
    btn.textContent = `Play ${fmt(preview.card)}`;
  } else if (state.phase === Phase.PLAY) {
    prompt.textContent = state.finalRound ? 'Your last turn: pick a card' : 'Your turn: pick a card';
  } else if (myDiscard()) {
    btn.hidden = false;
    btn.textContent = 'Discard';
    btn.disabled = selected.size !== DISCARD_COUNT;
    if (selected.size === DISCARD_COUNT) {
      const kept = human().hand.filter((c) => !selected.has(c.id));
      const delta = scoreWith(kept).scores[HUMAN].score - scoreWith().scores[HUMAN].score;
      prompt.innerHTML = `Keep ${kept.map(fmt).join(' ')} · ${deltaHtml(delta)}`;
    } else {
      prompt.textContent = `Discard ${DISCARD_COUNT} cards (${selected.size}/${DISCARD_COUNT}); the rest join your collection`;
    }
  } else if (state.phase === Phase.DISCARD) {
    prompt.textContent = 'CPU is discarding…';
  } else {
    prompt.textContent = winnerText(state.results);
    btn.hidden = false;
    btn.textContent = 'Results';
  }
}

function deltaHtml(delta) {
  return `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : delta < 0 ? '−' : '+'}${Math.abs(delta)} pts</span>`;
}

function renderHand() {
  const hand = $('hand');
  const canAct = myTurn() || myDiscard();
  hand.classList.toggle('idle', !canAct);
  const cards = human().hand;
  if (!cards.length) {
    const note = document.createElement('div');
    note.className = 'hand-note';
    note.textContent = state.phase === Phase.FINISHED ? 'Game over' : '';
    hand.replaceChildren(note);
    return;
  }
  hand.replaceChildren(...cards.map((c) => {
    const el = cardEl(c, { tag: 'button', classes: [selected.has(c.id) && 'selected'] });
    el.type = 'button';
    el.onclick = (e) => {
      e.stopPropagation();
      onHandCard(c);
    };
    return el;
  }));
}

// ---------- Animation ----------

function animateMove({ player, card, removed, from, paradeRects }) {
  if (reducedMotion.matches) return;
  const ease = 'cubic-bezier(.2, .75, .25, 1)';

  // Cards that stayed in the parade slide to their new places.
  for (const el of $('parade').querySelectorAll('.card[data-id]')) {
    const old = paradeRects.get(el.dataset.id);
    if (!old) continue;
    const now = el.getBoundingClientRect();
    if (old.left !== now.left || old.top !== now.top) {
      el.animate([{ transform: `translate(${old.left - now.left}px, ${old.top - now.top}px)` }, { transform: 'none' }],
        { duration: 380, easing: ease });
    }
  }

  // The played card flies from the hand to the end of the parade.
  const played = $('parade').querySelector(`[data-id="${card.id}"]`);
  if (played && from) {
    const now = played.getBoundingClientRect();
    played.animate([
      { transform: `translate(${from.left - now.left}px, ${from.top - now.top}px) scale(${from.width / now.width})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ], { duration: 420, easing: ease });
  }

  // Taken cards fly into the matching tile of whoever took them.
  const side = player === HUMAN ? $('youTiles') : $('cpuTiles');
  removed.forEach((c, k) => {
    const old = paradeRects.get(c.id);
    const tile = side.querySelector(`[data-color="${c.color}"]`);
    if (!old || !tile) return;
    const t = tile.getBoundingClientRect();
    const fly = cardEl(c, { classes: ['flying'] });
    Object.assign(fly.style, { left: `${old.left}px`, top: `${old.top}px` });
    fly.style.setProperty('--w', `${old.width}px`);
    document.body.append(fly);
    const dx = t.left + t.width / 2 - (old.left + old.width / 2);
    const dy = t.top + t.height / 2 - (old.top + old.height / 2);
    fly.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(.45)`, opacity: .6 },
    ], { duration: 520, delay: 120 + k * 70, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'both' })
      .finished.then(() => {
        fly.remove();
        // The tile may have been re-rendered meanwhile; pulse whichever one is current.
        side.querySelector(`[data-color="${c.color}"]`)?.animate([{ transform: 'scale(1.18)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
      });
  });
}

// ---------- Sheets ----------

function winnerText({ winners }) {
  if (winners.length > 1) return 'It’s a tie!';
  return winners[0] === HUMAN ? 'You win!' : 'CPU wins';
}

function showResults() {
  if (!state?.results) return;
  const { scores, majorities, winners } = state.results;
  $('resultTitle').textContent = winnerText(state.results);
  $('scoreLine').innerHTML = scores.map((s) => `
    <div class="score-box${winners.includes(s.player) ? ' win' : ''}">
      <div class="l">${nameOf(s.player)}${winners.includes(s.player) ? ' 🏆' : ''}</div>
      <div class="n">${s.score}</div>
      <div class="l">${s.cardCount} cards</div>
    </div>`).join('');

  const rows = COLORS.map((color) => {
    const cells = state.players.map((p, i) => {
      const cards = p.collected.filter((c) => c.color === color).sort((a, b) => a.value - b.value);
      const flip = majorities[color].includes(i);
      const pts = flip ? cards.length : cards.reduce((n, c) => n + c.value, 0);
      return `<td>${cards.length}${flip ? ' <span class="star">★</span>' : ''}`
        + `<span class="vals">${cards.map((c) => c.value).join(' ') || '–'}</span></td><td>${pts}</td>`;
    }).join('');
    return `<tr><td><span class="swatch ${color}"></span>${color}</td>${cells}</tr>`;
  }).join('');

  $('breakdown').innerHTML = `<table class="breakdown">
    <thead>
      <tr><th></th>${state.players.map((p, i) => `<th colspan="2">${nameOf(i)}</th>`).join('')}</tr>
      <tr><th>Suit</th>${state.players.map(() => '<th>cards</th><th>pts</th>').join('')}</tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Total</th>${scores.map((s) => `<th>${s.cardCount}</th><th>${s.score}</th>`).join('')}</tr></tfoot>
  </table>
  <p class="field-note">★ majority: those cards score 1 each. With two players you need at least 2 more cards of a
    colour than your opponent. Lowest score wins; ties go to fewer cards. Seed ${seed}.</p>`;
  if (!$('results').open) {
    $('results').returnValue = '';
    $('results').showModal();
  }
}

function openSetup() {
  const min = minCardsPerColor(PLAYERS.length);
  const range = $('perSuit');
  range.min = min;
  range.max = MAX_CARDS_PER_COLOR;
  range.value = Math.min(MAX_CARDS_PER_COLOR, Math.max(min, prefs.perSuit));
  updatePerSuit();
  $('setupCancel').hidden = !game;
  $('setup').returnValue = '';
  $('setup').showModal();
}

function updatePerSuit() {
  const n = Number($('perSuit').value);
  $('perSuitOut').textContent = n;
  $('perSuitNote').textContent = `Values 0–${n - 1} · ${n * COLORS.length}-card deck`
    + (n === MAX_CARDS_PER_COLOR ? ' (standard)' : '');
}

for (const el of document.querySelectorAll('[data-rules]')) el.innerHTML = RULES;

$('perSuit').addEventListener('input', updatePerSuit);

$('setup').addEventListener('close', () => {
  if ($('setup').returnValue === 'start') {
    prefs.perSuit = Number($('perSuit').value);
    savePrefs();
    const s = $('seed').value.trim();
    newGame({ perSuit: prefs.perSuit, seed: s === '' ? null : Number(s) });
  } else if (!game) {
    openSetup(); // there has to be a game behind the sheet
  }
});
$('setup').addEventListener('cancel', (e) => {
  if (!game) e.preventDefault();
});

$('menu').addEventListener('close', () => {
  if ($('menu').returnValue === 'new') new ResizeObserver(() => state && renderParade(playPreview())).observe($('parade'));

openSetup();
  if ($('menu').returnValue === 'results') showResults();
});

$('results').addEventListener('close', () => {
  if ($('results').returnValue === 'again') newGame({ perSuit: state.cardsPerColor });
  if ($('results').returnValue === 'settings') new ResizeObserver(() => state && renderParade(playPreview())).observe($('parade'));

openSetup();
});

// Tapping the dimmed backdrop closes a sheet.
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && (dialog !== $('setup') || game)) {
      dialog.returnValue = '';
      dialog.close();
    }
  });
}

$('menuBtn').onclick = () => {
  $('menu').returnValue = '';
  $('menu').showModal();
};
$('showCpu').checked = prefs.showCpu;
$('showCpu').onchange = () => {
  prefs.showCpu = $('showCpu').checked;
  savePrefs();
  render();
};
$('actionBtn').onclick = (e) => {
  e.stopPropagation();
  act();
};
// Tapping anywhere else clears the selection.
$('app').addEventListener('click', () => {
  if (selected.size) {
    selected.clear();
    render();
  }
});

new ResizeObserver(() => state && renderParade(playPreview())).observe($('parade'));

openSetup();
