// Zustand und Ressourcenrechnung des Bewertungssystems. Hier steht nur Zählen: Raw Card Advantage (RCA).
// Qualität, Tempo, Friedhof und Timing stehen in dimensions.js und zählen Karten nie ein zweites Mal.
//
// Ressourcen-Pool einer Seite = Hand + Feld (Monster, Zauber/Fallen, Feldzauber). Tokens sind keine Karten.
// Friedhof, Verbannt, Deck und Extra Deck sind nicht im Pool. Damit gilt von selbst:
//   Hand -> Feld        : Pool gleich, nichts verloren.
//   Zone -> Zone        : Pool gleich, nichts doppelt gezählt.
//   Deck -> Hand        : +1 (Ziehen, Suchen).   Feld/Hand -> Friedhof/Verbannt/Deck : -1.
import { OcgPosition as P } from '../../vendor/ocgcore/index.js';

const TOKEN = 0x4000;
const isToken = (c, table) => !!(table.data.get(c.code)?.type & TOKEN);

/**
 * Eine Seite aus der Engine-Ansicht. hide = true ist die Sicht des Bots auf den Gegner: verdeckte Karten haben keine
 * Identität, seine Hand und sein Deck sind nur Zahlen. Eigene Karten und Probewelten (hide = false) tragen Identitäten.
 */
export function sideState(v, table, hide = false) {
  const full = (c) => (c ? { code: c.code, pos: c.position, atk: c.attack, def: c.defense, token: isToken(c, table) } : null);
  const seen = (c) => (c && hide && c.position & P.FACEDOWN ? { down: true, pos: c.position, token: false } : full(c));
  return {
    hand: hide ? v.hand.length : v.hand.map(full),
    mz: v.mz.map(seen), st: v.st.map(seen), field: seen(v.field),
    gy: v.gy.map(full), banished: v.banished.map(full), deck: v.deck, extra: v.extra.length
  };
}

/** Beobachtung des Bots: eigene Seite vollständig, Gegner nur öffentlich. Einzige Eingabe der Bewertung für das echte Spiel. */
export const observe = (view, me, table) => ({ own: sideState(view[me], table), foe: sideState(view[1 - me], table, true) });

const live = (list) => list.filter((c) => c && !c.token);
const num = (x) => (Array.isArray(x) ? live(x).length : x);

/** Zähler je Zone. Der Pool ist Hand + Feld. */
export function counts(s) {
  const c = { hand: num(s.hand), mz: num(s.mz), st: num(s.st), field: s.field && !s.field.token ? 1 : 0, gy: num(s.gy), banished: num(s.banished), deck: s.deck, extra: s.extra };
  return { ...c, pool: c.hand + c.mz + c.st + c.field };
}

/** Raw Card Advantage zwischen zwei Zuständen: (Δ Pool eigen) − (Δ Pool Gegner). Positiv = ich gewinne Karten. */
export function rawAdvantage(before, after) {
  const d = (side) => counts(after[side]).pool - counts(before[side]).pool;
  return d('own') - d('foe');
}

// --- Identitäten (nur für Modellwelten, in denen jede Karte eine Identität trägt) ---
const bag = (list) => list.reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map());
const minus = (a, b) => [...a].flatMap(([code, n]) => Array(Math.max(0, n - (b.get(code) ?? 0))).fill(code));
const poolCodes = (s) => live([...s.hand, ...s.mz, ...s.st, s.field]).map((c) => c.code);
const zoneCodes = (list) => live(list).map((c) => c.code);

/**
 * Was sich zwischen zwei Modellzuständen bewegt hat, als Identitäten. Reine Zonenwechsel (Hand -> Feld) heben sich im Pool auf
 * und tauchen nirgends auf.
 *   lost    verlässt den Pool (Friedhof, Verbannt, Deck)      gained  kommt in den Pool (Deck, Friedhof, Extra Deck)
 *   toGy    neu im Friedhof                                    toBanished neu verbannt
 */
export function movement(before, after) {
  const side = (s) => {
    const b = bag(poolCodes(before[s])); const a = bag(poolCodes(after[s]));
    return {
      lost: minus(b, a), gained: minus(a, b),
      toGy: minus(bag(zoneCodes(after[s].gy)), bag(zoneCodes(before[s].gy))),
      toBanished: minus(bag(zoneCodes(after[s].banished)), bag(zoneCodes(before[s].banished)))
    };
  };
  return { own: side('own'), foe: side('foe') };
}

/** Wissensklassen der Gegnerkarten (Anforderung 4): bekannt, vermutet, unbekannt. Aus der Beobachtung, nie aus echten Karten. */
export function knowledge(foe) {
  const field = [...foe.mz, ...foe.st, foe.field].filter(Boolean);
  return {
    known: field.filter((c) => !c.down).length + foe.gy.length + foe.banished.length,
    estimated: field.filter((c) => c.down).length, // verdeckt auf dem Feld: Identität nur als Verteilung (guess.js)
    unknown: num(foe.hand) + foe.deck
  };
}
