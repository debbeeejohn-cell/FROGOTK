// Run: node --no-warnings js/duel-core.test.mjs  (Bot Duel on the real engine, needs data/core-*.json)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore, cardTable, newGame, traceOf, compareCombo, M, R, IDLE, BATTLE } from './duel-core.js';
import { features, score, pickSoftmax, WEIGHTS } from './decide.js';
import { snapshot, rollout, lookahead } from './lookahead.js';
import { L, P, seededRandom } from './duel-core.js';

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

// Teacher: compare my plays with a saved combo that fits my opening hand
g = start();
summonSwapFrog(g);
const combo = { name: 'Swap Start', hand: ['Swap Frog'], trace: traceOf(g.log) };
assert.deepEqual(combo.trace, ['Normalbeschwörung Swap Frog', 'aktiviert Swap Frog']);
assert.match(compareCombo(combo, ['Swap Frog', 'Scapegoat'], combo.trace), /vollständig gespielt \(2 Schritte\)/);
assert.match(compareCombo(combo, ['Swap Frog'], ['Normalbeschwörung Swap Frog']), /Schritt 2 von 2: erwartet „aktiviert Swap Frog“, du hast nichts mehr gespielt/);
assert.match(compareCombo(combo, ['Swap Frog'], ['setzt Scapegoat']), /Schritt 1 von 2: .*du hast „setzt Scapegoat“ gespielt/);
assert.equal(compareCombo(combo, ['Scapegoat'], []), null, 'combo needs Swap Frog in the opening hand');
assert.equal(compareCombo({ ...combo, hand: ['Swap Frog', 'Swap Frog'] }, ['Swap Frog'], []), null, 'needs two copies');

// Phase 2: features of my own legal actions (summon costs a hand card and adds its ATK to the field)
g = start({ hand: [id.get('Swap Frog')] });
const feats = features(g.prompt, table, g, g.me);
const summonSwap = feats.find((f) => f.kind === 'summons' && f.index === g.prompt.summons.findIndex((c) => name(c) === 'Swap Frog'));
assert.deepEqual({ boardGain: summonSwap.boardGain, handCost: summonSwap.handCost }, { boardGain: 1000, handCost: 1 });
assert.equal(g.prompt.summons.length > 0, true);
assert.equal(features(g.prompt, table, g, g.me).length > 0, true);

// Phase 3: the category order holds (spell > summon > special > effect > set > phase), softmax at 0 picks the best
const noRisk = { boardGain: 0, handCost: 0, damage: 0, risk: 0 };
assert.ok(score('spell', { ...noRisk, handCost: 1 }) > score('summon', { ...noRisk, boardGain: 2800, risk: 3 }));
assert.ok(score('summon', { ...noRisk, boardGain: 2800 }) > score('special', { ...noRisk, boardGain: 2800 }));
assert.ok(score('special', { ...noRisk, boardGain: 0 }) > score('effect', { ...noRisk, boardGain: 2800 }));
assert.ok(score('effect', noRisk) > score('set', { ...noRisk, handCost: 1 }));
assert.ok(score('set', noRisk) > score('phase', noRisk));
const scored = [{ id: 'a', score: 10 }, { id: 'b', score: 30 }, { id: 'c', score: 20 }];
assert.equal(pickSoftmax(scored, 0).id, 'b');
assert.ok(WEIGHTS.kind.spell > WEIGHTS.kind.summon);
assert.equal(pickSoftmax(scored, 5, () => 0.999).id !== undefined, true, 'a warm softmax still returns one of the options');

// same seed + same answers = same duel (this is how undo works)
const a = start(); const b = start();
for (const x of [a, b]) x.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
assert.deepEqual(a.view(), b.view());
assert.deepEqual(a.log, b.log);

// A whole starting position: LP, field, hand and deck order are placed, nobody draws an opening hand.
// The last deck card is on top: the bot draws Kalut in turn 2, Bora pierces with it and Shura finishes.
{
  const n = (x) => id.get(x);
  const cards = [
    { side: 'bot', code: n('Blackwing - Shura the Blue Flame'), location: L.MZONE, sequence: 0, position: P.FACEUP_ATTACK },
    { side: 'bot', code: n('Blackwing - Bora the Spear'), location: L.HAND, sequence: 0, position: P.FACEDOWN },
    { side: 'bot', code: n('Black Whirlwind'), location: L.DECK }, { side: 'bot', code: n('Blackwing - Kalut the Moon Shadow'), location: L.DECK },
    { side: 'me', code: n('Swap Frog'), location: L.MZONE, sequence: 2, position: P.FACEDOWN_DEFENSE },
    ...Array(4).fill({ side: 'me', code: n('Des Frog'), location: L.DECK })
  ];
  g = newGame({ lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), start: { lp: { me: 3000, bot: 6000 }, cards }, botPlays: true, stopTurn: 4, seed: [1n, 1n, 1n, 1n] });
  assert.deepEqual([g.lp[g.me], g.lp[g.bot]], [3000, 6000]);
  assert.deepEqual(g.view()[g.me].hand.map(name), ['Des Frog'], 'only the turn draw');
  g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
  assert.equal(g.winner, g.bot);
  assert.ok(g.log.some((l) => l.includes('aktiviert Blackwing - Kalut the Moon Shadow')), 'the top deck card was drawn and used');
  g.close();
}

