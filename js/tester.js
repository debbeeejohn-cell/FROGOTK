// Deck tester: draw test hands and move cards by hand, like DuelingBook's solo mode.
// No rules and no automation: every move is a click, the app only keeps track of where cards are.
import { loadCards } from './decks.js';
import { esc } from './util.js';

const PILES = ['hand', 'deck', 'extra', 'gy', 'banished'];
const ZONE_SIZE = { mz: 5, st: 5, emz: 2, field: 1 };
const PLACE = { hand: 'Hand', deck: 'Deck', extra: 'Extra Deck', gy: 'Friedhof', banished: 'Verbannt' };
const zoneName = (z) => {
  const [kind, i] = z.split(':');
  return { mz: `M${+i + 1}`, st: `S/T${+i + 1}`, emz: `Linkzone ${+i + 1}`, field: 'Feldzone' }[kind];
};

// Fisher-Yates; rng injectable for tests.
function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Fresh game: whole main deck shuffled (deck[0] is the top card), nothing drawn yet. */
export function newGame(deck, rng = Math.random) {
  let id = 0;
  const cards = (list, ex) => (list || []).flatMap(({ card, count }) => Array.from({ length: count }, () => ({ id: ++id, name: card, ex })));
  return {
    deck: shuffle(cards(deck.main, false), rng),
    extra: cards(deck.extra, true),
    hand: [], gy: [], banished: [],
    ...Object.fromEntries(Object.entries(ZONE_SIZE).map(([k, n]) => [k, Array(n).fill(null)])),
    nextId: id + 1,
    log: []
  };
}

/** Where a card is: ['hand', 3] for piles, ['mz:2', 0] for zones. */
export function find(s, id) {
  for (const p of PILES) {
    const i = s[p].findIndex((c) => c.id === id);
    if (i >= 0) return [p, i];
  }
  for (const kind of Object.keys(ZONE_SIZE)) {
    const i = s[kind].findIndex((c) => c?.id === id);
    if (i >= 0) return [`${kind}:${i}`, 0];
  }
  return null;
}

/** The card object with that id, wherever it is. */
export function cardAt(s, id) {
  const [where, i] = find(s, id) ?? [];
  if (!where) return null;
  const [kind, z] = where.split(':');
  return z === undefined ? s[kind][i] : s[kind][z];
}

/**
 * Moves a card. `to` is a pile ('hand', 'gy', 'banished', 'extra', 'deck' = top, 'deckBottom')
 * or a zone ('mz:0' … 'field:0'). Tokens that leave the field disappear.
 */
export function move(prev, id, to, pos) {
  const s = structuredClone(prev);
  const at = find(s, id);
  if (!at) throw new Error(`Karte ${id} nicht gefunden`);
  const [from, i] = at;
  let card;
  if (from.includes(':')) {
    const [kind, z] = from.split(':');
    card = s[kind][z];
    s[kind][z] = null;
  } else card = s[from].splice(i, 1)[0];

  if (to.includes(':')) {
    const [kind, z] = to.split(':');
    if (!(kind in ZONE_SIZE) || !(z < ZONE_SIZE[kind])) throw new Error(`Unbekannte Zone ${to}`);
    if (s[kind][z]) throw new Error(`${zoneName(to)} ist belegt`);
    s[kind][z] = { ...card, pos: pos ?? (kind === 'st' || kind === 'field' ? 'up' : 'atk') };
    return s;
  }
  if (card.token) return s;
  const { pos: _, ...plain } = card;
  if (to === 'deck') s.deck.unshift(plain);
  else if (to === 'deckBottom') s.deck.push(plain);
  else if (PILES.includes(to)) s[to].push(plain);
  else throw new Error(`Unbekanntes Ziel ${to}`);
  return s;
}

export function draw(prev, n) {
  const s = structuredClone(prev);
  s.hand.push(...s.deck.splice(0, Math.max(0, n)));
  return s;
}

export function shuffleDeck(prev, rng = Math.random) {
  const s = structuredClone(prev);
  shuffle(s.deck, rng);
  return s;
}

export function setPos(prev, id, pos) {
  const s = structuredClone(prev);
  cardAt(s, id).pos = pos;
  return s;
}

/** Puts a token straight into an empty zone. */
export function addToken(prev, zone, pos = 'atk') {
  const s = structuredClone(prev);
  const [kind, i] = zone.split(':');
  if (s[kind][i]) throw new Error(`${zoneName(zone)} ist belegt`);
  s[kind][i] = { id: s.nextId, name: 'Token', token: true, pos };
  s.nextId += 1;
  return s;
}

