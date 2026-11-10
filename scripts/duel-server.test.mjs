// Run: node --no-warnings scripts/duel-server.test.mjs  (the JSON bridge a Godot client talks to)
import assert from 'node:assert/strict';
import { server } from './duel-server.mjs';

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
};
const post = (path, body = {}) => call('POST', path, body);

// before a duel
assert.equal((await call('GET', '/state')).duel, false);
assert.equal((await post('/answer', { choice: 0 })).status, 400);
assert.equal((await post('/new', { deck: 'nope', opp: 'blackwing' })).status, 400);
const decks = await (await fetch(`${base}/decks`)).json();
assert.ok(decks.some((d) => d.id === 'frogOtk' && d.name === 'Frog OTK'));
assert.equal((await call('GET', '/card?name=Swap%20Frog')).atk, 1000);

// new duel with a fixed opening hand; the bot's hand is only a number
let st = await post('/new', { deck: 'frogOtk', opp: 'blackwing', hand: ['Swap Frog', 'Scapegoat'], bot: 'passiv' });
assert.equal(st.status, 200);
assert.equal(st.turn, 1); assert.equal(st.active, 'me');
assert.ok(st.field.me.hand.includes('Swap Frog') && st.field.me.hand.length === 6);
assert.equal(st.field.bot.hand, 5);
assert.deepEqual(st.lp, { me: 8000, bot: 8000 });
assert.ok(st.events.some((e) => e.type === 'draw' && e.side === 'me'));
assert.equal(st.prompt.title, 'Dein Zug');

// choices carry the card they belong to; answering by id summons Swap Frog and the trigger is asked
const summon = st.prompt.choices.find((c) => c.label === 'Normalbeschwören' && c.card.name === 'Swap Frog');
assert.deepEqual({ side: summon.card.side, zone: summon.card.zone }, { side: 'me', zone: 'hand' });
st = await post('/answer', { choice: summon.id });
assert.ok(st.events.some((e) => e.type === 'summon' && e.kind === 'normal' && e.name === 'Swap Frog' && e.zone === 'mz'));
assert.equal(st.prompt.title, 'Swap Frog: Effekt aktivieren?');
assert.deepEqual(st.events.filter((e) => e.type === 'draw'), [], 'events are delivered once');
st = await post('/answer', { choice: st.prompt.choices.find((c) => c.label === 'Ja').id });

// multi selection: wrong shapes are rejected, the duel stays answerable
assert.equal(st.prompt.multi, true); assert.equal(st.prompt.min, 1);
assert.equal((await post('/answer', { choice: 0 })).status, 400);
assert.equal((await post('/answer', { pick: [999] })).status, 400);
const sent = st.prompt.choices[0].card.name;
st = await post('/answer', { pick: [0] });
assert.deepEqual(st.field.me.gy, [sent]);
assert.equal(st.field.me.mz[0].name, 'Swap Frog');

// undo replays without the last answer
st = await post('/undo');
assert.equal(st.reset, true);
assert.deepEqual(st.field.me.gy, []);
assert.equal(st.prompt.multi, true);

// the teacher's review arrives with the state
st = await post('/new', { deck: 'frogOtk', opp: 'blackwing', hand: ['Swap Frog'], bot: 'passiv' });
st = await post('/answer', { choice: st.prompt.choices.find((c) => c.label === 'Zug beenden').id });
assert.ok(st.review.notes.some((n) => n.startsWith('Normalbeschwörung nicht genutzt')));

assert.equal((await call('GET', '/nope')).status, 404);
assert.equal((await fetch(`${base}/new`, { method: 'POST', body: '{broken' })).status, 400);

server.close();
console.log('duel-server: all checks passed');
