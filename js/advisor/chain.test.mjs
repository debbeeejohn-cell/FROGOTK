// Run: node --no-warnings js/advisor/chain.test.mjs  (answers in chain windows, measured by the engine, with the user's examples)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore, cardTable, newGame, L, P, M, R, IDLE, BATTLE } from '../duel-core.js';
import { evaluateChain, stimulusOf, restage } from './chain.js';
import { advisorHook } from './index.js';
import { graveOption } from './dimensions.js';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url)));
const table = cardTable(json('core-cards.json'));
const { scripts } = json('core-scripts.json');
const id = new Map(json('cards.json').cards.map((c) => [c.name, c.id]));
const decks = json('decks.json');
const weights = json('advisor-weights.json');
const codes = (d) => ({ main: d.main.flatMap((c) => Array(c.count).fill(id.get(c.card))), extra: (d.extra || []).flatMap((c) => Array(c.count).fill(id.get(c.card))) });
const lib = await loadCore();
const n = (x) => id.get(x);
const ctx = { table, weights, gyOption: graveOption(scripts, table) };

const set = (side, card, seq) => ({ side, code: n(card), location: L.SZONE, sequence: seq, position: P.FACEDOWN });
const hand = (side, card, seq = 0) => ({ side, code: n(card), location: L.HAND, sequence: seq, position: P.FACEDOWN });
const mon = (side, card, seq) => ({ side, code: n(card), location: L.MZONE, sequence: seq, position: P.FACEUP_ATTACK });
const mostly = (samples, value, msg) => assert.ok(samples.filter((x) => Math.abs(x - value) < 1e-9).length >= Math.ceil((samples.length * 3) / 4), `${msg}: ${JSON.stringify(samples)} is not mostly ${value}`);

/**
 * Echtes Duell bis zum ersten Kettenfenster des Bots, in dem der Gegner etwas aktiviert hat. drive = was ich bis dahin tue:
 * { activate: Karte (Zug 1) } oder { chain: Karte } (ich antworte im Angriff des Bots). capture(opts, g, m) bekommt das Fenster.
 */
function atWindow(cards, drive, capture, hook = null) {
  const used = (side) => cards.filter((c) => c.side === side).map((c) => c.code);
  const deckOf = (side, list) => { const left = [...codes(decks[list]).main]; for (const code of used(side)) { const at = left.indexOf(code); if (at >= 0) left.splice(at, 1); } return left.map((code) => ({ side, code, location: L.DECK })); };
  let out = null;
  const opts = { lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), start: { lp: { me: 8000, bot: 8000 }, cards: [...cards, ...deckOf('me', 'frogOtk'), ...deckOf('bot', 'blackwing')] }, botPlays: true, askAllChains: true, seed: [1n, 1n, 1n, 1n] };
  opts.botHook = (m, g) => {
    if (m.type === M.SELECT_CHAIN && g.chainBy === g.me && !out) { out = { value: capture(opts, g, m), g, m }; return hook ? hook(opts)(m, g) : { type: R.SELECT_CHAIN, index: null }; }
    return undefined;
  };
  const g = newGame(opts);
  for (let i = 0; i < 60 && g.prompt && !out && g.turn < 4; i += 1) {
    const m = g.prompt;
    let r;
    if (m.type === M.SELECT_IDLECMD && drive.activate && g.turn === 1) r = { type: R.SELECT_IDLECMD, action: IDLE.SELECT_ACTIVATE, index: m.activates.findIndex((c) => table.name(c.code) === drive.activate) };
    else if (m.type === M.SELECT_CHAIN && drive.chain) r = { type: R.SELECT_CHAIN, index: Math.max(-1, m.selects.findIndex((c) => table.name(c.code) === drive.chain)) < 0 ? null : m.selects.findIndex((c) => table.name(c.code) === drive.chain) };
    else r = m.type === M.SELECT_IDLECMD ? { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null } : m.type === M.SELECT_BATTLECMD ? { type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null } : m.type === M.SELECT_CHAIN ? { type: R.SELECT_CHAIN, index: m.forced ? 0 : null } : m.type === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : { type: R.SELECT_YESNO, yes: false };
    g.respond(r);
  }
  const log = out ? structuredClone(out.g.advisorLog ?? []) : null;
  g.close();
  assert.ok(out, 'the bot reached a chain window');
  return { value: out.value, log };
}
const measure = (cards, drive) => atWindow(cards, drive, (opts, g, m) => evaluateChain(opts, g, m, ctx)).value;

// Der Gegner aktiviert Heavy Storm, ich habe Icarus Attack und eine zweite Karte des Gegners liegt dort: das Tributmonster ginge umsonst verloren
const storm = measure([hand('me', 'Heavy Storm'), set('me', 'Scapegoat', 0), mon('bot', 'Blackwing - Shura the Blue Flame', 0), set('bot', 'Icarus Attack', 0)], { activate: 'Heavy Storm' });
assert.equal(storm.stimulus.kind, 'activation');
const icarus = storm.candidates.find((c) => c.label.includes('Icarus Attack'));
mostly(icarus.samples, -1, 'the monster is lost for nothing: one card less than passing');
assert.ok(icarus.total < 0, 'so the bot does not answer');