// Lookahead: the bot's sampled world must not depend on my hidden cards, only on public ones.
{
  g = start({ botPlays: true, hand: [id.get('Dupe Frog'), id.get('Swap Frog')], seed: [3n, 1n, 4n, 1n] });
  g.respond({ type: R.SELECT_IDLECMD, action: IDLE.SELECT_MONSTER_SET, index: g.prompt.monster_sets.findIndex((c) => name(c) === 'Dupe Frog') });
  const view = g.view(); const mine = view[g.me];
  const at = mine.mz.findIndex(Boolean);
  assert.ok(mine.mz[at].position & P.FACEDOWN);
  const info = { bot: g.bot, me: g.me, lp: g.lp, botMain: codes(decks.blackwing).main, meMain: codes(decks.frogOtk).main, table };
  const world = () => snapshot(view, info, seededRandom([9n, 9n, 9n, 9n]));
  const before = world();
  mine.mz[at].code = id.get('Des Frog'); mine.hand.forEach((c) => { c.code = id.get('Unifrog'); }); // other hidden cards, same public board
  assert.deepEqual(world(), before, 'hidden cards do not leak into the sampled world');
  const mySide = before.cards.filter((c) => c.side === 'me' && c.location !== L.EXTRA);
  assert.equal(mySide.length, 40, 'my 40 cards are all somewhere');
  assert.equal(mySide.filter((c) => c.location === L.MZONE).length, 1);
  assert.ok(table.data.get(mySide.find((c) => c.location === L.MZONE).code).type & 1, 'a set monster is guessed as a monster');
  // a sampled world plays to its end without an engine error, and fast enough for a few per turn
  const t0 = performance.now();
  const v = rollout({ lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing) }, before, { action: IDLE.TO_BP });
  console.log(`  eine Probewelt: ${(performance.now() - t0).toFixed(0)} ms`);
  assert.equal(typeof v, 'number');
  g.close();
}

// Lookahead is reproducible: the same duel twice gives the same game (needed for undo and combo replay).
{
  const play = () => {
    const opts = { lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), hand: [], seed: [3n, 1n, 4n, 1n], botPlays: true };
    opts.botHook = lookahead(opts);
    const game = newGame(opts);
    for (let i = 0; i < 6 && game.prompt; i += 1) {
      const m = game.prompt;
      game.respond(m.type === M.SELECT_IDLECMD ? { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null }
        : m.type === M.SELECT_BATTLECMD ? { type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null }
          : m.type === M.SELECT_CHAIN ? { type: R.SELECT_CHAIN, index: null } : { type: R.SELECT_EFFECTYN, yes: false });
    }
    const out = { log: [...game.log], look: game.lookLog };
    game.close();
    return out;
  };
  const a = play();
  assert.ok(a.look?.length > 0, 'the bot looked ahead at least once');
  assert.deepEqual(play(), a);
}

// Icarus Attack: the bot only chains it when I control at least 2 cards (both targets can be mine).
{
  const n = (x) => id.get(x);
  const play = (extraCards) => {
    const cards = [
      { side: 'bot', code: n('Blackwing - Shura the Blue Flame'), location: L.MZONE, sequence: 0, position: P.FACEUP_ATTACK },
      { side: 'bot', code: n('Icarus Attack'), location: L.SZONE, sequence: 0, position: P.FACEDOWN },
      ...Array(3).fill({ side: 'bot', code: n('Black Whirlwind'), location: L.DECK }),
      { side: 'me', code: n('Dupe Frog'), location: L.HAND, sequence: 0, position: P.FACEDOWN },
      ...Array(4).fill({ side: 'me', code: n('Des Frog'), location: L.DECK }),
      ...extraCards
    ];
    const game = newGame({ lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), start: { lp: { me: 8000, bot: 8000 }, cards }, botPlays: true, seed: [1n, 1n, 1n, 1n] });
    game.respond({ type: R.SELECT_IDLECMD, action: IDLE.SELECT_SUMMON, index: game.prompt.summons.findIndex((c) => name(c) === 'Dupe Frog') });
    const used = game.log.some((l) => l.includes('aktiviert Icarus Attack'));
    game.close();
    return used;
  };
  assert.equal(play([]), false, 'one card of mine: Icarus Attack stays set');
  assert.equal(play([{ side: 'me', code: n('Scapegoat'), location: L.SZONE, sequence: 0, position: P.FACEDOWN }]), true, 'two cards of mine: Icarus Attack is used');
}

// Goyo Guardian needs an EARTH Tuner (its script): a WATER Tuner plus Des Frog offers no Synchro summon.
{
  const n = (x) => id.get(x);
  const cards = [
    { side: 'me', code: n('Fishborg Blaster'), location: L.MZONE, sequence: 0, position: P.FACEUP_ATTACK },
    { side: 'me', code: n('Des Frog'), location: L.MZONE, sequence: 1, position: P.FACEUP_ATTACK },
    ...Array(3).fill({ side: 'me', code: n('Des Frog'), location: L.DECK })
  ];
  g = newGame({ lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), start: { lp: { me: 8000, bot: 8000 }, cards }, seed: [3n, 1n, 4n, 1n] });
  assert.equal(g.prompt.type, M.SELECT_IDLECMD);
  assert.deepEqual(g.prompt.special_summons.map(name), [], 'no Goyo with a WATER Tuner');
  g.close();
}

console.log('duel-core: all checks passed');
