// Potenzial einer Karte: Was bringt sie im besten Fall an Karten (Raw Card Advantage)? Gemessen von der ENGINE in einer
// „reichen“ Teststellung: Der Bot hat Monster, der Gegner viel Angreifbares (drei offene Monster, drei gesetzte Karten).
// Aus Potenzial und dem, was die Karte jetzt bringt, rechnen dimensions.js Timing (Verhältnis) und Future (Verschwendung).
// Die Teststellung nimmt ihre Karten aus den Decklisten und kennt keine Kartennamen. Unbekannt (null), wenn die Karte in der
// Stellung keine legale Hauptphasen-Aktion hat (z. B. Fallen, die nur auf einen Auslöser antworten): dann gibt es keine Strafe.
import { L, P, IDLE } from '../duel-core.js';
import { branch } from './probe.js';
import { measure } from './dimensions.js';

const ACTIONS = [IDLE.SELECT_SUMMON, IDLE.SELECT_SPECIAL_SUMMON, IDLE.SELECT_ACTIVATE];
const TYPE_MONSTER = 1; const TYPE_BACKROW = 2 | 4;
const memo = new Map();

const distinct = (codes, test, n, skip) => { const out = []; for (const c of codes) if (test(c) && c !== skip && !out.includes(c)) out.push(c); return out.slice(0, n); };

/** Reiche Startstellung für `code` auf der Seite des Bots. */
export function richStart(opts, code) {
  const { table } = opts;
  const monster = (c) => !!(table.data.get(c)?.type & TYPE_MONSTER) && !(table.data.get(c)?.type & 0x2000 | table.data.get(c)?.type & 0x40);
  const backrow = (c) => !!(table.data.get(c)?.type & TYPE_BACKROW);
  const botType = table.data.get(code)?.type ?? 0;
  const cards = [];
  const put = (side, c, location, sequence = 0, position = P.FACEDOWN) => cards.push({ side, code: c, location, sequence, position });
  distinct(opts.bot.main, monster, 3, code).forEach((c, i) => put('bot', c, L.MZONE, i, P.FACEUP_ATTACK));
  if (botType & 4) put('bot', code, L.SZONE, 0); else put('bot', code, L.HAND, 0); // Fallen liegen gesetzt, alles andere auf der Hand
  distinct(opts.me.main, monster, 3, null).forEach((c, i) => put('me', c, L.MZONE, i, P.FACEUP_ATTACK));
  distinct(opts.me.main, backrow, 3, null).forEach((c, i) => put('me', c, L.SZONE, i));
  const deck = (side, list) => list.slice(0, 8).forEach((c) => put(side, c, L.DECK));
  deck('bot', opts.bot.main.filter((c) => c !== code)); deck('me', opts.me.main);
  (opts.me.extra ?? []).forEach((c) => put('me', c, L.EXTRA));
  (opts.bot.extra ?? []).forEach((c) => put('bot', c, L.EXTRA));
  return { lp: { me: 8000, bot: 8000 }, cards };
}

/** Funktion code -> Potenzial (Karten) oder null. Gemerkt je Karte und Decklisten, damit jede Partie sie nicht neu misst. */
export function potentialOf(opts, ctx) {
  const deckKey = `${opts.bot.main.slice(0, 8)}|${opts.me.main.slice(0, 8)}`;
  return (code) => {
    const key = `${code}|${deckKey}`;
    if (!memo.has(key)) {
      const start = richStart(opts, code);
      let best = null;
      for (const action of ACTIONS) {
        const r = branch(opts, start, { action, code });
        if (r) { const raw = measure(r.before, r.after, ctx).raw; best = best === null ? raw : Math.max(best, raw); }
      }
      memo.set(key, best);
    }
    return memo.get(key);
  };
}
