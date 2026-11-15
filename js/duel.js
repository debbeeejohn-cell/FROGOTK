// Bot Duel: practice duel against a passive bot on the real rules engine (duel-core.js, ygopro-core).
// The engine decides what is legal and asks the questions (activate? which cards? which position?);
// this module only draws the board and turns clicks into engine responses, like Dueling Nexus.
import { loadCore, cardTable, newGame, traceOf, compareCombo, L, P, M, R, PLACE } from './duel-core.js';
import { loadDecks, loadCards, deckOptions } from './decks.js';
import { ocgRaceString, ocgAttributeString } from '../vendor/ocgcore/index.js';
import { esc } from './util.js';
import { getStoredSettings, saveSettings } from './store.js';
import { key, actionsByCard as offeredActions, phaseButtons, sumState as levelSum, phaseMenu, PHASE_SHORT } from './duel-view.js';

const getJson = (file) => fetch(`./data/${file}`).then((r) => {
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.json();
});
const POSITION = { 1: 'Offene Angriffsposition', 2: 'Verdeckte Angriffsposition', 4: 'Offene Verteidigungsposition', 8: 'Verdeckte Verteidigungsposition' };
const PROMPT_TITLE = { [M.SELECT_CARD]: 'Karten wählen', [M.SELECT_TRIBUTE]: 'Als Tribut wählen', [M.SELECT_SUM]: 'Karten wählen', [M.SELECT_UNSELECT_CARD]: 'Karten wählen' };
// Saved combos keep BigInt values (seed, declared Types) as { $big } so they survive JSON.
const toJson = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? { $big: String(x) } : x));
const fromJson = (text) => JSON.parse(text, (k, x) => (x && x.$big !== undefined ? BigInt(x.$big) : x));
const savedLines = () => getStoredSettings().duelLines ?? [];
const bitList = (mask) => { const out = []; for (let b = 1n; b <= BigInt(mask); b <<= 1n) if (BigInt(mask) & b) out.push(b); return out; };

