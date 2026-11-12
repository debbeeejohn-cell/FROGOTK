#!/usr/bin/env node
// Vergleicht den bisherigen Bot mit dem Bewertungssystem, reproduzierbar: gleiche Paarungen, gleiche Seeds, ich spiele zufällig
// (scripts/bot-eval.mjs). Je Variante und Paarung: Siege, mittlere Zuganzahl, Kartenvorteil des Bots in Zug 7 (Ressourcen-Pool
// Hand + Feld, ohne Tokens, Bot minus Gegner), Entscheidungen des Advisors (Hauptphase/Kette, Rückfall) und Zeit je Partie.
//   node --no-warnings scripts/advisor-eval.mjs [games=100] [variants=,advisor-main,advisor]    ('' = bisheriger Bot)
// Die Siegquote ist nicht das einzige Maß; die Entscheidungen stehen vollständig in g.advisorLog (Brücke: state.advisor).
import fs from 'node:fs';
import { server } from './duel-server.mjs';
import { PAIRS, play } from './bot-eval.mjs';

const MID = 7; // Zug, in dem der Kartenvorteil gemessen wird
const games = Number(process.argv[2] ?? 100);
const variants = (process.argv[3] ?? ',advisor-main,advisor').split(',');
const isToken = (name) => typeof name === 'string' && /Token/.test(name);
const live = (list) => list.filter((c) => c && !isToken(c.name));

// Pool aus dem Brückenzustand: Bot (nur Anzahl der Hand) minus Gegner
function poolDiff(st) {
  const bot = st.field.bot; const me = st.field.me;
  const botPool = bot.hand + live(bot.mz).length + live(bot.st).length + (bot.field && !isToken(bot.field.name) ? 1 : 0);
  const mePool = me.hand.length + live(me.mz).length + live(me.st).length + (me.field && !isToken(me.field.name) ? 1 : 0);
  return botPool - mePool;
}

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rows = [];
for (const [deck, opp] of PAIRS) {
  for (const variant of variants) {
    const results = []; const mid = []; const stat = { main: 0, chain: 0, fallback: 0, picked: 0 };
    const t0 = performance.now();
    for (let i = 0; i < games; i += 1) {
      let seenMid = false;
      const r = await play(base, deck, opp, 1000 + i * 7, (st) => {
        for (const e of st.advisor ?? []) { stat[e.kind] += 1; if (e.chosen) stat.picked += 1; else stat.fallback += 1; }
        if (!seenMid && st.turn >= MID && st.field) { seenMid = true; mid.push(poolDiff(st)); }
      }, variant);
      results.push(r);
    }
    const row = {
      deck, opp, variant: variant || 'bisheriger Bot', games, botWins: results.filter((r) => r.winner === 'bot').length,
      medianTurns: median(results.map((r) => r.turns)), poolDiffTurn7: mean(mid), reachedTurn7: mid.length,
      decisionsMain: stat.main, decisionsChain: stat.chain, chosen: stat.picked, fallbackOrPass: stat.fallback,
      secondsPerGame: (performance.now() - t0) / 1000 / games
    };
    rows.push(row);
    console.log(`${opp.padEnd(10)} (Bot) gegen ${deck.padEnd(10)} (ich) | ${row.variant.padEnd(16)} Siege ${row.botWins}/${games}, Züge Median ${row.medianTurns}, `
      + `Kartenvorteil Z${MID} ${row.poolDiffTurn7 === null ? '-' : row.poolDiffTurn7.toFixed(2)} (n=${row.reachedTurn7}), `
      + `Entscheidungen Haupt ${row.decisionsMain} / Kette ${row.decisionsChain}, gewählt ${row.chosen}, Rückfall/Pass ${row.fallbackOrPass}, ${row.secondsPerGame.toFixed(1)} s je Partie`);
  }
}
if (process.env.ADVISOR_EVAL_OUT) fs.writeFileSync(process.env.ADVISOR_EVAL_OUT, JSON.stringify(rows, null, 1));
server.close();
