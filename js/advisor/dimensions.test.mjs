// Run: node js/advisor/dimensions.test.mjs  (strategic dimensions, with the user's examples; no card is special-cased)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OcgPosition as P } from '../../vendor/ocgcore/index.js';
import { sideState } from './resources.js';
import { cardQuality, graveOption, measure, compare, combine } from './dimensions.js';

const weights = JSON.parse(fs.readFileSync(new URL('../../data/advisor-weights.json', import.meta.url)));
const [SPELL, PLAIN, BIRD, SYNCHRO, VAYU, MF, X, Y, ICARUS, BIG] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MON = 1; const EFF = 0x20; const SYN = 0x2000;
const table = {
  data: new Map([
    [SPELL, { type: 2, attack: 0 }], [PLAIN, { type: MON, attack: 1000 }], [BIRD, { type: MON | EFF, attack: 1800 }],
    [SYNCHRO, { type: MON | SYN | EFF, attack: 2800 }], [VAYU, { type: MON | EFF, attack: 1800, alias: 0 }],
    [MF, { type: 4, attack: 0 }], [X, { type: 4, attack: 0 }], [Y, { type: 4, attack: 0 }], [ICARUS, { type: 4, attack: 0 }], [BIG, { type: MON, attack: 2500 }]
  ])
};
const scripts = { [`c${VAYU}.lua`]: 'e1:SetRange(LOCATION_GRAVE)\n' };
const gyOption = graveOption(scripts, table);
const ctx = { table, weights, gyOption };

const c = (code, position = P.FACEUP_ATTACK) => ({ code, position, attack: table.data.get(code)?.attack ?? 0, defense: 0 });
const down = (code) => c(code, P.FACEDOWN);
const pad = (list, n) => [...list, ...Array(n - list.length).fill(null)];
const view = ({ hand = [], mz = [], st = [], gy = [] } = {}) => ({ hand, mz: pad(mz, 5), st: pad(st, 5), field: null, gy, banished: [], deck: 30, extra: [] });
const state = (own, foe) => ({ own: sideState(view(own), table), foe: sideState(view(foe), table) });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

// Qualität: 1 = gewöhnliche Karte, Überschuss aus Kartendaten
assert.equal(cardQuality(SPELL, table, weights.quality), 1);
assert.equal(cardQuality(PLAIN, table, weights.quality), 1);
assert.ok(cardQuality(SYNCHRO, table, weights.quality) > cardQuality(BIRD, table, weights.quality), 'Extra Deck and ATK count');

// Friedhofsoption wird aus dem Skript gelesen, nicht aus einem Namen
assert.equal(gyOption(VAYU), true);
assert.equal(gyOption(BIRD), false);

// Heavy Storm: raw +1, nichts sonst
const stormBefore = state({ hand: [c(SPELL)] }, { st: [down(X), down(Y)] });
const storm = measure(stormBefore, state({ gy: [c(SPELL)] }, { gy: [c(X), c(Y)] }), ctx);
assert.equal(storm.raw, 1);

// Mystical Space Typhoon: raw 0; trifft sie ein Extra-Deck-Monster, zeigt allein die Qualität den Unterschied
const mstBefore = state({ hand: [c(SPELL)] }, { mz: [c(SYNCHRO)] });
const mst = measure(mstBefore, state({ gy: [c(SPELL)] }, { gy: [c(SYNCHRO)] }), ctx);
assert.equal(mst.raw, 0);
assert.ok(mst.quality > 1, 'a Synchro Monster is worth more than a plain card');
const mstPlain = measure(state({ hand: [c(SPELL)] }, { st: [down(X)] }), state({ gy: [c(SPELL)] }, { gy: [c(X)] }), ctx);
assert.equal(mstPlain.quality, 0, 'a plain card adds no quality surplus');

// Normalbeschwörung: raw 0 (Hand -> Feld), Tempo steigt um die ATK
const summon = measure(state({ hand: [c(BIG)] }, {}), state({ mz: [c(BIG)] }, {}), ctx);
assert.equal(summon.raw, 0);
near(summon.tempo, 2.5);

// Vayu als Kosten: raw -1, der Friedhofsnutzen steht getrennt daneben und ändert raw nicht
const cost = measure(state({ mz: [c(VAYU)] }, {}), state({ gy: [c(VAYU)] }, {}), ctx);
assert.equal(cost.raw, -1);
assert.equal(cost.graveyard, 1);
assert.equal(combine(compare(cost, { raw: 0, quality: 0, tempo: 0, graveyard: 0 }), null, weights).parts.raw, -1, 'the card value is counted once');

// Icarus Attack: blind gegen zwei verdeckte Karten, mit Tribut, der sonst keinen Nutzen hätte
const none = { raw: 0, quality: 0, tempo: 0, graveyard: 0 };
const blindBefore = state({ st: [down(ICARUS)], mz: [c(BIRD)] }, { st: [down(X), down(Y)] });
const blind = compare(
  measure(blindBefore, state({ gy: [c(ICARUS), c(BIRD)] }, { gy: [c(X), c(Y)] }), ctx),
  measure(blindBefore, blindBefore, ctx)
);
assert.equal(blind.raw, 0, 'blind Icarus Attack is a 2:2');
assert.ok(blind.tempo < 0, 'and it sacrifices a monster that did nothing wrong');

// Derselbe Zug, wenn mein Mirror Force das Tributmonster ohnehin zerstört hätte: das Nichtstun verliert es ebenfalls
const doomedBefore = state({ st: [down(ICARUS)], mz: [c(BIRD)] }, { st: [c(MF), down(Y)] });
const pass = measure(doomedBefore, state({ st: [down(ICARUS)] }, { st: [down(Y)], gy: [c(MF)] }), ctx);
const act = measure(doomedBefore, state({ gy: [c(ICARUS), c(BIRD)] }, { gy: [c(MF), c(Y)] }), ctx);
const doomed = compare(act, pass);
assert.equal(doomed.raw, 0, 'still a null game by card count');
near(doomed.tempo, 0, 'the monster is gone either way');
const blindTotal = combine(blind, null, weights).total;
const doomedTotal = combine(doomed, null, weights).total;
assert.ok(doomedTotal > blindTotal, 'the same action is strategically better when its cost would be lost anyway');

// Zukunft: Verschwendung = Potenzial der Karte minus das, was sie jetzt bringt (nur wenn das Potenzial bekannt ist)
const now = combine({ ...none, raw: 0 }, 1, weights);
near(now.waste, 1);
near(now.parts.future, -weights.weights.future);
assert.equal(combine({ ...none, raw: 1 }, 1, weights).waste, 0, 'a card used at its best wastes nothing');
assert.equal(combine({ ...none, raw: 0 }, null, weights).waste, 0, 'unknown potential is no penalty');
near(combine({ ...none, raw: 1 }, 2, weights).timing, 0.5);

console.log('advisor dimensions: all checks passed');
