// Run: node js/tester.test.mjs  (deck tester state: draw, move, tokens, positions)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newGame, draw, move, setPos, addToken, find, cardAt } from './tester.js';

const { frogOtk } = JSON.parse(fs.readFileSync(new URL('../data/decks.json', import.meta.url), 'utf8'));
const total = (sec) => (frogOtk[sec] || []).reduce((n, c) => n + c.count, 0);

let s = newGame(frogOtk, () => 0.5);
assert.equal(s.deck.length, total('main'));
assert.equal(s.extra.length, total('extra'));
assert.equal(s.hand.length, 0);

// Drawing takes from the top and never more than the deck holds
const top = s.deck.slice(0, 5).map((c) => c.id);
s = draw(s, 5);
assert.deepEqual(s.hand.map((c) => c.id), top);
assert.equal(s.deck.length, total('main') - 5);
assert.equal(draw(s, 999).deck.length, 0);

// Normal summon from hand into a monster zone, then the zone is blocked
const [a, b] = s.hand;
s = move(s, a.id, 'mz:2', 'atk');
assert.deepEqual(find(s, a.id), ['mz:2', 0]);
assert.equal(cardAt(s, a.id).pos, 'atk');
assert.throws(() => move(s, b.id, 'mz:2'), /belegt/);
assert.throws(() => move(s, b.id, 'mz:7'), /Unbekannte Zone/);

// Position change, then to the graveyard: position is dropped
s = setPos(s, a.id, 'def');
assert.equal(cardAt(s, a.id).pos, 'def');
s = move(s, a.id, 'gy');
assert.equal(s.mz[2], null);
assert.equal(s.gy.at(-1).pos, undefined);

// Search the deck: any card can be pulled out, deck top/bottom work
const pulled = s.deck[10];
s = move(s, pulled.id, 'hand');
assert.equal(s.hand.at(-1).id, pulled.id);
s = move(s, pulled.id, 'deck');
assert.equal(s.deck[0].id, pulled.id);
s = move(s, pulled.id, 'deckBottom');
assert.equal(s.deck.at(-1).id, pulled.id);

// Extra deck monster into a link zone, then banished
const ex = s.extra[0];
s = move(s, ex.id, 'emz:1');
assert.equal(s.emz[1].id, ex.id);
s = move(s, ex.id, 'banished');
assert.equal(s.banished[0].id, ex.id);

// Tokens get fresh ids and vanish when they leave the field
s = addToken(s, 'mz:0', 'def');
const token = s.mz[0];
assert.ok(token.token);
assert.throws(() => addToken(s, 'mz:0'), /belegt/);
s = move(s, token.id, 'gy');
assert.equal(find(s, token.id), null);
assert.equal(s.gy.some((c) => c.token), false);

// Every card still exists exactly once
const all = ['deck', 'extra', 'hand', 'gy', 'banished'].flatMap((p) => s[p]).concat(s.mz, s.st, s.emz, s.field).filter(Boolean);
assert.equal(all.length, total('main') + total('extra'));
assert.equal(new Set(all.map((c) => c.id)).size, all.length);

console.log('tester: all checks passed');
