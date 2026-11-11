// Bot-Entscheidungen: wählt unter den legalen Aktionen, die die Engine anbietet. Die Regeln bestimmt die Engine.
// Phase 1 des Entscheidungsmoduls: die bisherige Heuristik, unverändert, nur an einen eigenen Ort verschoben.
import { OcgLocation as L, OcgPosition as P, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as IDLE, SelectBattleCMDAction as BATTLE } from '../vendor/ocgcore/index.js';

const ZONES = 5;
const FACEDOWN_GUESS = 1500; // the bot must not peek at my face-down monsters
const TYPE_SPELL = 2; const TYPE_TRAP = 4; const TYPE_CONTINUOUS = 0x20000; const TYPE_FIELD = 0x80000;
const MAX_BACKROW = 3; // do not overcommit into Heavy Storm
const MAX_BOARD_INTO_BACKROW = 3; // ... or into Mirror Force / Torrential Tribute when I have 2+ set cards
const MAX_ACTIONS_PER_TURN = 15; // stops effect loops (e.g. Swap Frog bouncing itself forever)
// Normal Spells the bot may play from its hand, each with the board it needs (foe = my side as seen by the bot).
const SPELL_WHEN = {
  'Allure of Darkness': () => true,
  'Pot of Avarice': () => true,
  'Mystical Space Typhoon': (own, foe) => foe.backrow > 0,
  'Heavy Storm': (own, foe) => foe.backrow >= 2 && foe.backrow > own.backrow,
  'Giant Trunade': (own, foe) => foe.backrow >= 2 && own.backrow === 0,
  'Brain Control': (own, foe) => foe.faceUp > 0
};


// Phase 3: Bewertung der Hauptphase. Die Gewichte sind so gewählt, dass die Kategorie-Reihenfolge der bisherigen
// Heuristik (Zauber, Beschwörung, Spezialbeschwörung, Effekt, Falle, Battle Phase) gilt. Die Bewertung entscheidet
// nur innerhalb einer Kategorie, z. B. welche Spezialbeschwörung. Ein Abstand von 1000 zwischen den Kategorien ist
// größer als jeder Wert innerhalb einer Kategorie (ATK-Anteil höchstens 0,1 * 2800 = 280).
export const WEIGHTS = {
  board: 0.1, damage: 0.1, hand: 10, risk: 10,
  kind: { spell: 4000, summon: 3000, special: 2000, effect: 1000, set: 500, phase: 0 }
};

export function score(cat, f, w = WEIGHTS) {
  return w.kind[cat] + w.board * f.boardGain + w.damage * f.damage - w.hand * f.handCost - w.risk * f.risk;
}

// Softmax-Auswahl: mit Temperatur 0 ist es immer die beste Aktion. Phase 4 setzt die Temperatur je Profil.
export function pickSoftmax(scored, temperature, rand = Math.random) {
  if (temperature <= 0 || scored.length === 1) return scored.reduce((a, b) => (b.score > a.score ? b : a));
  const top = Math.max(...scored.map((x) => x.score));
  const weights = scored.map((x) => Math.exp((x.score - top) / temperature));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return scored[i];
  }
  return scored[scored.length - 1];
}

function logBattle(g, entry) {
  (g.botLog ??= []).push(entry);
}

const act = (action, index) => ({ type: R.SELECT_IDLECMD, action, index });
const sideOf = (v) => ({ backrow: v.st.filter(Boolean).length, faceUp: v.mz.filter((c) => c && !(c.position & P.FACEDOWN)).length });

