// Run: node --no-warnings scripts/bot-audit.test.mjs  (Statistik des Audit-Werkzeugs; der volle Lauf ist bot-audit.mjs selbst)
import assert from 'node:assert/strict';
import { wilson, signTest } from './bot-audit.mjs';

// Wilson: bekannte Werte, 5 von 10 und 0 von 10
const [lo, hi] = wilson(5, 10);
assert.ok(Math.abs(lo - 0.237) < 0.01 && Math.abs(hi - 0.763) < 0.01, `wilson 5/10: ${lo} ${hi}`);
assert.equal(wilson(0, 10)[0], 0);
assert.deepEqual(wilson(0, 0), [0, 1]);

// Vorzeichentest: 10:0 ist klar, 6:4 nicht, 0:0 ist 1
assert.ok(signTest(10, 0) < 0.01);
assert.ok(signTest(6, 4) > 0.5);
assert.equal(signTest(0, 0), 1);
assert.equal(signTest(3, 3), 1);
assert.equal(signTest(10, 0), signTest(0, 10), 'symmetrisch');

console.log('bot-audit: all checks passed');
