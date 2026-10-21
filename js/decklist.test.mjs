// Run: node js/decklist.test.mjs
import assert from 'node:assert/strict';
import { parseDecklist } from './decklist.js';

// .ydk with sections, comments and passcodes (numbers in the DB, strings in the file)
const idToName = new Map([[84451804, 'Des Frog'], [59255742, 'Goyo Guardian']]);
const ydk = '﻿#created by someone\n#main\n84451804\n84451804\n84451804\n12345678\n#extra\n59255742\n!side\n84451804\n';
const a = parseDecklist(ydk, { idToName });
assert.deepEqual(a.main, [{ card: 'Des Frog', count: 3 }, { card: 'Karte #12345678', count: 1 }]);
assert.deepEqual(a.extra, [{ card: 'Goyo Guardian', count: 1 }]);
assert.deepEqual(a.side, [{ card: 'Des Frog', count: 1 }]);
assert.deepEqual(a.unknownIds, ['12345678']);

// Text formats, headers, blank lines, duplicates are summed case-insensitively
const text = `Main Deck (40)
3 Des Frog
3x Dandylion
Substitoad x2
Scapegoat
des frog

// a comment
Extra Deck:
1 Goyo Guardian
Side Deck
2 Mirror Force`;
const b = parseDecklist(text);
assert.deepEqual(b.main, [
  { card: 'Des Frog', count: 4 },
  { card: 'Dandylion', count: 3 },
  { card: 'Substitoad', count: 2 },
  { card: 'Scapegoat', count: 1 }
]);
assert.deepEqual(b.extra, [{ card: 'Goyo Guardian', count: 1 }]);
assert.deepEqual(b.side, [{ card: 'Mirror Force', count: 2 }]);

// A card whose name starts with a digit is kept whole when the card list knows it
const c = parseDecklist('7 Colored Fish\n2 Des Frog', { known: new Set(['7 colored fish']) });
assert.deepEqual(c.main, [{ card: '7 Colored Fish', count: 1 }, { card: 'Des Frog', count: 2 }]);

// Empty input -> nothing, no crash
assert.deepEqual(parseDecklist('  \n\n').main, []);
console.log('decklist: all checks passed');
