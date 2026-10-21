// Board replay + practice for recorded lines (data/<id>.json "actions").
// No rules engine: it replays what the log recorded and checks you against it.
import { esc } from './util.js';
import { deckTotal } from './decks.js';

const ZONES = ['M1', 'M2', 'M3', 'M4', 'M5'];
// Recorded lines per deck id (data/<name>.json). Add a file here to give a deck a line.
const LINE_FILES = { frogOtk: ['open-8k-3des'] };
const MOVES = new Set(['summon', 'specialSummon', 'toGrave', 'returnToDeck', 'removeToken']);
const KNOWN = new Set([...MOVES, 'token', 'activateEffect']);

export function initialState(line, deckSize = 40, extraSize = 15) {
  return {
    hand: [...line.startHand],
    zones: Object.fromEntries(ZONES.map((z) => [z, null])),
    grave: [],
    deck: deckSize - line.startHand.length,
    extra: extraSize
  };
}

/** Returns the board after one recorded action; throws if the log contradicts the board. */
export function applyAction(prev, a) {
  if (!KNOWN.has(a.type)) throw new Error(`Unbekannter Aktionstyp "${a.type}" (Schritt ${a.step})`);
  const s = structuredClone(prev);
  const fail = (why) => { throw new Error(`Schritt ${a.step}: ${why}`); };

  if (MOVES.has(a.type)) {
    const { from } = a;
    if (from === 'hand' || from === 'grave') {
      const list = from === 'hand' ? s.hand : s.grave;
      const i = list.lastIndexOf(a.card);
      if (i < 0) fail(`${a.card} nicht in ${from}`);
      list.splice(i, 1);
    } else if (from === 'deck') s.deck -= 1;
    else if (from === 'extraDeck') s.extra -= 1;
    else if (ZONES.includes(from)) {
      if (s.zones[from]?.card !== a.card) fail(`${a.card} nicht in ${from}`);
      s.zones[from] = null;
    } else fail(`unbekannte Quelle "${from}"`);
  }

  if (a.type === 'summon' || a.type === 'specialSummon' || a.type === 'token') {
    if (!ZONES.includes(a.to)) fail(`unbekannte Zone "${a.to}"`);
    if (s.zones[a.to]) fail(`${a.to} ist belegt`);
    s.zones[a.to] = { card: a.card, pos: a.position ?? 'ATK' };
  } else if (a.type === 'toGrave') s.grave.push(a.card);
  else if (a.type === 'returnToDeck') s.deck += 1;
  return s;
}

/** Board after 0..n actions: boards[i] is the state after i actions. */
export function replay(line, deckSize, extraSize) {
  const boards = [initialState(line, deckSize, extraSize)];
  for (const a of line.actions) boards.push(applyAction(boards.at(-1), a));
  return boards;
}

const sourceKey = (a) => ({ hand: `hand:${a.card}`, grave: 'grave', deck: 'deck', extraDeck: 'extra' }[a.from] ?? a.from);

/** The clicks (source, then target) that perform one recorded action in practice mode. */
export function expectedClicks(a) {
  switch (a.type) {
    case 'token': return [a.to];
    case 'toGrave': return [sourceKey(a), 'grave'];
    case 'returnToDeck': return [sourceKey(a), 'deck'];
    case 'summon':
    case 'specialSummon': return [sourceKey(a), a.to];
    default: return [sourceKey(a)]; // activateEffect, removeToken
  }
}

/* ---------- UI ---------- */

const getJson = (url) => fetch(url).then((res) => {
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
});

