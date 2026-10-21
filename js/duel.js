// Bot Duel: two-sided practice board. You move the cards by hand, the engine (duel-engine.js)
// keeps zones, life points and turns consistent. There is no card-effect engine and the bot is passive.
import * as E from './duel-engine.js';
import { loadDecks, loadCards, deckOptions } from './decks.js';
import { esc } from './util.js';

const HISTORY_MAX = 100;
const STEPS = [['−', -1], ['+', 1]];
const to = (dest, opts) => (g, c) => E.move(g, c.uid, dest, opts);
const ACTION = {
  normal: ['Normal beschwören', (g, c) => E.summon(g, c.uid, 'normal')],
  set: ['Monster setzen', (g, c) => E.summon(g, c.uid, 'set')],
  ssAtk: ['Spezialbeschwören (ATK)', (g, c) => E.summon(g, c.uid, 'ssAtk')],
  ssDef: ['Spezialbeschwören (DEF)', (g, c) => E.summon(g, c.uid, 'ssDef')],
  setST: ['Zauber/Falle setzen', to('st', { down: true })],
  openST: ['Offen legen / aktivieren', to('st')],
  field: ['Als Feldzauber', to('field')],
  gy: ['In den Friedhof', to('gy')],
  ban: ['Verbannen', to('banished')],
  hand: ['Auf die Hand', to('hand')],
  deckTop: ['Oben ins Deck', to('deck')],
  deckBot: ['Unten ins Deck', to('deckBottom')],
  pos: ['Position wechseln', (g, c) => E.togglePos(g, c.uid)],
  flip: ['Aufdecken', (g, c) => E.flip(g, c.uid)],
  control: ['Kontrolle übernehmen', to('mz', { side: 'me' })]
};
const FROM_PILE = ['hand', 'ssAtk', 'ssDef', 'openST', 'setST', 'field', 'gy', 'ban'];

function actionIds(c, loc, g) {
  if (loc.who === 'bot') return [c.down && 'flip', loc.zone === 'mz' && 'control', 'gy', 'ban', 'hand'].filter(Boolean);
  if (loc.zone === 'hand') return ['normal', 'set', 'ssAtk', 'ssDef', 'setST', 'openST', 'field', 'gy', 'ban', 'deckTop', 'deckBot'];
  if (loc.zone === 'mz') {
    const canAttack = g.phase === 'BP' && !c.down && c.pos === 'atk';
    return [canAttack && 'attack', c.down ? 'flip' : 'pos', 'gy', 'ban', 'hand', 'deckTop'].filter(Boolean);
  }
  if (loc.zone === 'st') return [c.down && 'flip', 'gy', 'ban', 'hand', 'deckTop'].filter(Boolean);
  if (loc.zone === 'field') return ['gy', 'ban', 'hand'];
  const zoneAction = { gy: 'gy', banished: 'ban' }[loc.zone];
  return FROM_PILE.filter((id) => id !== zoneAction);
}

