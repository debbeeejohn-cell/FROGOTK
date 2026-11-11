#!/usr/bin/env node
// Misst die Schätzung verdeckter Karten (js/guess.js) gegen die Wahrheit der Engine. Immer wenn der Bot eine Karte
// in die Zauber-/Fallenzone setzt, wird gefragt: Welche Wahrscheinlichkeit hätte ein Beobachter der echten Karte
// gegeben, der nur die Decklist und die offen gesehenen Karten kennt?
//   node --no-warnings scripts/guess-eval.mjs [games]
// ponytail: misst nur, was der Bot setzt (Fallen). Gesetzte Monster und damit die Setz-Tendenzen prüft das nicht.
import fs from 'node:fs';
import { server, peek } from './duel-server.mjs';
import { PAIRS, play } from './bot-eval.mjs';
import { unseenPool, faceDownOdds } from '../js/guess.js';

const json = (file) => JSON.parse(fs.readFileSync(new URL(`../data/${file}`, import.meta.url)));
const decks = json('decks.json');
const cards = json('cards.json').cards;
const isMonster = new Set(cards.filter((c) => c.type.includes('Monster')).map((c) => c.name));
const nameOf = new Map(cards.map((c) => [c.id, c.name]));
const { weights } = json('set-tendencies.json');

const VARIANTS = {
  'gleichverteilt': (pool) => faceDownOdds(pool),
  'mit Zone': (pool) => faceDownOdds(pool, {}, (card) => !isMonster.has(card)),
  'Zone + Tendenz': (pool) => faceDownOdds(pool, weights, (card) => !isMonster.has(card))
};

const games = Number(process.argv[2] ?? 100);
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
for (const [deck, opp] of PAIRS) {
  const sums = Object.fromEntries(Object.keys(VARIANTS).map((k) => [k, { p: 0, top: 0 }]));
  let cases = 0;
  for (let i = 0; i < games; i += 1) {
    let before = Array(5).fill(false);
    await play(base, deck, opp, 1000 + i * 7, (st) => {
      const g = peek(); const bot = st.field.bot;
      const down = bot.st.map((c) => !!c?.down);
      // öffentlich: offene Karten des Bots auf dem Feld, im Friedhof und verbannt
      const seen = [...bot.mz, ...bot.st, bot.field].filter((c) => c?.name).map((c) => c.name).concat(bot.gy, bot.banished);
      const pool = unseenPool(decks[opp].main, seen);
      g.view()[g.bot].st.forEach((c, zone) => {
        if (!down[zone] || before[zone]) return;
        const truth = nameOf.get(c.code);
        cases += 1;
        for (const [k, odds] of Object.entries(VARIANTS)) {
          const list = odds(pool);
          sums[k].p += list.find((x) => x.card === truth)?.p ?? 0;
          sums[k].top += list[0]?.card === truth ? 1 : 0;
        }
      });
      before = down;
    });
  }
  console.log(`${decks[opp].name} (Bot), ${cases} gesetzte Karten in ${games} Partien`);
  for (const [k, v] of Object.entries(sums)) {
    console.log(`  ${k.padEnd(15)} echte Karte im Schnitt ${(100 * v.p / cases).toFixed(1)} %, beste Vermutung richtig ${(100 * v.top / cases).toFixed(1)} %`);
  }
}
server.close();
