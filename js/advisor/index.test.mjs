// Run: node --no-warnings js/advisor/index.test.mjs  (the advisor variant plays a whole duel: legal, reproducible, fully logged)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore, cardTable, newGame, M, R, IDLE, BATTLE } from '../duel-core.js';
import { advisorHook } from './index.js';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url)));
const table = cardTable(json('core-cards.json'));
const { scripts } = json('core-scripts.json');
const id = new Map(json('cards.json').cards.map((c) => [c.name, c.id]));
const decks = json('decks.json');
const weights = json('advisor-weights.json');
const codes = (d) => ({ main: d.main.flatMap((c) => Array(c.count).fill(id.get(c.card))), extra: (d.extra || []).flatMap((c) => Array(c.count).fill(id.get(c.card))) });
const lib = await loadCore();

function play(seed) {
  const opts = { lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), seed, botPlays: true };
  opts.botHook = advisorHook(opts, weights, { worlds: 2 });
  const g = newGame(opts);
  for (let i = 0; i < 120 && g.prompt && g.turn < 5; i += 1) {
    const m = g.prompt;
    g.respond(m.type === M.SELECT_IDLECMD ? { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null }
      : m.type === M.SELECT_BATTLECMD ? { type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null }
        : m.type === M.SELECT_CHAIN ? { type: R.SELECT_CHAIN, index: m.forced ? 0 : null }
          : m.type === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : { type: R.SELECT_YESNO, yes: false });
  }
  const out = { log: [...g.log], advisor: structuredClone(g.advisorLog ?? []), errors: [...g.errors] };
  g.close();
  return out;
}

const a = play([5n, 6n, 7n, 8n]);
assert.ok(a.advisor.length >= 1, 'the advisor decided at least once');
assert.deepEqual(a.errors, [], 'every chosen action was legal (the engine reported no error)');

// Das Protokoll ist vollständig: Zustand, alle Kandidaten mit allen Dimensionen, Streuung, Teilwerte, Wahl
for (const entry of a.advisor) {
  assert.equal(entry.kind, 'main');
  assert.deepEqual(Object.keys(entry.knowledge), ['known', 'estimated', 'unknown']);
  assert.ok(entry.weights && entry.worlds >= 1 && Number.isInteger(entry.turn));
  for (const c of entry.candidates) {
    assert.deepEqual(Object.keys(c.dims), ['raw', 'quality', 'tempo', 'graveyard']);
    assert.ok(c.label && c.parts && Array.isArray(c.samples) && typeof c.total === 'number' && typeof c.spread === 'number');
  }
  assert.ok(entry.chosen === null ? entry.fallback : entry.candidates.some((c) => c.label === entry.chosen), 'the choice is one of the logged candidates, or the fallback is named');
}

// Gleiche Lage, gleicher Seed: gleiche Entscheidungen, gleiches Spiel
assert.deepEqual(play([5n, 6n, 7n, 8n]), a);

console.log('advisor index: all checks passed');
