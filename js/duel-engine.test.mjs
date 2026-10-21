// Run: node js/duel-engine.test.mjs  (board rules of the Bot Duel practice mode)
import assert from 'node:assert/strict';
import { newDuel, summon, move, attack, endTurn, draw, changeLp, setPhase, togglePos, locate, cardOf } from './duel-engine.js';

const deckOf = (n, extra = []) => ({
  main: [{ card: 'Filler', count: n }, { card: 'Mirror Force', count: 1 }],
  extra: extra.map((card) => ({ card, count: 1 }))
});
const stats = (name) => ({ A: { atk: 2000, def: 1000 }, B: { atk: 1500, def: 2500 }, C: { atk: 2000, def: 0 } }[name] ?? { atk: 0, def: 0 });
const rand = () => 0.5;
const duel = (opts = {}) => newDuel({ me: deckOf(34, ['Big']), bot: deckOf(34), rand, ...opts });
const inHand = (g, who, name) => g.players[who].hand.find((c) => c.name === name);
let nextTestUid = 0;
// put a named card straight onto a side (test helper: take any card by name from anywhere)
function put(g, who, name, to = 'mz', opts = {}) {
  const p = g.players[who];
  let c = [...p.hand, ...p.deck].find((x) => x.name === name);
  if (!c) { c = { ...p.deck[0], uid: 90000 + (nextTestUid += 1), name }; p.deck.unshift(c); }
  move(g, c.uid, to, { side: who, ...opts });
  return c;
}

// setup: hands, second player draws, first player does not
let g = duel();
assert.equal(g.players.me.hand.length, 6);
assert.equal(g.players.bot.hand.length, 5);
assert.equal(g.turn, 2); assert.equal(g.noAttack, false);
g = duel({ second: false });
assert.equal(g.players.me.hand.length, 5);
assert.equal(g.turn, 1); assert.equal(g.noAttack, true);

// preset: comes out of the bot deck, monsters face-up, S/T face-down
g = duel({ preset: { monsters: ['Mirror Force'], spellTraps: ['Mirror Force'] } });
const bp = g.players.bot;
assert.equal(bp.mz[0].name, 'Mirror Force'); assert.equal(bp.mz[0].down, false);
assert.equal(bp.st[0].down, true);
assert.equal(bp.deck.length + bp.hand.length, 35 - 1); // only the 1 copy in the deck was used, the 2nd is created

// summon, zone limit, extra deck return
g = duel({ second: false });
for (let i = 0; i < 5; i += 1) summon(g, g.players.me.hand[0].uid, 'normal');
assert.equal(g.players.me.mz.filter(Boolean).length, 5);
assert.throws(() => summon(g, g.players.me.deck[0].uid, 'ssAtk'), /Monsterzonen/);
const big = g.players.me.extra[0];
g.players.me.mz[0] = null; // free one zone
summon(g, big.uid, 'ssDef');
assert.equal(cardOf(g, big.uid).pos, 'def');
move(g, big.uid, 'deck');
assert.equal(g.players.me.extra.length, 1); // extra monster goes back to the extra deck, not the main deck
assert.ok(!g.players.me.deck.includes(big));

// deck top vs bottom, graveyard stays with the owner
g = duel();
const top = g.players.me.hand[0];
move(g, top.uid, 'deck');
assert.equal(g.players.me.deck[0], top);
move(g, top.uid, 'deckBottom');
assert.equal(g.players.me.deck.at(-1), top);
const steal = put(g, 'bot', 'A');
move(g, steal.uid, 'mz', { side: 'me' });
assert.equal(locate(g, steal.uid).who, 'me');
move(g, steal.uid, 'gy');
assert.equal(locate(g, steal.uid).who, 'bot'); // owner's graveyard

// field spell replaces the old one (old goes to graveyard)
g = duel();
const f1 = put(g, 'me', 'F1', 'field'); const f2 = put(g, 'me', 'F2', 'field');
assert.equal(g.players.me.field, f2); assert.ok(g.players.me.gy.includes(f1));

// battle rules
g = duel({ second: false });
const a = put(g, 'me', 'A'); setPhase(g, 'BP');
assert.throws(() => attack(g, a.uid, null, stats), /ersten Zug/);
g.noAttack = false;
setPhase(g, 'MP1');
assert.throws(() => attack(g, a.uid, null, stats), /Battle Phase/);
setPhase(g, 'BP');
attack(g, a.uid, null, stats); // direct
assert.equal(g.players.bot.lp, 6000);
assert.throws(() => attack(g, a.uid, null, stats), /schon angegriffen/);

g = duel(); setPhase(g, 'BP');
const att = put(g, 'me', 'A'); const foeA = put(g, 'bot', 'B'); // 2000 vs 1500 ATK
assert.throws(() => attack(g, att.uid, null, stats), /kein Monster/);
attack(g, att.uid, foeA.uid, stats);
assert.equal(g.players.bot.lp, 7500); assert.ok(g.players.bot.gy.includes(foeA));

g = duel(); setPhase(g, 'BP');
let x = put(g, 'me', 'B'); let y = put(g, 'bot', 'A'); // 1500 vs 2000 -> I lose the monster
attack(g, x.uid, y.uid, stats);
assert.equal(g.players.me.lp, 7500); assert.ok(g.players.me.gy.includes(x));

g = duel(); setPhase(g, 'BP');
x = put(g, 'me', 'A'); y = put(g, 'bot', 'C'); // tie -> both die
attack(g, x.uid, y.uid, stats);
assert.ok(g.players.me.gy.includes(x) && g.players.bot.gy.includes(y));
assert.equal(g.players.me.lp, 8000);

g = duel(); setPhase(g, 'BP');
x = put(g, 'me', 'A'); y = put(g, 'bot', 'B', 'mz', { pos: 'def', down: true }); // 2000 vs DEF 2500, face-down
attack(g, x.uid, y.uid, stats);
assert.equal(y.down, false); assert.equal(g.players.me.lp, 7500); assert.ok(g.players.bot.mz.includes(y));

// three direct hits with 3000 ATK: 8000 -> win
g = duel(); setPhase(g, 'BP');
const s = { ...stats, call: 0 };
const big3 = () => ({ atk: 3000, def: 0 });
for (let i = 0; i < 3; i += 1) { const m = put(g, 'me', `M${i}`); attack(g, m.uid, null, big3); }
assert.equal(g.players.bot.lp, 0); assert.equal(g.winner, 'me');

// position change, only face-up
g = duel(); const t = put(g, 'me', 'A');
togglePos(g, t.uid); assert.equal(t.pos, 'def');
t.down = true; assert.throws(() => togglePos(g, t.uid), /offene/);

// end turn: bot draws, I draw, counters reset
g = duel(); put(g, 'me', 'A'); setPhase(g, 'BP'); g.attacked.push(1); g.summons = 1;
const myHand = g.players.me.hand.length; const botHand = g.players.bot.hand.length;
endTurn(g);
assert.equal(g.turn, 4); assert.equal(g.phase, 'MP1'); assert.equal(g.summons, 0); assert.deepEqual(g.attacked, []);
assert.equal(g.players.me.hand.length, myHand + 1); assert.equal(g.players.bot.hand.length, botHand + 1);

// deck-out loses, LP never below 0
g = duel(); g.players.me.deck = [];
draw(g, 'me'); assert.equal(g.winner, 'bot');
g = duel(); changeLp(g, 'me', -99999);
assert.equal(g.players.me.lp, 0); assert.equal(g.winner, 'bot');

console.log('duel-engine: all checks passed');
