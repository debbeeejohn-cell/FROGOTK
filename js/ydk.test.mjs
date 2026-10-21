// Run: node js/ydk.test.mjs
import assert from 'node:assert/strict';
import { buildYdk } from './ydk.js';

const byName = new Map([['des frog', { id: 84451804 }], ['goyo guardian', { id: 59255742 }], ['scapegoat', { id: 73915051 }]]);
const deck = {
  main: [{ card: 'Des Frog', count: 3 }, { card: 'Scapegoat', count: 1 }],
  extra: [{ card: 'Goyo Guardian', count: 1 }],
  side: [{ card: 'Des Frog', count: 2 }]
};

const { text, missing } = buildYdk(deck, byName);
assert.deepEqual(missing, []);
assert.deepEqual(text.trim().split('\n'), [
  '#created by Frog OTK Lab',
  '#main', '84451804', '84451804', '84451804', '73915051',
  '#extra', '59255742',
  '!side', '84451804', '84451804'
]);

// Unknown card is reported once, never exported as a wrong/empty id
const partial = buildYdk({ main: [{ card: 'Nope', count: 3 }], extra: [], side: [] }, byName);
assert.deepEqual(partial.missing, ['Nope']);
assert.ok(!partial.text.includes('undefined'));

// Missing sections are fine
assert.equal(buildYdk({ main: [] }, byName).text.trim().split('\n').length, 4);
console.log('ydk: all checks passed');