// Greift der Bot an und der Gegner antwortet mit Mirror Force, stirbt das Tributmonster ohnehin: gegenüber Nichtstun ändert sich nichts
const mirror = measure([mon('bot', 'Blackwing - Shura the Blue Flame', 0), set('bot', 'Icarus Attack', 0), set('me', 'Mirror Force', 0), set('me', 'Scapegoat', 1)], { chain: 'Mirror Force' });
assert.equal(mirror.stimulus.kind, 'attack');
const doomed = mirror.candidates.find((c) => c.label.includes('Icarus Attack'));
mostly(doomed.samples, 0, 'a 2:2 trade in cards');
assert.ok(Math.abs(doomed.dims.tempo) < 1e-9, 'the monster is gone either way, no tempo is lost');

// Dieselbe Antwort ist schlechter, wenn das Monster ohne sie überlebt hätte (kein Mirror Force): hier gleicht sie nichts aus
assert.ok(doomed.total > icarus.total, 'answering Mirror Force is better than answering a Heavy Storm with the same card');

// Gibt die Engine keine Antwort frei, gibt es nichts zu bewerten
assert.equal(measure([hand('me', 'Heavy Storm'), mon('bot', 'Blackwing - Shura the Blue Flame', 0), set('bot', 'Icarus Attack', 0)], { activate: 'Heavy Storm' }), null, 'no legal answer, nothing measured');

// Verdeckte Information: andere verdeckte Karte des Gegners, gleiche Messung
const other = measure([hand('me', 'Heavy Storm'), set('me', 'Torrential Tribute', 0), mon('bot', 'Blackwing - Shura the Blue Flame', 0), set('bot', 'Icarus Attack', 0)], { activate: 'Heavy Storm' });
assert.deepEqual(other.candidates.map((c) => c.dims), storm.candidates.map((c) => c.dims), 'a different hidden card does not change what the bot measures');

// Gleiche Lage, gleicher Seed: gleiche Messung
assert.deepEqual(measure([hand('me', 'Heavy Storm'), set('me', 'Scapegoat', 0), mon('bot', 'Blackwing - Shura the Blue Flame', 0), set('bot', 'Icarus Attack', 0)], { activate: 'Heavy Storm' }), storm);

// Der Hook entscheidet im Kettenfenster, antwortet bei negativem Wert nicht und protokolliert alles
const hooked = atWindow([hand('me', 'Heavy Storm'), set('me', 'Scapegoat', 0), mon('bot', 'Blackwing - Shura the Blue Flame', 0), set('bot', 'Icarus Attack', 0)], { activate: 'Heavy Storm' }, () => 0, (opts) => advisorHook(opts, weights, { worlds: 4 }));
assert.equal(hooked.log.length, 1);
assert.equal(hooked.log[0].kind, 'chain');
assert.equal(hooked.log[0].chosen, null);
assert.equal(hooked.log[0].fallback, 'keine Antwort lohnt sich');
assert.deepEqual(Object.keys(hooked.log[0].knowledge), ['known', 'estimated', 'unknown']);

// Nicht nachspielbare Auslöser: Monstereffekte und lange Ketten bleiben beim bisherigen Bot
const fake = (over) => ({ me: 0, bot: 1, active: 0, phase: 4, chainBy: 0, chainSize: 1, chainCode: n('Heavy Storm'), attackBy: null, attackInfo: null, ...over });
assert.equal(stimulusOf(fake({ chainCode: n('Swap Frog') }), table), null, 'a monster effect is not rebuilt');
assert.equal(stimulusOf(fake({ chainSize: 2 }), table), null, 'chains longer than one link are not rebuilt');
assert.equal(stimulusOf(fake({ chainBy: 1 }), table), null, 'only an answer to my opponent counts');
assert.equal(stimulusOf(fake({ active: 1 }), table), null, 'an activation in my own turn is no stimulus of the opponent');
assert.equal(stimulusOf(fake({}), table).kind, 'activation');

// restage: Die aktivierte Karte kommt vor den Auslöser zurück (Zauber auf die Hand, Falle gesetzt)
const staged = restage({ lp: {}, cards: [{ side: 'me', code: n('Heavy Storm'), location: L.SZONE, sequence: 0, position: P.FACEUP_ATTACK }] }, { code: n('Heavy Storm'), trap: false });
assert.equal(staged.cards[0].location, L.HAND);
const trap = restage({ lp: {}, cards: [{ side: 'me', code: n('Mirror Force'), location: L.SZONE, sequence: 2, position: P.FACEUP_ATTACK }] }, { code: n('Mirror Force'), trap: true });
assert.deepEqual([trap.cards[0].location, trap.cards[0].sequence, !!(trap.cards[0].position & P.FACEDOWN)], [L.SZONE, 2, true]);

console.log('advisor chain: all checks passed');
