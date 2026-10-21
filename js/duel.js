// Bot Duel: practice duel against a passive bot on the real rules engine (duel-core.js, ygopro-core).
// The engine decides what is legal and asks the questions (activate? which cards? which position?);
// this module only draws the board and turns clicks into engine responses, like Dueling Nexus.
import { loadCore, cardTable, newGame, L, P, M, R, IDLE, BATTLE, PLACE, PHASE } from './duel-core.js';
import { loadDecks, loadCards, deckOptions } from './decks.js';
import { ocgRaceString, ocgAttributeString } from '../vendor/ocgcore/index.js';
import { esc } from './util.js';

const getJson = (file) => fetch(`./data/${file}`).then((r) => {
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.json();
});
const POSITION = { 1: 'Offene Angriffsposition', 2: 'Verdeckte Angriffsposition', 4: 'Offene Verteidigungsposition', 8: 'Verdeckte Verteidigungsposition' };
const PROMPT_TITLE = { [M.SELECT_CARD]: 'Karten wählen', [M.SELECT_TRIBUTE]: 'Als Tribut wählen', [M.SELECT_SUM]: 'Karten wählen', [M.SELECT_UNSELECT_CARD]: 'Karten wählen' };
const key = (c) => `${c.controller}:${c.location}:${c.sequence}`;
const bitList = (mask) => { const out = []; for (let b = 1n; b <= BigInt(mask); b <<= 1n) if (BigInt(mask) & b) out.push(b); return out; };