/* ---------- UI ---------- */

export async function initTester(root) {
  const cardDb = await loadCards();
  const byName = new Map((cardDb?.cards ?? []).map((c) => [c.name, c]));

  root.innerHTML = '<div class="ts-main"></div><dialog class="dl-dialog" data-pile aria-labelledby="tsPileTitle"></dialog>';
  const main = root.querySelector('.ts-main');
  const dlg = root.querySelector('[data-pile]');

  let deck = null;
  let s = null;
  let history = [];
  let sel = null;      // selected card id, or 'token' while placing a token
  let pending = null;  // { kinds, pos, label } while waiting for a zone click
  let openPile = null;
  let query = '';
  let drawCount = 5;
  let status = '';

  const info = (c) => byName.get(c.name);
  const isType = (c, word) => !c.token && (info(c)?.type ?? word).includes(word); // unknown card: offer everything

  const commit = (next, msg) => {
    history.push(s);
    s = next;
    s.log = [msg, ...s.log].slice(0, 60);
    status = '';
  };
  const run = (fn, msg) => {
    try { commit(fn(), msg); } catch (error) { status = error.message; }
  };

  function restart() {
    s = newGame(deck);
    history = []; sel = null; pending = null; status = '';
  }

  /** What can be done with a card, depending on where it is. */
  function actions(c, where) {
    const kind = where.split(':')[0];
    const list = [];
    const zone = (label, kinds, pos) => list.push({ label, zone: { kinds, pos, label } });
    if (!(kind in ZONE_SIZE)) {
      if (kind === 'hand' && isType(c, 'Monster') && !c.ex) {
        zone('Normalbeschwören', ['mz'], 'atk');
        zone('Monster setzen', ['mz'], 'set');
      }
      if (isType(c, 'Monster')) {
        zone('Spezialbeschwören (ATK)', ['mz', 'emz'], 'atk');
        zone('Spezialbeschwören (DEF)', ['mz', 'emz'], 'def');
      }
      if (isType(c, 'Spell') || isType(c, 'Trap')) {
        const kinds = [info(c)?.race === 'Field' ? 'field' : 'st'];
        zone('Aktivieren', kinds, 'up');
        zone('Zauber/Falle setzen', kinds, 'set');
      }
    } else {
      if (kind === 'mz' || kind === 'emz') {
        if (c.pos === 'set') list.push({ label: 'Flippen (aufdecken)', pos: 'atk' });
        if (c.pos === 'atk') list.push({ label: 'In Verteidigung', pos: 'def' });
        if (c.pos === 'def') list.push({ label: 'In Angriff', pos: 'atk' });
        if (c.pos !== 'set') list.push({ label: 'Verdeckt setzen', pos: 'set' });
      } else list.push(c.pos === 'set' ? { label: 'Aufdecken / Aktivieren', pos: 'up' } : { label: 'Verdeckt setzen', pos: 'set' });
      zone('Zone wechseln', kind === 'mz' || kind === 'emz' ? ['mz', 'emz'] : [kind], c.pos);
    }
    if (c.token) return [...list, { label: 'Token entfernen', to: 'gy' }];
    const dests = [['hand', 'Auf die Hand'], ['gy', 'Auf den Friedhof'], ['banished', 'Verbannen'], ['deck', 'Oben aufs Deck'], ['deckBottom', 'Unter das Deck']];
    if (c.ex) dests.splice(3, 2, ['extra', 'Zurück ins Extra Deck']);
    dests.filter(([to]) => to !== kind).forEach(([to, label]) => list.push({ label, to }));
    return list;
  }

  /* ----- rendering ----- */

  const img = (c) => (info(c)?.img ? `<img src="assets/cards-small/${Number(info(c).id)}.jpg" alt="" loading="lazy" />` : '');
  const face = (c) => img(c) || `<span>${esc(c.name)}</span>`;

  function cardBtn(c, kind) {
    const down = c.pos === 'set';
    const sideways = c.pos === 'def' || (down && (kind === 'mz' || kind === 'emz'));
    const cls = ['dl-card', down && 'down peek', sideways && 'def', sel === c.id && 'sel'].filter(Boolean).join(' ');
    const state = down ? ' (verdeckt)' : c.pos === 'def' ? ' (Verteidigung)' : '';
    return `<button type="button" class="${cls}" data-id="${c.id}" aria-pressed="${sel === c.id}" aria-label="${esc(c.name + state)}">${face(c)}</button>`;
  }

  function slot(kind, i, label) {
    const c = s[kind][i];
    if (c) return `<div class="dl-slot">${cardBtn(c, kind)}</div>`;
    const target = sel !== null && (!pending || pending.kinds.includes(kind));
    return target
      ? `<button type="button" class="dl-slot empty ts-target" data-zone="${kind}:${i}" aria-label="${esc(`${label} wählen`)}">${label}</button>`
      : `<div class="dl-slot empty" aria-hidden="true">${label}</div>`;
  }

  const pile = (p, label) => `<button type="button" class="dl-pile" data-open="${p}" aria-label="${esc(`${label}: ${s[p].length} Karten, öffnen`)}"><b>${s[p].length}</b>${label}</button>`;

  function detail() {
    if (sel === 'token') return '<p class="dl-hint">Token: freie Zone antippen.</p>';
    const c = sel !== null && cardAt(s, sel);
    if (!c) return '<p class="dl-hint">Karte antippen, dann Aktion wählen. Ein leeres Feld antippen legt die gewählte Karte direkt dorthin. Deck, Friedhof, Verbannt und Extra Deck öffnen sich per Klick.</p>';
    const [where] = find(s, sel);
    const d = info(c);
    const meta = d ? [d.type, d.attribute, d.race, d.level != null ? `Stufe ${d.level}` : null, d.atk != null ? `ATK ${d.atk} / DEF ${d.def ?? '–'}` : null].filter(Boolean).join(' · ') : '';
    const acts = actions(c, where).map((a, n) => `<button type="button" class="${a.zone ? 'primary-button' : 'secondary-button'}" data-act="${n}">${esc(a.label)}</button>`).join('');
    return `<div class="dl-detail-head">${img(c)}<div><h3>${esc(c.name)}</h3><p class="dl-meta">${esc(meta)}</p>`
      + `<p class="dl-meta">${esc(PLACE[where] ?? zoneName(where))}</p></div></div>`
      + `${d?.desc ? `<p class="dl-desc">${esc(d.desc)}</p>` : ''}<div class="dl-actions">${acts}</div>`;
  }

  function html() {
    const row = (kind, label) => Array.from({ length: ZONE_SIZE[kind] }, (_, i) => slot(kind, i, `${label}${i + 1}`)).join('');
    return `<div class="dl-wrap">
      <div class="dl-mat ts-mat" aria-label="Spielfeld">
        <div class="ts-grid">
          <span></span><span></span>${slot('emz', 0, 'Link')}<span></span>${slot('emz', 1, 'Link')}<span></span>${pile('banished', 'Verbannt')}
          ${slot('field', 0, 'Feld')}${row('mz', 'M')}${pile('gy', 'Friedhof')}
          ${pile('extra', 'Extra')}${row('st', 'S/T')}${pile('deck', 'Deck')}
        </div>
        <div class="dl-hand" aria-label="Deine Hand: ${s.hand.length} Karten">${s.hand.map((c) => `<div class="dl-slot">${cardBtn(c, 'hand')}</div>`).join('') || '<span class="dl-hint">Hand leer</span>'}</div>
      </div>
      <aside class="dl-side">
        <form class="ts-draw" data-draw>
          <label>Karten ziehen <input type="number" name="n" min="1" max="60" value="${drawCount}" inputmode="numeric" /></label>
          <button type="submit" class="primary-button">Ziehen</button>
        </form>
        <div class="dl-bar-btns">
          <button type="button" class="secondary-button" data-op="shuffle">Deck mischen</button>
          <button type="button" class="secondary-button" data-op="token">Token</button>
          <button type="button" class="secondary-button" data-op="undo" ${history.length ? '' : 'disabled'}>Rückgängig</button>
          <button type="button" class="ghost-button" data-op="restart">Neu starten</button>
        </div>
        <p class="dl-status" role="status">${esc(status || (pending ? `${pending.label}: Zone wählen.` : ''))}</p>
        ${pending ? '<button type="button" class="ghost-button" data-op="cancel">Abbrechen</button>' : ''}
        <section class="dl-detail" aria-label="Kartendetails">${detail()}</section>
        <ol class="dl-log" aria-label="Verlauf">${s.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
      </aside></div>`;
  }

  function renderPile() {
    if (!openPile) return;
    const q = query.toLowerCase();
    // Deck sorted by name so opening it doesn't reveal the draw order.
    const list = openPile === 'deck' ? [...s.deck].sort((a, b) => a.name.localeCompare(b.name)) : s[openPile];
    dlg.querySelector('h3').textContent = `${PLACE[openPile]} (${s[openPile].length})`;
    dlg.querySelector('[data-grid]').innerHTML = list.filter((c) => c.name.toLowerCase().includes(q))
      .map((c) => `<div class="dl-slot">${cardBtn(c, openPile)}<small>${esc(c.name)}</small></div>`).join('')
      || '<p class="dl-hint">Keine Karte gefunden.</p>';
  }

  function showPile(p) {
    openPile = p;
    query = '';
    dlg.innerHTML = `<h3 id="tsPileTitle"></h3>
      <input type="search" class="dl-announce" data-search placeholder="Karte suchen …" aria-label="Karte suchen" autocomplete="off" />
      <div class="dl-pilegrid" data-grid></div>
      <form method="dialog" class="dl-actions">${p === 'deck' ? '<button type="button" class="secondary-button" data-op="shuffle">Mischen</button>' : ''}<button class="secondary-button">Schließen</button></form>`;
    renderPile();
    dlg.showModal();
  }

  function render() {
    const active = document.activeElement;
    const focus = active && main.contains(active) && ['op', 'id', 'zone', 'open'].map((k) => active.dataset[k] && `[data-${k}="${active.dataset[k]}"]`).find(Boolean);
    main.innerHTML = html();
    if (focus) main.querySelector(focus)?.focus();
  }

  /* ----- events ----- */

  function onClick(d) {
    if (d.op === 'restart') restart();
    else if (d.op === 'undo') { s = history.pop(); pending = null; status = ''; }
    else if (d.op === 'shuffle') { run(() => shuffleDeck(s), 'Deck gemischt'); renderPile(); }
    else if (d.op === 'cancel') pending = null;
    else if (d.op === 'token') { sel = 'token'; pending = { kinds: ['mz', 'emz', 'st'], pos: 'def', label: 'Token beschwören' }; }
    else if (d.open) { showPile(d.open); return; }
    else if (d.id) {
      if (dlg.open) dlg.close();
      const id = Number(d.id);
      sel = sel === id ? null : id;
      pending = null;
    } else if (d.zone) {
      if (sel === 'token') run(() => addToken(s, d.zone, pending.pos), `Token → ${zoneName(d.zone)}`);
      else {
        const c = cardAt(s, sel);
        const keep = c.pos === 'set' ? 'set' : undefined; // a set card dragged around stays face-down
        run(() => move(s, sel, d.zone, pending?.pos ?? keep), `${pending?.label ?? 'Bewegt'}: ${c.name} → ${zoneName(d.zone)}`);
      }
      sel = null; pending = null;
    } else if (d.act) {
      const c = cardAt(s, sel);
      const a = actions(c, find(s, sel)[0])[Number(d.act)];
      if (a.zone) pending = a.zone;
      else if (a.pos) run(() => setPos(s, sel, a.pos), `${a.label}: ${c.name}`);
      else { run(() => move(s, sel, a.to), `${a.label}: ${c.name}`); sel = null; }
    } else return;
    if (typeof sel === 'number' && !find(s, sel)) sel = null; // undo can go back to before the card existed
    render();
  }

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('button');
    if (!el || !root.contains(el) || el.disabled || !Object.keys(el.dataset).length) return;
    onClick(el.dataset);
  });
  root.addEventListener('submit', (ev) => {
    if (!ev.target.matches('[data-draw]')) return;
    ev.preventDefault();
    drawCount = Math.max(1, Number(new FormData(ev.target).get('n')) || 1);
    const n = Math.min(drawCount, s.deck.length);
    if (!n) status = 'Das Deck ist leer.';
    else commit(draw(s, n), `${n} Karte${n === 1 ? '' : 'n'} gezogen`);
    render();
  });
  root.addEventListener('input', (ev) => {
    if (!ev.target.matches('[data-search]')) return;
    query = ev.target.value;
    renderPile();
  });
  dlg.addEventListener('close', () => { openPile = null; });

  return {
    setDeck(id, d) {
      if (d === deck) return; // returning to the tab keeps the running test hand
      deck = d;
      restart();
      render();
    }
  };
}
