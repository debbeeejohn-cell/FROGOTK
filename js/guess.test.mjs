// Run: node js/guess.test.mjs  (odds about the opponent, built on the exact calc in js/calc.js)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unseenPool, faceDownOdds, inHandChance } from './guess.js';

const { lists } = JSON.parse(fs.readFileSync(new URL('../data/opponent-lists.json', import.meta.url)));
const main = lists.frogMonarch.main;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

// Nothing seen: 40 cards, Swap Frog x3. Chance of at least one in a 5-card hand = 1 - C(37,5)/C(40,5)
const full = unseenPool(main, []);
assert.equal(full.total, 40);
close(inHandChance(full, 5, 'Swap Frog'), 1 - 435897 / 658008);
assert.equal(inHandChance(full, 5, 'Nobody'), 0);

// Seeing one Swap Frog removes it from the unknown pool
const seen = unseenPool(main, ['Swap Frog']);
assert.equal(seen.total, 39);
assert.equal(seen.copies.get('Swap Frog'), 2);

// Odds of a face-down card add up to 1 and are sorted, most likely first
const odds = faceDownOdds(seen);
close(odds.reduce((sum, x) => sum + x.p, 0), 1);
assert.ok(odds.every((x, i) => i === 0 || odds[i - 1].p >= x.p));

console.log('guess: all checks passed');
