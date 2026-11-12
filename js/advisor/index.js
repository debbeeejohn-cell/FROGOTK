// Bewertungssystem als eigene Bot-Variante, getrennt vom bisherigen Bot (js/decide.js bleibt unverändert).
//   opts.botHook = advisorHook(opts, weights)        // wie js/lookahead.js; nur eines von beiden gleichzeitig
// Entscheidet die erste Hauptphasen-Aktion jedes Bot-Zuges nach Kartenvorteil und strategischem Wert. Findet das System keine
// Aktion mit Wert >= 0 oder ist die Lage nicht messbar, entscheidet der bisherige Bot (Rückfall, im Log vermerkt).
// Jede Entscheidung steht in g.advisorLog: Wissensklassen, alle Kandidaten mit allen Dimensionen, Streuung, Teilwerte, Wahl.
import { M } from '../duel-core.js';
import { mainCandidates } from '../decide.js';
import { graveOption } from './dimensions.js';
import { evaluateMain, observed } from './probe.js';
import { knowledge } from './resources.js';

const MAIN1 = 4;
const rankKey = (r) => `${r.action}:${r.index}`;

export function advisorHook(opts, weights, { worlds = 4 } = {}) {
  const ctx = { table: opts.table, weights, gyOption: graveOption(opts.scripts, opts.table), tendencies: opts.tendencies };
  return (m, g) => {
    if (m.type !== M.SELECT_IDLECMD || g.active !== g.bot || g.phase !== MAIN1 || g.turn === 1 || g.advisorTurn === g.turn) return undefined;
    g.advisorTurn = g.turn; // eine Entscheidung je Zug: später fehlen der Probewelt die Merker dieses Zuges
    const results = evaluateMain(opts, g, m, ctx, { worlds });
    const old = mainCandidates(m, opts.table, g).map((c) => rankKey(c.response)); // Reihenfolge des bisherigen Bots entscheidet bei Gleichstand
    const rank = (r) => { const at = old.indexOf(rankKey(r.response)); return at < 0 ? old.length : at; };
    const best = results.length ? results.reduce((a, b) => (b.total > a.total + 1e-9 || (Math.abs(b.total - a.total) <= 1e-9 && rank(b) < rank(a)) ? b : a)) : null;
    const chosen = best && best.total >= 0 ? best : null;
    (g.advisorLog ??= []).push({
      turn: g.turn, kind: 'main', worlds, weights: weights.weights, knowledge: knowledge(observed(g, opts.table).foe),
      candidates: results.map((r) => ({ key: r.key, label: r.label, dims: r.dims, spread: r.spread, samples: r.samples, parts: r.parts, total: r.total })),
      chosen: chosen ? chosen.label : null, fallback: chosen ? null : (results.length ? 'kein Wert >= 0' : 'nicht messbar')
    });
    return chosen ? chosen.response : undefined;
  };
}
