import {
  ActionType,
  attachComputerPlayers,
  COLORS,
  dateOfKey,
  dayKey,
  DISCARD_COUNT,
  Game,
  GameEvent,
  HAND_SIZE,
  msUntilMidnight,
  Phase,
  resolvePlay,
  score,
  seededRandom,
  seedForDay,
} from '../src/index.js';

const HUMAN = 0;
const CPU = 1;
const PLAYERS = ['You', 'CPU'];
const CPU_DELAY_MS = 900;
const PER_SUIT = 7; // fixed, so everyone's daily deal is the same game
const KEEP_COUNT = HAND_SIZE - 1 - DISCARD_COUNT; // the final hand is one card short
// Playing-card suits for the Queen's card soldiers, a crown, and the Cheshire Cat's crescent grin.
const SUIT = { red: '♥', blue: '♦', green: '♣', yellow: '♛', purple: '☾', black: '♠' };
const RULES = `<ul>
  <li>On your turn, play a card from your hand to the end of the parade, then draw.</li>
  <li>Count back from the end of the parade by your card's value: those cards are safe.</li>
  <li>From the rest, you take every card that matches your card's colour or has a value
    less than or equal to it. Tap a card once to see what it would take, and again to play it.</li>
  <li>Taken cards score their face value, but if you hold the most of a colour they score
    1 each (✓). With two players you need at least 2 more of that colour than your opponent.</li>
  <li>When someone has collected all six colours, or the deck runs out, each player takes one
    last turn without drawing. Then you pick 2 of your 4 cards to keep; they join your collection and the other 2 are discarded.</li>
  <li>Lowest score wins. Ties go to whoever collected fewer cards.</li>
</ul>`;

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const prefs = loadPrefs();

let game = null;
let state = null;
let seed = null;
let day = null; // the date of the deal being played, which can lag today's after midnight
let outcome = null; // the finished game's differential and how it compares with the day's best
let stopComputers = null;
let selected = new Set();
let lastMove = '';
let pendingMove = null;

// ---------- Preferences (best effort; the page works without storage) ----------

function loadPrefs() {
  try {
    return { showCpu: false, theme: 'auto', ...JSON.parse(localStorage.getItem('cavalcade-prefs') ?? '{}') };
  } catch {
    return { showCpu: false, theme: 'auto' };
  }
}

function savePrefs() {
  try {
    localStorage.setItem('cavalcade-prefs', JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

// ---------- Daily records: { 'YYYY-MM-DD': { best, plays } } ----------

const records = loadRecords();

function loadRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem('cavalcade-daily') ?? '{}') ?? {};
    // Records from before the deck was fixed were kept per cards-per-suit; keep the 7s.
    return Object.fromEntries(Object.entries(saved)
      .map(([d, rec]) => [d, 'best' in rec ? rec : rec[PER_SUIT]])
      .filter(([, rec]) => rec));
  } catch {
    return {};
  }
}

/**
 * Saves a finished game under its day. The differential is the CPU's score minus
 * yours, so bigger is better and a positive number is a win on points.
 */
