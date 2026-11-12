// Bewertungssystem als eigene Bot-Variante, getrennt vom bisherigen Bot (js/decide.js bleibt unverändert).
//   opts.botHook = advisorHook(opts, weights)        // wie js/lookahead.js; nur eines von beiden gleichzeitig
// Entscheidet nach Kartenvorteil und strategischem Wert (1) die erste Hauptphasen-Aktion jedes Bot-Zuges und (2) Antworten in
// Kettenfenstern, die sich nachspielen lassen (chain.js). Ist die Lage nicht messbar, entscheidet der bisherige Bot
// (Rückfall, im Log vermerkt). Eine Hauptphasen-Aktion braucht Wert >= 0, eine Antwort in der Kette Wert > 0 gegenüber Nichtstun.
// Jede Entscheidung steht in g.advisorLog: Wissensklassen, alle Kandidaten mit allen Dimensionen, Streuung, Teilwerte, Wahl.
import { M, R } from '../duel-core.js';
import { mainCandidates } from '../decide.js';
import { graveOption } from './dimensions.js';
import { potentialOf } from './potential.js';
import { evaluateMain, observed } from './probe.js';
import { evaluateChain } from './chain.js';
import { knowledge } from './resources.js';

const MAIN1 = 4;
const rankKey = (r) => `${r.action}:${r.index}`;

export function advisorHook(opts, weights, { worlds = 4, chain = true } = {}) {
  const ctx = { table: opts.table, weights, gyOption: graveOption(opts.scripts, opts.table), tendencies: opts.tendencies };
  ctx.potential = potentialOf(opts, ctx); // Timing und Future: was die Karte im besten Fall bringt (gemessen, gemerkt)
  const entry = (g, kind, extra) => ({ turn: g.turn, kind, worlds, weights: weights.weights, knowledge: knowledge(observed(g, opts.table).foe), ...extra });
  const shown = (r) => ({ key: r.key, label: r.label, dims: r.dims, spread: r.spread, samples: r.samples, potential: r.potential, timing: r.timing, waste: r.waste, parts: r.parts, total: r.total });
  return (m, g) => {
    if (chain && m.type === M.SELECT_CHAIN && !m.forced) {
      const r = evaluateChain(opts, g, m, ctx, { worlds });
      if (!r) return undefined; // nicht messbar: der bisherige Bot entscheidet
      const best = r.candidates.reduce((a, b) => (b.total > a.total + 1e-9 ? b : a));
      const chosen = best.total > 1e-9 ? best : null;
      (g.advisorLog ??= []).push(entry(g, 'chain', { stimulus: r.stimulus, candidates: r.candidates.map(shown), chosen: chosen ? chosen.label : null, fallback: chosen ? null : 'keine Antwort lohnt sich' }));
      return chosen ? chosen.response : { type: R.SELECT_CHAIN, index: null };
    }
    if (m.type !== M.SELECT_IDLECMD || g.active !== g.bot || g.phase !== MAIN1 || g.turn === 1 || g.advisorTurn === g.turn) return undefined;
    g.advisorTurn = g.turn; // eine Entscheidung je Zug: später fehlen der Probewelt die Merker dieses Zuges
    const results = evaluateMain(opts, g, m, ctx, { worlds });
    const old = mainCandidates(m, opts.table, g).map((c) => rankKey(c.response)); // Reihenfolge des bisherigen Bots entscheidet bei Gleichstand
    const rank = (r) => { const at = old.indexOf(rankKey(r.response)); return at < 0 ? old.length : at; };
    const best = results.length ? results.reduce((a, b) => (b.total > a.total + 1e-9 || (Math.abs(b.total - a.total) <= 1e-9 && rank(b) < rank(a)) ? b : a)) : null;
    const chosen = best && best.total >= 0 ? best : null;
    (g.advisorLog ??= []).push(entry(g, 'main', {
      candidates: results.map(shown), chosen: chosen ? chosen.label : null, fallback: chosen ? null : (results.length ? 'kein Wert >= 0' : 'nicht messbar')
    }));
    return chosen ? chosen.response : undefined;
  };
}