export async function initDuel(root) {
  root.innerHTML = '<p class="dl-hint">Lade Duell-Engine …</p>';
  const [decks, cardDb, coreCards, { scripts }, lib] = await Promise.all([
    loadDecks(), loadCards(), getJson('core-cards.json'), getJson('core-scripts.json'), loadCore()
  ]);
  if (!cardDb) {
    root.innerHTML = '<p class="dl-hint">Für das Bot Duel fehlt die Kartendatenbank (Workflow „Karten laden“).</p>';
    return { setDeck() {} };
  }
  const table = cardTable(coreCards);
  const byId = new Map(cardDb.cards.map((c) => [c.id, c]));
  const idOf = new Map(cardDb.cards.map((c) => [c.name, c.id]));
  const codes = (names) => names.map((n) => idOf.get(n)).filter((code) => table.data.has(code));
  const deckCodes = (deck) => ({
    main: codes(deck.main.flatMap((c) => Array(c.count).fill(c.card))),
    extra: codes((deck.extra || []).flatMap((c) => Array(c.count).fill(c.card)))
  });

  root.innerHTML = '<div class="dl-main"></div><dialog class="dl-dialog" data-prompt aria-labelledby="dlPromptTitle"></dialog><dialog class="dl-dialog" data-pile aria-labelledby="dlPileTitle"></dialog>';
  const main = root.querySelector('.dl-main');
  const promptDlg = root.querySelector('[data-prompt]');
  const pileDlg = root.querySelector('[data-pile]');
  promptDlg.addEventListener('cancel', (ev) => ev.preventDefault()); // the engine waits for an answer

  let myId; let g = null; let opts = null; let answers = [];
  let sel = null; let picked = new Set(); let status = '';
  let tab = 'card'; let redo = []; // Inspektor: 'card' | 'log'; redo = zurückgenommene Antworten, jüngste zuletzt
  let menu = null; // offenes Menü am Feld: 'card' (Aktionen der gewählten Karte) | 'phase'
  let duelDeck = null; let duelSetup = null; let openHand = []; let replay = null; // replay: { name, all: recorded answers, marks: answer counts before each shown step } while a saved combo is shown
  let setup = { opp: null, bot: 'aktiv', first: '1', askAll: '', hand: [] };
  const readSetup = (form) => { const fd = new FormData(form); return { askAll: '', ...Object.fromEntries(fd), hand: fd.getAll('hand') }; };

  const name = (code) => table.name(code);
  const missing = new Set(); // Karten, deren Bilddatei fehlt (assets/cards-small liegt nicht im Repo): dort steht der Name
  const img = (code) => (byId.get(code)?.img && !missing.has(Number(code)) ? `<img src="assets/cards-small/${Number(code)}.jpg" alt="${esc(name(code))}" data-code="${Number(code)}" loading="lazy" />` : '');
  const face = (code) => img(code) || `<span>${esc(name(code))}</span>`;

  const actionsByCard = (p) => offeredActions(p, table); // was die Engine anbietet, je Karte (js/duel-view.js)

  // ---------- board ----------
  function cardBtn(c, p, loc, i, actions) {
    const k = `${p}:${loc}:${i}`;
    const down = loc !== L.HAND && c.position & P.FACEDOWN; // hand cards are "face-down" for the engine
    const hidden = p === g.bot && (loc === L.HAND || down);
    const cls = ['dl-card', down && 'down', c.position & P.DEFENSE && loc === L.MZONE && 'def', down && !hidden && 'peek',
      actions.has(k) && 'can', sel === k && 'sel'].filter(Boolean).join(' ');
    const stat = loc === L.MZONE && !down ? `<b class="dl-stat">${c.attack}/${c.defense}</b>` : '';
    const label = hidden ? 'Verdeckte Karte des Bots' : `${name(c.code)}${down ? ' (verdeckt)' : ''}`;
    return `<button type="button" class="${cls}" data-key="${k}" aria-label="${esc(label)}" aria-pressed="${sel === k}">${hidden ? '' : face(c.code)}${stat}</button>`;
  }
  const slot = (c, p, loc, i, actions) => (c ? `<div class="dl-slot">${cardBtn(c, p, loc, i, actions)}</div>` : '<div class="dl-slot empty" aria-hidden="true"></div>');
  const fieldSlot = (v, p, actions) => `<div class="dl-slot${v.field ? '' : ' empty'}">${v.field ? cardBtn(v.field, p, L.SZONE, 5, actions) : ''}<span class="dl-tag">FELD</span></div>`;

  /** Ein Stapel (Deck, Extra, Friedhof, Verbannt) mit Beschriftung wie „FH 3“. Friedhof und Verbannt zeigen die oberste Karte. */
  function pile(v, p, field, tag, actions, low = false) {
    const loc = { deck: L.DECK, extra: L.EXTRA, gy: L.GRAVE, banished: L.REMOVED }[field];
    const n = field === 'deck' ? v.deck : v[field].length;
    const top = field === 'gy' || field === 'banished' ? v[field].at(-1) : null;
    const clickable = n > 0 && field !== 'deck' && (field !== 'extra' || p === g.me);
    const can = [...actions.keys()].some((k) => k.startsWith(`${p}:${loc}:`)) ? ' can' : '';
    const art = top ? face(top.code) : n && (field === 'deck' || field === 'extra') ? '<i class="dl-back"></i>' : '';
    const label = esc(`${p === g.me ? 'Du' : 'Bot'}: ${PLACE[loc]} ${n}`);
    const inner = `${art}<span class="dl-tag">${tag} <b>${n}</b></span>`;
    const cls = `dl-pile${low ? ' low' : ''}${can}${clickable ? '' : ' static'}`;
    return clickable ? `<button type="button" class="${cls}" data-pile="${p}:${field}" aria-label="${label}">${inner}</button>` : `<div class="${cls}" aria-label="${label}">${inner}</div>`;
  }

  /** Spielfeld als 7-Spalten-Raster, wie bei einem echten Feld: Stapel links und rechts (Bot punktgespiegelt), fünf Zonen in der Mitte. */
  function board(v, actions) {
    const [me, bot] = [v[g.me], v[g.bot]];
    const cell = (row, col, html) => `<div class="dl-cell" style="grid-row:${row};grid-column:${col}">${html}</div>`;
    const cells = [];
    for (let i = 0; i < 5; i += 1) {
      cells.push(cell(1, 6 - i, slot(bot.st[i], g.bot, L.SZONE, i, actions)), cell(2, 6 - i, slot(bot.mz[i], g.bot, L.MZONE, i, actions)),
        cell(4, 2 + i, slot(me.mz[i], g.me, L.MZONE, i, actions)), cell(5, 2 + i, slot(me.st[i], g.me, L.SZONE, i, actions)));
    }
    cells.push(
      cell(1, 1, pile(bot, g.bot, 'deck', 'DECK', actions)), cell(1, 7, pile(bot, g.bot, 'extra', 'EXTRA', actions)),
      cell(2, 1, pile(bot, g.bot, 'gy', 'FH', actions)), cell(2, 7, fieldSlot(bot, g.bot, actions)),
      cell(3, 1, pile(bot, g.bot, 'banished', 'VERB.', actions, true)), cell(3, 7, pile(me, g.me, 'banished', 'VERB.', actions, true)),
      cell(4, 1, fieldSlot(me, g.me, actions)), cell(4, 7, pile(me, g.me, 'gy', 'FH', actions)),
      cell(5, 1, pile(me, g.me, 'extra', 'EXTRA', actions)), cell(5, 7, pile(me, g.me, 'deck', 'DECK', actions)),
      `<button type="button" class="dl-turn" data-menu="phase" aria-label="Zug ${g.turn}, ${g.active === g.me ? 'du' : 'Bot'}, Phase ${PHASE_SHORT[g.phase] ?? ''}. Phasenmenü öffnen"${replay ? ' disabled' : ''}><small>ZUG ${g.turn} · ${g.active === g.me ? 'DU' : 'BOT'}</small><b>${PHASE_SHORT[g.phase] ?? ''}</b></button>`
    );
    return cells.join('');
  }

  function findCard(k) {
    if (!k) return null;
    const [p, loc, i] = k.split(':').map(Number);
    const v = g.view()[p];
    const list = { [L.HAND]: v.hand, [L.MZONE]: v.mz, [L.GRAVE]: v.gy, [L.REMOVED]: v.banished, [L.EXTRA]: v.extra }[loc];
    const c = loc === L.SZONE ? (i === 5 ? v.field : v.st[i]) : list?.[i];
    return c ? { c, p, loc } : null;
  }

  function detail(actions) {
    const s = findCard(sel);
    if (!s) return '<p class="dl-hint">Leuchtende Karten haben Aktionen. Antippen für Details.</p>';
    const hidden = s.p === g.bot && (s.loc === L.HAND || s.c.position & P.FACEDOWN);
    if (hidden) return '<h3>Verdeckte Karte (Bot)</h3>';
    const info = byId.get(s.c.code);
    const meta = info ? [info.type, info.attribute, info.race, info.level != null ? `Stufe ${info.level}` : null,
      info.atk != null ? `ATK ${info.atk} / DEF ${info.def ?? '–'}` : null].filter(Boolean).join(' · ') : '';
    return `<div class="dl-detail-head">${img(s.c.code)}<div><h3>${esc(name(s.c.code))}</h3><p class="dl-meta">${esc(meta)}</p>`
      + `<p class="dl-meta">${s.p === g.me ? 'Du' : 'Bot'} · ${PLACE[s.loc]}</p></div></div>`
      + `${info?.desc ? `<p class="dl-desc">${esc(info.desc)}</p>` : ''}`;
  }

  /** Menü am Feld: Aktionen der gewählten Karte (Effekt, Beschwören, Setzen …) oder die sechs Phasen. Platziert wird es nach dem Zeichnen (placePopup). */
  function popupHtml(actions) {
    if (menu === 'phase') {
      return `<div class="dl-popup" role="menu" aria-label="Phasen">${phaseMenu(g.prompt, g.phase).map((m) => `<button type="button" role="menuitem" class="dl-pop-item${m.current ? ' current' : ''}" ${m.response ? `data-pphase="${m.id}"` : 'disabled'}><b>${m.id}</b>${m.label}</button>`).join('')}</div>`;
    }
    const s = menu === 'card' && findCard(sel);
    const acts = s ? actions.get(sel) ?? [] : [];
    if (!acts.length) return '';
    return `<div class="dl-popup" role="menu" aria-label="${esc(name(s.c.code))}"><strong>${esc(name(s.c.code))}</strong>${acts.map((a, i) => `<button type="button" role="menuitem" class="dl-pop-item" data-act="${i}">${esc(a.label)}</button>`).join('')}`
      + '<button type="button" role="menuitem" class="dl-pop-item" data-op="inspect">Karte ansehen</button></div>';
  }

  function placePopup() {
    const pop = main.querySelector('.dl-popup');
    if (!pop) return;
    const play = main.querySelector('.dl-play').getBoundingClientRect();
    const anchor = (menu === 'phase' ? main.querySelector('.dl-turn') : main.querySelector(`[data-key="${sel}"]`))?.getBoundingClientRect()
      ?? { left: play.left + play.width / 2, width: 0, top: play.top + 80, bottom: play.top + 80 }; // Karte im Stapel-Dialog: Mitte des Feldes
    const left = Math.max(0, Math.min(anchor.left + anchor.width / 2 - pop.offsetWidth / 2 - play.left, play.width - pop.offsetWidth));
    const above = anchor.top - pop.offsetHeight - 8 - play.top;
    pop.style.left = `${left}px`;
    pop.style.top = `${above >= 0 ? above : anchor.bottom + 8 - play.top}px`;
    pop.querySelector('button:not(:disabled)')?.focus();
  }

  /** Rule checks from the engine plus a comparison with my saved combos for this deck. */
  function teacherNotes() {
    const mine = traceOf(g.log);
    const combos = replay ? [] : savedLines().filter((l) => l.deck === duelDeck && l.trace?.length)
      .map((l) => compareCombo(l, openHand, mine)).filter(Boolean);
    return [...g.review.notes, ...combos];
  }

  function duelHtml() {
    const v = g.view(); const me = v[g.me]; const bot = v[g.bot];
    const actions = replay ? new Map() : actionsByCard(g.prompt);
    const lp = (p, label) => `<div class="dl-lp ${p === g.me ? 'me' : 'bot'}"><span class="dl-crest" aria-hidden="true">${label[0]}</span><div><small>${label.toUpperCase()}</small><strong>${g.lp[p]}<span class="dl-sr"> LP</span></strong><div class="dl-bar"><i style="width:${Math.min(100, g.lp[p] / 80)}%"></i></div></div></div>`;
    const next = replay ? null : phaseButtons(g.prompt)[0]; // die nächste Phase, die die Engine anbietet
    const tool = (attrs, text, label, off, cls = '') => `<button type="button" class="dl-tool ${cls}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}"${off ? ' disabled' : ''}>${text}</button>`;
    const toolbar = `<div class="dl-toolbar" role="toolbar" aria-label="Duell"><details class="dl-menu"><summary class="dl-tool" aria-label="Menü" title="Menü">☰</summary>`
      + `<div class="dl-menu-list"><button type="button" class="secondary-button" data-op="save" ${answers.length && !replay ? '' : 'disabled'}>Combo speichern</button><button type="button" class="secondary-button" data-op="new">Duell beenden</button></div></details>`
      + `${tool('data-op="undo"', '↶', 'Rückgängig', replay || !answers.length)}${tool('data-op="redo"', '↷', 'Wiederholen', replay || !redo.length)}${tool('data-tab="log"', '≡', 'Duellprotokoll', false)}`
      + `${tool(next ? 'data-phase="0"' : '', `▶ ${next ? esc(next.label) : 'Phase'}`, next ? `Weiter: ${next.label}` : 'Keine Phase wählbar', !next, 'wide')}</div>`;
    const tabBtn = (id, label) => `<button type="button" role="tab" class="dl-tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`;
    const logPane = `${g.review ? `<section class="dl-teacher" aria-label="Lehrer"><h3>Lehrer zu Zug ${g.review.turn}</h3>${teacherNotes().length
      ? `<ul>${teacherNotes().map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p>Nichts auszusetzen.</p>'}</section>` : ''}`
      + `<ol class="dl-log" aria-label="Verlauf">${g.log.slice(0, 30).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
    const banner = g.winner !== null ? `<div class="dl-win" role="status">${g.winner === g.me ? 'Du gewinnst!' : g.winner === g.bot ? 'Der Bot gewinnt.' : 'Unentschieden.'} <button type="button" class="primary-button" data-op="new">Neues Duell</button></div>` : '';
    const waiting = g.winner === null && !g.prompt ? 'Engine wartet …' : '';
    return `${banner}<div class="dl-wrap">
      <aside class="dl-side" aria-label="Inspektor">
        <div class="dl-tabs" role="tablist">${tabBtn('card', 'Karte ansehen')}${tabBtn('log', 'Duellprotokoll')}</div>
        ${replay ? `<div class="dl-replay"><strong>Combo „${esc(replay.name)}“</strong><span>Schritt ${answers.length} von ${replay.all.length}</span></div>
        <div class="dl-bar-btns"><button type="button" class="secondary-button" data-op="undo" ${answers.length ? '' : 'disabled'}>Zurück</button><button type="button" class="primary-button" data-op="step" ${answers.length < replay.all.length ? '' : 'disabled'}>Weiter</button><button type="button" class="secondary-button" data-op="takeover">Ab hier selbst spielen</button></div>` : ''}
        <p class="dl-status" role="status">${esc(status || g.error || waiting)}</p>
        <div class="dl-pane" role="tabpanel">${tab === 'log' ? logPane : `<section class="dl-detail" aria-label="Kartendetails">${detail(actions)}</section>`}</div>
        ${g.errors.length ? `<p class="dl-hint">Skriptfehler: ${esc(g.errors.at(-1))}</p>` : ''}
      </aside>
      <div class="dl-play">
        ${toolbar}
        <div class="dl-mat" aria-label="Spielfeld">
          <div class="dl-top"><div class="dl-handrow" aria-label="Hand des Bots: ${bot.hand.length} Karten">${bot.hand.map(() => '<i class="dl-back"></i>').join('')}</div>${lp(g.bot, 'Bot')}</div>
          <div class="dl-stage"><div class="dl-board">${board(v, actions)}</div></div>
          <div class="dl-bottom">${lp(g.me, 'Du')}<div class="dl-hand" aria-label="Deine Hand">${me.hand.map((c, i) => `<div class="dl-slot" style="--d:${i - (me.hand.length - 1) / 2}">${cardBtn(c, g.me, L.HAND, i, actions)}</div>`).join('') || '<span class="dl-hint">Hand leer</span>'}</div></div>
        </div>
        ${popupHtml(actions)}
      </div></div>`;
  }

  // ---------- prompts (everything except the open game state) ----------
  const tile = (c, attrs, on) => `<button type="button" class="dl-tile" ${attrs} aria-pressed="${!!on}">`
    + `<span class="dl-card${c.code ? '' : ' down'}">${c.code ? face(c.code) : ''}</span><small>${esc(c.code ? name(c.code) : 'Verdeckt')}<br>${c.controller === g.me ? 'Du' : 'Bot'} · ${PLACE[c.location] ?? ''}</small></button>`;
  const btn = (label, attrs, primary) => `<button type="button" class="${primary ? 'primary-button' : 'secondary-button'}" ${attrs}>${esc(label)}</button>`;
  const tileRow = (tiles) => `<div class="dl-tiles">${tiles}</div><div class="dl-arrows"><button type="button" class="dl-tool" data-scroll="-1" aria-label="Nach links">‹</button><button type="button" class="dl-tool" data-scroll="1" aria-label="Nach rechts">›</button></div>`;
  const effectText = (c) => { const t = table.text(c.description); return t && !t.startsWith('Effekt von') ? `: ${t}` : ''; };

  const sumState = (p) => levelSum(p, picked); // Stufensummen (js/duel-view.js)

  function promptBody(p) {
    const hint = g.hint ? `<p class="dl-hint">${esc(g.hint)}</p>` : '';
    switch (p.type) {
      case M.SELECT_EFFECTYN:
        return [`${name(p.code)}: Effekt aktivieren?`, `<div class="dl-ask">${img(p.code)}<p>${esc(table.text(p.description, p.code, PLACE[p.location]))}</p></div>`,
          btn('Ja', 'data-yes="1"', true) + btn('Nein', 'data-yes="0"')];
      case M.SELECT_YESNO:
        return [table.text(p.description) || 'Bestätigen?', hint, btn('Ja', 'data-yes="1"', true) + btn('Nein', 'data-yes="0"')];
      case M.SELECT_OPTION:
        return ['Option wählen', hint, p.options.map((o, i) => btn(table.text(o) || `Option ${i + 1}`, `data-opt="${i}"`)).join('')];
      case M.SELECT_CHAIN:
        return [p.forced ? 'Effekt aktivieren (Pflicht)' : 'Kette: Effekt aktivieren?', hint,
          p.selects.map((c, i) => btn(`${name(c.code)}${effectText(c)}`, `data-chain="${i}"`, true)).join('')
          + (p.forced ? '' : btn('Nicht aktivieren', 'data-chain="-1"'))];
      case M.SELECT_CARD: case M.SELECT_TRIBUTE: case M.SELECT_SUM: {
        const sum = p.type === M.SELECT_SUM && sumState(p);
        const range = sum ? `Summe ${sum.total} / ${p.select_max ? 'mind. ' : ''}${p.amount & 0xffff}` : p.min === p.max ? `${p.min} Karte(n)` : `${p.min}–${p.max} Karten`;
        const must = (p.selects_must || []).map((c) => tile(c, 'disabled', true)).join('');
        const ok = picked.size > 0 && (sum ? sum.ok : picked.size >= p.min && picked.size <= p.max);
        return [`${PROMPT_TITLE[p.type]} (${range})`, `${hint}${tileRow(must + p.selects.map((c, i) => tile(c, `data-pick="${i}"`, picked.has(i))).join(''))}`,
          btn('Bestätigen', `data-confirm ${ok ? '' : 'disabled'}`, true) + (p.can_cancel ? btn('Abbrechen', 'data-cancel') : '')];
      }
      case M.SELECT_UNSELECT_CARD:
        return [`${PROMPT_TITLE[p.type]} (${p.min}–${p.max})`, `${hint}${tileRow(p.select_cards.map((c, i) => tile(c, `data-unsel="${i}"`, false)).join('')
          + p.unselect_cards.map((c, i) => tile(c, `data-unsel="${p.select_cards.length + i}"`, true)).join(''))}`,
          (p.can_finish ? btn('Fertig', 'data-unsel="-1"', true) : '') + (p.can_cancel && !p.can_finish ? btn('Abbrechen', 'data-unsel="-1"') : '')];
      case M.SELECT_POSITION:
        return [`${name(p.code)}: Position wählen`, img(p.code), bitList(p.positions).map((b) => btn(POSITION[b], `data-pos="${b}"`, true)).join('')];
      case M.ANNOUNCE_NUMBER:
        return ['Zahl ansagen', hint, p.options.map((o, i) => btn(String(o), `data-num="${i}"`)).join('')];
      case M.ANNOUNCE_RACE: case M.ANNOUNCE_ATTRIB: {
        const race = p.type === M.ANNOUNCE_RACE;
        return [`${race ? 'Typ' : 'Eigenschaft'} ansagen (${p.count})`, hint,
          bitList(p.available).map((b) => btn((race ? ocgRaceString.get(b) : ocgAttributeString.get(Number(b))) ?? String(b), `data-bit="${b}" aria-pressed="${picked.has(String(b))}"`)).join('')
          + btn('Bestätigen', `data-confirm ${picked.size === p.count ? '' : 'disabled'}`, true)];
      }
      case M.ANNOUNCE_CARD:
        return ['Kartenname ansagen', `${hint}<input class="dl-announce" list="dlNames" data-announce autocomplete="off" aria-label="Kartenname" />`
          + `<datalist id="dlNames">${[...table.data.keys()].map((c) => `<option value="${esc(name(c))}"></option>`).join('')}</datalist>`,
          btn('Bestätigen', 'data-confirm', true)];
      default:
        return ['Unbekannte Engine-Frage', `<p class="dl-hint">Nachricht ${p.type}</p>`, ''];
    }
  }

  function renderPrompt() {
    const p = g?.prompt;
    if (replay || !p || p.type === M.SELECT_IDLECMD || p.type === M.SELECT_BATTLECMD) { if (promptDlg.open) promptDlg.close(); return; }
    const [title, body, buttons] = promptBody(p);
    const scrolled = promptDlg.querySelector('.dl-tiles')?.scrollLeft ?? 0; // die Kartenreihe springt beim Anklicken nicht an den Anfang
    promptDlg.innerHTML = `<h3 id="dlPromptTitle">${esc(title)}</h3>${body}${g.error ? `<p class="dl-status">${esc(g.error)}</p>` : ''}<div class="dl-actions">${buttons}</div>`;
    if (!promptDlg.open) promptDlg.showModal();
    const row = promptDlg.querySelector('.dl-tiles');
    if (row) row.scrollLeft = scrolled;
  }

  function setupHtml() {
    const options = deckOptions(decks);
    const opp = setup.opp ?? options.find((o) => o.id !== myId)?.id ?? options[0].id;
    const sOpt = (list, cur) => list.map(([id, label]) => `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const mine = (decks[myId]?.main ?? []).map((c) => c.card).sort();
    return `<form class="dl-setup" data-setup>
      <p>Dein Deck: <strong>${esc(decks[myId]?.name ?? '')}</strong> <span class="dl-meta">(oben über „Deck“ wählbar)</span></p>
      <label>Gegner-Deck <select name="opp">${sOpt(options.map((o) => [o.id, o.name]), opp)}</select></label>
      <label>Verhalten des Bots <select name="bot">${sOpt([['aktiv', 'Aktiv: beschwört, setzt Fallen, greift an'], ['passiv', 'Passiv: zieht und passt (reines Combo-Training)']], setup.bot)}</select></label>
      <label>Reihenfolge <select name="first">${sOpt([['1', 'Ich beginne'], ['0', 'Der Bot beginnt']], setup.first)}</select></label>
      <fieldset class="dl-handpick"><legend>Starthand (optional)</legend>
        ${[0, 1, 2, 3, 4].map((i) => `<select name="hand" aria-label="Handkarte ${i + 1}">${sOpt([['', 'Zufällig'], ...mine.map((n) => [n, n])], mine.includes(setup.hand[i]) ? setup.hand[i] : '')}</select>`).join('')}
      </fieldset>
      <label class="dl-check"><input type="checkbox" name="askAll" value="1"${setup.askAll ? ' checked' : ''} /> Bei jeder Gelegenheit nach Ketten fragen</label>
      <button class="primary-button" type="submit">Duell starten</button>
      ${status ? `<p class="dl-status">${esc(status)}</p>` : ''}
      ${savedLines().length ? `<section class="dl-lines" aria-label="Gespeicherte Combos"><h3>Gespeicherte Combos</h3><ul>${savedLines().map((l, i) => `<li><span><strong>${esc(l.name)}</strong><small>${esc(decks[l.deck]?.name ?? l.deck)} · ${Number(l.steps)} Schritte</small></span>
        <button type="button" class="secondary-button" data-line-play="${i}">Abspielen</button><button type="button" class="ghost-button" data-line-del="${i}" aria-label="${esc(l.name)} löschen">Löschen</button></li>`).join('')}</ul></section>` : ''}
      <p class="dl-hint">Regeln wie 2010 (Master Rule 1): Der Startspieler zieht, greift im ersten Zug aber nicht an. Effekte laufen über die EDOPro-Engine mit den offiziellen Kartenskripten. Der aktive Bot spielt nach einfachen Faustregeln (stärkstes Monster bis Stufe 4, Fallen setzen, Angriff mit der kleinsten ATK zuerst) und aktiviert Fallen und Effekte, sobald die Engine sie anbietet.</p>
    </form>`;
  }

  function render() {
    const active = document.activeElement;
    const focusKey = active && main.contains(active) && (active.dataset.key ? `[data-key="${active.dataset.key}"]` : active.dataset.op ? `[data-op="${active.dataset.op}"]` : null);
    if (!g || (menu === 'card' && !sel)) menu = null;
    main.innerHTML = g ? duelHtml() : setupHtml();
    if (focusKey) main.querySelector(focusKey)?.focus();
    renderPrompt();
    placePopup();
  }

  // ---------- answering ----------
  function answer(response, keepRedo = false) {
    answers.push(response);
    if (!keepRedo) redo = [];
    sel = null; menu = null; picked = new Set(); status = '';
    try { g.respond(response); } catch (error) { status = error.message; }
    render();
  }

  function begin(deckId, chosen, seed) {
    const deck = decks[deckId];
    // Fixed opening hand: never more copies than the deck has; the rest is drawn at random.
    const left = new Map(deck.main.map((c) => [c.card, c.count]));
    const hand = (chosen.hand ?? []).filter((n) => left.get(n) > 0 && left.set(n, left.get(n) - 1));
    opts = {
      lib, table, scripts, me: deckCodes(deck), bot: deckCodes(decks[chosen.opp] ?? deck),
      hand: codes(hand), second: chosen.first === '0', askAllChains: !!chosen.askAll, botPlays: chosen.bot !== 'passiv', seed
    };
    duelDeck = deckId; duelSetup = chosen; answers = []; redo = []; sel = null; status = '';
    try { g = newGame(opts); } catch (error) { g = null; status = error.message; }
    openHand = g ? g.view()[g.me].hand.map((c) => name(c.code)) : [];
  }

  function start(form) {
    setup = readSetup(form);
    replay = null;
    begin(myId, setup);
    render();
  }

  // ---------- saved combos: a duel is fully described by its setup, seed and answers ----------
  function saveLine() {
    const name = window.prompt('Name der Combo', `${decks[duelDeck].name}, ${answers.length} Schritte`)?.trim();
    if (!name) return;
    // For the teacher: the plays in order, and the opening-hand cards those plays use.
    const trace = traceOf(g.log);
    const hand = openHand.filter((card) => trace.some((step) => step.endsWith(card)));
    saveSettings({ duelLines: [...savedLines(), { name: name.slice(0, 60), deck: duelDeck, steps: answers.length, hand, trace, data: toJson({ setup: duelSetup, seed: opts.seed, answers }) }] });
    status = 'Combo gespeichert. Du findest sie nach „Duell beenden“ im Startbildschirm.';
    render();
  }

  function playLine(index) {
    const line = savedLines()[index];
    if (!line || !decks[line.deck]) { status = 'Das Deck dieser Combo gibt es nicht mehr.'; render(); return; }
    const data = fromJson(line.data);
    begin(line.deck, data.setup, data.seed);
    replay = g ? { name: line.name, all: data.answers, marks: [] } : null;
    render();
  }

  /** One visible step: answers until the log changes, so silent clicks (zone, pass) do not need a tap each. */
  function replayStep() {
    const before = g.log[0];
    replay.marks.push(answers.length);
    try {
      do { const a = replay.all[answers.length]; answers.push(a); g.respond(a); }
      while (!g.error && g.log[0] === before && answers.length < replay.all.length);
      if (g.error) throw new Error('ungültige Antwort');
    } catch {
      status = 'Die Aufzeichnung passt nicht mehr zum Duell (Deck oder Kartendaten geändert). Ab hier selbst spielen.';
      replay = null;
    }
    sel = null;
    render();
  }

  // Undo = replay the same duel (same seed) with every answer except the last one.
  function undo() {
    if (replay) answers.length = replay.marks.pop() ?? 0; // back one visible step
    else redo.push(answers.pop());
    g.close();
    g = newGame(opts);
    for (const a of answers) g.respond(a);
    sel = null; menu = null; picked = new Set();
    render();
  }

  function openPile(p, field) {
    const v = g.view()[p];
    const loc = { gy: L.GRAVE, banished: L.REMOVED, extra: L.EXTRA }[field];
    const actions = actionsByCard(g.prompt);
    pileDlg.innerHTML = `<h3 id="dlPileTitle">${p === g.me ? 'Du' : 'Bot'}: ${PLACE[loc]} (${v[field].length})</h3>`
      + `<div class="dl-pilegrid">${v[field].map((c, i) => `<div class="dl-slot">${cardBtn(c, p, loc, i, actions)}<small>${esc(name(c.code))}</small></div>`).join('')}</div>`
      + '<form method="dialog"><button class="secondary-button">Schließen</button></form>';
    pileDlg.showModal();
  }

  // Lädt ein Kartenbild nicht, steht an seiner Stelle der Name; `missing` verhindert, dass jedes Neuzeichnen es erneut versucht.
  root.addEventListener('error', (ev) => {
    const el = ev.target;
    if (el.tagName !== 'IMG' || !el.dataset.code) return;
    missing.add(Number(el.dataset.code));
    const label = document.createElement('span');
    label.textContent = el.alt;
    el.replaceWith(label);
  }, true);

  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !menu) return;
    menu = null; render();
    main.querySelector(`[data-key="${sel}"]`)?.focus();
  });

  root.addEventListener('click', (ev) => {
    if (menu && !ev.target.closest('.dl-popup, [data-key], [data-menu]')) { menu = null; render(); } // Klick daneben schließt das Menü
    const el = ev.target.closest('button');
    if (!el || !root.contains(el) || el.disabled) return;
    const d = el.dataset; const p = g?.prompt;
    if (d.scroll) { el.closest('dialog').querySelector('.dl-tiles').scrollBy({ left: Number(d.scroll) * 300, behavior: 'smooth' }); return; }
    if (d.menu) { menu = menu === d.menu ? null : d.menu; sel = null; render(); return; }
    if (d.pphase) { const item = phaseMenu(p, g.phase).find((m) => m.id === d.pphase); if (item?.response) answer(item.response); return; }
    if (d.op === 'inspect') { menu = null; tab = 'card'; render(); return; }
    if (d.op === 'new') { g?.close(); g = null; replay = null; status = ''; render(); return; }
    if (d.op === 'save') { saveLine(); return; }
    if (d.op === 'step') { replayStep(); return; }
    if (d.op === 'takeover') { replay = null; render(); return; }
    if (d.linePlay) { playLine(Number(d.linePlay)); return; }
    if (d.lineDel) { saveSettings({ duelLines: savedLines().filter((_, i) => i !== Number(d.lineDel)) }); render(); return; }
    if (d.op === 'undo') { undo(); return; }
    if (d.op === 'redo') { const a = redo.pop(); if (a) answer(a, true); return; }
    if (d.tab) { tab = d.tab; render(); return; }
    if (d.pile) { const [pl, field] = d.pile.split(':'); openPile(Number(pl), field); return; }
    if (d.key) {
      if (pileDlg.open) pileDlg.close();
      const same = sel === d.key;
      sel = same ? null : d.key; tab = 'card';
      menu = !same && actionsByCard(p).has(d.key) ? 'card' : null; // hat die Karte Aktionen, öffnet sich ihr Menü
      render(); return;
    }
    if (d.phase) { answer(phaseButtons(p)[Number(d.phase)].response); return; }
    if (d.act) { answer(actionsByCard(p).get(sel)[Number(d.act)].response); return; }
    if (!p) return;
    if (d.yes) answer({ type: p.type === M.SELECT_EFFECTYN ? R.SELECT_EFFECTYN : R.SELECT_YESNO, yes: d.yes === '1' });
    else if (d.opt) answer({ type: R.SELECT_OPTION, index: Number(d.opt) });
    else if (d.chain) answer({ type: R.SELECT_CHAIN, index: d.chain === '-1' ? null : Number(d.chain) });
    else if (d.unsel) answer({ type: R.SELECT_UNSELECT_CARD, index: d.unsel === '-1' ? null : Number(d.unsel) });
    else if (d.pos) answer({ type: R.SELECT_POSITION, position: Number(d.pos) });
    else if (d.num) answer({ type: R.ANNOUNCE_NUMBER, value: Number(d.num) });
    else if (d.pick || d.bit) {
      const v = d.pick ? Number(d.pick) : d.bit;
      if (picked.has(v)) picked.delete(v);
      else if (d.bit || p.type === M.SELECT_SUM || picked.size < p.max) picked.add(v);
      renderPrompt();
    } else if ('cancel' in d) answer({ type: p.type === M.SELECT_TRIBUTE ? R.SELECT_TRIBUTE : R.SELECT_CARD, indicies: null });
    else if ('confirm' in d) {
      const list = [...picked].sort((a, b) => a - b);
      if (p.type === M.SELECT_CARD) answer({ type: R.SELECT_CARD, indicies: list });
      else if (p.type === M.SELECT_TRIBUTE) answer({ type: R.SELECT_TRIBUTE, indicies: list });
      else if (p.type === M.SELECT_SUM) answer({ type: R.SELECT_SUM, indicies: list });
      else if (p.type === M.ANNOUNCE_RACE) answer({ type: R.ANNOUNCE_RACE, races: [...picked].map(BigInt) });
      else if (p.type === M.ANNOUNCE_ATTRIB) answer({ type: R.ANNOUNCE_ATTRIB, attributes: [...picked].map(Number) });
      else if (p.type === M.ANNOUNCE_CARD) {
        const typed = promptDlg.querySelector('[data-announce]').value.trim().toLowerCase();
        const code = [...table.data.keys()].find((c) => name(c).toLowerCase() === typed);
        if (code) answer({ type: R.ANNOUNCE_CARD, card: code });
      }
    }
  });

  root.addEventListener('input', (ev) => {
    if (ev.target.closest('[data-setup]')) setup = readSetup(ev.target.form);
  });
  root.addEventListener('submit', (ev) => {
    if (!ev.target.matches('[data-setup]')) return;
    ev.preventDefault();
    start(ev.target);
  });

  return {
    setDeck(id) {
      myId = id;
      if (!g) render(); // a running duel keeps its deck; the new one applies to the next duel
    }
  };
}