export async function initSandbox(root, catalog) {
  let lines = [];
  let deckName = '';
  let deckSize = 40;
  let extraSize = 15;
  let loadToken = 0;

  const loadLines = async (deckId) => {
    const jsons = await Promise.all((LINE_FILES[deckId] ?? []).map((name) => getJson(`./data/${name}.json`)));
    return jsons.flatMap((f) => f.lines).filter((l) => l.actions?.length && l.startHand?.length);
  };

  const ui = { line: 0, mode: 'replay', step: 0, picked: 0, mistakes: 0, hint: false, msg: '' };
  let boards = null;
  const current = () => lines[ui.line];
  const load = () => {
    boards = null;
    if (!lines.length) return;
    try {
      boards = replay(current(), deckSize, extraSize);
    } catch (error) {
      ui.error = error.message;
    }
  };
  const reset = () => Object.assign(ui, { step: 0, picked: 0, mistakes: 0, hint: false, msg: '', error: '' });

  const title = (line) => catalog.find((l) => l.id === line.id)?.title ?? line.id;

  const render = () => {
    if (!lines.length) {
      root.innerHTML = `<p class="empty-state"><strong>${esc(deckName)}: noch keine Lines mit Aktionsdaten.</strong><br>
        Eine Line kommt dazu, indem du eine JSON-Datei im Format von data/open-8k-3des.json anlegst und sie in LINE_FILES (js/sandbox.js) einträgst.</p>`;
      return;
    }
    const line = current();
    if (!boards) {
      root.innerHTML = `<p class="notice notice-error">Die Line "${esc(title(line))}" passt nicht zu den Daten: ${esc(ui.error)}</p>`;
      return;
    }
    const practice = ui.mode === 'practice';
    const n = line.actions.length;
    const board = boards[ui.step];
    const last = ui.step > 0 ? line.actions[ui.step - 1] : null;
    const next = line.actions[ui.step];
    const want = practice && next ? expectedClicks(next) : [];
    const changed = new Set(!practice && last ? expectedClicks(last) : []);
    const chosen = new Set(want.slice(0, ui.picked));

    // Practice: slots are buttons. Replay: plain boxes, nothing to click.
    const slot = (key, html, label, extra = '') => {
      const cls = `sb-slot ${changed.has(key) ? 'sb-changed' : ''} ${chosen.has(key) ? 'sb-picked' : ''} ${extra}`;
      return practice
        ? `<button type="button" class="${cls}" data-key="${esc(key)}" aria-label="${esc(label)}">${html}</button>`
        : `<div class="${cls}">${html}</div>`;
    };

    const zones = ZONES.map((z) => {
      const c = board.zones[z];
      return slot(z, c ? `<strong>${esc(c.card)}</strong><span class="sb-pos">${c.pos}</span>` : `<span class="sb-empty">${z}</span>`,
        `Zone ${z}: ${c ? c.card : 'leer'}`);
    }).join('');
    const hand = board.hand.map((c) => slot(`hand:${c}`, `<strong>${esc(c)}</strong>`, `Handkarte ${c}`)).join('')
      || '<span class="sb-empty">Hand leer</span>';
    const piles = [
      slot('deck', `<span class="sb-empty">Deck</span><strong>${board.deck}</strong>`, `Deck, ${board.deck} Karten`, 'sb-pile'),
      slot('extra', `<span class="sb-empty">Extra Deck</span><strong>${board.extra}</strong>`, `Extra Deck, ${board.extra} Karten`, 'sb-pile'),
      slot('grave', `<span class="sb-empty">Friedhof · ${board.grave.length}</span><small>${board.grave.map(esc).join(', ')}</small>`, `Friedhof, ${board.grave.length} Karten`, 'sb-pile sb-grave')
    ].join('');

    // Log / feedback line
    let status;
    if (practice) {
      if (!next) {
        const ok = Object.entries(line.finalBoard).every(([z, c]) => board.zones[z]?.card === c);
        status = `Geschafft: ${n} Züge, ${ui.mistakes} Fehlversuch${ui.mistakes === 1 ? '' : 'e'}. Endboard ${ok ? 'stimmt ✓' : 'weicht ab'}: ${Object.values(line.finalBoard).map(esc).join(', ')}`;
      } else {
        status = `${ui.msg ? `${esc(ui.msg)} ` : ''}Zug ${ui.step + 1} von ${n}: ${ui.picked ? 'Wohin?' : 'Welche Karte bewegst du?'}`
          + (ui.hint ? `<br><em>Tipp: ${esc(next.log)}</em>` : '');
      }
    } else if (last) {
      status = `Schritt ${ui.step}/${n}${last.t ? ` · ${esc(last.t)}` : ''}: ${esc(last.log)}`
        + (last.inferredSynchro ? ' <em>(Synchro-Materialien aus dem Log abgeleitet, ungeprüft)</em>' : '');
    } else {
      status = `Startposition. ${n} Schritte, Weiter zeigt den ersten.`;
    }
    if (!practice && ui.step === n) {
      status += `<br>Endboard: ${Object.values(line.finalBoard).map(esc).join(', ')}`;
    }

    const notes = [line.needsReview ? 'Diese Line ist noch nicht geprüft.' : '', ...(line.notes || [])].filter(Boolean);

    root.innerHTML = `
      <div class="sb-controls">
        ${lines.length > 1 ? `<select data-line aria-label="Line">${lines.map((l, i) => `<option value="${i}"${i === ui.line ? ' selected' : ''}>${esc(title(l))}</option>`).join('')}</select>` : `<strong>${esc(title(line))}</strong>`}
        <span class="spacer"></span>
        <button type="button" class="secondary-button" data-mode="replay" aria-pressed="${!practice}">Nachspielen</button>
        <button type="button" class="secondary-button" data-mode="practice" aria-pressed="${practice}">Selbst spielen</button>
        <button type="button" class="ghost-button" data-act="reset">Neustart</button>
      </div>
      <div class="sb-board">
        <div class="sb-piles">${piles}</div>
        <div class="sb-zones">${zones}</div>
        <div class="sb-hand">${hand}</div>
      </div>
      <p class="sb-log" role="status" aria-live="polite">${status}</p>
      <div class="sb-nav">
        ${practice
          ? `<button type="button" class="secondary-button" data-act="hint"${next ? '' : ' disabled'}>Tipp</button>`
          : `<button type="button" class="secondary-button" data-act="back"${ui.step === 0 ? ' disabled' : ''}>← Zurück</button>
             <button type="button" class="primary-button" data-act="forward"${ui.step === n ? ' disabled' : ''}>Weiter →</button>`}
      </div>
      ${notes.length ? `<details class="sb-notes"><summary>Hinweise zur Datenqualität</summary><ul>${notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}`;
  };

  const pick = (key) => {
    const next = current().actions[ui.step];
    if (!next) return;
    const want = expectedClicks(next);
    if (key === want[ui.picked]) {
      ui.picked += 1;
      ui.msg = '';
      if (ui.picked === want.length) { ui.step += 1; ui.picked = 0; ui.hint = false; ui.msg = '✓ Richtig.'; }
    } else {
      ui.mistakes += 1;
      ui.picked = 0;
      ui.msg = 'Nicht ganz, versuche es nochmal.';
    }
  };

  root.addEventListener('click', (event) => {
    const t = event.target.closest('button');
    if (!t || !boards) return;
    if (t.dataset.key) pick(t.dataset.key);
    else if (t.dataset.mode) { ui.mode = t.dataset.mode; reset(); }
    else if (t.dataset.act === 'reset') reset();
    else if (t.dataset.act === 'hint') ui.hint = true;
    else if (t.dataset.act === 'forward') ui.step = Math.min(ui.step + 1, current().actions.length);
    else if (t.dataset.act === 'back') ui.step = Math.max(ui.step - 1, 0);
    else return;
    render();
    // Re-rendering replaces the buttons: keep keyboard users where they were.
    const keep = t.dataset.act || t.dataset.mode;
    if (keep) root.querySelector(`[data-act="${t.dataset.act}"],[data-mode="${t.dataset.mode}"]`)?.focus();
  });
  root.addEventListener('change', (event) => {
    if (event.target.dataset.line === undefined) return;
    ui.line = Number(event.target.value);
    reset(); load(); render();
  });

  return {
    async setDeck(id, deck) {
      const token = ++loadToken;
      deckName = deck.name;
      deckSize = deckTotal(deck, 'main') || 40;
      extraSize = deckTotal(deck, 'extra') || 15;
      try {
        const loaded = await loadLines(id);
        if (token !== loadToken) return; // a newer deck switch won
        lines = loaded;
      } catch (error) {
        root.innerHTML = `<p class="notice notice-error">Sandbox konnte nicht geladen werden (${esc(error.message)}).</p>`;
        return;
      }
      ui.line = 0;
      reset();
      load();
      render();
    }
  };
}
