#!/usr/bin/env node
// Plays many Bot Duels with random choices for me and the active bot on the other side, and writes each
// game as one JSON line: decks, seed and every answer I sent. Replaying a line (same seed, same answers)
// gives exactly the same game, so the file is training data for a later learning bot.
//
//   node --no-warnings scripts/selfplay.mjs <games> <out.jsonl> [deck] [opponent]
//   node --no-warnings scripts/selfplay.mjs --replay <file.jsonl> <index>
// ponytail: random play only; a learned policy would replace pick() and keep the same file format.

import fs from 'node:fs';
import { server } from './duel-server.mjs';

const MAX_STEPS = 600;   // stops endless loops (e.g. a card that bounces itself forever)
const TRIES = 6;         // a rejected answer (e.g. a Summe that does not add up) is re-rolled this often
const PASS = /Zug beenden|Battle Phase|Main Phase 2|Nicht aktivieren/;

async function call(base, method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json();
}

/** A random legal answer to the open question. Phases and passes are used only when nothing else is offered. */
export function pick(st) {
  const p = st.prompt;
  if (p.multi) {
    const max = Math.min(p.max ?? p.choices.length, p.choices.length);
    const min = Math.min(p.min ?? 1, max);
    const count = min + Math.floor(Math.random() * (max - min + 1));
    return { pick: p.choices.map((c) => c.id).sort(() => Math.random() - 0.5).slice(0, count) };
  }
  const acts = p.kind === 'actions' ? p.choices.filter((c) => !PASS.test(c.label)) : p.choices;
  const pool = acts.length ? acts : p.choices;
  return { choice: pool[Math.floor(Math.random() * pool.length)].id };
}

const result = (st, steps) => ({ winner: st.winner, turns: st.turn, lp: st.lp, steps });

/** One game from start to end; returns the record (the answers are the replay). */
export async function playGame(base, { deck, opp, seed }) {
  let st = await call(base, 'POST', '/new', { deck, opp, seed, bot: 'aktiv' });
  const answers = [];
  while (st.duel && st.winner === null && st.prompt && answers.length < MAX_STEPS) {
    let body = null; let next = null;
    for (let t = 0; t < TRIES && !next; t += 1) {
      body = pick(st);
      const res = await call(base, 'POST', '/answer', body);
      if (res.ok) next = res;
    }
    if (!next) return { ...result(st, answers.length), stuck: true, answers };
    answers.push(body);
    st = next;
  }
  return { ...result(st, answers.length), stuck: st.winner === null, answers };
}

/** Plays a recorded game again and returns the same kind of result, for comparison. */
export async function replayGame(base, rec) {
  let st = await call(base, 'POST', '/new', { deck: rec.deck, opp: rec.opp, seed: rec.seed, bot: 'aktiv' });
  for (const body of rec.answers) {
    st = await call(base, 'POST', '/answer', body);
    if (!st.ok) throw new Error(`Aufzeichnung passt nicht mehr: ${st.error}`);
  }
  return result(st, rec.answers.length);
}

const randomSeed = () => [0, 1, 2, 3].map(() => String(1 + Math.floor(Math.random() * 2 ** 31)));

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/selfplay.mjs')) {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const args = process.argv.slice(2);
  if (args[0] === '--replay') {
    const [file, index] = [args[1], Number(args[2])];
    const rec = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[index]);
    console.log('aufgezeichnet:', { winner: rec.winner, turns: rec.turns, lp: rec.lp, steps: rec.steps });
    console.log('nachgespielt: ', await replayGame(base, rec));
  } else {
    const [games = '10', out = 'selfplay.jsonl', deck = 'frogOtk', opp = 'blackwing'] = args;
    const lines = [];
    for (let i = 0; i < Number(games); i += 1) {
      const seed = randomSeed();
      lines.push(JSON.stringify({ id: i, deck, opp, seed, ...(await playGame(base, { deck, opp, seed })) }));
    }
    fs.writeFileSync(out, lines.join('\n') + '\n');
    const rows = lines.map((l) => JSON.parse(l));
    const count = (k) => rows.filter((r) => r.winner === k).length;
    console.log(`${rows.length} Partien nach ${out}: ich ${count('me')}, Bot ${count('bot')}, offen ${rows.filter((r) => r.stuck).length}`);
  }
  server.close();
}
