#!/usr/bin/env node
// Local bridge for other front ends (Godot): runs the Bot Duel core (js/duel-core.js) and speaks JSON.
//
//   node --no-warnings scripts/duel-server.mjs [port]      (default 8131, bound to 127.0.0.1 only)
//
//   GET  /decks                 -> [{ id, name }]
//   GET  /card?name=Swap%20Frog -> { name, type, desc, atk, def, level, attribute, race }
//   POST /new    { deck, opp, hand: [names], first: true, bot: "aktiv"|"passiv", askAll: false }
//   POST /answer { choice: id } | { pick: [ids] } | { name: "Card Name" }
//   POST /undo
//   GET  /state
// Every duel call answers with the state: { turn, active, phase, lp, winner, field, prompt, events, log, review }.
// prompt.choices carry an id; a front end never builds engine responses itself.
// ponytail: one duel at a time and no persistence; the labels mirror js/duel.js (the DOM front end).

import fs from 'node:fs';
import http from 'node:http';
import { loadCore, cardTable, newGame, L, P, M, R, IDLE, BATTLE, PLACE, PHASE, ZONE } from '../js/duel-core.js';

const MAX_BODY = 64 * 1024;
const json = (file) => JSON.parse(fs.readFileSync(new URL(`../data/${file}`, import.meta.url)));
const decks = json('decks.json');
const cardDb = json('cards.json').cards;
const byName = new Map(cardDb.map((c) => [c.name, c]));
const table = cardTable(json('core-cards.json'));
const { scripts } = json('core-scripts.json');
const lib = await loadCore();

const codes = (names) => names.map((n) => byName.get(n)?.id).filter((code) => table.data.has(code));
const deckCodes = (deck) => ({
  main: codes(deck.main.flatMap((c) => Array(c.count).fill(c.card))),
  extra: codes((deck.extra || []).flatMap((c) => Array(c.count).fill(c.card)))
});
const POSITION = { 1: 'Offene Angriffsposition', 2: 'Verdeckte Angriffsposition', 4: 'Offene Verteidigungsposition', 8: 'Verdeckte Verteidigungsposition' };
const bitList = (mask) => { const out = []; for (let b = 1n; b <= BigInt(mask); b <<= 1n) if (BigInt(mask) & b) out.push(b); return out; };

let s = null; // { g, opts, answers, sent (events already delivered), pending (current prompt) }

const side = (p) => (p === s.g.me ? 'me' : 'bot');
const ref = (c) => ({ side: side(c.controller), zone: c.location === L.SZONE && c.sequence === 5 ? 'field' : ZONE[c.location] ?? 'other', index: c.sequence, name: table.name(c.code) });
const effect = (c) => { const t = table.text(c.description); return t && !t.startsWith('Effekt von') ? `Aktivieren: ${t}` : 'Aktivieren'; };

