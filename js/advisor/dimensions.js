// Strategic Action Value: bewertet, was eine Aktion über das reine Kartenzählen (resources.js) hinaus bringt.
// Jede Dimension misst etwas anderes und zählt keine Karte ein zweites Mal:
//   raw        Kartenzahl (resources.js), immer getrennt ausgewiesen
//   quality    nur der ÜBERSCHUSS über 1 je bewegter Karte (Extra Deck, ATK, Effekt)
//   tempo      Brettpräsenz (ATK offener Angriffsmonster), keine Karten
//   graveyard  Optionswert nutzbarer Friedhofseffekte neu im Friedhof, zählt NICHT als Karte
//   timing     (nur Anzeige) wie nah die Aktion jetzt an ihrem Potenzial liegt
//   future     Verschwendung: Potenzial der eingesetzten Karte minus das, was sie jetzt bringt
// Opportunity Cost: Jede Dimension wird als Differenz Aktion − Nichtstun gebildet (compare).
// Karten tragen hier keine Namen als Regel: Qualität und Friedhofsoption kommen aus Kartendaten und Skripten.
import { OcgPosition as P } from '../../vendor/ocgcore/index.js';
import { movement, rawAdvantage } from './resources.js';

const TYPE_MONSTER = 1; const TYPE_EFFECT = 0x20;
const TYPE_EXTRA = 0x40 | 0x2000 | 0x800000; // Fusion, Synchro, Xyz

/** Qualität einer Karte, 1 = eine gewöhnliche Karte. Nur aus Kartendaten (Typ, ATK, Effekt). */
export function cardQuality(code, table, w) {
  const d = table.data.get(code);
  if (!d || !(d.type & TYPE_MONSTER)) return 1;
  let q = 1;
  if (d.type & TYPE_EXTRA) q += w.extraDeck;
  if (d.type & TYPE_EFFECT) q += w.effect;
  q += Math.min(w.atkCap, Math.max(0, ((d.attack - w.atkFrom) / 1000) * w.atkPer1000));
  return q;
}

/**
 * Hat die Karte einen Effekt, den sie aus dem Friedhof nutzen kann? Gelesen aus dem Skript der Engine (SetRange), nicht
 * erfunden. scripts: Dateiname -> Lua-Quelle, wie in data/core-scripts.json.
 */
export function graveOption(scripts, table) {
  const memo = new Map();
  return (code) => {
    if (!memo.has(code)) {
      const d = table.data.get(code);
      const src = scripts[`c${d?.alias || code}.lua`] ?? '';
      memo.set(code, /SetRange\(\s*LOCATION_GRAVE/.test(src));
    }
    return memo.get(code);
  };
}

const power = (s) => s.mz.reduce((sum, c) => sum + (c && !c.token && c.pos & P.FACEUP_ATTACK ? c.atk : 0), 0);

/** Alle Dimensionen eines Zweigs (Zustand nach der Aktion) gegenüber dem Zustand davor. ctx: { table, weights, gyOption }. */
export function measure(before, after, ctx) {
  const { table, weights, gyOption } = ctx;
  const m = movement(before, after);
  const excess = (codes) => codes.reduce((sum, code) => sum + cardQuality(code, table, weights.quality) - 1, 0);
  const options = (codes) => codes.filter(gyOption).length;
  return {
    raw: rawAdvantage(before, after),
    quality: excess(m.foe.lost) - excess(m.own.lost) + excess(m.own.gained) - excess(m.foe.gained),
    tempo: ((power(after.own) - power(after.foe)) - (power(before.own) - power(before.foe))) / 1000,
    graveyard: options(m.own.toGy) - options(m.foe.toGy),
    moved: m
  };
}

const KEYS = ['raw', 'quality', 'tempo', 'graveyard'];

/** Opportunity Cost: Aktion minus Nichtstun, je Dimension. */
export function compare(action, pass) {
  return Object.fromEntries(KEYS.map((k) => [k, action[k] - pass[k]]));
}

/**
 * Gesamtwert einer Aktion gegenüber dem Nichtstun. potential = was die eingesetzte Karte im besten Fall bringt (Kartenzahl),
 * null wenn unbekannt. Timing ist nur Anzeige; die Wirkung läuft über die Verschwendung (future).
 */
export function combine(diff, potential, weights) {
  const w = weights.weights;
  const waste = potential == null ? 0 : Math.max(0, potential - diff.raw);
  const parts = {
    raw: w.raw * diff.raw, quality: w.quality * diff.quality, tempo: w.tempo * diff.tempo,
    graveyard: w.graveyard * diff.graveyard, future: -w.future * waste
  };
  const timing = potential == null ? null : potential > 0 ? Math.max(-1, Math.min(1, diff.raw / potential)) : null;
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts, waste, timing };
}
