import { dateOfKey, dayKey, resolvePlay, seedForDay } from '../src/index.js';
import { ALICE, advance, createMemo, isBetter, openingPosition, playCard, selectBeam } from '../src/solver.js';

const SUIT = { red: '♥', blue: '♦', green: '♣', yellow: '♛', purple: '☾', black: '♠' };
const FIRST_WIDTH = 10;
const GROWTH = 3;
const STORE = 'cavalcade-solver';

const $ = (id) => document.getElementById(id);
const threads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));

let day = dayKey();
let seed = seedForDay(day);
let run = null; // the search in progress: { stop() }
let best = null; // { line, width, seconds, positions }

// ---------- Saved results (best effort) ----------

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

function save() {
  try {
    const saved = loadSaved();
    saved[day] = best;
    // Keep the last month or so.
    const days = Object.keys(saved).sort().slice(-40);
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(days.map((d) => [d, saved[d]]))));
  } catch {
    // ignore
  }
}

// ---------- Search ----------

/** A pool of workers that expand batches of positions in parallel. */
function createPool() {
  const workers = Array.from({ length: threads }, () => new Worker(new URL('worker.js', import.meta.url), { type: 'module' }));
  let nextId = 0;
  let cancel = null;
  return {
    /** Expands every position in `frontier`, split into batches across the workers. */
    expand(frontier) {
      const size = Math.max(1, Math.ceil(frontier.length / (threads * 4)));
      const batches = [];
      for (let i = 0; i < frontier.length; i += size) batches.push(frontier.slice(i, i + size));
      const children = [];
      const lines = [];
      let thought = 0;
      let done = 0;
      return new Promise((resolve, reject) => {
        cancel = () => reject(new Error('stopped'));
        const feed = (worker) => {
          const batch = batches.shift();
          if (!batch) return;
          const id = nextId++;
          worker.onmessage = ({ data }) => {
            if (data.id !== id) return;
            children.push(...data.children);
            lines.push(...data.lines);
            thought += data.thought;
            if (++done === Math.ceil(frontier.length / size)) resolve({ children, lines, thought });
            else feed(worker);
          };
          worker.onerror = (e) => reject(e);
          worker.postMessage({ id, seed, positions: batch });
        };
        workers.forEach(feed);
      });
    },
    stop() {
      workers.forEach((w) => w.terminate());
      cancel?.();
    },
  };
}

async function solve() {
  const pool = createPool();
  let stopped = false;
  run = {
    stop() {
      stopped = true;
      pool.stop();
    },
  };
  const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
  renderControls();
  const started = performance.now();
  let total = 0;
  const opening = advance(openingPosition(seed), createMemo());
  try {
    for (let width = FIRST_WIDTH; !stopped; width *= GROWTH) {
      const roundStart = performance.now();
      let positions = 0;
      let roundBest = null;
      let frontier = [opening];
      for (let turn = 1; frontier.length; turn++) {
        status(`Beam width ${width.toLocaleString()} · your turn ${turn} · ${(total + positions).toLocaleString()} positions · ${clock(performance.now() - started)}`);
        const { children, lines } = await pool.expand(frontier);
        positions += children.length + lines.length;
        for (const line of lines) {
          if (!roundBest || isBetter(line, roundBest)) roundBest = line;
          if (!best || isBetter(line, best.line)) {
            best = { line, width, seconds: (performance.now() - started) / 1000, positions: total + positions };
            save();
            renderBest();
          }
        }
        frontier = selectBeam(children, width);
      }
      total += positions;
      addRound(width, positions, performance.now() - roundStart, roundBest);
    }
  } catch (error) {
    if (!stopped) status(`Stopped: ${error.message ?? error}`);
  } finally {
    wakeLock?.release().catch(() => {});
    pool.stop();
    run = null;
    if (stopped) status(`Stopped after ${clock(performance.now() - started)} and ${total.toLocaleString()} positions in finished rounds.`);
    renderControls();
  }
}

// ---------- Rendering ----------

const clock = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const cardHtml = (c) => `<span class="c ${c.color}">${SUIT[c.color]}${c.value}</span>`;
const cards = (list) => list.map(cardHtml).join(' ');

function status(text) {
  $('status').textContent = text;
}

function renderControls() {
  $('solveBtn').hidden = Boolean(run);
  $('stopBtn').hidden = !run;
  $('day').disabled = Boolean(run);
}

function renderBest() {
  $('result').hidden = !best;
  if (!best) return;
  const { line, width, seconds, positions } = best;
  $('bestDiff').textContent = signed(line.diff);
  $('bestDiff').className = `diff ${line.diff > 0 ? 'up' : line.diff < 0 ? 'down' : ''}`;
  $('bestScores').textContent = `You ${line.you} · Alice ${line.alice}`;
  $('bestNote').textContent = `Found at beam width ${width.toLocaleString()}, ${clock(seconds * 1000)} in, after ${positions.toLocaleString()} positions.`;

  // Replay the line to show what each play took.
  let pos = openingPosition(seed);
  const items = [];
  let finalShown = false;
  for (const [n, { player, cardId }] of line.moves.entries()) {
    const card = pos.hands[player].find((c) => c.id === cardId);
    const { removed } = resolvePlay(pos.parade, card);
    const before = pos.finalTurns;
    pos = playCard(pos, cardId);
    const [who, takes] = player === ALICE ? ['Alice plays', 'takes'] : ['You play', 'take'];
    items.push(`<li value="${n + 1}" class="${player === ALICE ? 'alice' : 'you'}"><b>${who} ${cardHtml(card)}</b>`
      + ` and ${takes} ${removed.length ? cards(removed) : 'nothing'}</li>`);
    if (before === null && pos.finalTurns !== null && !finalShown) {
      finalShown = true;
      items.push('<li class="marker">Final round</li>');
    }
  }
  const byId = (ids) => ids.map((id) => pos.hands.flat().find((c) => c.id === id));
  items.push(`<li class="you end"><b>You keep ${cards(byId(line.keep))}</b> and discard ${cards(byId(line.discard))}</li>`);
  const aliceKeep = pos.hands[ALICE].filter((c) => !line.aliceDiscard.includes(c.id));
  items.push(`<li class="alice end"><b>Alice keeps ${cards(aliceKeep)}</b> and discards ${cards(byId(line.aliceDiscard))}</li>`);
  $('line').innerHTML = items.join('');
}

function addRound(width, positions, ms, roundBest) {
  $('roundsPanel').hidden = false;
  const row = document.createElement('tr');
  row.innerHTML = `<td>${width.toLocaleString()}</td><td>${positions.toLocaleString()}</td><td>${clock(ms)}</td>`
    + `<td class="diff">${roundBest ? signed(roundBest.diff) : '–'}</td>`;
  $('rounds').append(row);
}

function selectDay(key) {
  run?.stop();
  day = key;
  seed = seedForDay(day);
  $('day').value = day;
  $('seed').textContent = `${dateOfKey(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · seed ${seed}`;
  best = loadSaved()[day] ?? null;
  renderBest();
  $('rounds').replaceChildren();
  $('roundsPanel').hidden = true;
  status(best ? 'Showing the best line saved from an earlier search. Solve again to look further.' : 'Ready.');
}

$('day').addEventListener('change', () => {
  if (/^\d{4}-\d{2}-\d{2}$/.test($('day').value)) selectDay($('day').value);
});
$('solveBtn').onclick = () => {
  $('rounds').replaceChildren();
  solve();
};
$('stopBtn').onclick = () => run?.stop();

selectDay(day);
renderControls();
