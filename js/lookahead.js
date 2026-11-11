// Lookahead für den Bot: Am Anfang seines Zugs rechnet er seine besten Kandidaten in Probewelten durch und nimmt
// den mit dem besten Mittelwert. Eine Probewelt ist ein neues Duell aus dem öffentlichen Brett; meine verdeckten
// Karten (Hand, gesetzte Karten, Deck) werden aus dem Restpool meiner Decklist gezogen (js/guess.js). Der Bot
// liest also nie meine echten verdeckten Karten.
//   opts.botHook = lookahead(opts)   // opts = dieselben Optionen wie für newGame
// ponytail: die Probewelt kennt keine Zähler und keine „einmal pro Zug“-Marken und gilt nur am Zuganfang; nach der
// ersten Aktion spielen beide Seiten die Faustregeln. Baumsuche über mehrere Aktionen, wenn das messbar hilft.
import { newGame, seededRandom, botAnswer, L, P, M, R, IDLE } from './duel-core.js';
import { botPlay, mainCandidates } from './decide.js';
import { unseenPool } from './guess.js';

const CANDIDATES = 3; const WORLDS = 4;
const STOP_TURN = 4;         // Probewelt: Zug 1 ich passe, Zug 2 Bot, Zug 3 ich, dann Bewertung
const MAX_STEPS = 80;
const TYPE_MONSTER = 1; const MAIN1 = 4;
const LIST = { [IDLE.SELECT_SUMMON]: 'summons', [IDLE.SELECT_SPECIAL_SUMMON]: 'special_summons', [IDLE.SELECT_ACTIVATE]: 'activates', [IDLE.SELECT_SPELL_SET]: 'spell_sets' };

/** Zieht `count` Karten ohne Zurücklegen aus items = [[code, gewicht]], verändert bag (Map code -> Anzahl). */
function draw(bag, count, rand, weight = () => 1) {
  const out = [];
  for (let k = 0; k < count; k += 1) {
    const items = [...bag].map(([code, n]) => [code, n * weight(code)]).filter(([, w]) => w > 0);
    let r = rand() * items.reduce((sum, [, w]) => sum + w, 0);
    const hit = items.find(([, w]) => (r -= w) <= 0) ?? items.at(-1);
    if (!hit) break;
    out.push(hit[0]);
    if (bag.get(hit[0]) === 1) bag.delete(hit[0]); else bag.set(hit[0], bag.get(hit[0]) - 1);
  }
  return out;
}
const counted = (codes) => [...codes.reduce((map, c) => map.set(c, (map.get(c) ?? 0) + 1), new Map())].map(([card, count]) => ({ card, count }));

/**
 * Startstellung einer Probewelt. view = g.view(), bot/me = Spielerindex. Von meiner Seite werden nur öffentliche
 * Dinge gelesen: offene Karten, Friedhof, verbannt, Extra Deck, Positionen und Anzahlen. weights = Setz-Tendenzen
 * nach Passcode. Der Bot zieht in der Probewelt eine Karte: dafür liegt eine seiner Handkarten oben auf dem Deck.
 */
export function snapshot(view, { bot, me, lp, botMain, meMain, table, weights = {} }, rand) {
  const cards = [];
  const put = (side, code, location, sequence = 0, position = P.FACEDOWN_DEFENSE) => cards.push({ side, code, location, sequence, position });
  const isMonster = (code) => !!(table.data.get(code)?.type & TYPE_MONSTER);
  const down = (c) => !!(c.position & P.FACEDOWN);

  const b = view[bot];
  const botSeen = [...b.hand, ...b.mz, ...b.st, b.field, ...b.gy, ...b.banished].filter(Boolean).map((c) => c.code);
  const botDeck = draw(unseenPool(counted(botMain), botSeen).copies, b.deck, rand);
  const botHand = b.hand.map((c) => c.code);
  if (botHand.length) botDeck.push(botHand.pop());
  botDeck.forEach((code) => put('bot', code, L.DECK));
  botHand.forEach((code, i) => put('bot', code, L.HAND, i, P.FACEDOWN));

  const mine = view[me];
  const open = [...mine.mz, ...mine.st, mine.field].filter((c) => c && !down(c));
  const bag = unseenPool(counted(meMain), [...open, ...mine.gy, ...mine.banished].map((c) => c.code)).copies;
  const setMonsters = draw(bag, mine.mz.filter((c) => c && down(c)).length, rand, (code) => (isMonster(code) ? weights[code] ?? 1 : 0));
  const setBackrow = draw(bag, mine.st.filter((c) => c && down(c)).length, rand, (code) => (isMonster(code) ? 0 : 1));
  // Ich ziehe in Zug 1 der Probewelt eine Karte: eine Handkarte weniger, eine Deckkarte mehr.
  draw(bag, Math.max(0, mine.hand.length - 1), rand).forEach((code, i) => put('me', code, L.HAND, i, P.FACEDOWN));
  draw(bag, mine.deck + Math.min(1, mine.hand.length), rand).forEach((code) => put('me', code, L.DECK));

  for (const [side, v, hidden] of [['bot', b, null], ['me', mine, { mz: setMonsters, st: setBackrow }]]) {
    for (const [zone, location] of [['mz', L.MZONE], ['st', L.SZONE]]) {
      v[zone].forEach((c, i) => { if (c) put(side, hidden && down(c) ? hidden[zone].pop() ?? c.code : c.code, location, i, c.position); });
    }
    if (v.field) put(side, v.field.code, L.SZONE, 5, v.field.position);
    v.gy.forEach((c) => put(side, c.code, L.GRAVE, 0, P.FACEUP));
    v.banished.forEach((c) => put(side, c.code, L.REMOVED, 0, P.FACEUP));
    v.extra.forEach((c) => put(side, c.code, L.EXTRA));
  }
  return { lp: { me: lp[me], bot: lp[bot] }, cards };
}

