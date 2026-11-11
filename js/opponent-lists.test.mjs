// Run: node js/opponent-lists.test.mjs  (the bot's knowledge of two opponent decks must match the card database)
import assert from 'node:assert/strict';
import fs from 'node:fs';

const names = new Set(JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url))).cards.map((c) => c.name));
const { lists } = JSON.parse(fs.readFileSync(new URL('../data/opponent-lists.json', import.meta.url)));
const total = (section) => section.reduce((n, c) => n + c.count, 0);

for (const [key, list] of Object.entries(lists)) {
  for (const section of ['main', 'extra', 'side']) {
    for (const { card, count } of list[section]) {
      assert.ok(names.has(card), `${key}: "${card}" is not in data/cards.json`);
      assert.ok(count >= 1 && count <= 3, `${key}: "${card}" has ${count} copies`);
    }
  }
}
assert.equal(total(lists.frogMonarch.main), 40);
assert.equal(total(lists.frogMonarch.extra), 15);
assert.equal(total(lists.frogMonarch.side), 13);
assert.equal(total(lists.lightsworn.main), 40);
assert.equal(total(lists.lightsworn.extra), 14, 'Gewittermagierin is still missing');
assert.equal(total(lists.lightsworn.side), 15);
console.log('opponent-lists: all checks passed');
