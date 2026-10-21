// Run: node js/sandbox.test.mjs  (replays the real recorded line and checks the engine against its final state)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialState, applyAction, replay, expectedClicks } from './sandbox.js';

const { lines } = JSON.parse(fs.readFileSync(new URL('../data/open-8k-3des.json', import.meta.url), 'utf8'));
const line = lines[0];

// Replaying all recorded actions must end exactly at the recorded final board + graveyard
const boards = replay(line, 40, 15);
const end = boards.at(-1);
assert.equal(boards.length, line.actions.length + 1);
const names = Object.fromEntries(Object.entries(end.zones).filter(([, c]) => c).map(([z, c]) => [z, c.card]));
assert.deepEqual(names, line.finalBoard);
assert.deepEqual([...end.grave].sort(), [...line.finalGrave].sort());
assert.equal(end.hand.length, 0);
assert.equal(end.extra, 15 - 2); // Goyo + Brionac

// The engine refuses actions the board contradicts, instead of drawing a wrong board
const start = initialState(line, 40, 15);
assert.throws(() => applyAction(start, { step: 1, type: 'toGrave', card: 'Not In Hand', from: 'hand' }), /nicht in hand/);
assert.throws(() => applyAction(start, { step: 1, type: 'specialSummon', card: 'X', from: 'deck', to: 'M9' }), /unbekannte Zone/);
assert.throws(() => applyAction(start, { step: 1, type: 'wat', card: 'X' }), /Unbekannter Aktionstyp/);
const occupied = applyAction(start, { step: 1, type: 'token', card: 'Token', to: 'M1' });
assert.throws(() => applyAction(occupied, { step: 2, type: 'token', card: 'Token', to: 'M1' }), /belegt/);

// Every recorded action maps to a click path of 1-2 targets
for (const a of line.actions) {
  const clicks = expectedClicks(a);
  assert.ok(clicks.length >= 1 && clicks.length <= 2 && clicks.every(Boolean), `step ${a.step}`);
}
assert.deepEqual(expectedClicks(line.actions[0]), ['hand:Substitoad', 'M1']); // summon from hand
assert.deepEqual(expectedClicks(line.actions[7]), ['M4']);                    // token appears in M4

console.log('sandbox: all checks passed');
