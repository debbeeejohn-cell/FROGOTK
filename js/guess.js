// Wahrscheinlichkeiten über den Gegner: Was kann eine verdeckte Karte sein, und wie wahrscheinlich ist eine
// Karte in der Hand? Nutzt die Rechnung aus js/calc.js (chance). Ohne Engine, reine Daten.

import { chance } from './calc.js';

/** Restpool: Decklist-Abschnitt minus alle Karten, die schon offen gesehen wurden. seen = Kartennamen (mit Wiederholung). */
export function unseenPool(section, seen) {
  const copies = new Map(section.map(({ card, count }) => [card, count]));
  for (const name of seen) {
    if ((copies.get(name) ?? 0) > 0) copies.set(name, copies.get(name) - 1);
  }
  const left = [...copies].filter(([, n]) => n > 0);
  return { total: left.reduce((sum, [, n]) => sum + n, 0), copies: new Map(left) };
}

/**
 * Wahrscheinlichkeit je Karte, dass eine verdeckte Karte genau diese ist. Jede Karte zählt mit ihrer Anzahl im
 * Restpool mal ihrer Setz-Tendenz (weights, siehe data/set-tendencies.json; fehlt sie, gilt 1).
 */
export function faceDownOdds(pool, weights = {}) {
  const score = [...pool.copies].map(([card, n]) => [card, n * (weights[card] ?? 1)]);
  const sum = score.reduce((total, [, x]) => total + x, 0);
  return score.map(([card, x]) => ({ card, p: sum > 0 ? x / sum : 0 })).sort((a, b) => b.p - a.p);
}

/** Wahrscheinlichkeit, dass `card` unter `hand` zufällig gezogenen Karten aus dem Restpool ist. */
export function inHandChance(pool, hand, card) {
  return chance(pool.total, hand, [{ copies: pool.copies.get(card) ?? 0, min: 1 }]);
}
