// Run: node --no-warnings scripts/edison-db.test.mjs  (the Edison card database, built from data/cards.json)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEdisonDb } from './build-edison-db.mjs';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
const db = json('edison-db.json');
const banlist = json('edison-banlist.json');
const byName = new Map(db.cards.map((c) => [c.name, c]));

// every card has the fields a front end needs
for (const c of db.cards) {
  assert.ok(Number.isInteger(c.id) && c.name && c.type, `card ${c.id} has id, name, type`);
  assert.ok(c.sprite && /^[a-z0-9_]+$/.test(c.sprite), `sprite name of ${c.name} is a plain file name`);
}
assert.ok(db.cards.length > 3000, 'the Edison pool is large');

// forbidden cards are not in the database; limited ones are, marked
for (const name of banlist.forbidden) assert.equal(byName.has(name), false, `${name} is forbidden`);
assert.equal(byName.get(banlist.limited[0]).limit, 'limited');
assert.equal(byName.get('Swap Frog').limit, null);

// Edison texts, not the current errata (see data/edison-texts.json)
assert.match(byName.get('Goyo Guardian').desc, /Defense Position/);
assert.match(byName.get('Brionac, Dragon of the Ice Barrier').desc, /any number of cards/);

// the build itself: a small fake pool shows the rule
const fake = [
  { id: 1, name: 'Keep', type: 'Effect Monster', race: 'Warrior', attribute: 'EARTH', level: 4, atk: 1, def: 1, desc: '' },
  { id: 2, name: 'Gone', type: 'Spell Card', race: 'Normal', attribute: null, level: null, atk: null, def: null, desc: '' }
];
const built = buildEdisonDb(fake, { forbidden: ['Gone', 'Missing'], limited: [], semiLimited: [] });
assert.deepEqual(built.cards.map((c) => c.name), ['Keep']);
assert.equal(built.excludedForbidden, 1);
assert.deepEqual(built.notInCardData, ['Missing']);

console.log('edison-db: all checks passed');
