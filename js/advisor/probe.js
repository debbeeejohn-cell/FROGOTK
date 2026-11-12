// Messung in Probewelten: Jede legale Hauptphasen-Aktion wird von der ENGINE ausgeführt, davor und danach wird der Zustand
// verglichen. Der Bot kennt dadurch Kosten, Mengen und Obergrenzen, ohne Kartenregeln nachzubauen.
//
// Eine Probewelt entsteht aus dem öffentlichen Stand (js/lookahead.js: snapshot): Der Bot sieht sich selbst vollständig, vom
// Gegner nur Offenes. Verdeckte Gegnerkarten werden aus dem Restpool seiner Decklist gezogen (js/guess.js).
// sanitize() entfernt vorher alles Verdeckte aus der Ansicht, damit nichts davon in eine Probewelt gelangen KANN.
//
// Grenze (ponytail): nur die erste Aktion einer Hauptphase. Die Probewelt beginnt am Zuganfang; mitten im Zug fehlen ihr die
// Merker „Normalbeschwörung schon genutzt“ und „einmal pro Zug“. Alle späteren Aktionen entscheidet der bisherige Bot.
import { newGame, seededRandom, botAnswer, P, M, R, IDLE } from '../duel-core.js';
import { botPlay } from '../decide.js';
import { snapshot } from '../lookahead.js';
import { sideState, observe } from './resources.js';
import { measure, compare, combine } from './dimensions.js';

const MAX_STEPS = 80;
const STOP_TURN = 3; // Zug 1 der Gegner passt, Zug 2 der Bot: danach braucht die Messung nichts mehr
const LIST = {
  [IDLE.SELECT_SUMMON]: ['summons', 'Normalbeschwören'], [IDLE.SELECT_SPECIAL_SUMMON]: ['special_summons', 'Spezialbeschwören'],
  [IDLE.SELECT_ACTIVATE]: ['activates', 'Aktivieren'], [IDLE.SELECT_SPELL_SET]: ['spell_sets', 'Setzen'], [IDLE.SELECT_MONSTER_SET]: ['monster_sets', 'Monster setzen']
};

/** Ansicht ohne Verdecktes: Gegnerhand, verdeckte Gegnerkarten und sein Extra Deck tragen nur Platzhalter aus seiner Decklist. */
export function sanitize(view, foe, { foeMain, foeExtra }) {
  const dummy = foeMain[0];
  const blank = (c) => (c && c.position & P.FACEDOWN ? { ...c, code: dummy, attack: 0, defense: 0 } : c);
  return view.map((v, p) => (p !== foe ? v : {
    ...v,
    hand: v.hand.map(() => ({ code: dummy, position: P.FACEDOWN, attack: 0, defense: 0 })),
    mz: v.mz.map(blank), st: v.st.map(blank), field: blank(v.field),
    extra: foeExtra.map((code) => ({ code }))
  }));
}

/** Alle legalen Hauptphasen-Aktionen aus der Engine-Frage. first = wie man sie in einer Probewelt wiederfindet. */
export function candidates(m, table) {
  const out = [];
  for (const [action, [list, verb]] of Object.entries(LIST)) {
    m[list].forEach((c, index) => out.push({
      key: `${list}:${index}`, label: `${verb} ${table.name(c.code)}`,
      response: { type: R.SELECT_IDLECMD, action: Number(action), index }, first: { action: Number(action), code: c.code }
    }));
  }
  if (m.to_bp) out.push({ key: 'to_bp', label: 'Battle Phase', response: { type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null }, first: null, pass: true });
  return out;
}