function recordResult(dayOf, diff) {
  const prev = records[dayOf];
  const rec = { best: prev ? Math.max(prev.best, diff) : diff, plays: (prev?.plays ?? 0) + 1 };
  records[dayOf] = rec;
  try {
    localStorage.setItem('cavalcade-daily', JSON.stringify(records));
  } catch {
    // ignore
  }
  return { diff, ...rec, first: !prev, improved: Boolean(prev) && diff > prev.best };
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const plays = (n) => `${n} ${n === 1 ? 'game' : 'games'}`;
const dayLabel = (key, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  dateOfKey(key).toLocaleDateString(undefined, opts);

// ---------- Game lifecycle ----------

function newGame() {
  stopComputers?.();
  day = dayKey();
  seed = seedForDay(day);
  outcome = null;
  game = new Game({ players: PLAYERS, cardsPerColor: PER_SUIT, random: seededRandom(seed) });
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
    const [mine, theirs] = [HUMAN, CPU].map((i) => results.scores.find((s) => s.player === i).score);
    outcome = recordResult(day, theirs - mine);
    const cpu = game.getState().players[CPU];
    log(`CPU kept ${cpu.kept.map(fmt).join(' ')} and discarded ${cpu.discarded.map(fmt).join(' ')}.`);
  });

  stopComputers = attachComputerPlayers(game, [CPU], { delay: CPU_DELAY_MS });
  game.start();
  $('seedNote').textContent = `Deal of ${dayLabel(day)} · seed ${seed}`;
  log(`Deal of ${dayLabel(day)}. ${state.currentPlayer === HUMAN ? 'You start.' : 'CPU starts.'}`);
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
  } else if (myDiscard() && selected.size === KEEP_COUNT) {
    const kept = human().hand.filter((c) => selected.has(c.id));
    const discarded = human().hand.filter((c) => !selected.has(c.id));
    selected.clear();
    log(`You kept ${kept.map(fmt).join(' ')} and discarded ${discarded.map(fmt).join(' ')}.`);
    game.dispatch({ type: ActionType.DISCARD_CARDS, player: HUMAN, cardIds: discarded.map((c) => c.id) });
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
    else if (selected.size < KEEP_COUNT) selected.add(card.id);
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
    // Always the suit's face value; the player's total is what applies the majority.
    const pts = cards.reduce((n, c) => n + c.value, 0);
    const tile = document.createElement('div');
    tile.className = `tile ${color}${cards.length ? '' : ' empty'}${flip ? ' flip' : ''}`;
    tile.dataset.color = color;
    tile.title = cards.length ? `${color}: ${cards.map((c) => c.value).join(', ')}` : `no ${color}`;
    tile.innerHTML = cards.length ? `<b>${cards.length}</b><small>${pts}pt</small>` : `<b>${SUIT[color]}</b>`;
    return tile;
  }));

  if (i === CPU) {
    const finished = state.phase === Phase.FINISHED;
    // Once the CPU has chosen its discards it still holds its four cards until the reveal.
    const held = p.hand.length || finished ? p.hand : [...(p.kept ?? []), ...(p.discarded ?? [])];
    const showHand = prefs.showCpu && held.length;
    $('cpuHand').classList.toggle('open', Boolean(showHand));
    $('cpuHand').replaceChildren(...(showHand ? held.map((c) => cardEl(c)) : held.map(backEl)));
    const reveal = $('cpuReveal');
    if (!finished) {
      reveal.hidden = true;
      reveal.replaceChildren();
    } else if (reveal.hidden) {
      // Built once, so later re-renders don't replay the flip.
      reveal.replaceChildren(...revealGroups(p, { flip: true }));
      reveal.hidden = false;
    }
  } else {
    const n = p.collected.length;
    $('youHint').textContent = n ? `${n} collected` : '';
  }
}

