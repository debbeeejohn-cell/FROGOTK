// Run: node --no-warnings js/advisor/probe.test.mjs  (the engine measures each action; the user's examples, no card special-cased)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore, cardTable, newGame, L, P, M, R, IDLE } from '../duel-core.js';
import { evaluateMain, sanitize } from './probe.js';
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
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} !~ ${b}`);
// Der Gegner kann in einer Probewelt antworten (gezogene verdeckte Karte): Die Mehrheit der Welten zeigt den Wert der Aktion selbst.
const mostly = (result, value, msg) => assert.ok(result.samples.filter((x) => Math.abs(x - value) < 1e-9).length >= Math.ceil((result.samples.length * 3) / 4), `${msg}: samples ${JSON.stringify(result.samples)} are not mostly ${value}`);

const set = (side, card, seq) => ({ side, code: n(card), location: L.SZONE, sequence: seq, position: P.FACEDOWN });
const hand = (side, card, seq = 0) => ({ side, code: n(card), location: L.HAND, sequence: seq, position: P.FACEDOWN });
const mon = (side, card, seq) => ({ side, code: n(card), location: L.MZONE, sequence: seq, position: P.FACEUP_ATTACK });

/** Echtes Duell am Anfang der ersten Hauptphase des Bots (Zug 2). Das Ergebnis ist, was das Bewertungssystem dort misst. */
function measureAt(cards, botDeck = 'blackwing') {
  const used = (side) => cards.filter((c) => c.side === side).map((c) => c.code);
  const deckOf = (side, list) => { const left = [...codes(decks[list]).main]; for (const code of used(side)) { const at = left.indexOf(code); if (at >= 0) left.splice(at, 1); } return left.map((code) => ({ side, code, location: L.DECK })); };
  let result = null;
  const opts = { lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks[botDeck]), start: { lp: { me: 8000, bot: 8000 }, cards: [...cards, ...deckOf('me', 'frogOtk'), ...deckOf('bot', botDeck)] }, botPlays: true, seed: [1n, 1n, 1n, 1n] };
  opts.botHook = (m, g) => {
    if (m.type === M.SELECT_IDLECMD && g.active === g.bot && g.phase === 4 && g.turn === 2 && !result) {
      result = evaluateMain(opts, g, m, ctx);
      return { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null };
    }
    return undefined;
  };
  const g = newGame(opts);
  for (let i = 0; i < 40 && g.prompt && !result; i += 1) g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
  g.close();
  assert.ok(result, 'the bot reached its first Main Phase');
  return (label) => result.find((r) => r.label.includes(label)) ?? assert.fail(`no candidate "${label}" in ${result.map((r) => r.label).join(' | ')}`);
}

// Heavy Storm gegen zwei verdeckte Karten, keine eigenen: +1 Raw Card Advantage, gemessen
const storm = measureAt([hand('bot', 'Heavy Storm'), set('me', 'Scapegoat', 0), set('me', 'Mirror Force', 1)]);
const stormRaw = storm('Aktivieren Heavy Storm');
mostly(stormRaw, 1, 'Heavy Storm');
assert.ok(stormRaw.dims.raw > storm('Setzen Heavy Storm').dims.raw, 'activating beats just setting it');

// Eine Karte für ein schlichtes Monster (Fissure): 0 Raw Card Advantage. Der Friedhofsnutzen steht getrennt (negativ: der Gegner bekommt ihn)
const fissure = measureAt([hand('bot', 'Fissure'), mon('me', 'Fishborg Blaster', 0)]).call(null, 'Aktivieren Fissure');
mostly(fissure, 0, 'Fissure');
assert.ok(fissure.dims.graveyard < 0, 'Fishborg Blaster can come back from the Graveyard');

// Ein Monster, das beim Beschwören eine Karte sucht und auf dem Feld bleibt: +1 (der Fall von Stratos)
const gear = measureAt([hand('bot', 'Machina Gearframe')], 'jinzoOtk')('Normalbeschwören Machina Gearframe');
mostly(gear, 1, 'Machina Gearframe');
assert.ok(gear.dims.quality > 0, 'the searched card is a good one, counted apart from the card itself');

// Normalbeschwörung allein: Hand -> Feld verliert nichts
const summon = measureAt([hand('bot', 'Blackwing - Gale the Whirlwind')])('Normalbeschwören Blackwing - Gale');
mostly(summon, 0, 'Normal Summon');
assert.ok(summon.dims.tempo > 0);

// Icarus Attack blind: Karte für Karte (0), aber das geopferte Monster kostet Tempo
const icarus = measureAt([mon('bot', 'Blackwing - Shura the Blue Flame', 0), set('bot', 'Icarus Attack', 0), set('me', 'Scapegoat', 0), set('me', 'Mirror Force', 1)])('Aktivieren Icarus Attack');
mostly(icarus, 0, 'Icarus Attack');
assert.ok(icarus.dims.tempo < 0 && icarus.total < 0, 'blind it is not worth a monster');

// Verdeckte Information: andere verdeckte Gegnerkarten und andere Gegnerhand ergeben dieselbe Messung
const bring = (foeSet, foeHand) => measureAt([hand('bot', 'Heavy Storm'), set('me', foeSet[0], 0), set('me', foeSet[1], 1), hand('me', foeHand)]);
const one = bring(['Scapegoat', 'Mirror Force'], 'Des Frog')('Aktivieren Heavy Storm');
const two = bring(['Torrential Tribute', 'Trap Dustshoot'], 'Dupe Frog')('Aktivieren Heavy Storm');
assert.deepEqual({ ...one, label: 0 }, { ...two, label: 0 }, 'hidden cards of mine do not change what the bot measures');

// Gleiche Lage, gleicher Seed: gleiche Messung, auch im Log
assert.deepEqual(measureAt([hand('bot', 'Heavy Storm'), set('me', 'Scapegoat', 0)])('Aktivieren Heavy Storm'), measureAt([hand('bot', 'Heavy Storm'), set('me', 'Scapegoat', 0)])('Aktivieren Heavy Storm'));

// sanitize: Gegnerhand, verdeckte Karten und Extra Deck der Ansicht tragen nichts Echtes
const v = (handCode, setCode) => [{ hand: [], mz: [null, null, null, null, null], st: [null, null, null, null, null], field: null, gy: [], banished: [], deck: 30, extra: [] },
  { hand: [{ code: handCode, position: P.FACEDOWN }], mz: [{ code: setCode, position: P.FACEDOWN, attack: 1500, defense: 0 }, null, null, null, null], st: [null, null, null, null, null], field: null, gy: [], banished: [], deck: 30, extra: [{ code: setCode }] }];
const lists = { foeMain: [n('Des Frog')], foeExtra: [n('Goyo Guardian')] };
assert.deepEqual(sanitize(v(1, 2), 1, lists), sanitize(v(3, 4), 1, lists));

console.log('advisor probe: all checks passed');
