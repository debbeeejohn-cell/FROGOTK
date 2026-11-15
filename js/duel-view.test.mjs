// Run: node --no-warnings js/duel-view.test.mjs  (Bot-Duel-Hilfen auf der echten Engine, braucht data/core-*.json)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore, cardTable, newGame, M, R, IDLE, PHASE } from './duel-core.js';
import { actionsByCard, phaseButtons, phaseMenu, zoneCounts, sumState, key, PHASE_SHORT, PHASE_BANNER, animationSteps, lpRing } from './duel-view.js';

const json = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url)));
const table = cardTable(json('core-cards.json'));
const { scripts } = json('core-scripts.json');
const id = new Map(json('cards.json').cards.map((c) => [c.name, c.id]));
const decks = json('decks.json');
const codes = (deck) => ({
  main: deck.main.flatMap((c) => Array(c.count).fill(id.get(c.card))),
  extra: (deck.extra || []).flatMap((c) => Array(c.count).fill(id.get(c.card)))
});
const lib = await loadCore();
const g = newGame({ lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), hand: [id.get('Swap Frog'), id.get('Scapegoat')], seed: [5n, 6n, 7n, 8n] });

// Main Phase 1: die Engine bietet Beschwören und Setzen an; jede Aktion hängt an einer Handkarte und trägt die Antwort für die Engine
assert.equal(g.prompt.type, M.SELECT_IDLECMD);
const actions = actionsByCard(g.prompt, table);
assert.ok(actions.size > 0, 'actions are offered');
const swap = g.prompt.summons.find((c) => table.name(c.code) === 'Swap Frog');
const list = actions.get(key(swap));
assert.ok(list.some((a) => a.label === 'Normalbeschwören' && a.response.type === R.SELECT_IDLECMD && a.response.action === IDLE.SELECT_SUMMON));
assert.equal(actionsByCard(null, table).size, 0, 'no open game state, no actions');

// Phasenmenü: sechs Einträge, nur das wählbar, was die Engine anbietet
let menu = phaseMenu(g.prompt, g.phase);
assert.deepEqual(menu.map((m) => m.id), ['DP', 'SP', 'MP1', 'BP', 'MP2', 'EP']);
assert.equal(menu.find((m) => m.current).id, 'MP1');
const offered = phaseButtons(g.prompt).map((b) => (b.label === 'Battle Phase' ? 'BP' : b.label === 'Main Phase 2' ? 'MP2' : 'EP')).sort();
assert.deepEqual(menu.filter((m) => m.response).map((m) => m.id).sort(), offered);
assert.ok(menu.find((m) => m.id === 'EP').response, 'end the turn is always offered');
assert.equal(menu.find((m) => m.id === 'DP').response, null, 'Draw Phase can not be chosen');
assert.equal(menu.find((m) => m.id === 'BP').response, null, 'no Battle Phase in the first turn');

// Der Spielzug läuft: Zug beenden, der Bot zieht und passt, dann ist Zug 3 und die Battle Phase ist da
g.respond(menu.find((m) => m.id === 'EP').response);
assert.equal(g.turn, 3);
menu = phaseMenu(g.prompt, g.phase);
assert.ok(menu.find((m) => m.id === 'BP').response, 'Battle Phase offered in turn 3');
g.respond(menu.find((m) => m.id === 'BP').response);
assert.equal(g.prompt.type, M.SELECT_BATTLECMD);
menu = phaseMenu(g.prompt, g.phase);
assert.equal(menu.find((m) => m.current).id, 'BP');
assert.ok(menu.find((m) => m.id === 'MP2').response && menu.find((m) => m.id === 'EP').response);
assert.equal(menu.find((m) => m.id === 'BP').response, null, 'already in the Battle Phase');

// Kurznamen decken jede Phase der Engine ab
for (const bit of Object.keys(PHASE)) assert.ok(PHASE_SHORT[bit], `short name for phase ${bit}`);