/** Eine Probewelt, eine erste Aktion: Zustand am Anfang der Hauptphase und nachdem die Aktion abgewickelt ist. null = nicht messbar. */
export function branch(opts, start, first) {
  const { lib, table, scripts } = opts;
  let before = null; let after = null; let failed = false;
  const snap = (g) => { const v = g.view(); return { own: sideState(v[g.bot], table), foe: sideState(v[g.me], table) }; };
  const botHook = (m, g) => {
    if (m.type !== M.SELECT_IDLECMD || g.turn !== 2 || after) return undefined;
    if (!before) {
      before = snap(g);
      const index = m[LIST[first.action][0]].findIndex((c) => c.code === first.code);
      if (index < 0) { failed = true; return { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null }; }
      return { type: R.SELECT_IDLECMD, action: first.action, index };
    }
    after = snap(g); // wieder in der Hauptphase: die Aktion ist abgewickelt
    return { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null };
  };
  let g = null;
  try {
    g = newGame({ lib, table, scripts, me: opts.me, bot: opts.bot, start, seed: [1n, 1n, 1n, 1n], botPlays: true, botHook, stopTurn: STOP_TURN });
    const mirror = Object.assign(Object.create(g), { bot: g.me, me: g.bot }); // der Gegner, nach den Regeln des Bots gespielt
    let turn = 0;
    for (let i = 0; g.prompt && !after && !failed && i < MAX_STEPS; i += 1) {
      const m = g.prompt;
      if (g.turn !== turn) { turn = g.turn; mirror.botActs = 0; }
      const pass = m.type === M.SELECT_CHAIN && !m.forced ? { type: R.SELECT_CHAIN, index: null } : m.type === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : null;
      g.respond(g.turn === 1 ? pass ?? botAnswer(m, table, mirror) : botPlay(m, table, mirror) || botAnswer(m, table, mirror));
    }
    return before && after && !failed ? { before, after } : null;
  } catch { return null; } finally { g?.close(); }
}

const KEYS = ['raw', 'quality', 'tempo', 'graveyard'];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const spread = (xs) => { const u = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - u) ** 2))); };

/**
 * Bewertet jede legale erste Hauptphasen-Aktion in `worlds` Probewelten. Nichtstun ist die Vergleichsbasis (alles 0), die
 * Dimensionen sind damit schon Aktion − Nichtstun (Opportunity Cost). Ergebnis je Aktion: Mittel, Streuung, Teile, Gesamtwert.
 */
export function evaluateMain(opts, g, m, ctx, { worlds = 4 } = {}) {
  const view = sanitize(g.view(), g.me, { foeMain: opts.me.main, foeExtra: opts.me.extra });
  const info = { bot: g.bot, me: g.me, lp: g.lp, botMain: opts.bot.main, meMain: opts.me.main, table: opts.table, weights: ctx.tendencies ?? {} };
  const list = candidates(m, opts.table).filter((c) => !c.pass);
  const samples = new Map(list.map((c) => [c.key, []]));
  for (let w = 0; w < worlds; w += 1) {
    const rand = seededRandom([opts.seed[0] ^ BigInt(g.turn * 16 + w), ...opts.seed.slice(1)]);
    const start = snapshot(view, info, rand);
    for (const c of list) {
      const r = branch(opts, start, c.first);
      if (r) samples.get(c.key).push(measure(r.before, r.after, ctx));
    }
  }
  const zero = { raw: 0, quality: 0, tempo: 0, graveyard: 0 };
  return list.filter((c) => samples.get(c.key).length).map((c) => {
    const s = samples.get(c.key);
    const dims = Object.fromEntries(KEYS.map((k) => [k, mean(s.map((x) => x[k]))]));
    const potential = ctx.potential ? ctx.potential(c.first.code) : null;
    const scored = combine(compare(dims, zero), potential, ctx.weights);
    return { ...c, dims, spread: spread(s.map((x) => x.raw)), worlds: s.length, samples: s.map((x) => x.raw), potential, timing: scored.timing, waste: scored.waste, parts: scored.parts, total: scored.total };
  });
}

/** Wissensklassen der Gegnerkarten für den Log (aus der Beobachtung, nie aus echten Karten). */
export const observed = (g, table) => observe(g.view(), g.bot, table);