const value = (g) => {
  if (g.winner !== null) return g.winner === g.bot ? 1e6 : g.winner === g.me ? -1e6 : 0;
  const [mine, foe] = [g.view()[g.bot], g.view()[g.me]];
  const atk = (v) => v.mz.filter(Boolean).reduce((sum, c) => sum + (c.position & P.DEFENSE ? 0 : c.attack), 0);
  const count = (v) => v.hand.length + [...v.mz, ...v.st].filter(Boolean).length;
  return g.lp[g.bot] - g.lp[g.me] + atk(mine) - atk(foe) + 300 * (count(mine) - count(foe));
};

/** Spielt eine Probewelt: Bot beginnt mit `first` ({ action, code }), danach Faustregeln auf beiden Seiten. null = nicht spielbar. */
export function rollout(opts, start, first) {
  let done = false; let g = null;
  const botHook = (m) => {
    if (done || m.type !== M.SELECT_IDLECMD) return undefined;
    done = true;
    if (!LIST[first.action]) return { type: R.SELECT_IDLECMD, action: first.action, index: null };
    const index = m[LIST[first.action]].findIndex((c) => c.code === first.code);
    return index < 0 ? undefined : { type: R.SELECT_IDLECMD, action: first.action, index };
  };
  try {
    g = newGame({ lib: opts.lib, table: opts.table, scripts: opts.scripts, me: opts.me, bot: opts.bot, start, seed: [1n, 1n, 1n, 1n], botPlays: true, botHook, stopTurn: STOP_TURN });
    const mirror = Object.assign(Object.create(g), { bot: g.me, me: g.bot }); // ich, gespielt nach den Regeln des Bots
    let turn = 0;
    for (let i = 0; g.prompt && i < MAX_STEPS; i += 1) {
      const m = g.prompt;
      if (g.turn !== turn) { turn = g.turn; mirror.botActs = 0; }
      const pass = m.type === M.SELECT_CHAIN && !m.forced ? { type: R.SELECT_CHAIN, index: null } : m.type === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : null;
      g.respond(g.turn === 1 ? pass ?? botAnswer(m, opts.table, mirror) : botPlay(m, opts.table, mirror) || botAnswer(m, opts.table, mirror));
    }
    return done ? value(g) : null;
  } catch { return null; } finally { g?.close(); }
}

/** Der Haken für newGame: entscheidet die erste Hauptphasen-Aktion jedes Bot-Zugs (nicht in Zug 1: dort gibt es keinen Angriff). */
export function lookahead(opts, weights = {}) {
  return (m, g) => { // Merker liegt am Spiel, nicht am Haken: ein Replay (Rückgängig) entscheidet wieder gleich
    if (m.type !== M.SELECT_IDLECMD || g.active !== g.bot || g.phase !== MAIN1 || g.turn === 1 || g.lookTurn === g.turn) return undefined;
    g.lookTurn = g.turn;
    const cands = mainCandidates(m, opts.table, g).slice(0, CANDIDATES);
    if (cands.length < 2) return undefined;
    const firsts = cands.map((c) => ({ action: c.response.action, code: m[LIST[c.response.action]]?.[c.response.index]?.code }));
    const sums = cands.map(() => 0);
    const view = g.view();
    for (let w = 0; w < WORLDS; w += 1) {
      const rand = seededRandom([opts.seed[0] ^ BigInt(g.turn * 16 + w), ...opts.seed.slice(1)]);
      const start = snapshot(view, { bot: g.bot, me: g.me, lp: g.lp, botMain: opts.bot.main, meMain: opts.me.main, table: opts.table, weights }, rand);
      const values = firsts.map((first) => rollout(opts, start, first));
      if (values.every((v) => v !== null)) values.forEach((v, i) => { sums[i] += v; }); // nur Welten, in denen alle Kandidaten spielbar waren
    }
    (g.lookLog ??= []).push({ turn: g.turn, sums });
    return cands[sums.indexOf(Math.max(...sums))].response; // Gleichstand: der Kandidat mit dem höheren Score
  };
}