export async function initDuel(root) {
  const [decks, cardDb, presets] = await Promise.all([
    loadDecks(), loadCards(), fetch('./data/bot-presets.json').then((r) => r.json())
  ]);
  const byName = new Map((cardDb?.cards ?? []).map((c) => [c.name.toLowerCase(), c]));
  const info = (name) => byName.get(name.toLowerCase());
  const stats = (name) => ({ atk: info(name)?.atk ?? 0, def: info(name)?.def ?? 0 });

  root.innerHTML = '<div class="dl-main"></div><dialog class="dl-dialog" aria-labelledby="dlDialogTitle"></dialog>';
  const main = root.querySelector('.dl-main');
  const dialog = root.querySelector('dialog');

  let myId; let g = null; let sel = null; let attacker = null; let history = [];
  let status = ''; let amount = 1000; let setup = { opp: null, preset: 'backrow', second: '1' };

  const uidOf = (n) => Number(n);
  const selected = () => (sel && g && E.locate(g, sel) ? { c: E.cardOf(g, sel), loc: E.locate(g, sel) } : null);

  function act(fn) {
    const snapshot = structuredClone(g);
    try {
      fn(g);
      history.push(snapshot);
      if (history.length > HISTORY_MAX) history.shift();
      status = '';
    } catch (error) {
      g = snapshot; // the engine may have half-applied the move
      status = error.message;
    }
    attacker = null;
    render();
  }

  const hiddenFromMe = (c, who) => c.down && who === 'bot';

  function cardBtn(c, who, extraClass = '') {
    const hide = hiddenFromMe(c, who);
    const i = hide ? null : info(c.name);
    const label = hide ? 'Verdeckte Karte des Bots' : `${c.name}${c.down ? ' (verdeckt)' : ''}${c.pos === 'def' && !c.down ? ' (DEF)' : ''}`;
    const cls = ['dl-card', c.down && 'down', c.pos === 'def' && !c.down && 'def', c.uid === sel && 'sel', attacker && who === 'bot' && 'target', extraClass]
      .filter(Boolean).join(' ');
    const face = hide ? '' : i?.img
      ? `<img src="assets/cards-small/${Number(i.id)}.jpg" alt="" loading="lazy" />`
      : `<span>${esc(c.name)}</span>`;
    return `<button type="button" class="${cls}" data-uid="${c.uid}" aria-label="${esc(label)}" aria-pressed="${c.uid === sel}">${face}</button>`;
  }

  const zoneRow = (cards, who, kind) => `<div class="dl-zones">${cards.map((c, i) => (
    c ? `<div class="dl-slot">${cardBtn(c, who)}</div>` : `<div class="dl-slot empty" aria-hidden="true">${kind}${i + 1}</div>`
  )).join('')}</div>`;

  function piles(who) {
    const p = g.players[who];
    const pile = (key, label, n) => `<button type="button" class="dl-pile" data-pile="${who}:${key}" ${n ? '' : 'disabled'}><b>${n}</b>${label}</button>`;
    const fieldCard = p.field ? `<div class="dl-slot">${cardBtn(p.field, who)}</div>` : '<div class="dl-slot empty" aria-hidden="true">Feld</div>';
    return `<div class="dl-piles">${fieldCard}${pile('gy', 'Friedhof', p.gy.length)}${pile('banished', 'Verbannt', p.banished.length)}`
      + `${who === 'me' ? pile('deck', 'Deck', p.deck.length) : `<div class="dl-pile static"><b>${p.deck.length}</b>Deck</div>`}`
      + `${who === 'me' ? pile('extra', 'Extra', p.extra.length) : `<div class="dl-pile static"><b>${p.extra.length}</b>Extra</div>`}</div>`;
  }

  const lpBlock = (who) => {
    const lp = g.players[who].lp;
    return `<div class="dl-lp ${who}"><div class="dl-lp-top"><strong>${E.NAME[who]}</strong><span>${lp}</span></div>`
      + `<div class="dl-bar"><i style="width:${Math.min(100, lp / 80)}%"></i></div>`
      + `<div class="dl-lp-btns">${STEPS.map(([s, k]) => `<button type="button" class="secondary-button" data-lp="${who}:${k}" aria-label="${E.NAME[who]} ${k < 0 ? 'verliert' : 'erhält'} LP">${s}</button>`).join('')}</div></div>`;
  };

  function detail() {
    const s = selected();
    if (!s) return '<p class="dl-hint">Karte antippen, um Details und Aktionen zu sehen.</p>';
    const { c, loc } = s;
    if (hiddenFromMe(c, loc.who)) {
      return `<h3>Verdeckte Karte (Bot)</h3><div class="dl-actions">${actionButtons(c, loc)}</div>`;
    }
    const i = info(c.name);
    const img = i?.img ? `<img class="dl-detail-img" src="assets/cards-small/${Number(i.id)}.jpg" alt="" width="84" height="123" />` : '';
    const meta = i ? [i.type, i.attribute, i.race, i.level != null ? `Stufe ${i.level}` : null,
      i.atk != null ? `ATK ${i.atk} / DEF ${i.def ?? '–'}` : null].filter(Boolean).join(' · ') : 'Kein Eintrag in der Kartendatenbank';
    return `<div class="dl-detail-head">${img}<div><h3>${esc(c.name)}</h3><p class="dl-meta">${esc(meta)}</p>`
      + `<p class="dl-meta">${E.NAME[loc.who]} · ${E.PLACE[loc.zone]}</p></div></div>`
      + `${i?.desc ? `<p class="dl-desc">${esc(i.desc)}</p>` : ''}<div class="dl-actions">${actionButtons(c, loc)}</div>`;
  }

  function actionButtons(c, loc) {
    return actionIds(c, loc, g).map((id) => (id === 'attack'
      ? '<button type="button" class="primary-button" data-act="attack">Angreifen …</button>'
      : `<button type="button" class="secondary-button" data-act="${id}">${ACTION[id][0]}</button>`)).join('');
  }

  function setupHtml() {
    const opts = deckOptions(decks);
    const opp = setup.opp ?? opts.find((o) => o.id !== myId)?.id ?? opts[0].id;
    const sOpt = (list, cur) => list.map(([id, name]) => `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(name)}</option>`).join('');
    return `<form class="dl-setup" data-setup>
      <p>Dein Deck: <strong>${esc(decks[myId]?.name ?? '')}</strong> <span class="dl-meta">(oben über „Deck“ wählbar)</span></p>
      <label>Gegner-Deck <select name="opp">${sOpt(opts.map((o) => [o.id, o.name]), opp)}</select></label>
      <label>Board des Bots <select name="preset">${sOpt(Object.entries(presets).map(([id, p]) => [id, p.name]), setup.preset)}</select></label>
      <label>Reihenfolge <select name="second">${sOpt([['1', 'Ich bin zweiter (Draw und Angriff erlaubt)'], ['0', 'Ich bin erster (kein Draw, kein Angriff)']], setup.second)}</select></label>
      <button class="primary-button" type="submit">Duell starten</button>
      ${cardDb ? '' : '<p class="dl-hint">Ohne Kartendatenbank („Karten laden“-Workflow) gibt es keine Bilder, und der Kampfschaden rechnet mit ATK/DEF 0.</p>'}
    </form>`;
  }

  function duelHtml() {
    const me = g.players.me; const bot = g.players.bot;
    const phases = E.PHASES.map((p) => `<button type="button" class="secondary-button" data-phase="${p}" aria-pressed="${g.phase === p}">${p}</button>`).join('');
    const banner = g.winner ? `<div class="dl-win" role="status">${g.winner === 'me' ? 'Du gewinnst!' : 'Der Bot gewinnt.'} <button type="button" class="primary-button" data-act="new">Neues Duell</button></div>` : '';
    return `${banner}<div class="dl-wrap">
      <div class="dl-mat" aria-label="Spielfeld">
        <div class="dl-half bot"><div class="dl-handrow" aria-label="Hand des Bots: ${bot.hand.length} Karten">${bot.hand.map(() => '<i class="dl-back"></i>').join('')}</div>
          ${piles('bot')}${zoneRow(bot.st, 'bot', 'S/T')}${zoneRow(bot.mz, 'bot', 'M')}</div>
        <div class="dl-mid"><span>Zug ${g.turn} · ${g.active === 'me' ? 'Du' : 'Bot'}</span><div class="dl-phases">${phases}</div></div>
        <div class="dl-half me">${zoneRow(me.mz, 'me', 'M')}${zoneRow(me.st, 'me', 'S/T')}${piles('me')}
          <div class="dl-hand" aria-label="Deine Hand">${me.hand.map((c) => `<div class="dl-slot">${cardBtn(c, 'me')}</div>`).join('') || '<span class="dl-hint">Hand leer</span>'}</div></div>
      </div>
      <aside class="dl-side">
        <div class="dl-lps">${lpBlock('me')}${lpBlock('bot')}</div>
        <label class="dl-amt">Betrag <input type="number" min="1" step="100" value="${amount}" data-amount inputmode="numeric" /></label>
        <div class="dl-bar-btns">
          <button type="button" class="secondary-button" data-act="draw">Ziehen</button>
          <button type="button" class="secondary-button" data-act="shuffle">Mischen</button>
          <button type="button" class="secondary-button" data-act="undo" ${history.length ? '' : 'disabled'}>Rückgängig</button>
          <button type="button" class="primary-button" data-act="end">Zug beenden</button>
          ${attacker ? '<button type="button" class="secondary-button" data-act="direct">Direkt angreifen</button><button type="button" class="ghost-button" data-act="cancel">Abbrechen</button>' : ''}
        </div>
        <p class="dl-status" role="status">${esc(attacker ? 'Wähle ein Ziel oder „Direkt angreifen“.' : status)}</p>
        <section class="dl-detail" aria-label="Kartendetails">${detail()}</section>
        <ol class="dl-log" aria-label="Verlauf">${g.log.slice(0, 12).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        <button type="button" class="ghost-button" data-act="new">Duell beenden</button>
      </aside></div>`;
  }

  function render() {
    const active = document.activeElement;
    const key = active && root.contains(active) ? (active.dataset.uid && `[data-uid="${active.dataset.uid}"]`)
      || (active.dataset.act && `[data-act="${active.dataset.act}"]`) || (active.dataset.phase && `[data-phase="${active.dataset.phase}"]`) : null;
    main.innerHTML = g ? duelHtml() : setupHtml();
    if (key) main.querySelector(key)?.focus();
  }

  function openPile(who, key) {
    const list = [...g.players[who][key]].sort((a, b) => a.name.localeCompare(b.name));
    const title = `${E.NAME[who]}: ${E.PLACE[key]} (${list.length})`;
    dialog.innerHTML = `<form method="dialog"><h3 id="dlDialogTitle">${esc(title)}</h3>`
      + `<div class="dl-pilegrid">${list.map((c) => `<div class="dl-slot">${cardBtn(c, who)}<small>${esc(c.name)}</small></div>`).join('')}</div>`
      + '<button class="secondary-button" value="close">Schließen</button></form>';
    dialog.showModal();
  }

  const OPS = {
    new: () => { g = null; sel = null; history = []; status = ''; render(); },
    undo: () => { g = history.pop(); render(); },
    cancel: () => { attacker = null; render(); },
    draw: () => act((x) => E.draw(x, 'me')),
    shuffle: () => act((x) => E.shuffleDeck(x, 'me')),
    end: () => act((x) => E.endTurn(x)),
    attack: () => { attacker = sel; render(); },
    direct: () => act((x) => E.attack(x, attacker, null, stats))
  };

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-uid],[data-act],[data-phase],[data-lp],[data-pile]');
    if (!el || !root.contains(el)) return;
    if (el.dataset.pile) { const [who, key] = el.dataset.pile.split(':'); openPile(who, key); return; }
    if (el.dataset.phase) return act((x) => E.setPhase(x, el.dataset.phase));
    if (el.dataset.lp) {
      const [who, k] = el.dataset.lp.split(':');
      return act((x) => E.changeLp(x, who, Number(k) * amount));
    }
    if (el.dataset.uid) {
      const uid = uidOf(el.dataset.uid);
      dialog.close();
      const loc = E.locate(g, uid);
      if (attacker && loc?.who === 'bot' && loc.zone === 'mz') { const a = attacker; return act((x) => E.attack(x, a, uid, stats)); }
      sel = uid; attacker = null; status = '';
      return render();
    }
    const id = el.dataset.act;
    if (OPS[id]) return OPS[id]();
    const s = selected();
    if (s && ACTION[id]) act((x) => ACTION[id][1](x, E.cardOf(x, s.c.uid)));
  });

  root.addEventListener('input', (ev) => {
    if (ev.target.matches('[data-amount]')) amount = Math.max(1, Math.min(99999, Math.floor(Number(ev.target.value)) || 1));
    if (ev.target.closest('[data-setup]')) setup = { ...setup, ...Object.fromEntries(new FormData(ev.target.form)) };
  });

  root.addEventListener('submit', (ev) => {
    if (!ev.target.matches('[data-setup]')) return;
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    setup = f;
    g = E.newDuel({ me: decks[myId], bot: decks[f.opp] ?? decks[myId], preset: presets[f.preset], second: f.second === '1' });
    sel = null; history = []; status = '';
    render();
  });

  return {
    setDeck(id) {
      myId = id;
      if (!g) render(); // a running duel keeps its deck; the new one applies to the next duel
    }
  };
}
