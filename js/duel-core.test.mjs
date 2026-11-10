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

// active bot: attacks with the lowest ATK first (Gorz rule), then the stronger monster
g = start({ botPlays: true, hand: Array(3).fill(id.get('Reckless Greed')), preset: { monsters: [id.get('Dark Armed Dragon'), id.get('Cyber Dragon')] } });
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
for (let i = 0; i < 20 && g.turn < 3 && g.prompt; i += 1) { // decline everything until my next turn
  const t = g.prompt.type;
  g.respond(t === M.SELECT_CHAIN ? { type: R.SELECT_CHAIN, index: null } : t === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : { type: R.SELECT_YESNO, yes: false });
}
const atkOf = new Map(json('cards.json').cards.map((c) => [c.name, c.atk]));
const attacks = g.log.filter((l) => l.includes('greift an')).reverse().map((l) => atkOf.get(l.slice(5, l.indexOf(' greift an'))));
assert.ok(attacks.length >= 2 && attacks.includes(2100) && attacks.includes(2800), `bot attacked with ${attacks}`);
assert.deepEqual(attacks, [...attacks].sort((x, y) => x - y), 'lowest ATK attacks first');
assert.ok(g.lp[g.me] <= 8000 - attacks.reduce((sum, n) => sum + n, 0)); // hand effects like Kalut can add damage
assert.deepEqual(g.errors, []);

// Blackwing bot follows the deck plan: free Special Summons and a Synchro, then wins against a player who only passes
g = start({ botPlays: true, hand: [], seed: [3n, 1n, 4n, 1n] });
for (let i = 0; i < 200 && g.prompt; i += 1) {
  const p = g.prompt;
  g.respond(p.type === M.SELECT_IDLECMD ? { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null }
    : p.type === M.SELECT_CHAIN ? { type: R.SELECT_CHAIN, index: p.forced ? 0 : null }
      : p.type === M.SELECT_CARD ? { type: R.SELECT_CARD, indicies: [0] }
        : p.type === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : { type: R.SELECT_YESNO, yes: false });
}
assert.equal(g.winner, g.bot);
assert.ok(g.log.includes('Bot: Spezialbeschwörung Blackwing - Bora the Spear'));
assert.ok(g.log.includes('Bot: Spezialbeschwörung Blackwing Armed Wing'), 'bot Synchro Summons');
assert.deepEqual(g.errors, []);

// Missing the timing: Dupe Frog ("When ... you can") tributed as Substitoad's cost gets no search,
// because the Special Summon is the last thing to happen. Destroyed by battle, it does trigger.
const pickIdle = (list, action, card) => ({ type: R.SELECT_IDLECMD, action, index: g.prompt[list].findIndex((c) => name(c) === card) });
g = start({ hand: [id.get('Dupe Frog'), id.get('Substitoad')] });
g.respond(pickIdle('summons', IDLE.SELECT_SUMMON, 'Dupe Frog'));
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
g.respond(pickIdle('summons', IDLE.SELECT_SUMMON, 'Substitoad'));
if (g.prompt.type === M.SELECT_CHAIN) g.respond({ type: R.SELECT_CHAIN, index: null }); // 2010 ignition priority window
g.respond(pickIdle('activates', IDLE.SELECT_ACTIVATE, 'Substitoad'));
const asked = [];
for (let i = 0; i < 8 && g.prompt.type !== M.SELECT_IDLECMD; i += 1) {
  const p = g.prompt; asked.push(p.type);
  g.respond(p.type === M.SELECT_UNSELECT_CARD ? { type: R.SELECT_UNSELECT_CARD, index: p.select_cards.length ? p.select_cards.findIndex((c) => name(c) === 'Dupe Frog') : null }
    : p.type === M.SELECT_CARD ? { type: R.SELECT_CARD, indicies: [0] } : { type: R.SELECT_POSITION, position: 1 });
}
assert.ok(g.view()[g.me].gy.some((c) => name(c) === 'Dupe Frog'));
assert.ok(!asked.includes(M.SELECT_EFFECTYN), 'tributed for cost: timing missed, no search offered');

g = start({ botPlays: true, hand: [id.get('Dupe Frog')], preset: { monsters: [id.get('Cyber Dragon')] } });
g.respond(pickIdle('summons', IDLE.SELECT_SUMMON, 'Dupe Frog'));
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
while (g.prompt?.type === M.SELECT_CHAIN) g.respond({ type: R.SELECT_CHAIN, index: null });
assert.equal(g.prompt.type, M.SELECT_EFFECTYN, 'destroyed by battle: search is offered');
assert.equal(table.name(g.prompt.code), 'Dupe Frog');

// Teacher: reviews my turn when it ends
const endTurn = { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null };
g = start();
g.respond(endTurn); // turn 1: Swap Frog in hand, never summoned
assert.equal(g.review.turn, 1);
assert.ok(g.review.notes.some((n) => n.startsWith('Normalbeschwörung nicht genutzt') && n.includes('Swap Frog')));
g = start();
summonSwapFrog(g);
g.respond(endTurn);
assert.deepEqual(g.review.notes, [], 'nothing to criticise: summoned, and no attack is allowed on turn 1');
g.respond(endTurn); // turn 3: Swap Frog could attack directly
assert.ok(g.review.notes.some((n) => n.startsWith('Battle Phase übersprungen') && n.includes('Swap Frog')));
g = start();
summonSwapFrog(g);
g.respond(endTurn);
g.lp[g.bot] = 1000; // Swap Frog (1000 ATK) is exactly lethal
g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null });
g.respond({ type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null });
assert.ok(g.review.notes.some((n) => n.startsWith('Tödlicher Schaden lag auf dem Feld: 1000')));

// same seed + same answers = same duel (this is how undo works)
const a = start(); const b = start();
for (const x of [a, b]) x.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
assert.deepEqual(a.view(), b.view());
assert.deepEqual(a.log, b.log);

console.log('duel-core: all checks passed');