export async function initDuel(root) {
  root.innerHTML = '<p class="dl-hint">Lade Duell-Engine …</p>';
  const [decks, cardDb, presets, coreCards, { scripts }, lib] = await Promise.all([
    loadDecks(), loadCards(), getJson('bot-presets.json'), getJson('core-cards.json'), getJson('core-scripts.json'), loadCore()
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
  let setup = { opp: null, preset: 'backrow', first: '1', askAll: '' };

  const name = (code) => table.name(code);
  const img = (code) => (byId.get(code)?.img ? `<img src="assets/cards-small/${Number(code)}.jpg" alt="" loading="lazy" />` : '');
  const face = (code) => img(code) || `<span>${esc(name(code))}</span>`;

  /** Actions the engine offers in an open game state, grouped by card. */
  function actionsByCard(p) {
    const map = new Map();
    const push = (c, label, response) => { if (!map.has(key(c))) map.set(key(c), []); map.get(key(c)).push({ label, response }); };
    const effect = (c) => { const t = table.text(c.description); return t && !t.startsWith('Effekt von') ? `Aktivieren: ${t}` : 'Aktivieren'; };
    if (p?.type === M.SELECT_IDLECMD) {
      [['summons', IDLE.SELECT_SUMMON, 'Normalbeschwören'], ['special_summons', IDLE.SELECT_SPECIAL_SUMMON, 'Spezialbeschwören'],
        ['pos_changes', IDLE.SELECT_POS_CHANGE, 'Position ändern'], ['monster_sets', IDLE.SELECT_MONSTER_SET, 'Monster setzen'],
        ['spell_sets', IDLE.SELECT_SPELL_SET, 'Setzen'], ['activates', IDLE.SELECT_ACTIVATE, null]]
        .forEach(([field, action, label]) => p[field].forEach((c, index) => push(c, label ?? effect(c), { type: R.SELECT_IDLECMD, action, index })));
    }
    if (p?.type === M.SELECT_BATTLECMD) {
      p.attacks.forEach((c, index) => push(c, 'Angreifen', { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index }));
      p.chains.forEach((c, index) => push(c, effect(c), { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_CHAIN, index }));
    }
    return map;
  }

  function phaseButtons(p) {
    const b = (label, response, primary) => ({ label, response, primary });
    if (p?.type === M.SELECT_IDLECMD) return [p.to_bp && b('Battle Phase', { type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null }), p.to_ep && b('Zug beenden', { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null }, true)].filter(Boolean);
    if (p?.type === M.SELECT_BATTLECMD) return [p.to_m2 && b('Main Phase 2', { type: R.SELECT_BATTLECMD, action: BATTLE.TO_M2, index: null }), p.to_ep && b('Zug beenden', { type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null }, true)].filter(Boolean);
    return [];
  }

  // ---------- board ----------
  function cardBtn(c, p, loc, i, actions) {
    const k = `${p}:${loc}:${i}`;
    const down = c.position & P.FACEDOWN;
    const hidden = p === g.bot && (loc === L.HAND || down);
    const cls = ['dl-card', down && 'down', c.position & P.DEFENSE && loc === L.MZONE && 'def', down && !hidden && 'peek',
      actions.has(k) && 'can', sel === k && 'sel'].filter(Boolean).join(' ');
    const stat = loc === L.MZONE && !down ? `<b class="dl-stat">${c.attack}/${c.defense}</b>` : '';
    const label = hidden ? 'Verdeckte Karte des Bots' : `${name(c.code)}${down ? ' (verdeckt)' : ''}`;
    return `<button type="button" class="${cls}" data-key="${k}" aria-label="${esc(label)}" aria-pressed="${sel === k}">${hidden ? '' : face(c.code)}${stat}</button>`;
  }
  const zones = (list, p, loc, label, actions) => `<div class="dl-zones">${list.map((c, i) => (c
    ? `<div class="dl-slot">${cardBtn(c, p, loc, i, actions)}</div>` : `<div class="dl-slot empty" aria-hidden="true">${label}${i + 1}</div>`)).join('')}</div>`;

  function piles(v, p, actions) {
    const can = (loc) => ([...actions.keys()].some((k) => k.startsWith(`${p}:${loc}:`)) ? ' can' : '');
    const pile = (loc, field, label) => `<button type="button" class="dl-pile${can(loc)}" data-pile="${p}:${field}" ${v[field].length ? '' : 'disabled'}><b>${v[field].length}</b>${label}</button>`;
    const field = v.field ? `<div class="dl-slot">${cardBtn(v.field, p, L.SZONE, 5, actions)}</div>` : '<div class="dl-slot empty" aria-hidden="true">Feld</div>';
    const extra = p === g.me ? pile(L.EXTRA, 'extra', 'Extra') : `<div class="dl-pile static"><b>${v.extra.length}</b>Extra</div>`;
    return `<div class="dl-piles">${field}${pile(L.GRAVE, 'gy', 'Friedhof')}${pile(L.REMOVED, 'banished', 'Verbannt')}<div class="dl-pile static"><b>${v.deck}</b>Deck</div>${extra}</div>`;
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
    const acts = (actions.get(sel) || []).map((a, i) => `<button type="button" class="primary-button" data-act="${i}">${esc(a.label)}</button>`).join('');
    return `<div class="dl-detail-head">${img(s.c.code)}<div><h3>${esc(name(s.c.code))}</h3><p class="dl-meta">${esc(meta)}</p>`
      + `<p class="dl-meta">${s.p === g.me ? 'Du' : 'Bot'} · ${PLACE[s.loc]}</p></div></div>`
      + `${info?.desc ? `<p class="dl-desc">${esc(info.desc)}</p>` : ''}${acts ? `<div class="dl-actions">${acts}</div>` : ''}`;
  }

  function duelHtml() {
    const v = g.view(); const me = v[g.me]; const bot = v[g.bot];
    const actions = actionsByCard(g.prompt);
    const lp = (p, label) => `<div class="dl-lp ${p === g.me ? 'me' : 'bot'}"><div class="dl-lp-top"><strong>${label}</strong><span>${g.lp[p]}</span></div><div class="dl-bar"><i style="width:${Math.min(100, g.lp[p] / 80)}%"></i></div></div>`;
    const phases = phaseButtons(g.prompt).map((b, i) => `<button type="button" class="${b.primary ? 'primary-button' : 'secondary-button'}" data-phase="${i}">${b.label}</button>`).join('');
    const banner = g.winner !== null ? `<div class="dl-win" role="status">${g.winner === g.me ? 'Du gewinnst!' : g.winner === g.bot ? 'Der Bot gewinnt.' : 'Unentschieden.'} <button type="button" class="primary-button" data-op="new">Neues Duell</button></div>` : '';
    const waiting = g.winner === null && !g.prompt ? 'Engine wartet …' : '';
    return `${banner}<div class="dl-wrap">
      <div class="dl-mat" aria-label="Spielfeld">
        <div class="dl-half bot"><div class="dl-handrow" aria-label="Hand des Bots: ${bot.hand.length} Karten">${bot.hand.map(() => '<i class="dl-back"></i>').join('')}</div>
          ${piles(bot, g.bot, actions)}${zones(bot.st, g.bot, L.SZONE, 'S/T', actions)}${zones(bot.mz, g.bot, L.MZONE, 'M', actions)}</div>
        <div class="dl-mid"><span>Zug ${g.turn} · ${g.active === g.me ? 'Du' : 'Bot'} · ${PHASE[g.phase] ?? ''}</span></div>
        <div class="dl-half me">${zones(me.mz, g.me, L.MZONE, 'M', actions)}${zones(me.st, g.me, L.SZONE, 'S/T', actions)}${piles(me, g.me, actions)}
          <div class="dl-hand" aria-label="Deine Hand">${me.hand.map((c, i) => `<div class="dl-slot">${cardBtn(c, g.me, L.HAND, i, actions)}</div>`).join('') || '<span class="dl-hint">Hand leer</span>'}</div></div>
      </div>
      <aside class="dl-side">
        <div class="dl-lps">${lp(g.me, 'Du')}${lp(g.bot, 'Bot')}</div>
        <div class="dl-bar-btns">${phases}<button type="button" class="secondary-button" data-op="undo" ${answers.length ? '' : 'disabled'}>Rückgängig</button></div>
        <p class="dl-status" role="status">${esc(status || g.error || waiting)}</p>
        <section class="dl-detail" aria-label="Kartendetails">${detail(actions)}</section>
        ${g.errors.length ? `<p class="dl-hint">Skriptfehler: ${esc(g.errors.at(-1))}</p>` : ''}
        <ol class="dl-log" aria-label="Verlauf">${g.log.slice(0, 30).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        <button type="button" class="ghost-button" data-op="new">Duell beenden</button>
      </aside></div>`;
  }

  // ---------- prompts (everything except the open game state) ----------
  const tile = (c, attrs, on) => `<button type="button" class="dl-tile" ${attrs} aria-pressed="${!!on}">`
    + `<span class="dl-card${c.code ? '' : ' down'}">${c.code ? face(c.code) : ''}</span><small>${esc(c.code ? name(c.code) : 'Verdeckt')}<br>${c.controller === g.me ? 'Du' : 'Bot'} · ${PLACE[c.location] ?? ''}</small></button>`;
  const btn = (label, attrs, primary) => `<button type="button" class="${primary ? 'primary-button' : 'secondary-button'}" ${attrs}>${esc(label)}</button>`;
  const effectText = (c) => { const t = table.text(c.description); return t && !t.startsWith('Effekt von') ? `: ${t}` : ''; };

  // Level sums (e.g. Machina Fortress): exactly the target, or (select_max = 1) at least the target
  // with every picked card needed. Uses the card's first value; amount >>> 16 is an alternative level.
  function sumState(p) {
    const lvl = (c) => c.amount & 0xffff;
    const target = p.amount & 0xffff;
    const parts = [...picked].map((i) => lvl(p.selects[i]));
    const total = p.selects_must.reduce((t, c) => t + lvl(c), 0) + parts.reduce((t, n) => t + n, 0);
    const ok = p.select_max ? total >= target && parts.every((n) => total - n < target) : total === target;
    return { total, ok };
  }

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
        return [`${PROMPT_TITLE[p.type]} (${range})`, `${hint}<div class="dl-tiles">${must}${p.selects.map((c, i) => tile(c, `data-pick="${i}"`, picked.has(i))).join('')}</div>`,
          btn('Bestätigen', `data-confirm ${ok ? '' : 'disabled'}`, true) + (p.can_cancel ? btn('Abbrechen', 'data-cancel') : '')];
      }
      case M.SELECT_UNSELECT_CARD:
        return [`${PROMPT_TITLE[p.type]} (${p.min}–${p.max})`, `${hint}<div class="dl-tiles">${p.select_cards.map((c, i) => tile(c, `data-unsel="${i}"`, false)).join('')}`
          + `${p.unselect_cards.map((c, i) => tile(c, `data-unsel="${p.select_cards.length + i}"`, true)).join('')}</div>`,
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
    if (!p || p.type === M.SELECT_IDLECMD || p.type === M.SELECT_BATTLECMD) { if (promptDlg.open) promptDlg.close(); return; }
    const [title, body, buttons] = promptBody(p);
    promptDlg.innerHTML = `<h3 id="dlPromptTitle">${esc(title)}</h3>${body}${g.error ? `<p class="dl-status">${esc(g.error)}</p>` : ''}<div class="dl-actions">${buttons}</div>`;
    if (!promptDlg.open) promptDlg.showModal();
  }

  function setupHtml() {
    const options = deckOptions(decks);
    const opp = setup.opp ?? options.find((o) => o.id !== myId)?.id ?? options[0].id;
    const sOpt = (list, cur) => list.map(([id, label]) => `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(label)}</option>`).join('');
    return `<form class="dl-setup" data-setup>
      <p>Dein Deck: <strong>${esc(decks[myId]?.name ?? '')}</strong> <span class="dl-meta">(oben über „Deck“ wählbar)</span></p>
      <label>Gegner-Deck <select name="opp">${sOpt(options.map((o) => [o.id, o.name]), opp)}</select></label>
      <label>Board des Bots <select name="preset">${sOpt(Object.entries(presets).map(([id, p]) => [id, p.name]), setup.preset)}</select></label>
      <label>Reihenfolge <select name="first">${sOpt([['1', 'Ich beginne'], ['0', 'Der Bot beginnt']], setup.first)}</select></label>
      <label class="dl-check"><input type="checkbox" name="askAll" value="1"${setup.askAll ? ' checked' : ''} /> Bei jeder Gelegenheit nach Ketten fragen</label>
      <button class="primary-button" type="submit">Duell starten</button>
      ${status ? `<p class="dl-status">${esc(status)}</p>` : ''}
      <p class="dl-hint">Regeln wie 2010 (Master Rule 1): Der Startspieler zieht, greift im ersten Zug aber nicht an. Effekte laufen über die EDOPro-Engine mit den offiziellen Kartenskripten. Der Bot spielt nicht selbst, aktiviert aber gesetzte Fallen und Effekte, sobald die Engine sie anbietet.</p>
    </form>`;
  }

  function render() {
    const active = document.activeElement;
    const focusKey = active && main.contains(active) && (active.dataset.key ? `[data-key="${active.dataset.key}"]` : active.dataset.op ? `[data-op="${active.dataset.op}"]` : null);
    main.innerHTML = g ? duelHtml() : setupHtml();
    if (focusKey) main.querySelector(focusKey)?.focus();
    renderPrompt();
  }

  // ---------- answering ----------
  function answer(response) {
    answers.push(response);
    sel = null; picked = new Set(); status = '';
    try { g.respond(response); } catch (error) { status = error.message; }
    render();
  }

  function start(form) {
    setup = { askAll: '', ...Object.fromEntries(new FormData(form)) };
    const preset = presets[setup.preset] ?? {};
    opts = {
      lib, table, scripts, me: deckCodes(decks[myId]), bot: deckCodes(decks[setup.opp] ?? decks[myId]),
      preset: { monsters: codes(preset.monsters || []), spellTraps: codes(preset.spellTraps || []) },
      second: setup.first === '0', askAllChains: !!setup.askAll
    };
    answers = []; sel = null; status = '';
    try { g = newGame(opts); } catch (error) { g = null; status = error.message; }
    render();
  }

  // Undo = replay the same duel (same seed) with every answer except the last one.
  function undo() {
    answers.pop();
    g.close();
    g = newGame(opts);
    for (const a of answers) g.respond(a);
    sel = null; picked = new Set();
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

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('button');
    if (!el || !root.contains(el) || el.disabled) return;
    const d = el.dataset; const p = g?.prompt;
    if (d.op === 'new') { g?.close(); g = null; render(); return; }
    if (d.op === 'undo') { undo(); return; }
    if (d.pile) { const [pl, field] = d.pile.split(':'); openPile(Number(pl), field); return; }
    if (d.key) { if (pileDlg.open) pileDlg.close(); sel = sel === d.key ? null : d.key; render(); return; }
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
    if (ev.target.closest('[data-setup]')) setup = { askAll: '', ...Object.fromEntries(new FormData(ev.target.form)) };
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