/** Engine prompt -> { title, hint, multi, min, max, text, choices: [{ id, label, card? }] } plus how to answer it. */
function describe(p) {
  const { g } = s;
  const choices = []; const responses = [];
  const add = (label, response, card) => { choices.push({ id: choices.length, label, ...(card ? { card: ref(card) } : {}) }); responses.push(response); };
  const out = { title: '', hint: g.hint, multi: false, choices };
  const single = () => ({ ...out, answer: (body) => responses[body.choice] });
  const many = (type, key) => ({ ...out, multi: true, answer: (body) => (Array.isArray(body.pick) && body.pick.every((i) => Number.isInteger(i) && responses[i] !== undefined)
    ? { type, [key]: [...new Set(body.pick)].sort((a, b) => a - b).map((i) => responses[i]) } : undefined) });
  switch (p.type) {
    case M.SELECT_IDLECMD:
      out.title = 'Dein Zug';
      [['summons', IDLE.SELECT_SUMMON, 'Normalbeschwören'], ['special_summons', IDLE.SELECT_SPECIAL_SUMMON, 'Spezialbeschwören'],
        ['pos_changes', IDLE.SELECT_POS_CHANGE, 'Position ändern'], ['monster_sets', IDLE.SELECT_MONSTER_SET, 'Monster setzen'],
        ['spell_sets', IDLE.SELECT_SPELL_SET, 'Setzen'], ['activates', IDLE.SELECT_ACTIVATE, null]]
        .forEach(([field, action, label]) => p[field].forEach((c, index) => add(label ?? effect(c), { type: R.SELECT_IDLECMD, action, index }, c)));
      if (p.to_bp) add('Battle Phase', { type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null });
      if (p.to_ep) add('Zug beenden', { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
      return single();
    case M.SELECT_BATTLECMD:
      out.title = 'Battle Phase';
      p.attacks.forEach((c, index) => add('Angreifen', { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index }, c));
      p.chains.forEach((c, index) => add(effect(c), { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_CHAIN, index }, c));
      if (p.to_m2) add('Main Phase 2', { type: R.SELECT_BATTLECMD, action: BATTLE.TO_M2, index: null });
      if (p.to_ep) add('Zug beenden', { type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null });
      return single();
    case M.SELECT_EFFECTYN: case M.SELECT_YESNO: {
      const yn = p.type === M.SELECT_EFFECTYN;
      out.title = yn ? `${table.name(p.code)}: Effekt aktivieren?` : table.text(p.description) || 'Bestätigen?';
      if (yn) out.hint = table.text(p.description, p.code, PLACE[p.location]);
      const type = yn ? R.SELECT_EFFECTYN : R.SELECT_YESNO;
      add('Ja', { type, yes: true }, yn ? p : null); add('Nein', { type, yes: false });
      return single();
    }
    case M.SELECT_OPTION:
      out.title = 'Option wählen';
      p.options.forEach((o, index) => add(table.text(o) || `Option ${index + 1}`, { type: R.SELECT_OPTION, index }));
      return single();
    case M.SELECT_CHAIN:
      out.title = p.forced ? 'Effekt aktivieren (Pflicht)' : 'Kette: Effekt aktivieren?';
      p.selects.forEach((c, index) => add(effect(c), { type: R.SELECT_CHAIN, index }, c));
      if (!p.forced) add('Nicht aktivieren', { type: R.SELECT_CHAIN, index: null });
      return single();
    case M.SELECT_POSITION:
      out.title = `${table.name(p.code)}: Position wählen`;
      bitList(p.positions).forEach((b) => add(POSITION[b], { type: R.SELECT_POSITION, position: Number(b) }));
      return single();
    case M.SELECT_UNSELECT_CARD:
      out.title = `Karten wählen (${p.min}–${p.max})`;
      [...p.select_cards, ...p.unselect_cards].forEach((c, index) => add(index < p.select_cards.length ? 'Wählen' : 'Abwählen', { type: R.SELECT_UNSELECT_CARD, index }, c));
      if (p.can_finish || p.can_cancel) add(p.can_finish ? 'Fertig' : 'Abbrechen', { type: R.SELECT_UNSELECT_CARD, index: null });
      return single();
    case M.SELECT_CARD: case M.SELECT_TRIBUTE: case M.SELECT_SUM: {
      const sum = p.type === M.SELECT_SUM;
      out.title = sum ? `Karten wählen (Summe ${p.select_max ? 'mind. ' : ''}${p.amount & 0xffff})` : p.type === M.SELECT_TRIBUTE ? 'Als Tribut wählen' : 'Karten wählen';
      if (!sum) { out.min = p.min; out.max = p.max; }
      p.selects.forEach((c, index) => add(sum ? `Stufe ${c.amount & 0xffff}` : 'Wählen', index, c));
      return many(sum ? R.SELECT_SUM : p.type === M.SELECT_TRIBUTE ? R.SELECT_TRIBUTE : R.SELECT_CARD, 'indicies');
    }
    case M.ANNOUNCE_NUMBER:
      out.title = 'Zahl ansagen';
      p.options.forEach((o, index) => add(String(o), { type: R.ANNOUNCE_NUMBER, value: index }));
      return single();
    case M.ANNOUNCE_RACE: case M.ANNOUNCE_ATTRIB: {
      const race = p.type === M.ANNOUNCE_RACE;
      out.title = `${race ? 'Typ' : 'Eigenschaft'} ansagen`; out.min = p.count; out.max = p.count;
      bitList(p.available).forEach((b) => add(String(b), race ? b : Number(b)));
      return many(race ? R.ANNOUNCE_RACE : R.ANNOUNCE_ATTRIB, race ? 'races' : 'attributes');
    }
    case M.ANNOUNCE_CARD:
      out.title = 'Kartenname ansagen'; out.text = true;
      return { ...out, answer: (body) => { const card = byName.get(body.name)?.id; return table.data.has(card) ? { type: R.ANNOUNCE_CARD, card } : undefined; } };
    default:
      return { ...out, title: `Unbekannte Engine-Frage ${p.type}`, answer: () => undefined };
  }
}

function state() {
  if (!s) return { ok: true, duel: false };
  const { g } = s;
  const card = (c, hidden) => (c ? { down: !!(c.position & P.FACEDOWN), pos: c.position & P.DEFENSE ? 'def' : 'atk', ...(hidden && c.position & P.FACEDOWN ? {} : { name: table.name(c.code), atk: c.attack, def: c.defense }) } : null);
  const names = (list) => list.map((c) => table.name(c.code));
  const view = g.view();
  const half = (p, bot) => {
    const v = view[p];
    return {
      hand: bot ? v.hand.length : names(v.hand), mz: v.mz.map((c) => card(c, bot)), st: v.st.map((c) => card(c, bot)), field: card(v.field, bot),
      gy: names(v.gy), banished: names(v.banished), extra: bot ? v.extra.length : names(v.extra), deck: v.deck
    };
  };
  s.pending = g.prompt ? describe(g.prompt) : null;
  const events = g.events.slice(s.sent); s.sent = g.events.length;
  const { answer: _answer, ...prompt } = s.pending ?? {};
  return {
    ok: true, duel: true, turn: g.turn, active: g.active === null ? null : side(g.active), phase: PHASE[g.phase] ?? '',
    lp: { me: g.lp[g.me], bot: g.lp[g.bot] }, winner: g.winner === null ? null : g.winner === g.me ? 'me' : g.winner === g.bot ? 'bot' : 'draw',
    field: { me: half(g.me, false), bot: half(g.bot, true) }, prompt: s.pending ? prompt : null,
    events, log: g.log.slice(0, 30), review: g.review ?? null, error: g.error || (g.errors.at(-1) ?? '')
  };
}

const fail = (message) => ({ ok: false, error: message });

function start(body) {
  const deck = decks[body.deck]; const opp = decks[body.opp];
  if (!deck?.name || !opp?.name) return fail('Unbekanntes Deck. GET /decks zeigt die IDs.');
  const left = new Map(deck.main.map((c) => [c.card, c.count]));
  const hand = (Array.isArray(body.hand) ? body.hand : []).filter((n) => left.get(n) > 0 && left.set(n, left.get(n) - 1));
  s?.g.close();
  const opts = { lib, table, scripts, me: deckCodes(deck), bot: deckCodes(opp), hand: codes(hand), second: body.first === false, askAllChains: !!body.askAll, botPlays: body.bot !== 'passiv' };
  s = { g: newGame(opts), opts, answers: [], sent: 0, pending: null };
  return state();
}

function answer(body) {
  if (!s?.pending) return fail('Keine offene Frage.');
  const response = s.pending.answer(body);
  if (response === undefined) return fail('Ungültige Antwort für diese Frage.');
  s.answers.push(response);
  s.g.respond(response);
  return state();
}

// Undo = replay the same duel (same seed) without the last answer. reset tells the front end to redraw, not animate.
function undo() {
  if (!s?.answers.length) return fail('Nichts zum Zurücknehmen.');
  s.answers.pop();
  s.g.close();
  s.g = newGame(s.opts);
  for (const a of s.answers) s.g.respond(a);
  s.sent = s.g.events.length;
  return { ...state(), reset: true };
}

const routes = {
  'GET /decks': () => Object.entries(decks).filter(([, d]) => d.name).map(([id, d]) => ({ id, name: d.name })),
  'GET /card': (body, url) => {
    const c = byName.get(url.searchParams.get('name') ?? '');
    return c ? { ok: true, name: c.name, type: c.type, desc: c.desc, atk: c.atk, def: c.def, level: c.level, attribute: c.attribute, race: c.race } : fail('Karte nicht gefunden.');
  },
  'GET /state': state, 'POST /new': start, 'POST /answer': answer, 'POST /undo': undo
};

export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = routes[`${req.method} ${url.pathname}`];
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  if (!route) return send(404, fail('Unbekannter Pfad.'));
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; if (raw.length > MAX_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const body = raw ? JSON.parse(raw) : {};
      if (body === null || typeof body !== 'object') return send(400, fail('JSON-Objekt erwartet.'));
      const data = route(body, url);
      send(data.ok === false ? 400 : 200, data);
    } catch (error) {
      send(error instanceof SyntaxError ? 400 : 500, fail(error.message));
    }
  });
});

// Started directly (not imported by the test): listen.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/duel-server.mjs')) {
  const port = Number(process.argv[2]) || 8131;
  server.listen(port, '127.0.0.1', () => console.log(`Duel-Brücke läuft: http://127.0.0.1:${port}  (Strg+C beendet)`));
}
