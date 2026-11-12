// Run: node --no-warnings js/advisor/potential.test.mjs  (what a card is worth at its best, measured by the engine)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore, cardTable, newGame, L, P, M, R, IDLE } from '../duel-core.js';
import { potentialOf, richStart } from './potential.js';
import { evaluateMain } from './probe.js';
import { graveOption } from './dimensions.js';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/${f}`, import.meta.url)));
const table = cardTable(json('core-cards.json'));
const { scripts } = json('core-scripts.json');
const id = new Map(json('cards.json').cards.map((c) => [c.name, c.id]));
const decks = json('decks.json');
const weights = json('advisor-weights.json');
const codes = (d) => ({ main: d.main.flatMap((c) => Array(c.count).fill(id.get(c.card))), extra: (d.extra || []).flatMap((c) => Array(c.count).fill(id.get(c.card))) });
const lib = await loadCore();
const n = (x) => id.get(x);
const base = { table, weights, gyOption: graveOption(scripts, table) };

const optsOf = (botDeck) => ({ lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks[botDeck]) });
const blackwing = optsOf('blackwing');
const pot = potentialOf(blackwing, base);

// Gemessen, nicht eingetragen: drei gegnerische Zauber/Fallen liegen da, Heavy Storm kann also +2 bringen
assert.equal(pot(n('Heavy Storm')), 2, 'Heavy Storm at its best');
assert.equal(pot(n('Blackwing - Gale the Whirlwind')), 0, 'a Normal Summon is worth no card');
assert.equal(potentialOf(optsOf('jinzoOtk'), base)(n('Machina Gearframe')), 1, 'a Normal Summon that searches');
assert.equal(pot(n('Mirror Force')), null, 'no legal Main Phase action: unknown, not a penalty');
assert.equal(pot(n('Heavy Storm')), 2, 'remembered, the same answer');

// Die Teststellung trägt nur Karten aus den Decklisten und die geprüfte Karte
const start = richStart(blackwing, n('Heavy Storm'));
assert.ok(start.cards.some((c) => c.side === 'bot' && c.code === n('Heavy Storm') && c.location === L.HAND));
assert.equal(start.cards.filter((c) => c.side === 'me' && c.location === L.SZONE).length, 3, 'three set cards to hit');
assert.ok(start.cards.every((c) => c.side === 'me' ? codes(decks.frogOtk).main.includes(c.code) || codes(decks.frogOtk).extra.includes(c.code) : codes(decks.blackwing).main.includes(c.code) || codes(decks.blackwing).extra.includes(c.code)));

// Im Hauptphasen-Ergebnis stehen Potenzial, Timing und Verschwendung; Heavy Storm gegen nur zwei Karten lässt etwas liegen
let result = null;
const cards = [{ side: 'bot', code: n('Heavy Storm'), location: L.HAND, sequence: 0, position: P.FACEDOWN }, { side: 'me', code: n('Scapegoat'), location: L.SZONE, sequence: 0, position: P.FACEDOWN }, { side: 'me', code: n('Mirror Force'), location: L.SZONE, sequence: 1, position: P.FACEDOWN }];
const deckOf = (side, list) => { const left = [...codes(decks[list]).main]; for (const c of cards.filter((x) => x.side === side)) { const at = left.indexOf(c.code); if (at >= 0) left.splice(at, 1); } return left.map((code) => ({ side, code, location: L.DECK })); };
const opts = { ...blackwing, start: { lp: { me: 8000, bot: 8000 }, cards: [...cards, ...deckOf('me', 'frogOtk'), ...deckOf('bot', 'blackwing')] }, botPlays: true, seed: [1n, 1n, 1n, 1n] };
opts.botHook = (m, g) => {
  if (m.type === M.SELECT_IDLECMD && g.active === g.bot && g.phase === 4 && g.turn === 2 && !result) { result = evaluateMain(opts, g, m, { ...base, potential: potentialOf(opts, base) }); return { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null }; }
  return undefined;
};
const g = newGame(opts);
for (let i = 0; i < 40 && g.prompt && !result; i += 1) g.respond({ type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
g.close();
const storm = result.find((r) => r.label.includes('Aktivieren Heavy Storm'));
assert.equal(storm.potential, 2);
assert.ok(storm.waste > 0 && storm.parts.future < 0, 'with two targets Heavy Storm leaves a card on the table');
assert.ok(storm.timing > 0 && storm.timing < 1, 'timing is the share of its potential it reaches');

console.log('advisor potential: all checks passed');