// Alle Hauptphasen-Aktionen, die die bisherigen Regeln zulassen, mit Score, beste zuerst. Bei Gleichstand gewinnt die früher genannte.
export function mainCandidates(m, table, g, mine = g.view()[g.bot], theirs = g.view()[g.me]) {
  const data = (c) => table.data.get(c.code);
  const own = sideOf(mine); const foe = sideOf(theirs);
  const feats = features(m, table, g, g.bot);
  const f = (kind, index) => feats.find((x) => x.kind === kind && x.index === index) ?? {};
  const cands = [];
  const add = (cat, kind, index, response) => cands.push({ response, score: score(cat, f(kind, index)) });
  m.activates.forEach((c, i) => {
    const spell = c.location === L.HAND && data(c)?.type & TYPE_SPELL;
    if (spell && (data(c).type & (TYPE_CONTINUOUS | TYPE_FIELD) || SPELL_WHEN[table.name(c.code)]?.(own, foe))) add('spell', 'activates', i, act(IDLE.SELECT_ACTIVATE, i));
  });
  m.summons.forEach((c, i) => { if (data(c)?.level <= 4) add('summon', 'summons', i, act(IDLE.SELECT_SUMMON, i)); });
  if (mine.mz.filter(Boolean).length < (foe.backrow >= 2 ? MAX_BOARD_INTO_BACKROW : ZONES)) {
    m.special_summons.forEach((c, i) => add('special', 'special_summons', i, act(IDLE.SELECT_SPECIAL_SUMMON, i)));
  }
  m.activates.forEach((c, i) => { if (c.location === L.MZONE) add('effect', 'activates', i, act(IDLE.SELECT_ACTIVATE, i)); });
  if (own.backrow < MAX_BACKROW) {
    m.spell_sets.forEach((c, i) => { if (data(c)?.type & TYPE_TRAP) add('set', 'spell_sets', i, act(IDLE.SELECT_SPELL_SET, i)); });
  }
  if (m.to_bp) add('phase', 'to_bp', null, act(IDLE.TO_BP, null));
  return cands.map((c, i) => ({ ...c, i })).sort((a, b) => b.score - a.score || a.i - b.i); // beste zuerst
}

/**
 * Simple active bot (rules of thumb, no look-ahead). Returns undefined when it has nothing to do,
 * then botAnswer passes. Its Main Phase, in this order (Blackwing-style tempo, works for any deck):
 *   1. activate Continuous/Field Spells and the Normal Spells in SPELL_WHEN (Black Whirlwind first),
 *   2. Normal Summon the strongest Level 4 or lower monster (triggers Whirlwind),
 *   3. Special Summon whatever the engine offers (Bora, Gale, Dark Armed Dragon, Synchros),
 *   4. use monster effects on the field (Gale, Dark Armed Dragon), 5. set traps, 6. attack.
 * Attack order is always lowest ATK first, so an opposing Gorz gets the smallest token.
 * ponytail: no tribute summons and no per-deck combo plans; add a plan table per deck when needed.
 */
