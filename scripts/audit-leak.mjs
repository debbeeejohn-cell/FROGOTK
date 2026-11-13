// Prüft, ob ein Bot verdeckte Gegnerinformation benutzt. Verfahren: eine echte Stellung am Zug des Bots, daraus zwei Welten
// mit gleichem öffentlichem Brett, aber anderen verdeckten Karten des Gegners (Hand, Deck, gesetzte Karten; js/lookahead.js::snapshot).
// Die erste Hauptphasen-Entscheidung des Bots muss in beiden Welten gleich sein. Gegenprobe: ein Bot, der die Gegnerhand liest, fällt durch.
import fs from 'node:fs';
import { loadCore, cardTable, newGame, seededRandom, botAnswer, M, R, IDLE, BATTLE, L, P } from '../js/duel-core.js';
import { botPlay } from '../js/decide.js';
import { snapshot } from '../js/lookahead.js';
import { advisorHook } from '../js/advisor/index.js';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
const MAIN1 = 4;
const TO_EP = { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null };

/** Mein Spieler passt (wie js/advisor/index.test.mjs), damit beide Welten bis zum Zug des Bots gleich laufen. */
const pass = (m) => (m.type === M.SELECT_IDLECMD ? TO_EP
  : m.type === M.SELECT_BATTLECMD ? { type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null }
    : m.type === M.SELECT_CHAIN ? { type: R.SELECT_CHAIN, index: m.forced ? 0 : null }
      : m.type === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : { type: R.SELECT_YESNO, yes: false });

export async function setup() {
  const table = cardTable(json('core-cards.json'));
  const { scripts } = json('core-scripts.json');
  const id = new Map(json('cards.json').cards.map((c) => [c.name, c.id]));
  const decks = json('decks.json');
  const codes = (d) => ({ main: d.main.flatMap((c) => Array(c.count).fill(id.get(c.card))), extra: (d.extra || []).flatMap((c) => Array(c.count).fill(id.get(c.card))) });
  const lib = await loadCore();
  return { lib, table, scripts, weights: json('advisor-weights.json'), deck: (name) => codes(decks[name]) };
}

/** Echte Stellung: Das Spiel läuft bis zum ersten Hauptphasen-Zug des Bots (Zug 2); beide Seiten nach den Regeln des Bots. null = nicht erreicht. */
export function position(opts, seed) {
  let found = null; let g = null;
  try {
    g = newGame({ ...opts, seed, botPlays: true, botHook: (m, game) => {
      if (!found && m.type === M.SELECT_IDLECMD && game.active === game.bot && game.phase === MAIN1 && game.turn === 2) found = { view: structuredClone(game.view()), lp: { ...game.lp }, bot: game.bot, me: game.me };
      return undefined;
    } });
    const mirror = Object.assign(Object.create(g), { bot: g.me, me: g.bot });
    for (let i = 0; g.prompt && !found && i < 200; i += 1) g.respond(botPlay(g.prompt, opts.table, mirror) || botAnswer(g.prompt, opts.table, mirror));
  } catch { return null; } finally { g?.close(); }
  return found;
}

/** Die erste Hauptphasen-Entscheidung des Bots in einer Welt. `decider(m, g)` gibt die Antwort zurück (oder einen Wert zum Vergleichen). */
export function decision(opts, start, decider) {
  let rec; let g = null;
  try {
    g = newGame({ ...opts, start, seed: [1n, 1n, 1n, 1n], botPlays: true, stopTurn: 3, botHook: (m, game) => {
      if (rec !== undefined || m.type !== M.SELECT_IDLECMD || game.active !== game.bot || game.phase !== MAIN1 || game.turn !== 2) return undefined;
      const r = decider(m, game);
      rec = r === undefined ? null : r;
      return r !== undefined && r !== null && r.type ? r : undefined;
    } });
    for (let i = 0; g.prompt && rec === undefined && i < 80; i += 1) g.respond(pass(g.prompt));
  } catch { return undefined; } finally { g?.close(); }
  return rec;
}

/** Zwei Welten mit gleichem öffentlichem Brett und eigenem (Bot-)Deck, aber anderen verdeckten Karten des Gegners. */
export function worlds(opts, pos, k) {
  const make = (n) => snapshot(pos.view, { bot: pos.bot, me: pos.me, lp: pos.lp, botMain: opts.bot.main, meMain: opts.me.main, table: opts.table }, seededRandom([BigInt(k * 2 + n + 1), 5n, 6n, 7n]));
  const a = make(0); const b = make(1);
  b.cards = [...a.cards.filter((c) => c.side === 'bot'), ...b.cards.filter((c) => c.side === 'me')];
  const hidden = (w) => JSON.stringify(w.cards.filter((c) => c.side === 'me' && (c.location === L.HAND || c.location === L.DECK || c.position & P.FACEDOWN)).map((c) => [c.code, c.location, c.sequence]).sort());
  return { a, b, differ: hidden(a) !== hidden(b) };
}

const DECIDERS = {
  'alter Bot': (opts) => (m, g) => botPlay(m, opts.table, g) || undefined,
  advisor: (opts) => { const hook = advisorHook(opts, opts.weights, { worlds: 2 }); return (m, g) => hook(m, g) ?? (botPlay(m, opts.table, g) || undefined); },
  // Gegenprobe: liest die Gegnerhand aus der echten Ansicht, muss durchfallen
  'Gegenprobe (liest die Gegnerhand)': () => (m, g) => ({ peek: g.view()[g.me].hand.map((c) => c.code).join() }),
};

/** Liefert Zeilen { name, ok, detail } für alle Bots und die Gegenprobe. pairs = [[mein Deck, Bot-Deck], ...]. */
export async function leakRows(positions, pairs) {
  const env = await setup();
  const rows = [];
  const cases = [];
  for (let i = 0; i < positions; i += 1) {
    const [meDeck, botDeck] = pairs[i % pairs.length];
    const opts = { ...env, me: env.deck(meDeck), bot: env.deck(botDeck), seed: [1n, 1n, 1n, 1n] };
    const pos = position(opts, [BigInt(2000 + i * 13), 1n, 2n, 3n]);
    if (pos) cases.push({ opts, pos, i });
  }
  for (const [name, make] of Object.entries(DECIDERS)) {
    let same = 0, diff = 0, used = 0, skipped = 0; const bad = [];
    for (const { opts, pos, i } of cases) {
      const w = worlds(opts, pos, i);
      if (!w.differ) { skipped += 1; continue; }
      const decide = make(opts);
      const [x, y] = [decision(opts, w.a, decide), decision(opts, w.b, decide)];
      if (x === undefined || y === undefined) { skipped += 1; continue; }
      used += 1;
      if (JSON.stringify(x) === JSON.stringify(y)) same += 1; else { diff += 1; bad.push(`Stellung ${i}`); }
    }
    const control = name.startsWith('Gegenprobe');
    const ok = used === 0 ? null : control ? diff > 0 : diff === 0;
    rows.push({ name: control ? name : `Verdeckte Information, ${name}`, ok, detail: used === 0 ? `keine nutzbare Stellung (${skipped} übersprungen)` : control ? `${diff}/${used} Stellungen unterschiedlich: Prüfung erkennt Lecks${diff ? '' : ' NICHT'}` : `${same}/${used} Stellungen gleich entschieden${diff ? `; Abweichung: ${bad.join(', ')}` : ''}${skipped ? `; ${skipped} übersprungen` : ''}` });
  }
  return rows;
}