/** The final hand split into the two cards kept and the two discarded, optionally turning face up. */
function revealGroups(p, { flip = false } = {}) {
  let k = 0;
  const group = (label, cards, cls) => {
    const el = document.createElement('div');
    el.className = `reveal-group ${cls}`;
    const row = document.createElement('div');
    row.className = 'reveal-cards';
    row.append(...cards.map((c) => {
      if (!flip) return cardEl(c);
      const flipper = document.createElement('div');
      flipper.className = 'flipper';
      flipper.style.setProperty('--i', k++);
      flipper.append(backEl(), cardEl(c));
      return flipper;
    }));
    const name = document.createElement('span');
    name.className = 'reveal-label';
    name.textContent = label;
    el.append(name, row);
    return el;
  };
  return [group('Kept', p.kept, 'kept'), group('Discarded', p.discarded, 'discarded')];
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
  const { rows, width } = paradeLayout(slots.length, parade.clientWidth - 12, parade.clientHeight);
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
    prompt.textContent = 'The CPU is pondering…';
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
    btn.textContent = 'Keep';
    btn.disabled = selected.size !== KEEP_COUNT;
    if (selected.size === KEEP_COUNT) {
      const kept = human().hand.filter((c) => selected.has(c.id));
      const delta = scoreWith(kept).scores[HUMAN].score - scoreWith().scores[HUMAN].score;
      prompt.innerHTML = `Keep ${kept.map(fmt).join(' ')} · ${deltaHtml(delta)}`;
    } else {
      prompt.textContent = `Pick ${KEEP_COUNT} cards to keep (${selected.size}/${KEEP_COUNT}); the rest are discarded`;
    }
  } else if (state.phase === Phase.DISCARD) {
    prompt.textContent = 'CPU is discarding…';
  } else {
    const cpu = state.players[CPU];
    $('lastMove').textContent = `The end. ${winnerText(state.results)}`;
    prompt.textContent = `The CPU kept ${cpu.kept.map(fmt).join(' ')} and discarded ${cpu.discarded.map(fmt).join(' ')}`;
    btn.hidden = false;
    btn.textContent = 'See results';
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
  if (state.phase === Phase.FINISHED) {
    hand.replaceChildren(...revealGroups(human()));
    return;
  }
  if (!cards.length) {
    const note = document.createElement('div');
    note.className = 'hand-note';
    note.textContent = myDiscard() ? '' : 'Waiting for the CPU…';
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
  $('resultTitle').textContent = winners.length > 1 ? 'Everybody has won, and all must have prizes!'
    : winners[0] === HUMAN ? 'O frabjous day! You win.' : 'Off with your head! The CPU wins.';
  $('scoreLine').innerHTML = scores.map((s) => `
    <div class="score-box${winners.includes(s.player) ? ' win' : ''}">
      <div class="l">${nameOf(s.player)}${winners.includes(s.player) ? ' 🏆' : ''}</div>
      <div class="n">${s.score}</div>
      <div class="l">${s.cardCount} cards</div>
    </div>`).join('');
  renderOutcome();

  const rows = COLORS.map((color) => {
    const cells = state.players.map((p, i) => {
      const cards = p.collected.filter((c) => c.color === color).sort((a, b) => a.value - b.value);
      const flip = majorities[color].includes(i);
      const pts = flip ? cards.length : cards.reduce((n, c) => n + c.value, 0);
      return `<td>${cards.length}${flip ? ' <span class="star">✓</span>' : ''}`
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
  <p class="field-note">✓ majority: those cards score 1 each. With two players you need at least 2 more cards of a
    colour than your opponent. Lowest score wins; ties go to fewer cards.
    Deal of ${dayLabel(day, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>`;
  if (!$('results').open) {
    $('results').returnValue = '';
    $('results').showModal();
  }
}

function renderOutcome() {
  const el = $('dailyResult');
  el.hidden = !outcome;
  if (!outcome) return;
  const today = day === dayKey();
  const when = today ? 'today' : `on ${dayLabel(day)}`;
  const note = outcome.improved ? `A new best for ${when}!`
    : outcome.first ? `Your first game of ${today ? 'today’s' : 'that'} deal.`
    : `Your best ${when}: ${signed(outcome.best)}`;
  el.innerHTML = `<span class="diff ${outcome.diff > 0 ? 'up' : outcome.diff < 0 ? 'down' : ''}">${signed(outcome.diff)}</span>`
    + `<span><b>Score differential</b><span class="field-note">${note} · ${plays(outcome.plays)} ${today ? 'today' : 'that day'}</span></span>`;
  el.classList.toggle('best', outcome.improved);
  // After midnight, "again" deals the new day's cards.
  $('againBtn').textContent = today ? 'Play again' : 'Play today’s deal';
}

function renderDaily() {
  const today = dayKey();
  $('dailyDate').textContent = dayLabel(today);
  const rec = records[today];
  $('dailyBest').innerHTML = rec
    ? `Your best today: <b class="diff ${rec.best > 0 ? 'up' : rec.best < 0 ? 'down' : ''}">${signed(rec.best)}</b> · ${plays(rec.plays)}`
    : 'Not played yet today.';
}

function renderHistory() {
  const days = Object.keys(records).sort().reverse().slice(0, 30);
  if (!days.length) {
    $('history').innerHTML = '<p class="field-note">No finished games yet. Your best score differential for each day will appear here.</p>';
    return;
  }
  const rows = days.map((d) => {
    const rec = records[d];
    return `<tr><td>${dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}</td>`
      + `<td class="diff ${rec.best > 0 ? 'up' : rec.best < 0 ? 'down' : ''}">${signed(rec.best)}</td>`
      + `<td>${plays(rec.plays)}</td></tr>`;
  });
  $('history').innerHTML = `<table class="history"><tbody>${rows.join('')}</tbody></table>
    <p class="field-note">Best differential is the CPU’s score minus yours: higher is better.</p>`;
}

/** Keeps the date labels right when the page is left open past midnight. */
function watchMidnight() {
  setTimeout(() => {
    renderDaily();
    if (state?.results) renderOutcome();
    watchMidnight();
  }, msUntilMidnight() + 1000);
}

function openSetup() {
  renderDaily();
  $('setupCancel').hidden = !game;
  $('setup').returnValue = '';
  $('setup').showModal();
}

for (const el of document.querySelectorAll('[data-rules]')) el.innerHTML = RULES;

$('setup').addEventListener('close', () => {
  if ($('setup').returnValue === 'start') {
    newGame();
  } else if (!game) {
    openSetup(); // there has to be a game behind the sheet
  }
});
$('setup').addEventListener('cancel', (e) => {
  if (!game) e.preventDefault();
});

$('menu').addEventListener('close', () => {
  if ($('menu').returnValue === 'new') openSetup();
  if ($('menu').returnValue === 'results') showResults();
});

$('results').addEventListener('close', () => {
  if ($('results').returnValue === 'again') newGame();
  if ($('results').returnValue === 'settings') openSetup();
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
  renderHistory();
  $('menu').returnValue = '';
  $('menu').showModal();
};
// ---------- Theme ----------

const systemDark = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const dark = prefs.theme === 'dark' || (prefs.theme !== 'light' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#211a2e' : '#f3e9d2';
  for (const btn of document.querySelectorAll('[data-theme-choice]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === prefs.theme));
  }
}

for (const btn of document.querySelectorAll('[data-theme-choice]')) {
  btn.onclick = () => {
    prefs.theme = btn.dataset.themeChoice;
    savePrefs();
    applyTheme();
  };
}
systemDark.addEventListener('change', applyTheme);
applyTheme();

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

// Phones pause timers in background tabs, so also check the date on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renderDaily();
  if (state?.results) renderOutcome();
});
watchMidnight();

openSetup();
