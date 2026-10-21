// Run: node --no-warnings js/duel-core.test.mjs  (Bot Duel on the real engine, needs data/core-*.json)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore, cardTable, newGame, M, R, IDLE, BATTLE } from './duel-core.js';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
const table = cardTable(json('core-cards.json'));
const { scripts } = json('core-scripts.json');
const id = new Map(json('cards.json').cards.map((c) => [c.name, c.id]));
const decks = json('decks.json');
const codes = (deck) => ({
  main: deck.main.flatMap((c) => Array(c.count).fill(id.get(c.card))),
  extra: (deck.extra || []).flatMap((c) => Array(c.count).fill(id.get(c.card)))
});
const lib = await loadCore();
const name = (c) => table.name(c.code);
const start = (extra = {}) => newGame({
  lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing),
  hand: [id.get('Swap Frog'), id.get('Scapegoat')], seed: [5n, 6n, 7n, 8n], ...extra
});

// Swap Frog: Normal Summon -> optional trigger -> pick a WATER monster from the deck -> it hits the GY
function summonSwapFrog(g) {
  assert.equal(g.prompt.type, M.SELECT_IDLECMD);
  g.respond({ type: R.SELECT_IDLECMD, action: IDLE.SELECT_SUMMON, index: g.prompt.summons.findIndex((c) => name(c) === 'Swap Frog') });
  assert.equal(g.prompt.type, M.SELECT_EFFECTYN, 'summon trigger is offered');
  g.respond({ type: R.SELECT_EFFECTYN, yes: true });
  assert.equal(g.prompt.type, M.SELECT_CARD);
  assert.equal(g.hint, 'Select the card(s) to send to the GY');
  const pick = g.prompt.selects[0];
  g.respond({ type: R.SELECT_CARD, indicies: [0] });
  assert.deepEqual(g.view()[g.me].gy.map(name), [name(pick)]);
  assert.equal(g.prompt.type, M.SELECT_IDLECMD, 'no pointless chain window in my own Main Phase');
}

// Edison (Master Rule 1): the player going first draws
let g = start();
assert.equal(g.view()[g.me].hand.length, 6);
assert.equal(g.turn, 1);
summonSwapFrog(g);

// passive bot: draws and passes; then I attack directly and the LP drop automatically
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
assert.equal(g.turn, 3);
assert.equal(g.view()[g.bot].hand.length, 6);
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null });
assert.equal(g.prompt.type, M.SELECT_BATTLECMD);
g.respond({ type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index: 0 });
assert.equal(g.prompt.type, M.SELECT_CHAIN, 'attack declaration opens a chain window (Scapegoat)');
g.respond({ type: R.SELECT_CHAIN, index: null });
assert.deepEqual(g.lp, [8000, 7000]);
assert.deepEqual(g.errors, []);

// the bot activates its set Mirror Force on my attack
g = start({ preset: { spellTraps: [id.get('Mirror Force')] } });
summonSwapFrog(g);
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null });
g.respond({ type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index: 0 });
while (g.prompt?.type === M.SELECT_CHAIN) g.respond({ type: R.SELECT_CHAIN, index: null });
assert.ok(g.log.includes('Bot: aktiviert Mirror Force'));
assert.ok(g.view()[g.me].gy.some((c) => name(c) === 'Swap Frog'));
assert.deepEqual(g.lp, [8000, 8000]);

// Scapegoat: 4 Sheep Tokens (separate passcodes; tokens have no script and must not error)
g = start();
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.SELECT_ACTIVATE, index: g.prompt.activates.findIndex((c) => name(c) === 'Scapegoat') });
assert.deepEqual(g.view()[g.me].mz.map((c) => c && name(c)), Array(4).fill('Sheep Token').concat(null));
assert.deepEqual(g.errors, []);

// same seed + same answers = same duel (this is how undo works)
const a = start(); const b = start();
for (const x of [a, b]) x.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
assert.deepEqual(a.view(), b.view());
assert.deepEqual(a.log, b.log);

console.log('duel-core: all checks passed');