// Zonenzahlen aus der Ansicht: Deck, Extra, Friedhof, Verbannt
const v = g.view()[g.me];
assert.deepEqual(zoneCounts(v), { deck: v.deck, extra: v.extra.length, gy: v.gy.length, banished: v.banished.length });
assert.ok(zoneCounts(v).extra > 0 && zoneCounts(v).deck > 0);

// Summenregel an gebauten Eingaben: Ziel 8, zwei Karten mit Stufe 4 treffen genau
const sum = { amount: 8, select_max: 0, selects_must: [], selects: [{ amount: 4 }, { amount: 4 }, { amount: 3 }] };
assert.deepEqual(sumState(sum, new Set([0, 1])), { total: 8, ok: true });
assert.equal(sumState(sum, new Set([0, 2])).ok, false);
assert.equal(sumState({ ...sum, select_max: 1 }, new Set([0, 2])).ok, false, 'at least the target: 7 is not enough');
assert.equal(sumState({ ...sum, select_max: 1 }, new Set([0, 1])).ok, true, 'at least the target, every card needed');

g.close();

// Animation: Banner und LP-Schritte aus den Ereignissen einer echten Partie (Swap Frog beschwören, Zug beenden, angreifen)
const h = newGame({ lib, table, scripts, me: codes(decks.frogOtk), bot: codes(decks.blackwing), hand: [id.get('Swap Frog'), id.get('Scapegoat')], seed: [5n, 6n, 7n, 8n] });
let seen = animationSteps(h.events, '');
assert.deepEqual(seen.steps.map((s) => s.text), ['Draw-Phase', 'Standby-Phase', 'Main-Phase 1'], 'the opening phases');
h.respond({ type: R.SELECT_IDLECMD, action: IDLE.SELECT_SUMMON, index: h.prompt.summons.findIndex((c) => table.name(c.code) === 'Swap Frog') });
h.respond({ type: R.SELECT_EFFECTYN, yes: false });
let n = h.events.length;
h.respond(phaseMenu(h.prompt, h.phase).find((m) => m.id === 'EP').response);
let next = animationSteps(h.events.slice(n), seen.lastPhase);
const banners = next.steps.map((s) => s.text);
assert.ok(banners.length >= 3 && banners.at(-1) === 'Main-Phase 1', `a whole round of phases: ${banners}`);
assert.ok(banners.every((t, i) => t !== banners[i - 1]), 'never the same phase twice in a row');
assert.ok(banners.includes('Draw-Phase') && banners.includes('End-Phase'));
n = h.events.length;
h.respond(phaseMenu(h.prompt, h.phase).find((m) => m.id === 'BP').response);
seen = animationSteps(h.events.slice(n), next.lastPhase);
assert.deepEqual(seen.steps.map((s) => s.text), ['Battle-Phase']);
n = h.events.length;
h.respond([...actionsByCard(h.prompt, table).values()].flat().find((a) => a.label === 'Angreifen').response);
assert.equal(h.prompt.type, M.SELECT_CHAIN, 'the engine first offers a chain response to the attack declaration');
h.respond({ type: R.SELECT_CHAIN, index: null });
next = animationSteps(h.events.slice(n), seen.lastPhase);
assert.deepEqual(next.steps, [{ kind: 'lp', change: 'damage', side: 'bot', amount: 1000, lp: 7000 }], 'the attack: LP step only, the Damage Step has no banner');
assert.deepEqual(animationSteps([], 'Main-Phase 1'), { steps: [], lastPhase: 'Main-Phase 1' });
h.close();

// LP-Kreis: Anteil von 8000, oben gedeckelt, Farbton rot → gelb → grün
assert.deepEqual(lpRing(8000), { ratio: 1, hue: 120 });
assert.deepEqual(lpRing(4000), { ratio: 0.5, hue: 60 });
assert.deepEqual(lpRing(0), { ratio: 0, hue: 0 });
assert.equal(lpRing(12000).ratio, 1);
assert.equal(lpRing(-50).ratio, 0);
for (const phase of Object.values(PHASE).filter((p) => p !== 'Damage Step')) assert.ok(PHASE_BANNER[phase], `banner text for ${phase}`);

console.log('duel-view: all checks passed');
