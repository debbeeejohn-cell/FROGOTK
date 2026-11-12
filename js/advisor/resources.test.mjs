// Run: node js/advisor/resources.test.mjs  (Raw Card Advantage: counting only, with the user's examples)
import assert from 'node:assert/strict';
import { OcgPosition as P } from '../../vendor/ocgcore/index.js';
import { sideState, observe, counts, rawAdvantage, movement, knowledge } from './resources.js';

const TOKEN_CODE = 900;
const table = { data: new Map([[TOKEN_CODE, { type: 0x4000 }]]) };
const c = (code, position = P.FACEUP_ATTACK, attack = 1000) => ({ code, position, attack, defense: 0 });
const down = (code) => c(code, P.FACEDOWN);
const pad = (list, n) => [...list, ...Array(n - list.length).fill(null)];
const view = ({ hand = [], mz = [], st = [], field = null, gy = [], banished = [], deck = 30 } = {}) => ({ hand, mz: pad(mz, 5), st: pad(st, 5), field, gy, banished, deck, extra: [] });
const state = (own, foe) => ({ own: sideState(view(own), table), foe: sideState(view(foe), table) });

const [HEAVY, MST, STRATOS, SEARCHED, ICARUS, BIRD, X, Y, A] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// Hand -> Feld verliert nichts, Zonenwechsel auf dem Feld zählt nicht doppelt
assert.equal(rawAdvantage(state({ hand: [c(A)] }, {}), state({ mz: [c(A)] }, {})), 0, 'Normal Summon');
assert.equal(rawAdvantage(state({ mz: [c(A)] }, {}), state({ st: [c(A)] }, {})), 0, 'zone to zone on the field');
assert.equal(rawAdvantage(state({ mz: [down(A)] }, {}), state({ mz: [c(A)] }, {})), 0, 'flip');

// Heavy Storm: eine Karte für zwei gegnerische Zauber/Fallen = +1
assert.equal(rawAdvantage(state({ hand: [c(HEAVY)] }, { st: [down(X), down(Y)] }), state({ gy: [c(HEAVY)] }, { gy: [c(X), c(Y)] })), 1);
// Mystical Space Typhoon: eine Karte für eine Karte = 0
assert.equal(rawAdvantage(state({ hand: [c(MST)] }, { st: [down(X)] }), state({ gy: [c(MST)] }, { gy: [c(X)] })), 0);
// Stratos: bleibt auf dem Feld, sucht eine Karte aus dem Deck = +1
assert.equal(rawAdvantage(state({ hand: [c(STRATOS)], deck: 30 }, {}), state({ mz: [c(STRATOS)], hand: [c(SEARCHED)], deck: 29 }, {})), 1);
// Icarus Attack: Falle + Winged Beast als Tribut für zwei gegnerische Karten = 0
assert.equal(rawAdvantage(state({ st: [down(ICARUS)], mz: [c(BIRD)] }, { st: [down(X), down(Y)] }), state({ gy: [c(ICARUS), c(BIRD)] }, { gy: [c(X), c(Y)] })), 0);

// Der Friedhof zählt nicht zum Pool: mehr Karten im Friedhof ändern die Rohrechnung nicht
assert.equal(rawAdvantage(state({ gy: [] }, {}), state({ gy: [c(A), c(X)] }, {})), 0);

// Tokens sind keine Karten
const tokens = [c(TOKEN_CODE), c(TOKEN_CODE), c(TOKEN_CODE), c(TOKEN_CODE)];
assert.equal(rawAdvantage(state({ hand: [c(A)] }, {}), state({ st: [c(A)], mz: tokens }, {})), 0, 'four Sheep Tokens are no resources');
assert.equal(counts(sideState(view({ mz: tokens }), table)).pool, 0);

// Bewegung als Identitäten: Zonenwechsel taucht nicht auf, Verluste und Gewinne schon
const storm = movement(state({ hand: [c(HEAVY), c(A)] }, { st: [down(X), down(Y)] }), state({ gy: [c(HEAVY)], mz: [c(A)] }, { gy: [c(X), c(Y)] }));
assert.deepEqual(storm.own.lost, [HEAVY]);
assert.deepEqual(storm.foe.lost.sort(), [X, Y]);
assert.deepEqual(storm.own.toGy, [HEAVY]);
assert.deepEqual(storm.own.gained, [], 'A only changed zone');

// Wissensklassen aus der Beobachtung
const seen = observe([view({}), view({ hand: [c(1), c(2)], mz: [c(A), down(X)], st: [down(Y)], gy: [c(3)], deck: 20 })], 0, table).foe;
assert.deepEqual(knowledge(seen), { known: 2, estimated: 2, unknown: 22 });

// Verdeckte Information: andere echte verdeckte Karten und andere Gegnerhand ergeben dieselbe Beobachtung
const one = observe([view({ hand: [c(A)] }), view({ hand: [c(11), c(12)], mz: [down(21)], st: [down(22)], deck: 25 })], 0, table);
const two = observe([view({ hand: [c(A)] }), view({ hand: [c(31), c(32)], mz: [down(41)], st: [down(42)], deck: 25 })], 0, table);
assert.deepEqual(one, two, 'hidden opponent cards do not leak into the observation');
assert.equal(one.foe.hand, 2, 'the opponent hand is only a number');
assert.deepEqual(one.foe.mz[0], { down: true, pos: P.FACEDOWN, token: false });
assert.equal(observe([view({ hand: [c(A)] }), view({})], 0, table).own.hand[0].code, A, 'my own hand is known to me');

console.log('advisor resources: all checks passed');
