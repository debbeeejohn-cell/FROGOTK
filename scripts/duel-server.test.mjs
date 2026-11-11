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
assert.equal(st.prompt.kind, 'actions');

// card facts arrive once per card name; the bot's hidden cards are never named
assert.deepEqual({ frame: st.cards['Swap Frog'].frame, atk: st.cards['Swap Frog'].atk, level: st.cards['Swap Frog'].level }, { frame: 'effect', atk: 1000, level: 2 });
assert.equal(st.cards.Scapegoat.frame, 'spell');
assert.ok(st.cards['Swap Frog'].desc.length > 20);

// choices carry the card they belong to; answering by id summons Swap Frog and the trigger is asked
const summon = st.prompt.choices.find((c) => c.label === 'Normalbeschwören' && c.card.name === 'Swap Frog');
assert.deepEqual({ side: summon.card.side, zone: summon.card.zone }, { side: 'me', zone: 'hand' });
st = await post('/answer', { choice: summon.id });
assert.ok(st.events.some((e) => e.type === 'summon' && e.kind === 'normal' && e.name === 'Swap Frog' && e.zone === 'mz'));
assert.equal(st.prompt.title, 'Swap Frog: Effekt aktivieren?');
assert.equal(st.prompt.kind, 'question');
assert.equal(st.cards['Swap Frog'], undefined, 'already described');
assert.equal((await call('GET', '/state')).cards['Swap Frog'].frame, 'effect', 'GET /state describes everything again');
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

// an active bot sets cards: neither the field nor the events may name them
st = await post('/new', { deck: 'frogOtk', opp: 'blackwing', bot: 'aktiv' });
const seen = [];
for (let i = 0; i < 40 && st.winner === null && st.turn < 6; i += 1) {
  seen.push(st);
  const c = st.prompt.choices;
  const pass = c.find((x) => ['Zug beenden', 'Nicht aktivieren', 'Nein'].includes(x.label));
  st = await post('/answer', st.prompt.multi ? { pick: c.slice(0, Math.max(1, st.prompt.min ?? 1)).map((x) => x.id) } : { choice: (pass ?? c[0]).id });
}
const botSets = seen.flatMap((x) => x.events).filter((e) => e.type === 'set' && e.side === 'bot');
assert.ok(botSets.length > 0 && botSets.every((e) => e.name === null), 'bot sets are unnamed');
assert.ok(seen.flatMap((x) => x.events).filter((e) => e.type === 'move' && e.to.side === 'bot' && e.to.down).every((e) => e.name === null));
assert.ok(seen.every((x) => x.field.bot.st.every((c) => c === null || !c.down || c.name === undefined)));

assert.equal((await call('GET', '/nope')).status, 404);
assert.equal((await fetch(`${base}/new`, { method: 'POST', body: '{broken' })).status, 400);

server.close();
console.log('duel-server: all checks passed');
