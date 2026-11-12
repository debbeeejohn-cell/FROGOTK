#!/usr/bin/env node
// Misst den Bot: Die Gegenseite (der Bot) spielt seine Heuristik, ich spiele zufällig, aber mit festem Seed je
// Partie. So ist jeder Lauf wiederholbar, und zwei Versionen des Bots lassen sich direkt vergleichen.
//   node --no-warnings scripts/bot-eval.mjs [games] [lookahead|advisor]
import { server } from './duel-server.mjs';

export const PAIRS = [['blackwing', 'frogOtk'], ['frogOtk', 'blackwing'], ['jinzoOtk', 'gigavise']];
const PASS = /Zug beenden|Battle Phase|Main Phase 2|Nicht aktivieren|Nein/;

// mulberry32: kleiner, fester Zufallsgenerator für meine Züge
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function call(base, path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

function myChoice(st, rand) {
  const p = st.prompt;
  if (p.multi) {
    const max = Math.min(p.max ?? p.choices.length, p.choices.length);
    const min = Math.min(p.min ?? 1, max);
    const count = min + Math.floor(rand() * (max - min + 1));
    return { pick: p.choices.map((c) => c.id).slice(0, count) };
  }
  const acts = p.kind === 'actions' ? p.choices.filter((c) => !PASS.test(c.label)) : p.choices;
  const pool = acts.length ? acts : p.choices;
  return { choice: pool[Math.floor(rand() * pool.length)].id };
}

/** onState(st): wird nach jedem Zustand aufgerufen (für Auswertungen wie scripts/guess-eval.mjs). */
export async function play(base, deck, opp, seed, onState = () => {}, variant = '') {
  const rand = rng(seed);
  let st = await call(base, '/new', { deck, opp, seed: [seed, seed + 1, seed + 2, seed + 3].map(String), bot: 'aktiv', lookahead: variant === 'lookahead' || variant === true, advisor: variant === 'advisor' });
  onState(st);
  let steps = 0;
  while (st.duel && st.winner === null && st.prompt && steps < 600) {
    let next = null;
    for (let t = 0; t < 6 && !next; t += 1) {
      const res = await call(base, '/answer', myChoice(st, rand));
      if (res.ok) next = res;
    }
    if (!next) break;
    st = next; steps += 1; onState(st);
  }
  return { winner: st.winner, turns: st.turn };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/bot-eval.mjs')) {
  const games = Number(process.argv[2] ?? 100);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [deck, opp] of PAIRS) {
    const rows = [];
    for (let i = 0; i < games; i += 1) rows.push(await play(base, deck, opp, 1000 + i * 7, undefined, process.argv[3] ?? ''));
    const botWins = rows.filter((r) => r.winner === 'bot').length;
    const turns = rows.map((r) => r.turns).sort((a, b) => a - b);
    console.log(`${opp.padEnd(10)} (Bot) gegen ${deck.padEnd(10)} (ich): Bot gewinnt ${botWins}/${games}, Züge Median ${turns[Math.floor(turns.length / 2)]}`);
  }
  server.close();
}