export function botPlay(m, table, g) {
  const view = g.view(); const mine = view[g.bot]; const theirs = view[g.me];
  const foes = theirs.mz.filter(Boolean);
  const data = (c) => table.data.get(c.code);
  if (m.type === M.SELECT_IDLECMD && (g.botActs = (g.botActs ?? 0) + 1) <= MAX_ACTIONS_PER_TURN) {
    const best = mainCandidates(m, table, g, mine, theirs)[0];
    if (best) return best.response;
  }
  const value = (c) => (c.position & P.FACEDOWN ? FACEDOWN_GUESS : c.position & P.DEFENSE ? c.defense : c.attack);
  if (m.type === M.SELECT_BATTLECMD) {
    const weakest = Math.min(...foes.map(value));
    const weakestCard = foes.reduce((x, y) => (value(y) < value(x) ? y : x), foes[0] ?? {});
    const next = m.attacks.map((c, index) => ({ index, atk: mine.mz[c.sequence]?.attack ?? 0, direct: c.can_direct }))
      .filter((a) => a.direct || a.atk > weakest).sort((a, b) => a.atk - b.atk)[0];
    // Protokoll (ändert nichts): was der Bot hatte, welches Ziel er als schwächstes sah, und was er tat.
    logBattle(g, {
      turn: g.turn,
      attackers: m.attacks.map((c) => ({ atk: mine.mz[c.sequence]?.attack ?? 0, direct: !!c.can_direct })),
      weakest: foes.length ? { value: weakest, faceDown: !!(weakestCard.position & P.FACEDOWN) } : null,
      chosen: next ? { atk: next.atk, direct: !!next.direct } : null
    });
    if (next) { g.botAtk = next.atk; return { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index: next.index }; }
  }
  if (m.type === M.SELECT_CARD) {
    const count = Math.min(Math.max(m.min, 1), m.selects.length);
    // Attack target: the strongest monster this attacker still beats.
    if (g.botAtk != null && m.selects.every((c) => c.controller === g.me && c.location === L.MZONE)) {
      const atk = g.botAtk; g.botAtk = null;
      const beat = m.selects.map((c, index) => ({ index, v: value(theirs.mz[c.sequence]) })).filter((t) => t.v < atk).sort((a, b) => b.v - a.v)[0];
      if (beat) return { type: R.SELECT_CARD, indicies: [beat.index] };
    }
    // A choice across both fields is removal (Icarus Attack, Dark Armed Dragon): hit my cards, not its own.
    const sides = new Set(m.selects.map((c) => c.controller));
    if (sides.size === 2) {
      const order = m.selects.map((c, index) => ({ index, own: c.controller === g.bot })).sort((a, b) => a.own - b.own);
      return { type: R.SELECT_CARD, indicies: order.slice(0, count).map((x) => x.index).sort((a, b) => a - b) };
    }
  }
  return undefined;
}

/**
 * Phase 2: Merkmale jeder legalen Aktion aus Sicht von `side`. Die Funktion verändert den Zustand nicht und
 * entscheidet nichts. Sie wird protokolliert, damit Phase 3 (Bewertung) später darauf aufbauen kann.
 * boardGain: ATK, die das Feld dazugewinnt. handCost: Karten, die die Hand verlassen. damage: erwarteter Schaden.
 * risk: verdeckte Karten des Gegners, die auf die Aktion antworten könnten (nur die Anzahl ist öffentlich).
 * Gegnerische verdeckte Monster zählen mit FACEDOWN_GUESS, nicht mit ihren echten Werten.
 */
export function features(m, table, g, side = g.bot) {
  const view = g.view();
  const own = view[side]; const foe = view[1 - side];
  const data = (c) => table.data.get(c.code);
  const hand = (c) => (c.location === L.HAND ? 1 : 0);
  const risk = foe.st.filter((c) => c && c.position & P.FACEDOWN).length;
  const valueOf = (c) => (c.position & P.FACEDOWN ? FACEDOWN_GUESS : c.position & P.DEFENSE ? c.defense : c.attack);
  const foeTop = Math.max(0, ...foe.mz.filter(Boolean).map(valueOf));
  const out = [];
  const add = (kind, index, f) => out.push({ kind, index, boardGain: 0, handCost: 0, damage: 0, risk: 0, ...f });
  if (m.type === M.SELECT_IDLECMD) {
    for (const field of ['summons', 'special_summons']) {
      m[field].forEach((c, i) => add(field, i, { boardGain: data(c)?.attack ?? 0, handCost: hand(c), risk }));
    }
    m.monster_sets.forEach((c, i) => add('monster_sets', i, { boardGain: data(c)?.defense ?? 0, handCost: hand(c) }));
    m.spell_sets.forEach((c, i) => add('spell_sets', i, { handCost: hand(c) }));
    m.activates.forEach((c, i) => add('activates', i, { handCost: hand(c), risk }));
    if (m.to_bp) add('to_bp', null, {});
    if (m.to_ep) add('to_ep', null, {});
  } else if (m.type === M.SELECT_BATTLECMD) {
    m.attacks.forEach((c, i) => {
      const atk = own.mz[c.sequence]?.attack ?? 0;
      add('attacks', i, { damage: c.can_direct ? atk : Math.max(0, atk - foeTop), risk });
    });
    m.chains.forEach((c, i) => add('chains', i, { handCost: hand(c), risk }));
  }
  return out;
}
