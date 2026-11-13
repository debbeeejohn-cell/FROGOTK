// Run: node --no-warnings scripts/bot-audit.test.mjs  (Statistik des Audit-Werkzeugs; der volle Lauf ist bot-audit.mjs selbst)
import assert from 'node:assert/strict';
import { wilson, signTest } from './bot-audit.mjs';
import { leakRows, setup } from './audit-leak.mjs';
import { referee, refereedGame, HARD } from './audit-referee.mjs';
import { M, BATTLE } from '../js/duel-core.js';
import { PAIRS } from './bot-eval.mjs';

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

// Verdeckte Information: beide Bots bestehen, die Gegenprobe (liest die Gegnerhand) muss durchfallen, sonst taugt die Prüfung nichts
const rows = await leakRows(4, PAIRS);
const row = (start) => rows.find((r) => r.name.startsWith(start));
assert.equal(row('Verdeckte Information, alter Bot').ok, true, row('Verdeckte Information, alter Bot').detail);
assert.equal(row('Verdeckte Information, advisor').ok, true, row('Verdeckte Information, advisor').detail);
assert.equal(row('Gegenprobe').ok, true, 'the control bot that reads the foe hand is caught');

// Schiedsrichter, harte Regel an einer gebauten Stellung: 2500 direkter Schaden gegen 1000 LP und trotzdem die Battle Phase verlassen
const fake = (foeLp) => ({ active: 1, bot: 1, me: 0, turn: 2, lp: [foeLp, 8000], view: () => [{ mz: [] }, { mz: [{ attack: 2500, position: 1 }] }] });
const battle = { type: M.SELECT_BATTLECMD, attacks: [{ can_direct: true, sequence: 0 }] };
const miss = referee(); miss.check(battle, fake(1000), { action: BATTLE.TO_EP });
assert.deepEqual(miss.found.map((f) => [f.rule, f.severity]), [['tödlicher Schaden', HARD]]);
const fine = referee(); fine.check(battle, fake(4000), { action: BATTLE.TO_EP });
assert.deepEqual(fine.found, [], 'not lethal: no hard finding');
const attacked = referee(); attacked.check(battle, fake(1000), { action: BATTLE.TO_EP + 99 });
assert.deepEqual(attacked.found, [], 'an attack was made: nothing to flag');

// Weiche Regeln: der passive Bot (tut nichts, beendet den Zug) muss gefunden werden, der alte Bot nicht ständig
const env = await setup();
const passive = refereedGame(env, 'frogOtk', 'blackwing', [3000n, 1n, 2n, 3n], 'passiv');
assert.ok(passive.findings.some((f) => f.rule === 'leerer Zug') && passive.findings.some((f) => f.rule === 'Normalbeschwörung'), 'the passive bot is caught');
const old = refereedGame(env, 'frogOtk', 'blackwing', [3000n, 1n, 2n, 3n], '');
assert.deepEqual(old.errors, []);
assert.equal(old.findings.filter((f) => f.severity === HARD).length, 0, 'the old bot always takes lethal in this game');

console.log('bot-audit: all checks passed');
